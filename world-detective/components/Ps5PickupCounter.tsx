"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useLingbotWorld2, useLingbotWorld2Message } from "@reactor-models/lingbot-world-2";
import { applyObservation, emptyPickupState, type Ps5Observation, type SampledFrame } from "@/lib/ps5-detection";

export function Ps5PickupCounter({ videoContainer }: {
  videoContainer: RefObject<HTMLDivElement | null>;
}) {
  const { status, sessionId } = useLingbotWorld2();
  const pickups = useRef(emptyPickupState());
  const active = useRef(false);
  const started = useRef(false);
  const revision = useRef(0);
  const [count, setCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [flash, setFlash] = useState(false);

  function reset() {
    revision.current += 1;
    pickups.current = emptyPickupState();
    started.current = false;
    active.current = false;
    setCount(0);
    setRunning(false);
    setError(null);
    setFlash(false);
    setEpoch(revision.current);
  }

  function setActive(value: boolean) {
    if (active.current !== value) {
      revision.current += 1;
      setEpoch(revision.current);
    }
    active.current = value;
    setRunning(value);
  }

  useLingbotWorld2Message((raw: unknown) => {
    const message = raw as { type: string; started?: boolean; running?: boolean; paused?: boolean };
    switch (message.type) {
      case "generation_started":
        reset();
        started.current = true;
        setActive(true);
        break;
      case "generation_reset": reset(); break;
      case "generation_paused":
      case "generation_complete": setActive(false); break;
      case "generation_resumed": setActive(true); break;
      case "state":
        if (!message.started) {
          if (started.current) reset();
        } else {
          started.current = true;
          setActive(Boolean(message.running && !message.paused));
        }
        break;
    }
  });

  useEffect(() => { reset(); }, [status, sessionId]); // Session-scoped count.

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), 1500);
    return () => clearTimeout(timer);
  }, [flash, count]);

  useEffect(() => {
    if (status !== "ready" || !running) return;
    const runRevision = revision.current;
    const canvas = document.createElement("canvas");
    let frames: SampledFrame[] = [];
    let lastVideoTime = -1;
    let busy = false;
    let stopped = false;
    let failures = 0;
    let retryAfter = 0;
    let blocked = false;
    let pending: AbortController | null = null;

    async function sample() {
      if (stopped || blocked || !active.current || revision.current !== runRevision) return;
      if (document.hidden) { frames = []; return; }
      const video = videoContainer.current?.querySelector("video");
      if (!video || video.readyState < 2 || !video.videoWidth || video.paused || video.ended ||
          video.currentTime === lastVideoTime) return;
      // Sample independently of inference latency. Keep memory and request size bounded.
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
        const timestamp = Math.round(performance.now());
        if (frames.length && timestamp - frames[frames.length - 1].timestamp > 2000) frames = [];
        frames = [...frames, { timestamp, image }].slice(-5);
      } catch {
        blocked = true;
        setError("Could not capture video frames. Retry detection.");
        return;
      }
      if (frames.length < 2 || busy || Date.now() < retryAfter) return;
      busy = true;
      setChecking(true);
      const window = [...frames];
      const controller = new AbortController();
      pending = controller;
      try {
        const response = await fetch("/api/ps5/detect", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frames: window, lastCrossingAt: pickups.current.lastCrossingAt }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]),
        });
        const body = await response.json();
        if (!response.ok) {
          blocked = response.status === 503 || response.status === 403;
          throw new Error(body.error || "PS5 analysis failed");
        }
        if (stopped || revision.current !== runRevision || !active.current) return;
        const next = applyObservation(pickups.current, body as Ps5Observation, window);
        if (next.count > pickups.current.count) setFlash(true);
        pickups.current = next;
        setCount(next.count);
        setError(null);
        failures = 0;
      } catch (cause) {
        if (stopped || revision.current !== runRevision) return;
        failures += 1;
        retryAfter = Date.now() + Math.min(30_000, 1000 * 2 ** failures);
        frames = []; // Never infer a crossing across an unobserved outage.
        setError(cause instanceof Error ? cause.message : "PS5 analysis unavailable");
      } finally {
        busy = false;
        pending = null;
        if (!stopped && revision.current === runRevision) setChecking(false);
      }
    }

    const timer = setInterval(() => { void sample(); }, 1000);
    return () => {
      stopped = true;
      pending?.abort();
      clearInterval(timer);
      frames = [];
      setChecking(false);
    };
  }, [status, running, epoch, retry, videoContainer]);

  return (
    <div className={`absolute left-3 top-3 z-20 max-w-[75%] rounded-lg border px-3 py-2 text-white shadow-lg backdrop-blur-md transition-colors ${flash ? "border-primary bg-primary/20" : "border-white/15 bg-black/70"}`}>
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium tracking-wider">PS5 COLLECTED</span>
        <span role="status" aria-label={`${count} PS5 consoles collected`} className="font-mono text-xl tabular-nums">{count}</span>
        {flash && <span className="text-sm text-primary">+1</span>}
      </div>
      <div className="mt-0.5 text-[10px] text-white/60">
        {error ? <>
          <span className="text-amber-300">{error}</span>
          <button className="ml-2 underline hover:text-white" onClick={() => { setError(null); setRetry((value) => value + 1); }}>Retry</button>
        </> : status !== "ready" || !running ? "Waiting for live video" : checking ? "Gemini · checking path…" : "Gemini · watching path"}
      </div>
    </div>
  );
}
