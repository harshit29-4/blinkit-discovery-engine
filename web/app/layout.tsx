import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "./nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Discovery Engine", template: "%s · Discovery Engine" },
  description:
    "An AI research engine reading public quick-commerce reviews to understand why shoppers stick to the same categories.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-semibold tracking-tight">Category Discovery Engine</p>
              <p className="text-sm text-muted">Public user feedback about Blinkit, collected and analysed</p>
            </div>
            <Nav />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-border">
          <p className="mx-auto max-w-6xl px-4 py-4 text-sm text-muted">
            Independent research project, not affiliated with Blinkit. Built from public reviews and posts;
            usernames are never stored.
          </p>
        </footer>
      </body>
    </html>
  );
}
