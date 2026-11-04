import { NoCheckpointError, restoreFromWalrus } from "@/engine/checkpoint";
import { createEngineCtx } from "@/engine/ctx";
import { getReadyDb } from "@/lib/db/ready";
import { features, getEnv } from "@/lib/env";

/** The Amnesia demo: wipes the local trust model and rebuilds it from Walrus. Off unless AMNESIA_ENABLED is set. */
export async function POST() {
  const env = getEnv();
  if (!env.AMNESIA_ENABLED) return Response.json({ code: "DISABLED" }, { status: 403 });
  if (!features(env).memory) return Response.json({ code: "NO_MEMORY" }, { status: 503 });
  try {
    return Response.json(await restoreFromWalrus(createEngineCtx({ db: await getReadyDb() })));
  } catch (err) {
    if (err instanceof NoCheckpointError) return Response.json({ code: "NO_CHECKPOINT" }, { status: 409 });
    return Response.json({ code: "RECALL_FAILED", message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
