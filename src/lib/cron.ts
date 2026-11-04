import { timingSafeEqual } from "node:crypto";

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Guards the engine tick behind `Authorization: Bearer <CRON_SECRET>`; refuses to run unconfigured. */
export async function handleCronTick(
  request: Request,
  o: { secret: string | undefined; run: () => Promise<unknown> },
): Promise<Response> {
  if (!o.secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  const auth = request.headers.get("authorization") ?? "";
  if (!sameSecret(auth, `Bearer ${o.secret}`)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await o.run());
}
