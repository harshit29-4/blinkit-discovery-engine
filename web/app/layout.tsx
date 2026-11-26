import type { Metadata } from "next";
import Link from "next/link";
import { Plus_Jakarta_Sans } from "next/font/google";
import { IconSearch } from "@/components/icons";
import { BottomNav, Nav } from "./nav";
import "./globals.css";

// Blinkit's own typeface ("Okra") is proprietary; Plus Jakarta Sans is the closest free match.
const brand = Plus_Jakarta_Sans({ variable: "--font-brand", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

const description =
  "An AI research engine reading public quick-commerce reviews to understand why shoppers stick to the same categories.";

// Absolute base for link-preview image URLs. On Vercel the production domain is provided
// automatically; locally it falls back to the dev server.
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Discovery Engine", template: "%s · Discovery Engine" },
  description,
  openGraph: { title: "Category Discovery Engine", description, type: "website", siteName: "Category Discovery Engine" },
  twitter: { card: "summary_large_image", title: "Category Discovery Engine", description },
};

/** The header's ask bar: like Blinkit's "Search 'milk'", but it asks the engine. */
function AskBar() {
  return (
    <form action="/ask" role="search" className="w-full sm:max-w-xl sm:flex-1">
      <label htmlFor="ask-bar" className="sr-only">Ask the engine a question</label>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-bg px-3 focus-within:border-accent">
        <IconSearch className="h-5 w-5 shrink-0 text-muted" />
        <input id="ask-bar" name="q" maxLength={500} required minLength={3} autoComplete="off"
          placeholder="Ask about Blinkit shoppers…"
          className="w-full bg-transparent py-2.5 text-base placeholder:text-muted focus:outline-none" />
      </div>
    </form>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${brand.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only rounded-md bg-accent px-3 py-2 text-accent-ink focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-30">
          Skip to content
        </a>
        <header className="z-20 border-b border-border bg-surface sm:sticky sm:top-0">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 pt-3 pb-3 sm:flex-row sm:items-center sm:gap-6 sm:pb-0">
            <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Discovery Engine, home">
              <span aria-hidden className="grid h-9 w-9 place-items-center rounded-lg bg-brand-yellow text-lg font-extrabold text-brand-ink">D</span>
              <span className="leading-tight">
                <span className="block text-base font-extrabold tracking-tight">Discovery Engine</span>
                {/* Said in the header itself: the brand colours make the site look official. */}
                <span className="block text-sm text-muted">Blinkit feedback · independent project</span>
              </span>
            </Link>
            <AskBar />
          </div>
          <div className="mx-auto hidden max-w-6xl px-4 sm:block">
            <Nav />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 sm:py-8">{children}</main>
        <footer className="border-t border-border bg-surface pb-20 sm:pb-0">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
              Independent research project; not affiliated with or endorsed by Blinkit. Based on public feedback;
              no personal information is stored.
            </p>
            <p className="flex shrink-0 gap-4">
              <Link href="/how-it-works" className="underline underline-offset-2">How it works</Link>
              <Link href="/validation" className="underline underline-offset-2">Validation</Link>
              <Link href="/health" className="underline underline-offset-2">Pipeline</Link>
            </p>
          </div>
        </footer>
        <BottomNav />
      </body>
    </html>
  );
}
