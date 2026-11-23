import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "./nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only rounded-md bg-accent px-3 py-2 text-accent-ink focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10">
          Skip to content
        </a>
        <header className="bg-brand-yellow text-brand-ink">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-lg font-bold tracking-tight">Category Discovery Engine</p>
              {/* Said in the header itself: the brand colours make the site look official. */}
              <p className="text-sm text-brand-ink-muted">
                Analysis of public customer feedback on Blinkit · Independent research project, not affiliated with Blinkit
              </p>
            </div>
            <Nav />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-border">
          <p className="mx-auto max-w-6xl px-4 py-4 text-sm text-muted">
            Independent research project; not affiliated with or endorsed by Blinkit. Brand colours are used for
            reference only. Based on publicly available feedback; no personal information is stored.
          </p>
        </footer>
      </body>
    </html>
  );
}
