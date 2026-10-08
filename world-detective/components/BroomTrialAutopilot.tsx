"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useLingbotWorld2 } from "@reactor-models/lingbot-world-2";
import {
  BROOM_TRIAL_SCENE_ID, isBroomDecision, safeBroomKeys,
  type BroomKey, type BroomSteeringDecision,
} from "@/lib/broom-controls";
import type { SampledFrame } from "@/lib/ps5-detection";

function decisionLabel(decision: BroomSteeringDecision | null) {
  if (!decision) return "waiting for frames";
  if (!safeBroomKeys(decision).length) return "holding for a clear ring";
  return `${decision.target} · ${decision.keys.join(" + ")}`;
}

export function BroomTrialAutopilot({
  videoContainer, activeExampleId, generationEpoch, running, onControl,
}: {
  videoContainer: RefObject<HTMLDivElement | null>;
  activeExampleId: string | null;
  generationEpoch: number;
  running: boolean;
  onControl: (keys: BroomKey[] | null) => void;
}) {
  const { status, sessionId } = useLingbotWorld2();
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(false);
  const [decision, setDecision] = useState<BroomSteeringDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enabledRef = useRef(false);
  const onControlRef = useRef(onControl);
  onControlRef.current = onControl;
  const available = status === "ready" && running && activeExampleId === BROOM_TRIAL_SCENE_ID;

  // A new scene/run needs a fresh explicit start; old replies cannot move it.
  useEffect(() => {
    enabledRef.current = false;
    setEnabled(false);
    setDecision(null);
  }, [sessionId, generationEpoch, available]);

  useEffect(() => {
    if (!enabled || !available) return;
    const canvas = document.createElement("canvas");
    let frames: SampledFrame[] = [];
    let lastVideoTime = -1;
    let lastFrameAt = performance.now();
    let lastDecisionAt = -1;
    let busy = false;
    let stopped = false;
    let failures = 0;
    let retryAfter = 0;
    let pending: AbortController | null = null;

    function hold() {
      lastDecisionAt = -1;
      onControlRef.current([]);
      setDecision(null);
    }

    enabledRef.current = true;
    hold(); // claim the main controller before the first inference

    function onVisibilityChange() {
      if (document.hidden) {
        pending?.abort();
        frames = [];
        hold();
      }
    }

    async function sample() {
      if (stopped || !enabledRef.current) return;
      const now = performance.now();
      if (document.hidden) return;
      // Stateful WASD must never stay held during inference/video outages.
      if ((lastDecisionAt >= 0 && now - lastDecisionAt > 5000) || now - lastFrameAt > 2500) hold();
      const video = videoContainer.current?.querySelector("video");
      if (!video || video.readyState < 2 || !video.videoWidth || video.paused || video.ended ||
          video.currentTime === lastVideoTime) return;
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Video capture unavailable");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL("image/jpeg", 0.65).split(",")[1];
        if (!image || image.length > 250_000) throw new Error("Video frame is too large to analyze");
        lastVideoTime = video.currentTime;
        lastFrameAt = now;
        if (frames.length && now - frames[frames.length - 1].timestamp > 2000) frames = [];
        frames = [...frames, { timestamp: Math.round(now), image }].slice(-3);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not capture live video");
        enabledRef.current = false;
        setEnabled(false);
        onControlRef.current(null);
        return;
      }
      // Sampling stays independent of inference; there is no request queue.
      if (frames.length < 2 || busy || Date.now() < retryAfter) return;
      busy = true;
      setChecking(true);
      const frameWindow = [...frames];
      const controller = new AbortController();
      pending = controller;
      try {
        const response = await fetch("/api/broom/steer", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frames: frameWindow }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]),
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          if (response.status === 503 || response.status === 403) {
            enabledRef.current = false;
            setEnabled(false);
            onControlRef.current(null);
          }
          throw new Error((body as { error?: string })?.error || "Gemini steering failed");
        }
        if (stopped || !enabledRef.current || controller.signal.aborted || document.hidden) return;
        if (performance.now() - lastFrameAt > 2500) { hold(); return; }
        if (!isBroomDecision(body)) throw new Error("Gemini returned invalid controls");
        if (performance.now() - frameWindow[frameWindow.length - 1].timestamp > 6000) {
          throw new Error("Steering arrived too late; waiting for a fresh view");
        }
        onControlRef.current(safeBroomKeys(body));
        lastDecisionAt = performance.now();
        setDecision(body);
        setError(null);
        failures = 0;
      } catch (cause) {
        if (!stopped) {
          if (enabledRef.current) hold();
          frames = [];
          if (!controller.signal.aborted) {
            failures += 1;
            retryAfter = Date.now() + Math.min(30_000, 1000 * 2 ** failures);
            setError(cause instanceof Error ? cause.message : "Gemini steering unavailable");
          }
        }
      } finally {
        busy = false;
        pending = null;
        if (!stopped) setChecking(false);
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = window.setInterval(() => { void sample(); }, 850);
    return () => {
      stopped = true;
      enabledRef.current = false;
      pending?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      onControlRef.current(null);
      setDecision(null);
      setChecking(false);
    };
  }, [enabled, available, sessionId, generationEpoch, videoContainer]);

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.05] p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs font-medium uppercase tracking-widest text-primary">Gemini trial autopilot</div>
          <p className="mt-1 text-[11px] leading-snug text-white/55">Flies the broom through the next bannered hoop in Wizard: Ring Flying Trial.</p>
        </div>
        <button
          type="button" role="switch" aria-label="Gemini trial autopilot" aria-checked={enabled}
          disabled={!available && !enabled}
          onClick={() => {
            enabledRef.current = !enabled;
            if (enabled) onControlRef.current(null);
            setError(null);
            setEnabled(!enabled);
          }}
          className={`shrink-0 rounded-md border px-3 py-1.5 font-mono text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${enabled ? "border-primary/60 bg-primary/20 text-white" : "border-white/15 bg-white/5 text-white/65 hover:bg-white/10"}`}
        >
          {enabled ? "STOP AUTOPILOT" : error ? "RETRY AUTOPILOT" : "START AUTOPILOT"}
        </button>
      </div>
      <div role="status" className="mt-2 font-mono text-[10px] text-white/50">
        {error ? <span className="text-amber-300">{error}</span> : !available
          ? "Start Wizard: Ring Flying Trial to enable autopilot"
          : !enabled ? "Ready for the ring trial" : checking
            ? "Gemini · reading live frames…" : `Gemini · ${decisionLabel(decision)}`}
      </div>
      {enabled && <p className="mt-2 text-[10px] text-white/60">Stop autopilot to take over with WASD and arrows.</p>}
    </div>
  );
}
