import { analyzePs5Frames, DEFAULT_GEMINI_MODEL, DetectionError, readDetectionRequest } from "../../../../lib/ps5-gemini";

export const runtime = "nodejs";
export const maxDuration = 30;

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  // Match the app's local, same-origin workflow; never expose the Google key.
  // Next may normalize request.url to localhost even when accessed via 127.0.0.1.
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  if (request.headers.get("origin") !== `${url.protocol}//${host}`) {
    return Response.json({ error: "Same-origin requests only" }, { status: 403, headers });
  }
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Set GEMINI_API_KEY on the server to enable PS5 detection" }, { status: 503, headers });
  }
  try {
    const { frames, lastCrossingAt } = await readDetectionRequest(request);
    const observation = await analyzePs5Frames(frames, lastCrossingAt, apiKey,
      process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]));
    return Response.json(observation, { headers });
  } catch (error) {
    if (error instanceof DetectionError) {
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    return Response.json({ error: "PS5 analysis unavailable; retrying shortly" }, { status: 502, headers });
  }
}
