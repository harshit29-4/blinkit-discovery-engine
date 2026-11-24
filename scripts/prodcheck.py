"""Production-readiness probe for the website (black-box, HTTP only).

Usage (from the project root, using the pipeline's virtualenv):
    pipeline/.venv/Scripts/python -X utf8 scripts/prodcheck.py https://blinkit-discovery-engine-six.vercel.app

Checks: status codes, warm latency, hostile/edge search inputs (must never show the error page),
security headers, that no secret from .env reaches the browser, metadata, and first-load JS size.
"""
import glob
import gzip
import os
import re
import sys
import time

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3001"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
c = httpx.Client(timeout=60, follow_redirects=False)
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail else ''}")


def text_of(html):
    return re.sub(r"<!-- -->", "", html)


# 1. Pages and status codes
for path, expect in [("/", 200), ("/evidence", 200), ("/themes", 200), ("/validation", 200),
                     ("/how-it-works", 200), ("/health", 200), ("/definitely-not-a-page", 404)]:
    t = time.perf_counter()
    r = c.get(BASE + path)
    ms = (time.perf_counter() - t) * 1000
    check(f"GET {path} → {expect}", r.status_code == expect, f"got {r.status_code} in {ms:.0f} ms")

# 2. Warm latency
for path in ["/", "/themes", "/evidence", "/evidence?q=delivery"]:
    times = []
    for _ in range(5):
        t = time.perf_counter()
        c.get(BASE + path)
        times.append((time.perf_counter() - t) * 1000)
    times.sort()
    check(f"warm latency {path} median < 800 ms", times[2] < 800, f"median {times[2]:.0f} ms, max {times[-1]:.0f} ms")

# 3. Hostile / edge inputs on the search page: must never show the error page
nasty = {
    "regex metachars": "?q=(.*)+[a-z]{2,}$^|\\",
    "quotes + sql-ish": "?q=%27%3B%20drop%20table%20raw_items%3B--",
    "postgrest operator injection": "?q=x&source=eq.play_store,or(1.eq.1)",
    "html/script": "?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    "very long query (5k chars)": "?q=" + "a" * 5000,
    "unicode / Hindi": "?q=%E0%A4%A6%E0%A5%82%E0%A4%A7",
    "emoji": "?q=%F0%9F%98%80",
    "negative page": "?page=-5",
    "huge page": "?page=999999",
    "non-numeric page": "?page=abc",
    "invalid source": "?source=../../etc/passwd",
    "invalid rating": "?rating=9",
    "invalid tag filters": "?barrier=drop&category=%27&stage=x&theme=abc",
    "repeated params": "?q=a&q=b&source=app_store&source=play_store",
    "empty everything": "?q=&source=&rating=&page=",
}
for name, qs in nasty.items():
    r = c.get(BASE + "/evidence" + qs)
    body = text_of(r.text)
    error_ui = "Data temporarily unavailable" in body
    ok = r.status_code == 200 and "Application error" not in body and not error_ui
    if name == "quotes + sql-ish":
        ok = ok and "could not be processed" in body
    if name == "huge page":
        ok = ok and "Go to the last page" in body
    if name == "html/script":
        ok = ok and "<script>alert(1)</script>" not in body
    check(f"search input: {name}", ok, f"HTTP {r.status_code}, {len(r.content) // 1024} KB")

# 4. Security headers
h = {k.lower(): v for k, v in c.get(BASE + "/").headers.items()}
for header in ["content-security-policy", "x-content-type-options", "referrer-policy",
               "x-frame-options", "permissions-policy", "strict-transport-security"]:
    check(f"header {header}", header in h, h.get(header, "missing")[:80])
check("no x-powered-by header", "x-powered-by" not in h, h.get("x-powered-by", ""))


# 5. Secrets: nothing server-side may reach the browser bundle or HTML
def env_file(path):
    out = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                out[k] = v.strip('"')
    return out


root_env = env_file(os.path.join(ROOT, ".env"))
secrets = {k: v for k, v in root_env.items()
           if k in ("SUPABASE_SECRET_KEY", "SUPABASE_DB_URL", "GROQ_API_KEY") and len(v) > 8}
static_text = "".join(open(f, encoding="utf-8", errors="ignore").read()
                      for f in glob.glob(os.path.join(WEB, ".next", "static", "**", "*.js"), recursive=True))
pages_html = "".join(c.get(BASE + p).text for p in ["/", "/evidence", "/themes", "/validation", "/health"])
for k, v in secrets.items():
    check(f"secret {k} absent from client JS + HTML", v not in static_text and v not in pages_html)
pub = root_env.get("SUPABASE_PUBLISHABLE_KEY", "")
check("publishable key not shipped to the browser", bool(pub) and pub not in static_text and pub not in pages_html)
check("no author hashes exposed in HTML", "author_hash" not in pages_html)

# 6. Metadata
home = c.get(BASE + "/").text
check("<title> present", bool(re.search(r"<title>[^<]+</title>", home)))
check("meta description present", 'name="description"' in home)
check("html lang attribute", '<html lang="en"' in home)
check("robots.txt", c.get(BASE + "/robots.txt").status_code == 200)
og = re.search(r'property="og:image" content="([^"]+)"', home)
check("og:image is an absolute URL", bool(og) and og.group(1).startswith("http"), og.group(1) if og else "missing")

# 7. First-load JS
scripts = set(re.findall(r'src="(/_next/static/[^"]+\.js)"', home))
blobs = [c.get(BASE + s).content for s in scripts]
gz = sum(len(gzip.compress(b, 9)) for b in blobs)
check("first-load JS < 200 KB gzipped", gz < 200_000, f"{len(scripts)} files, {gz // 1024} KB gzipped")

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
