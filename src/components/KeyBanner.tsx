import { connection } from "next/server";
import { features, getEnv } from "@/lib/env";

/** Tells a reviewer running without keys which parts are showing stored data only. */
export async function KeyBanner() {
  await connection();
  const f = features(getEnv());
  const missing = [
    !f.tatum && "Tatum (live markets and Sui RPC)",
    !f.memory && "Walrus Memory (new memories stay queued)",
  ].filter(Boolean);
  if (missing.length === 0) return null;
  return (
    <div className="border-b border-rule bg-surface">
      <p className="mx-auto max-w-5xl px-4 py-2 text-sm text-ink-2 sm:px-6">
        Running without {missing.join(" and ")}. Pages show what is already in the local database. Add keys to{" "}
        <code className="text-ink">.env.local</code> to go live.
      </p>
    </div>
  );
}
