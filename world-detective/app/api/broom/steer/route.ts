import { DEFAULT_GEMINI_MODEL } from "../../../../lib/ps5-gemini";
import {
  analyzeBroomFrames,
  BroomAutopilotError,
  readBroomSteeringRequest,
} from "../../../../lib/broom-autopilot";

export const runtime = "nodejs";
export const maxDuration = 30;

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  if (request.headers.get("origin") !== `${url.protocol}//${host}`) {
    return Response.json({ error: "Same-origin requests only" }, { status: 403, headers });
  }
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Set GEMINI_API_KEY on the server to enable Gemini autopilot" }, { status: 503, headers });
  }
  try {
    const frames = await readBroomSteeringRequest(request);
    const decision = await analyzeBroomFrames(
      frames,
      apiKey,
      process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    );
    return Response.json(decision, { headers });
  } catch (error) {
    if (error instanceof BroomAutopilotError) {
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    return Response.json({ error: "Gemini steering unavailable; retrying shortly" }, { status: 502, headers });
  }
}
