import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/*
 * Content Security Policy without nonces. Nonces would force every page to render per
 * request (no prerendering), so we use Next.js's documented static-friendly policy:
 * scripts/styles only from this site, no framing, no plugins, forms post only here.
 * The site loads nothing third-party (fonts are self-hosted by next/font).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" }, // legacy twin of frame-ancestors
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  // Vercel already sends HSTS on its domains; harmless and explicit for any other host.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false, // don't advertise the framework/version
  experimental: {
    // Pre-rendering every page at once sent a burst of heavy view queries to Supabase, which cancels
    // anything over 3 s for the public key; two deploys on 2026-11-26 failed on that while the same
    // views answered in under a second on their own. One worker, two pages at a time, and a failed
    // page is retried before the build gives up.
    cpus: 1,
    staticGenerationMaxConcurrency: 2,
    staticGenerationRetryCount: 2,
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  turbopack: {
    // Pin the project root: a stray package-lock.json in the user's home folder otherwise
    // makes Turbopack guess the wrong workspace root.
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
