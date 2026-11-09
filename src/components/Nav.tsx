import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getReadyDb } from "@/lib/db/ready";
import { getHeaderStats } from "@/lib/queries";

async function MemoryCount() {
  await connection();
  const stats = await getHeaderStats(await getReadyDb());
  return (
    <Link href="/brain" className="inline-flex items-center gap-2 rounded-full border border-rule-strong px-3 py-1 text-sm text-ink-2 hover:text-ink">
      <span className={`h-2 w-2 rounded-full ${stats.memoriesStored > 0 ? "bg-won" : "bg-muted"}`} aria-hidden />
      <span className="font-semibold tabular-nums text-ink">{stats.memoriesStored}</span> on Walrus
      {stats.memoriesQueued > 0 && <span className="text-muted">+{stats.memoriesQueued} queued</span>}
    </Link>
  );
}

const links = [
  { href: "/", label: "Radar" },
  { href: "/voices", label: "Voices" },
  { href: "/me", label: "My picks" },
  { href: "/brain", label: "Memory" },
];

export function Nav() {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-4 sm:px-6">
        <Link href="/" className="text-xl font-bold tracking-tight">
          Credence
        </Link>
        <nav className="flex gap-5 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-ink-2 hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <Suspense fallback={<span className="text-sm text-muted">Reading memory…</span>}>
            <MemoryCount />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
