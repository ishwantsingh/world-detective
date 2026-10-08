"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  useLingbotWorld2,
  useLingbotWorld2Message,
} from "@reactor-models/lingbot-world-2";
import type { BroomKey, BroomSteeringDecision } from "@/lib/broom-autopilot";
import type { SampledFrame } from "@/lib/ps5-detection";

const MIN_CONFIDENCE = 0.55;
const STEER_AMOUNT = 0.055;
const CHUNK_LATENTS = 3;

function decisionLabel(decision: BroomSteeringDecision | null) {
  if (!decision) return "waiting for frames";
  if (decision.target === "none") return "no ring in view — holding";
  return `${decision.target} · ${decision.keys.length ? decision.keys.join(" + ") : "holding"}`;
}

export function BroomTrialAutopilot({ videoContainer }: {
  videoContainer: RefObject<HTMLDivElement | null>;
}) {
  const lw2 = useLingbotWorld2();
  const { status, sessionId } = lw2;
  const [enabled, setEnabled] = useState(false);
  const [running, setRunning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [decision, setDecision] = useState<BroomSteeringDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enabledRef = useRef(false);
  const runningRef = useRef(false);
  const decisionRef = useRef<BroomSteeringDecision | null>(null);

  const stop = () => {
    decisionRef.current = null;
    setDecision(null);
    void lw2.setMoveLongitudinal({ move_longitudinal: "idle" });
    void lw2.setMoveLateral({ move_lateral: "idle" });
    void lw2.setCameraPose({ camera_pose: [] });
  };

  const applyDecision = (next: BroomSteeringDecision) => {
    // A low-confidence suggestion is deliberately converted to neutral controls.
    const keys = next.confidence >= MIN_CONFIDENCE ? new Set<BroomKey>(next.keys) : new Set<BroomKey>();
    const longitudinal = keys.has("w") ? "forward" : keys.has("s") ? "back" : "idle";
    const lateral = keys.has("a") ? "strafe_left" : keys.has("d") ? "strafe_right" : "idle";
    void lw2.setMoveLongitudinal({ move_longitudinal: longitudinal });
    void lw2.setMoveLateral({ move_lateral: lateral });
    decisionRef.current = { ...next, keys: [...keys] };
    setDecision(decisionRef.current);
  };

  // The backend consumes camera pose a chunk at a time. Re-send the latest
  // arrow-key intent at each heartbeat; WASD remains stateful until changed.
  useLingbotWorld2Message((raw: unknown) => {
    const message = raw as { type?: string; started?: boolean; running?: boolean; paused?: boolean };
    if (message.type === "generation_started" ||
        (message.type === "state" && message.started && message.running && !message.paused)) {
      runningRef.current = true;
      setRunning(true);
    }
    if (message.type === "generation_paused" || message.type === "generation_complete" ||
        (message.type === "state" && (!message.started || !message.running || message.paused))) {
      runningRef.current = false;
      setRunning(false);
      if (enabledRef.current) stop();
    }
    if (message.type !== "chunk_complete" || !enabledRef.current || !runningRef.current) return;
    const keys = decisionRef.current?.keys ?? [];
    const pitch = (keys.includes("ArrowUp") ? STEER_AMOUNT : 0) - (keys.includes("ArrowDown") ? STEER_AMOUNT : 0);
    const yaw = (keys.includes("ArrowRight") ? STEER_AMOUNT : 0) - (keys.includes("ArrowLeft") ? STEER_AMOUNT : 0);
    if (pitch === 0 && yaw === 0) {
      void lw2.setCameraPose({ camera_pose: [] });
      return;
    }
    const pose = Array.from({ length: CHUNK_LATENTS }, () => [pitch, yaw, 0, 0, 0, 0]).flat();
    void lw2.setCameraPose({ camera_pose: pose });
  });

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      stop();
      setChecking(false);
      setError(null);
    }
  // Commands intentionally run only when the toggle changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    runningRef.current = false;
    setRunning(false);
    setDecision(null);
    setError(null);
    if (enabledRef.current) stop();
  // Session changes must never retain the previous run's controls.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sessionId]);

  useEffect(() => {
    if (!enabled || status !== "ready" || !running) return;
    const canvas = document.createElement("canvas");
    let frames: SampledFrame[] = [];
    let lastVideoTime = -1;
    let busy = false;
    let stopped = false;
    let failures = 0;
    let retryAfter = 0;
    let pending: AbortController | null = null;

    async function steer() {
      if (stopped || busy || !enabledRef.current || !runningRef.current || document.hidden || Date.now() < retryAfter) return;
      const video = videoContainer.current?.querySelector("video");
      if (!video || video.readyState < 2 || !video.videoWidth || video.paused || video.ended || video.currentTime === lastVideoTime) return;
      const scale = Math.min(1, 512 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Video capture unavailable");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
        if (!image || image.length > 250_000) throw new Error("Video frame is too large to analyze");
        lastVideoTime = video.currentTime;
        frames = [...frames, { timestamp: Math.round(performance.now()), image }].slice(-3);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not capture live video");
        setEnabled(false);
        return;
      }
      if (frames.length < 2) return;
      busy = true;
      setChecking(true);
      const controller = new AbortController();
      pending = controller;
      try {
        const response = await fetch("/api/broom/steer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frames: [...frames] }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Gemini steering failed");
        if (!stopped && enabledRef.current && runningRef.current) {
          applyDecision(body as BroomSteeringDecision);
          setError(null);
          failures = 0;
        }
      } catch (cause) {
        if (!stopped && enabledRef.current) {
          failures += 1;
          retryAfter = Date.now() + Math.min(30_000, 1000 * 2 ** failures);
          frames = [];
          stop();
          setError(cause instanceof Error ? cause.message : "Gemini steering unavailable");
        }
      } finally {
        busy = false;
        pending = null;
        if (!stopped) setChecking(false);
      }
    }

    const timer = window.setInterval(() => { void steer(); }, 850);
    return () => {
      stopped = true;
      pending?.abort();
      window.clearInterval(timer);
      setChecking(false);
    };
  // applyDecision intentionally uses the current SDK command wrappers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, status, running, videoContainer]);

  const available = status === "ready" && running;
  return (
    <div className="rounded-xl border border-sky-300/20 bg-sky-300/[0.05] p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs font-medium uppercase tracking-widest text-sky-200">Gemini broom autopilot</div>
          <p className="mt-1 text-[11px] leading-snug text-white/55">Watches consecutive LingBot frames and steers with WASD plus arrow-direction camera poses to line up the next ring.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={!available}
          onClick={() => setEnabled((value) => !value)}
          className={`shrink-0 rounded-md border px-3 py-1.5 font-mono text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${enabled ? "border-sky-300/60 bg-sky-300/20 text-sky-100" : "border-white/15 bg-white/5 text-white/65 hover:bg-white/10"}`}
        >
          {enabled ? "AUTOPILOT ON" : "START AUTOPILOT"}
        </button>
      </div>
      <div className="mt-2 font-mono text-[10px] text-white/50">
        {error ? <span className="text-amber-300">{error}</span> : !available ? "Start the wizard flight to enable control" : checking ? "Gemini · reading live frames…" : `Gemini · ${decisionLabel(decision)}`}
      </div>
      {enabled && <p className="mt-2 text-[10px] text-sky-100/70">Autopilot refreshes movement from every visual decision. Turning it off immediately sends neutral movement so you can take over.</p>}
    </div>
  );
}
