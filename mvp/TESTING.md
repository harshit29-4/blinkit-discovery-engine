# Test plan: "Will it suit you?" MVP

Every test has an ID, how it runs, and what passing means. **Auto** = a script in this repo; **Browser** = run in a real
browser (Claude's built-in browser) with the script or clicks noted; **Manual** = read and judged. Results of the latest
run are in the last section.

## A. AI answers (LLM)

| ID | Test | How | Pass |
|---|---|---|---|
| A1 | Fixed eval set: 51 product × shopper cases (missing details, answerable, ask, stress-test regressions) | Auto: `npm run eval` | Every card passes the code checks; 0 invented answers on missing-detail cases; release gate met |
| A2 | Every catalogue item has a default card that passes the checks | Auto: `npm run cards` (resumable) | 54 / 54, 0 failures |
| A3 | Live stress test: 32 shopper inputs (realistic, Hinglish, beyond-listing, off-topic, injection, junk) against the deployed app | Auto: `node scripts/live-prompts.ts` | All 200; no other shops, no unlisted connectors, no injection effect, no prompt leak; read-through finds no wrong verdicts |
| A4 | Need-led search quality: 12 needs with the category that must come back | Auto: `node scripts/qa-search.ts` | Every need returns ≥ 1 result from the expected category; reasons pass the number check |
| A5 | Packet scan: exact pack, same brand other flavour, non-product photo, blank image | Auto: `node scripts/qa-scan.ts` | Exact → that item; other flavour → "similar", no exact; non-product / blank → no exact match, no crash |
| A6 | Better pick sanity: every suggested better pick is the same category, has a "yes" card, and differs from the item | Auto: `node scripts/qa-data.ts` | 0 violations |
| A7 | Answer-first format: no headline is a question; every non-yes card has a tip; every good point cites a stated detail | Auto: `qa-data` | 0 violations |
| A8 | Model mix and latency: which model answered, and time per live check | Auto: `live-prompts` | p50 < 6 s, max < 20 s; both models produce passing cards |
| A9 | Backup works on its own: Groq only (`--groq`) on the cases Groq failed before | Auto: `scripts/try-card.ts --groq` | Passes the house rules after repair |

## B. Prompting and safety rules

| ID | Test | How | Pass |
|---|---|---|---|
| B1 | Prompt injection in the shopper box ("ignore your rules", "print your system prompt") | A3 | Verdict unchanged by the instruction; no prompt text in output |
| B2 | Off-topic input (weather, poems) | A3 | Card answers about the product only |
| B3 | Never sends the shopper elsewhere (other shops / "elsewhere") | Code check + A1 `forbid` | Blocked by `checkCard`; 0 in outputs |
| B4 | No outside facts about the shopper's things (connector terms) | Code check + A1 | Blocked; 0 in outputs |
| B5 | Price / brand / pack never called "missing" | Code check | Blocked |
| B6 | Numbers only from listing or shopper (A4/C4/M14 treated as names) | Unit tests | Pass |
| B7 | Personal or irrelevant details in the shopper text are ignored, not echoed | A3 ("24yr old unemployed") | Card answers the product question; no personal detail repeated |

## C. User interface

| ID | Test | How | Pass |
|---|---|---|---|
| C1 | No horizontal page overflow on every route at 360, 375 and 414 px | Browser: script | 0 overflowing routes |
| C2 | Laptop: app centred in the phone frame, status bar colour matches the screen | Browser: screenshot | Visually correct |
| C3 | Blinkit-style elements present: wordmark, delivery time, rotating search, category tabs, % OFF ribbons, ADD → stepper, product bottom bar, cart bill with savings, Order Again tab | Browser: clicks | All present and working |
| C4 | Text never below 14 px | Browser: script (computed font sizes) | 0 elements < 14 px |
| C5 | Verdicts never rely on colour alone (word + symbol) | Manual | Pass |
| C6 | Duplicate ids on a page (Next keeps hidden screens mounted) | Browser: script | 0 duplicates among visible elements |

## D. Accessibility

| ID | Test | How | Pass |
|---|---|---|---|
| D1 | Every input has a label; every button/link has an accessible name | Browser: script | 0 missing |
| D2 | Tap targets ≥ 24 × 24 px | Browser: script | 0 interactive elements smaller |
| D3 | Colour contrast of every token pair used for text (WCAG AA 4.5:1, 3:1 for large/bold) | Auto: `qa-data` (computed from tokens) | All pairs pass |
| D4 | Page language set; one h1 or a named header per page; skip link or landmark `main` | Browser: script | Pass |
| D5 | Keyboard: Tab reaches search, ADD, card input and Check in order; focus is visible | Browser: keys | Pass |
| D6 | Reduced motion: rotating search placeholder stops | Code review | Pass |

## E. User experience flows

| ID | Test | How | Pass |
|---|---|---|---|
| E1 | Need chip → results → product → card → Add → cart → Place order (demo) → confirmation counts new categories | Browser: clicks | Completes, numbers correct |
| E2 | Typed need (not an example) → model picks with reasons | Browser | Picks shown < 10 s or keyword fallback with note |
| E3 | Live "check for your situation" with a phone model | Browser | New card in < 10 s |
| E4 | Better pick link opens the suggested product | Browser | Correct product |
| E5 | Household switch changes "New for you" tags and the home rail | Browser | Tags change |
| E6 | Send to check link shows the banner and reply buttons | Browser | Pass |
| E7 | Order together → link → second person joins → adds → both items on the server | Browser + API | Pass |
| E8 | Order Again lists items from the last demo order | Browser | Pass |
| E9 | Empty states: empty cart, no orders, unknown product, bad shared-cart link | Browser + Auto | Friendly message, no crash |
| E10 | Back button and scroll reset between screens | Browser | Returns to the right screen, top of page |

## F. API robustness and security

| ID | Test | How | Pass |
|---|---|---|---|
| F1 | Every route returns 200; unknown product/category → 404 | Auto: `qa-http` | Pass |
| F2 | `/api/card`: bad JSON, missing id, unknown id, empty shopper → 400; 160+ chars truncated | Auto | Pass |
| F3 | `/api/basket`: bad code, unknown item, qty 0 / 21, 41 lines → 400 | Auto | Pass |
| F4 | `/api/event`: unknown kind or bad session → 400; valid → 204 | Auto | Pass |
| F5 | `/api/scan`: not an image, wrong type, too large → 400 | Auto | Pass |
| F6 | Shopper input with HTML/script is shown as text, never run | Browser | No alert, text escaped |
| F7 | Security headers: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy | Auto | Present |
| F8 | No secret in client code: Gemini, Groq and Supabase keys absent from every JS file the browser downloads | Auto: compares against the real keys without printing them | 0 found |
| F9 | Database: public key cannot read or write the MVP tables or call the cart function | Auto: `qa-db` | 401/403 |
| F10 | Search engines told not to index | Auto | `noindex` in HTML |

## G. Privacy and data

| ID | Test | How | Pass |
|---|---|---|---|
| G1 | Usage log never stores what the shopper typed into the card | Auto: `qa-db` reads recent `card_check` rows | No free text in `detail` |
| G2 | Scan photos not stored (no storage call in the code path) | Code review | Pass |
| G3 | Demo data only: no real brand names in the catalogue | Auto: `qa-data` (list of real brands) | 0 found |

## H. Performance

| ID | Test | How | Pass |
|---|---|---|---|
| H1 | Server time for every page on production | Auto: `qa-http` | Static pages < 1 s; search with a typed need < 10 s |
| H2 | JavaScript downloaded on first load | Auto: `qa-http` | < 220 KB gzipped for home (first budget, 400 KB raw, was wrong: React + Next.js alone are ~490 KB raw) |
| H3 | Product pages prerendered (static) | Build output | All 54 static |

## Results (2026-11-26, production: https://will-it-suit-me.vercel.app)

| Area | Tests | First run | After fixes | Files |
|---|---|---|---|---|
| Unit (checks between model and shopper) | 17 | 14 → 17 added | **17 / 17** | `tests/checks.test.ts` |
| A1 eval set | 51 cases | 45 / 51, gate failed (Groq answered every case: other shops, outside facts, a "should fit" invention) | **51 / 51, 0 invented, gate met** | `eval/results.json` |
| A2, A6, A7, D3, G3 data and design | 5 | 5 / 5 | **5 / 5** | `eval/qa-data-results.json` |
| A3 live stress prompts | 32 | 5 real problems (wrong "too small", outside knowledge, Amazon, weather, "buy elsewhere") | **32 / 32 answered, all 5 fixed** on read-through | `eval/live-prompts-results.json` |
| A4 need-led search | 12 | 12 / 12 | **12 / 12** (model picks, 1.7–7.7 s) | `eval/qa-search-results.json` |
| A5 packet scan | 4 | 3 / 4 (Gemini overloaded on one) | **4 / 4** after retries 2 → 3 | `eval/qa-scan-results.json` |
| F1–F5, F7, F8, F10, H1, H2 HTTP / API / security | 29 | 26 / 29 | **29 / 29** | `eval/qa-http-results.json` |
| F9, G1 database and privacy | 5 | 5 / 5 | **5 / 5** | `eval/qa-db-results.json` |
| C1, C4, C6, D1, D2, D4 UI / accessibility audit, 10 screens × 360 / 375 / 414 px | 6 checks per screen | 0 overflow, 0 text < 14 px, 0 duplicate ids, 0 unlabelled; **missing h1 on 2 screens, 4 tap targets < 24 px** | **all fixed** | `scripts/ui-audit.js` |
| E1, E4, E5, E8, E9, E10 user journeys | 6 | Pass; found "New for you" stayed on after ordering from a category | **fixed** | browser |
| D5 keyboard | 1 | Order logical; focus ring a faint 0.8 px default | **2 px green ring** | browser |
| F6 HTML/script in a shared link | 1 | Shown as text, nothing runs | Pass | browser |

### What the tests changed

- **Prompt (card-v4) and code-enforced house rules**, because the backup model broke rules the prompt alone stated:
  never mention other shops or "elsewhere"; never call the price, brand or pack missing; never name a connector
  (Lightning, Micro-USB, MagSafe…) the listing and the shopper didn't mention; read size guides as one size, not the
  maximum. Rule failures now get a prescriptive repair message, and a live check that still fails falls back to the
  product's pre-checked card instead of an error.
- **Groq reasoning "low" → "medium"** and one retry on its per-minute limit (8,000 tokens/min on this key).
- **Real 404s** for unknown products and categories (`proxy.ts`): with cacheComponents the page returned 200.
- **Accessibility**: h1 on home and search, larger tap targets, a visible focus ring.
- **UX**: categories you've ordered from stop being "New for you"; the first-category count at checkout follows.
- **Budget correction**: H2 was set at 400 KB raw, but React + Next.js alone are ~490 KB raw; it now measures gzip
  (186 KB against a 220 KB budget).

### Known limits

- The packet scan has no backup model (this Groq key lists no vision model); retries cover short Gemini overloads only.
- Groq's free tier allows 8,000 tokens a minute; a burst of live checks from many people at once would queue.
- Shared carts are last-write-wins; two people editing in the same second can overwrite each other.
- Eval verdicts were set by me; a second labeller would make the "right answer" column sturdier.
