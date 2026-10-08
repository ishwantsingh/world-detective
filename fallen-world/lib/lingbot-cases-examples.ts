// Fallen World's bundled course. Event order maps directly to hold-keys 1–5.
// Add scenes as JSON under lib/lingbot-cases and images under public/lingbot-cases.
import type { StructuredExample } from "@/lib/lingbot-world-prompts";
import fallGuysPs5 from "./lingbot-cases/fallguys-ps5.json";

export const LINGBOT_CASES_EXAMPLE_LIST: StructuredExample[] = [fallGuysPs5];
