export interface SampledFrame {
  timestamp: number;
  image: string;
}

export interface Ps5Observation {
  phase: "clear" | "approaching" | "crossed" | "uncertain";
  confidence: number;
  crossingAt: number | null;
}

export interface PickupState {
  count: number;
  lastCrossingAt: number;
  lastAnalyzedAt: number;
  armed: boolean;
  clearSamples: number;
}

export function emptyPickupState(): PickupState {
  return { count: 0, lastCrossingAt: -1, lastAnalyzedAt: -1, armed: true, clearSamples: 0 };
}

// Overlapping image windows must not award the same pickup repeatedly.
export function applyObservation(
  state: PickupState,
  observation: Ps5Observation,
  frames: SampledFrame[],
): PickupState {
  const latest = frames.at(-1)?.timestamp ?? -1;
  if (latest <= state.lastAnalyzedAt) return state;
  const next = { ...state, lastAnalyzedAt: latest };
  if (observation.confidence < 0.85) return { ...next, clearSamples: 0 };
  if (observation.phase === "clear") {
    next.clearSamples += 1;
    if (next.clearSamples >= 2) next.armed = true;
  } else if (observation.phase === "approaching") {
    // A new approach can rearm even when consoles are close together.
    if (latest - state.lastCrossingAt >= 2000) next.armed = true;
    next.clearSamples = 0;
  } else {
    next.clearSamples = 0;
    const at = observation.crossingAt;
    if (observation.phase === "crossed" && next.armed && at !== null &&
        at > state.lastCrossingAt && frames.some((frame) => frame.timestamp === at)) {
      next.count += 1;
      next.lastCrossingAt = at;
      next.armed = false;
    }
  }
  return next;
}
