import path from "node:path";
import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";

// Local dev and local builds read the project's root .env (where the scripts' keys live), without overriding
// anything already set. On Vercel there is no parent .env; the values come from the project's encrypted settings.
const rootEnv = path.join(__dirname, "..", ".env");
if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

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
