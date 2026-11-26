import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { CartBar } from "@/components/cart";
import { AppScroll, BottomNav, ScrollReset, StatusBar } from "@/components/shell";
import "./globals.css";

const brand = Plus_Jakarta_Sans({ variable: "--font-brand", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

const description =
  "Concept prototype of a 'Will it suit you?' feature for Blinkit: every product answers the one question that decides whether it suits you.";

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3001";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "blinkit concept · Will it suit you?", template: "%s · blinkit concept" },
  description,
  openGraph: { title: "blinkit concept · Will it suit you?", description, type: "website" },
  robots: { index: false, follow: false }, // a concept prototype: keep it out of search results
};

export const viewport: Viewport = { themeColor: "#f8cb46" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${brand.variable} antialiased`}>
      <body className="sm:grid sm:min-h-dvh sm:place-items-center sm:py-3">
        {/* On a laptop the app sits in a phone frame; on a phone it fills the screen. */}
        <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-bg sm:h-[min(860px,calc(100dvh-24px))] sm:w-[376px] sm:rounded-[3rem] sm:border-[8px] sm:border-frame sm:shadow-2xl sm:ring-1 sm:ring-black/10">
          <StatusBar />
          <ScrollReset />
          <AppScroll>
            <main id="main" className="flex-1">{children}</main>
            <CartBar />
            <BottomNav />
          </AppScroll>
          <div id="sheet-root" />
        </div>
      </body>
    </html>
  );
}
