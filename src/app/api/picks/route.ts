import { cookies } from "next/headers";
import { z } from "zod";
import { createEngineCtx } from "@/engine/ctx";
import { createPick, PickError } from "@/engine/picks";

const Body = z.object({
  handle: z.string(),
  marketId: z.string(),
  outcomeIndex: z.union([z.literal(0), z.literal(1)]),
  confidence: z.number(),
  reason: z.string().optional(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "BAD_REQUEST" }, { status: 400 });
  try {
    const pick = await createPick(createEngineCtx(), parsed.data);
    (await cookies()).set("credence_handle", pick.handle, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return Response.json({ pick }, { status: 201 });
  } catch (err) {
    if (err instanceof PickError) return Response.json({ code: err.code }, { status: 400 });
    throw err;
  }
}
