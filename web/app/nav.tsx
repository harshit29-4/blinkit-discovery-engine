"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/themes", label: "Themes" },
  { href: "/evidence", label: "Evidence" },
  { href: "/validation", label: "Validation" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/health", label: "Health" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-wrap gap-1">
      {LINKS.map(({ href, label }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2 py-1.5 text-sm font-semibold transition-colors sm:px-3 ${
              active
                ? "bg-brand-ink text-brand-yellow"
                : "text-brand-ink underline-offset-4 hover:underline"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
