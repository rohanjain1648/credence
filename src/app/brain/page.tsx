import { connection } from "next/server";
import { Suspense } from "react";
import { AmnesiaButton } from "@/components/AmnesiaButton";
import { LearningCurve } from "@/components/LearningCurve";
import { MemoryFeed } from "@/components/MemoryFeed";
import { ProofCard } from "@/components/ProofCard";
import { TimeMachine } from "@/components/TimeMachine";
import { countMemories } from "@/engine/checkpoint";
import { getReadyDb } from "@/lib/db/ready";
import { getEnv } from "@/lib/env";
import { GROUP_LABEL } from "@/lib/format";
import { getMemory } from "@/lib/memory/client";
import { getBrainView, getTimeMachine } from "@/lib/queries";
import { LAMBDA_PRIOR } from "@/lib/scoring/learning";
import { createTatumSuiClient } from "@/lib/sui/client";
import { cachedMemoryProof, getMemoryAccountProof } from "@/lib/sui/memoryProof";

async function Proof() {
  await connection();
  const env = getEnv();
  if (!env.TATUM_API_KEY || !env.MEMWAL_ACCOUNT_ID) {
    return <p className="text-sm text-ink-2">Add the Tatum key and the memory account ID to .env.local to read the account from Sui.</p>;
  }
  try {
    const db = await getReadyDb();
    const memory = getMemory();
    const proof = await cachedMemoryProof(db, Date.now(), async () => ({
      ...(await getMemoryAccountProof(createTatumSuiClient(env.TATUM_API_KEY!), env.MEMWAL_ACCOUNT_ID!)),
      memoriesOnWalrus: memory ? await countMemories(memory) : undefined,
    }));
    return <ProofCard proof={proof} />;
  } catch {
    return <p className="text-sm text-ink-2">The account couldn&apos;t be read from Sui just now. It will be tried again on the next visit.</p>;
  }
}

async function Brain() {
  await connection();
  const db = await getReadyDb();
  const view = await getBrainView(db);
  const latest = view.checkpoints.at(-1);
  const timeMachine = latest ? await getTimeMachine(db, latest.seq) : null;

  return (
    <>
      <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
        <div>
          <dt className="text-sm text-ink-2">Stored on Walrus</dt>
          <dd className="text-3xl font-bold text-sharp">{view.counts.stored}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-2">On the way</dt>
          <dd className="text-3xl font-bold">{view.counts.onTheWay}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-2">Failed</dt>
          <dd className="text-3xl font-bold">{view.counts.failed}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-2">Tatum credits today</dt>
          <dd className="text-3xl font-bold">{view.creditsToday.toLocaleString("en-US")}</dd>
        </div>
      </dl>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">Get your memory back</h2>
        <p className="mb-4 mt-1 max-w-prose text-sm text-ink-2">
          This wipes Credence&apos;s local trust model, then rebuilds it from the latest checkpoint on Walrus Mainnet. The numbers below come back without touching the local
          copy.
        </p>
        <AmnesiaButton enabled={getEnv().AMNESIA_ENABLED} />
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">What it has learned</h2>
        <p className="mb-4 mt-1 max-w-prose text-sm text-ink-2">
          λ is how much Credence trusts sharp money in each category. It starts at {LAMBDA_PRIOR}, and rises or falls as markets resolve. If sharp money adds nothing, it falls
          toward 0.
        </p>
        {view.lambdas.length === 0 ? (
          <p className="text-sm text-ink-2">Every category is still at the starting {LAMBDA_PRIOR}. This changes when a market with a Sharp Line resolves.</p>
        ) : (
          <table className="mb-8 w-full max-w-md text-sm">
            <caption className="sr-only">Trust in sharp money by category</caption>
            <thead>
              <tr className="border-b border-rule text-left text-ink-2">
                <th className="py-1 pr-3 font-normal">Category</th>
                <th className="py-1 pr-3 text-right font-normal">λ now</th>
                <th className="py-1 text-right font-normal">Markets learned from</th>
              </tr>
            </thead>
            <tbody>
              {view.lambdas.map((l) => (
                <tr key={l.group} className="border-b border-rule">
                  <td className="py-1 pr-3">{GROUP_LABEL[l.group] ?? l.group}</td>
                  <td className="py-1 pr-3 text-right font-semibold">{l.lambda.toFixed(2)}</td>
                  <td className="py-1 text-right">{l.n > 0 ? l.n : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-4">
          <LearningCurve points={view.curve} />
        </div>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">Time machine</h2>
        <p className="mb-4 mt-1 max-w-prose text-sm text-ink-2">See what Credence believed at each checkpoint, and how today&apos;s markets look with that older memory.</p>
        {timeMachine ? (
          <TimeMachine checkpoints={view.checkpoints.map((c) => ({ seq: c.seq, ts: c.ts }))} initial={timeMachine} />
        ) : (
          <p className="text-sm text-ink-2">The first checkpoint is written after a market with a Sharp Line resolves.</p>
        )}
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">Proof on Sui</h2>
        <p className="mb-4 mt-1 max-w-prose text-sm text-ink-2">Check the memory account yourself. It&apos;s a public object on Sui Mainnet.</p>
        <Suspense fallback={<p className="text-sm text-muted">Reading the account from Sui…</p>}>
          <Proof />
        </Suspense>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">Every memory</h2>
        <p className="mb-4 mt-1 max-w-prose text-sm text-ink-2">
          The latest {Math.min(view.feed.length, 100)} of {view.counts.total}. Blue text shows what each memory changed in the product.
        </p>
        {view.feed.length === 0 ? (
          <p className="max-w-prose text-sm text-ink-2">
            No memories yet. They appear when the engine scores a wallet, makes a call before a market closes, or learns from a result. Logging a pick adds one too.
          </p>
        ) : (
          <MemoryFeed feed={view.feed} />
        )}
      </section>
    </>
  );
}

export default function BrainPage() {
  return (
    <div className="pt-10">
      <h1 className="max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">What Credence remembers</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-2">
        What Credence learns goes to Walrus Memory on Mainnet, where it outlives this app&apos;s database. Here you can read those memories, check them on Sui, and watch the
        trust model come back after a wipe.
      </p>
      <Suspense fallback={<p className="mt-10 text-muted">Loading memories…</p>}>
        <Brain />
      </Suspense>
    </div>
  );
}
