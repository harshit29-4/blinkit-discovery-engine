"use client";

/** The app shell inside the phone frame: one scroll area, sticky headers, bottom navigation. */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useId, useState, type ReactNode } from "react";
import { IconBack, IconCamera, IconGrid, IconHome, IconRepeat, IconSearch, IconUser } from "./icons";

/**
 * Pieces that depend on the current URL. Each has a URL-free version used as its Suspense fallback, so pages can
 * be prerendered (Next.js cacheComponents) and the URL-aware part streams in.
 */

/** The frame's scroll area (the frame, not the window, scrolls). */
export function AppScroll({ children }: { children: ReactNode }) {
  return <div id="app-scroll" className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">{children}</div>;
}

/** Scrolls the frame back to the top on every navigation. */
function ScrollResetInner() {
  const path = usePathname();
  useEffect(() => { document.getElementById("app-scroll")?.scrollTo({ top: 0 }); }, [path]);
  return null;
}
export const ScrollReset = () => <Suspense fallback={null}><ScrollResetInner /></Suspense>;

/** Phone status bar, shown only in the laptop phone frame (a real phone has its own). */
function StatusBarView({ home }: { home: boolean }) {
  return (
    <div aria-hidden className={`relative hidden h-9 shrink-0 items-center justify-between px-6 text-sm font-bold text-brand-ink sm:flex ${home ? "bg-brand-yellow" : "bg-surface"}`}>
      <span>9:41</span>
      <span className="absolute left-1/2 top-1.5 h-6 w-24 -translate-x-1/2 rounded-full bg-frame" />
      <span className="flex items-center gap-1.5">
        <svg viewBox="0 0 18 12" className="h-3 w-4" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="7" rx="1" /><rect x="10" y="2.5" width="3" height="9.5" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
        <svg viewBox="0 0 24 12" className="h-3 w-6" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="19" height="10" rx="2.5" /><rect x="3" y="3" width="13" height="6" rx="1" fill="currentColor" /><path d="M22 4.5v3" /></svg>
      </span>
    </div>
  );
}
function StatusBarInner() {
  return <StatusBarView home={usePathname() === "/"} />;
}
export const StatusBar = () => <Suspense fallback={<StatusBarView home={false} />}><StatusBarInner /></Suspense>;

// Blinkit's tabs: Home, Order Again, Categories (+ Account here). The cart is reached from the floating bar
// and the header icon, as in Blinkit.
function BottomNavView({ path }: { path: string }) {
  const tabs = [
    { href: "/", label: "Home", Icon: IconHome, on: path === "/" },
    { href: "/order-again", label: "Order Again", Icon: IconRepeat, on: path === "/order-again" },
    { href: "/categories", label: "Categories", Icon: IconGrid, on: path.startsWith("/categories") || path.startsWith("/c/") },
    { href: "/account", label: "Account", Icon: IconUser, on: path === "/account" || path === "/how-it-works" },
  ];
  return (
    <nav aria-label="Main" className="sticky bottom-0 z-30 mt-auto grid grid-cols-4 border-t border-border bg-surface">
      {tabs.map(({ href, label, Icon, on }) => (
        <Link key={href} href={href} aria-current={on ? "page" : undefined}
          className={`relative flex flex-col items-center gap-0.5 py-2 text-sm ${on ? "font-extrabold text-text" : "text-muted"}`}>
          <Icon className="h-6 w-6" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
function BottomNavInner() {
  return <BottomNavView path={usePathname()} />;
}
export const BottomNav = () => <Suspense fallback={<BottomNavView path="" />}><BottomNavInner /></Suspense>;

// Rotating examples in the search box, like Blinkit's 'Search "milk"'; needs and products mixed on purpose.
const EXAMPLES = ["whiteboard markers", "a game for a train", "cat food", "a charger for my phone", "ripe tomatoes"];

export function SearchBar({ defaultValue = "", autoFocus = false }: { defaultValue?: string; autoFocus?: boolean }) {
  const id = useId(); // unique: Next keeps the previous screen (and its search bar) mounted but hidden
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setN((x) => (x + 1) % EXAMPLES.length), 2500);
    return () => clearInterval(t);
  }, []);
  return (
    <form action="/search" role="search" className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 shadow-sm">
      <IconSearch className="h-5 w-5 shrink-0 text-muted" />
      <label htmlFor={id} className="sr-only">Search, or say what you need it for</label>
      <input id={id} name="q" defaultValue={defaultValue} autoFocus={autoFocus} maxLength={200} autoComplete="off"
        placeholder={`Search "${EXAMPLES[n]}"`}
        className="min-w-0 flex-1 bg-transparent py-2.5 text-base placeholder:text-muted focus:outline-none" />
      <Link href="/scan" aria-label="Scan a pack to find the same one" className="-mr-1 rounded-lg p-1.5 text-text hover:bg-bg">
        <IconCamera className="h-5 w-5" />
      </Link>
    </form>
  );
}

/** White header for inner pages: back, title, search. */
export function PageHeader({ title, search = true, children }: { title: string; search?: boolean; children?: ReactNode }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      <div className="flex items-center gap-2 px-2 py-2">
        <button type="button" aria-label="Back"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          className="rounded-full p-2 hover:bg-bg"><IconBack className="h-6 w-6" /></button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold">{title}</h1>
        {search && <Link href="/search" aria-label="Search" className="rounded-full p-2 hover:bg-bg"><IconSearch className="h-6 w-6" /></Link>}
      </div>
      {children}
    </header>
  );
}
