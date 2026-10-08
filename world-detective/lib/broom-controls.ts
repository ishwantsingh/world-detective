export const BROOM_TRIAL_SCENE_ID = "wizard_ring_flying_trial";
export const BROOM_KEYS = ["w", "s", "a", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
export type BroomKey = (typeof BROOM_KEYS)[number];
export interface BroomSteeringDecision {
  keys: BroomKey[];
  confidence: number;
  target: "ring" | "recover" | "none";
}

export function isValidKeySet(keys: unknown): keys is BroomKey[] {
  if (!Array.isArray(keys) || keys.length > 4 ||
      keys.some((key) => !(BROOM_KEYS as readonly unknown[]).includes(key))) return false;
  const set = new Set(keys);
  return set.size === keys.length &&
    ![["w", "s"], ["a", "d"], ["ArrowUp", "ArrowDown"], ["ArrowLeft", "ArrowRight"]]
      .some(([first, second]) => set.has(first) && set.has(second));
}

export function isBroomDecision(value: unknown): value is BroomSteeringDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const decision = value as BroomSteeringDecision;
  return isValidKeySet(decision.keys) && typeof decision.confidence === "number" &&
    Number.isFinite(decision.confidence) && decision.confidence >= 0 && decision.confidence <= 1 &&
    ["ring", "recover", "none"].includes(decision.target);
}

export function safeBroomKeys(decision: unknown): BroomKey[] {
  return isBroomDecision(decision) && decision.confidence >= 0.55 && decision.target !== "none"
    ? [...decision.keys] : [];
}

export function broomMotion(keys: readonly BroomKey[]) {
  return {
    longitudinal: keys.includes("w") ? "forward" as const : keys.includes("s") ? "back" as const : "idle" as const,
    lateral: keys.includes("a") ? "strafe_left" as const : keys.includes("d") ? "strafe_right" as const : "idle" as const,
    pitch: (keys.includes("ArrowUp") ? 0.055 : 0) - (keys.includes("ArrowDown") ? 0.055 : 0),
    yaw: (keys.includes("ArrowRight") ? 0.055 : 0) - (keys.includes("ArrowLeft") ? 0.055 : 0),
  };
}
