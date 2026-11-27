# LP-ADMIN-BOT-GOKU001 — tracking & analytics update

## READ FIRST: what was and wasn't in the upload
The upload was ONE text file (`my_github_all_files`) containing 8 files, not a ZIP. I split it into the real files.
**Not in the upload (so not inspected, not changed, not included):** `secure.js`, `index.html`, `landing.html`, `project-theme.js`,
`integrations.js` was present, `logo.png`. Copy the files from this folder **over** your repo; keep your own `secure.js`, `index.html`, etc.

Changed: `integrations.js`, `project-schema.js`, `projects.js`, `projects-ui.js`, `landing-page.js`, `package.json` (added `"test"` script only).
Unchanged: `server.js`, `landing-templates.js`. Originals are in `_original_backup/`. New: `tests/`.

## 1. Root cause of "Pixel ID not found or this token has no access to that Pixel"
`checkPixel` did `GET /{pixel_id}?fields=id,name`. A CAPI token from Events Manager is allowed to **post events** but frequently
**not to read the Pixel object**; Meta then answers error code 100 ("…cannot be loaded due to missing permissions").
The old code mapped **every** code 100 / 200 / 803 to "Pixel ID not found or token has no access", so valid ID+token pairs were rejected.
(Code reading + Meta's documented behaviour; I could not call Meta live — **confirm with your real Pixel**.)
Not the cause: Graph v21.0 is still supported until 2027-01-21. I raised the default to v25.0 (still overridable with `META_API_VERSION`).

New validation (still real validation, nothing removed):
1. Pixel ID must be 8–20 digits; token required.
2. Try to read the Pixel → success = **verified**.
3. Token invalid/expired (190) → "token invalid" (separate from pixel errors). Rate limit / Meta 5xx / network → honest message.
4. Ambiguous "cannot read" (100/200/10/803/294): if a **Test Event Code** is entered, a probe is sent to Test Events only (never production) → proves write access; rejected if Meta refuses.
5. Ambiguous and no Test Event Code → page is created with `pixelVerified:false` + a visible warning ("add a Test Event Code and tap SEND TEST EVENT").
Tokens are scrubbed from all error text and never returned to the browser (tested).

## 2. Join Request tracking (exact flow, now in code)
Ad click → landing page (`/api/track/:id/view` saves visitor/session/first-touch attribution + a `view` event) →
JOIN NOW (`/api/invite/:id` saves a `click` event, creates ONE unique Telegram invite link per visitor session with `creates_join_request`) →
Telegram sends `chat_join_request` to `/api/tg/:id` (secret-token verified) → backend finds the visitor **by the invite-link hash**
(not by the browser) → **row saved in `join_events` first** → only then Subscribe is sent to Meta.
**Subscribe fires only when:** a verified `chat_join_request` arrives through one of OUR unique invite links, once per user per channel.
Clicks, opening Telegram, or opening the link never send Subscribe. Join requests via other links are counted as "other" and never sent to Meta.

## 3. CAPI reliability
- Status in `join_events.status`: `sent`, `pending_retry`, `failed` (plus `pending` while the first try runs).
- Temporary failures (network, 429, 5xx, Meta transient codes) → `pending_retry` with growing delays (1m, 5m, 15m, 1h, 6h, 12h, 24h), max 8 attempts, stops after 6 days (Meta limit is 7). A background worker (every 60 s, `FOR UPDATE SKIP LOCKED`) retries — also recovers rows left `pending` by a crash/restart.
- Permanent failures (bad token, rejected payload) → `failed`, not retried.
- Same `event_id` (`join_<chat>_<user>`) on every attempt + unique (project, chat, user) row → no duplicate Subscribe.
- Subscribe `custom_data` now also carries `landing_page_id`, `landing_page_url`, `fbclid` (plus existing campaign/ad/UTM keys).

## 4. Tracking URL
Built server-side from your real page URL (`PUBLIC_BASE_URL` or the Railway domain in `server.js`):
`<domain>/p/<id>?landing_page_id=<id>&campaign_id={{campaign.id}}&campaign_name={{campaign.name}}&adset_id=…&ad_id=…&utm_source=facebook&utm_medium=paid&utm_campaign=…&utm_content=…&utm_term=…`
`{{…}}` are Meta macros (kept un-encoded so Meta can fill them); `fbclid` is added by Meta automatically. No duplicate keys; existing/custom params are kept;
`GET /api/projects/:id/tracking-url?utm_source=google&…` returns a customised URL. Shown in "My Landing Pages" (ID, Copy tracking link, Share when supported, Analytics) and on the detail screen (ID, Direct URL, **Preview URL**, Tracking URL).
Preview URL (`?preview=1`) switches off the Pixel, view tracking and invite links, so previewing never pollutes stats.

## 5. Attribution
Stored first-touch on the visitor row, copied as a snapshot into `join_events.attribution` at join time. If the click request lost the ad params, the saved first-touch values are used.
No attribution ⇒ shown as **Unattributed**; nothing is guessed. A session is scoped to one landing page (tested: Page A's session can't attribute to Page B).

## 6. Analytics (per landing page, `GET /api/projects/:id` → `analytics`, or `/analytics`)
Total / today page views, unique visitors, JOIN NOW clicks, Join Requests, clicks-without-Join-Request, three rates, funnel, CAPI status counts, breakdown by Campaign / Ad set / Ad / UTM source / medium / campaign / content (incl. Unattributed), recent activity.
- Conversion Rate = Join Requests ÷ Unique Visitors × 100 · CTR = JOIN NOW clicks ÷ Page Views × 100 · Join Request Rate = Join Requests ÷ JOIN NOW clicks × 100. Zero denominator ⇒ "—".
- Clicks without Join Request = **unique visitors** who clicked and have no Join Request (3 clicks by one person count once; never negative).
- **Telegram Opened** and **Confirmed Members** show *Unavailable*: the browser can't tell if Telegram opened, and the webhook only receives requests, not approvals.
- "Today" uses `ANALYTICS_TIMEZONE` (default UTC).
- Numbers come from new event tables, so they start from deployment day; the old 30-day counters remain (relabelled "RAW COUNTERS"; "Join attempts (all)" includes blocked/bot attempts, so it is higher than JOIN NOW clicks).
- Every query is filtered by the project's id, resolved through owner check (404 for other users).

## 7. Database migration (automatic, additive, idempotent — runs in `projects.init()` at startup)
No tables dropped/recreated. Adds: `join_events.event_time`, `join_events.next_retry_at`; `'pending_retry'` allowed in the status CHECK; new table `track_events`; 4 indexes.
Optional (run once, manually) to re-queue old transient failures that are still < 6 days old:
```sql
UPDATE join_events SET status='pending_retry', next_retry_at=NOW()
WHERE status='failed' AND created_at > NOW() - INTERVAL '6 days'
  AND (capi_http_status = 0 OR capi_http_status = 429 OR capi_http_status >= 500);
```
Back up the database before first deploy as usual.

## 8. Environment variable NAMES
Existing: `BOT_TOKEN`, `ADMIN_TELEGRAM_ID`, `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `PUBLIC_BASE_URL` (optional), `META_API_VERSION` (optional), `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` (optional), `RAILWAY_VOLUME_MOUNT_PATH`, `PORT`.
New (optional): `ANALYTICS_TIMEZONE` (e.g. `Asia/Kolkata`).

## 9. Test results (actually executed: `node tests/run.js` → 44 tests)
Environment limits: no PostgreSQL, no `express`/`pg` installed, no network. Tests run the REAL `projects.js`/`integrations.js`/`landing-page.js` code against a fake router, an in-memory store with the same contract as the SQL store, mocked Telegram/Meta `fetch`, and a test-only `secure.js` stub (`tests/secure.stub.js`).
**Round 1: 25/25 passed. Round 2: 19/19 passed.**
Before Round 1 passed, my first run failed 25 tests because of a bug in my own fake router (not in the app); fixed. During the review I also fixed one real SQL risk (`at` used as a column alias → renamed `occurred_at`).
I also mutation-checked the suite (removed click recording, Subscribe sending, ownership check, retries): the suite failed as expected.

Round 1: Pixel valid/invalid/missing/ambiguous(root-cause)/bad token/rate-limit/network/token-scrubbing · validation kept · Telegram channel + admin checks · landing page creation & URLs · tracking URL rules · PageView & unique visitors · JOIN click & repeat click · webhook secret · DB-first Join Request + Subscribe payload · non-landing-link requests · duplicate webhooks · analytics math & funnel · auth/ownership · CAPI dedup · preview mode.
Round 2: missing UTMs · two campaigns on one page · lost-attribution recovery · Meta 500 / network failure · retry worker (timing, single send) · webhook re-delivery · invalid token (no retry) · max attempts & backoff · stale events · DB failure (Meta not called) · multiple pages per user · session isolation · cross-user writes · zero-denominator math · test-event route · paused page · no secrets/user-ids in analytics · UI rendering + HTML escaping.

## 10. NOT TESTED (needs your environment/credentials)
- Real PostgreSQL: the new SQL (analytics queries, `claimRetryJoins`, migration, CHECK-constraint swap) is reviewed but **not executed**. Deploy to a staging DB first and open one landing page's detail screen.
- Live Meta: Pixel validation with your real Pixel/token (root cause is code-analysis based), real Subscribe delivery, Test Events tab, dedup in Events Manager.
- Live Telegram: real `chat_join_request` webhook, real invite links.
- Browser/mobile rendering of the new UI blocks (only the HTML-string generation was executed; no browser/Telegram WebApp available).
- Your real `secure.js`, `index.html`, `landing.html`, `project-theme.js` (not provided).
- `landing-templates.js` ends with a stray `require('./project-schema')` line (looks like a paste artifact, harmless); left untouched.
