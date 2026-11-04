import { getReadyDb } from "@/lib/db/ready";
import { getTimeMachine } from "@/lib/queries";

export async function GET(request: Request) {
  const seq = Number(new URL(request.url).searchParams.get("seq"));
  if (!Number.isInteger(seq)) return Response.json({ error: "seq must be a checkpoint number" }, { status: 400 });
  const view = await getTimeMachine(await getReadyDb(), seq);
  if (!view) return Response.json({ error: "no such checkpoint" }, { status: 404 });
  return Response.json(view);
}
