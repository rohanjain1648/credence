import { desc, eq } from "drizzle-orm";
import { markets, sharpLines } from "@/lib/db/schema";
import { NS } from "@/lib/memory/namespaces";
import { enqueueMemory } from "@/lib/memory/writer";
import type { EngineCtx } from "./ctx";

export type CallKind = "final" | "election";

export const pct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * Writes Credence's own prediction for a market to memory before the market closes,
 * so every call is on the record before the outcome is known.
 */
export async function recordCall(ctx: EngineCtx, marketId: string, kind: CallKind): Promise<string | null> {
  const [line] = await ctx.db.select().from(sharpLines).where(eq(sharpLines.marketId, marketId)).orderBy(desc(sharpLines.ts), desc(sharpLines.id)).limit(1);
  const [market] = await ctx.db.select().from(markets).where(eq(markets.id, marketId));
  if (!line || !market) return null;

  const [a, b] = market.outcomes.map((o) => o.name);
  const label = kind === "election" ? "Election call" : "Final call";
  let human: string;
  if (line.line === null || line.consensus === null) {
    human = `${label} — "${market.question}": crowd ${pct(line.priceA)} on ${a}; not enough credible money to form a Sharp Line.`;
  } else {
    const leansA = line.consensus >= 0.5;
    const share = leansA ? line.consensus : 1 - line.consensus;
    human =
      `${label} — "${market.question}": crowd ${pct(line.priceA)} on ${a}, Sharp Line ${pct(line.line)}. ` +
      `Credible money leans ${leansA ? a : b} (${pct(share)} of credible weight, λ ${line.lambda.toFixed(2)}).`;
  }

  const id = await enqueueMemory(ctx.db, {
    namespace: NS.calls,
    kind: "call",
    human,
    data: {
      marketId,
      question: market.question,
      outcomes: [a, b],
      closeTime: market.closeTime,
      priceA: line.priceA,
      consensus: line.consensus,
      line: line.line,
      lambda: line.lambda,
      contributors: line.contributors,
      snapshotId: line.snapshotId,
      kind,
    },
    refType: "market",
    refId: marketId,
    effect: { type: "call", marketId, priceA: line.priceA, line: line.line },
  });
  await ctx.db.update(sharpLines).set({ callMemoryId: id }).where(eq(sharpLines.id, line.id));
  return id;
}
