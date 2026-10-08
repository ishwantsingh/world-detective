// Fallen World's bundled scenes. Event order maps directly to number hold-keys.
// Add scenes as JSON under lib/lingbot-cases and images under public/lingbot-cases.
import type { StructuredExample } from "@/lib/lingbot-world-prompts";
import fallGuysPs5 from "./lingbot-cases/fallguys-ps5.json";
import footballSoloDrill from "./lingbot-cases/football-solo-drill.json";

export const LINGBOT_CASES_EXAMPLE_LIST: StructuredExample[] = [
  fallGuysPs5,
  footballSoloDrill,
];
