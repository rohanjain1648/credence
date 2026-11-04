import Link from "next/link";

type Pill = { href: string; label: string; active: boolean };

export function FilterPills({ label, pills }: { label: string; pills: Pill[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {pills.map((p) => (
        <Link
          key={p.label}
          href={p.href}
          aria-current={p.active ? "page" : undefined}
          className={`rounded-full border px-3 py-1 text-sm ${p.active ? "border-ink bg-ink text-paper" : "border-rule-strong text-ink-2 hover:text-ink"}`}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
