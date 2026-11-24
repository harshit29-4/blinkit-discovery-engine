"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconAsk, IconCheck, IconHome, IconInfo, IconPulse, IconSearch, IconThemes } from "@/components/icons";

const LINKS = [
  { href: "/", label: "Home", Icon: IconHome, mobile: true },
  { href: "/ask", label: "Ask", Icon: IconAsk, mobile: true },
  { href: "/themes", label: "Themes", Icon: IconThemes, mobile: true },
  { href: "/evidence", label: "Evidence", Icon: IconSearch, mobile: true },
  { href: "/validation", label: "Validation", Icon: IconCheck, mobile: false },
  { href: "/health", label: "Pipeline", Icon: IconPulse, mobile: false },
  { href: "/how-it-works", label: "How it works", Icon: IconInfo, mobile: true },
];

function useActive() {
  const path = usePathname();
  return (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
}

/** Desktop and tablet: a tab strip under the header (Blinkit's category strip). */
export function Nav() {
  const active = useActive();
  return (
    <nav aria-label="Main" className="-mb-px flex gap-1 overflow-x-auto">
      {LINKS.map(({ href, label, Icon }) => {
        const on = active(href);
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 border-b-[3px] px-3 py-2.5 text-sm font-semibold transition-colors ${
              on ? "border-brand-yellow text-text" : "border-transparent text-muted hover:text-text"
            }`}>
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phones: a bottom tab bar, as in the Blinkit app. */
export function BottomNav() {
  const active = useActive();
  return (
    <nav aria-label="Main (mobile)"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden">
      <ul className="grid grid-cols-5">
        {LINKS.filter((l) => l.mobile).map(({ href, label, Icon }) => {
          const on = active(href);
          return (
            <li key={href}>
              <Link href={href} aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-[0.875rem] font-semibold ${on ? "text-accent" : "text-muted"}`}>
                <Icon className="h-5 w-5" />
                <span className="leading-none">{label === "How it works" ? "Learn" : label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
