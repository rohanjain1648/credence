import { createEngineCtx } from "@/engine/ctx";
import { runTick } from "@/engine/tick";
import { handleCronTick } from "@/lib/cron";
import { getEnv } from "@/lib/env";

export const maxDuration = 300;

export async function POST(request: Request) {
  return handleCronTick(request, { secret: getEnv().CRON_SECRET, run: () => runTick(createEngineCtx()) });
}
