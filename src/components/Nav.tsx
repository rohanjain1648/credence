import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getReadyDb } from "@/lib/db/ready";
import { getHeaderStats } from "@/lib/queries";

async function MemoryCount() {
  await connection();
  const stats = await getHeaderStats(await getReadyDb());
  return (
    <Link href="/brain" className="text-sm text-ink-2 hover:text-ink">
      <span className="font-semibold text-ink">{stats.memoriesStored}</span> memories on Walrus
      {stats.memoriesQueued > 0 && <span className="text-muted">, {stats.memoriesQueued} on the way</span>}
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
      <div className="mx-auto flex max-w-5xl flex-wrap items-baseline gap-x-8 gap-y-2 px-4 py-4 sm:px-6">
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
