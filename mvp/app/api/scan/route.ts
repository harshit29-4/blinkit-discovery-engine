/** Packet scan: the photo is sent to the model once and never stored. */
import { geminiJsonRetry } from "@/lib/gemini.ts";
import { SCAN_SYSTEM, checkScan, scanCatalogue } from "@/lib/scan.ts";
import { logEvent } from "@/lib/db.ts";
import { SHOPPERS } from "@/lib/shoppers.ts";

const MAX_BYTES = 1_500_000;
const hits = new Map<string, number[]>();

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  hits.set(ip, [...recent, now]);
  if (recent.length >= 6) return Response.json({ error: "Too many scans in a minute. Try again shortly." }, { status: 429 });

  let image: unknown, session: unknown, shopper: unknown;
  try {
    ({ image, session, shopper } = await req.json());
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_BYTES * 1.37) {
    return Response.json({ error: "Please use a JPEG, PNG or WebP photo under 1.5 MB." }, { status: 400 });
  }
  try {
    const r = await geminiJsonRetry(SCAN_SYSTEM, [
      { type: "text", text: `Catalogue:\n${scanCatalogue()}` },
      { type: "image_url", image_url: { url: image } },
    ], { tries: 3, waitMs: 2500, timeoutMs: 20_000, maxTokens: 600 }); // no backup model reads images, so retry more
    const { result, problems } = checkScan(r.data);
    if (!result) {
      console.warn("scan failed checks", problems);
      return Response.json({ error: "Couldn't read that photo. Try again with the front of the pack in good light." }, { status: 502 });
    }
    if (typeof session === "string" && /^[a-z0-9-]{8,40}$/.test(session)) {
      await logEvent({ session, shopper: SHOPPERS.some((s) => s.id === shopper) ? (shopper as string) : null, kind: "scan",
        item: result.id, detail: { match: result.match } });
    }
    return Response.json({ result });
  } catch (e) {
    console.warn("scan model error", (e as Error).message);
    return Response.json({ error: "The scanner is busy right now. Try again in a minute." }, { status: 503 });
  }
}
