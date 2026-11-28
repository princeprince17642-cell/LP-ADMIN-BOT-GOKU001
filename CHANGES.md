# v3.1 — create-flow regression fixed (read this first)

## What I broke and fixed
1. **"Create Landing Page" did nothing — my bug.** In v3 I removed the headline / button-text / guide fields from the form, but `clientValidate()` still ran `o.headline.length`, `o.buttonText.length`, `o.guidePoints.length`. Those were now `undefined`, so the click threw a TypeError before any request was sent. Fixed (those checks removed). My earlier tests never clicked the real form, which is why I missed it; the new browser test does.
2. **Channel URL field.** Honest note: in the original code (`_original_backup/projects-ui.js`) there was no field called "Channel URL" — the fields were Channel ID, Channel/community name and Channel *image* URL. Since you want it, it now exists: optional "Channel URL" in create AND edit, saved in a new `projects.channel_url` column, shown in the page details and returned by the API. Accepts `https://t.me/x`, `t.me/x`, `@x`, `t.me/+invite`; normalised to `https://t.me/...`; anything else is rejected with a message. It is never printed on the public landing page (name + JOIN NOW only). Channel Name and Image URL are unchanged.
3. **`toast()`** fell back to a blocking `alert()` when the host page has no `#toast` element (froze my test browser). It now creates its own element.
4. **Migration hardening:** critical columns (`channel_url`, `source_type`, `project_history`) are created first; optional steps (orders link, require_fbclid reset) are isolated, so one failing statement can never block page creation. Dry-run against a fake DB with a forced failure: finishes normally.
Other v3 changes were re-checked for breakage (details/edit/pause/resume/delete/check-connection/download-HTML/orders/restart persistence): nothing else was broken.

## What was actually tested (executed)
- `node tests/run.js`: **R1 24/24, R2 19/19, R3 21/21 = 64 tests** (real code, mocked Telegram/Meta, in-memory store).
- `tests/browser/create-flow-e2e.js` (headless Chrome driving the real dashboard JS + public page JS against the real server routes, mocked DB/Telegram/Meta), **all PASS**: fill and submit the create form → page created, saved, details opened; validation errors shown; Channel URL saved/shown/edited; server restart + refresh → page still listed; public page opens (ad URL and direct URL); JOIN NOW click recorded and sends **no** Subscribe; real `chat_join_request` webhook → saved in DB first, then exactly one Subscribe with campaign / ad set / ad / UTM / fbclid / landing_page_id/url; duplicate webhook ignored; direct visitor's Join Request saved but not sent to Meta; dashboard analytics numbers; order exists; CHECK CONNECTION, PAUSE, RESUME, DELETE work; no JavaScript errors.
- Static check: SQL placeholder counts of insertProject / upsertVisitor / insertJoinEvent match their parameter lists.
## NOT tested (needs your environment)
Real PostgreSQL (the SQL is only statically checked), live Meta, live Telegram, your real `index.html` / `secure.js` (not provided), real Telegram WebApp.

---
# v3 corrections — persistence, minimal page, open access, Your Services, Orders, history
(v2 notes: CHANGES_v2.md. Originals of the first upload: `_original_backup/`.)

**Still missing from your uploads:** `secure.js`, `index.html`, `landing.html`, `project-theme.js`, `logo.png`. Copy this folder's files over your repo; keep your own copies of those.
Files changed in v3: `projects.js`, `projects-ui.js`, `landing-page.js`, `project-schema.js` (+ v2: `integrations.js`). `server.js` is unchanged.

## 1. Why the landing page "disappeared"
I could not see `index.html` or your database, so this is from the code. Findings:
- **Nothing deleted it.** Pages live in the PostgreSQL `projects` table. The only deletion paths are your own DELETE, and a rollback *during creation* if Telegram's setWebhook fails (then you see an error, not a success).
- **The page became unreachable.** The only way to the list was one button injected ONCE at load into `#landing .lp-head`. If `index.html` re-renders that header (e.g. after it loads your selected design) the button is gone, and there was no other entry. The list API also lived behind a screen you could only reach through that button.
- Not verified on your live app. If pages are truly missing from the `projects` table after a restart, the cause is the database (e.g. DATABASE_URL pointing to a different/ephemeral DB), which this code can't detect: check `SELECT public_id, owner_telegram_id, created_at FROM projects;`.

## 2. Permanent saving, fixed
- Entry points are re-created by a MutationObserver whenever the host page re-renders. "Your Services" is also added to the bottom navigation (see §6 caveat).
- Everything is read from PostgreSQL on every open (`GET /api/services`); no page state is kept in memory.
- Saved per page: id, name, channel info, URL + ad-ready link (derived from the id), created/updated timestamps, status, encrypted bot/CAPI tokens. Analytics and history stay attached (`ON DELETE CASCADE` only if the page itself is deleted).
- Creation is all-or-nothing: if Telegram setWebhook fails, nothing is kept (page and order). Duplicate bot/channel → 409, no second record.

## 3. Landing page design
Public page = emblem (channel image or initial) + **channel name** + **one JOIN NOW button**. Removed: headline, subtitle, About, What members get, Why join, FAQ, privacy accordion, footer, sticky bar, tag, micro-text. Same 4 theme palettes/fonts. Verified in headless Chrome at 390 px for all 4 designs.
The creation form no longer asks for headline, subtitle, button text, description, guide points or the ad-only checkbox.
Note: the removed privacy accordion explained Pixel/IP use to visitors. Check whether your ad/legal setup needs a privacy notice elsewhere.

## 4. Direct URLs always open
Cause: `require_fbclid` (default ON) made JOIN NOW answer "This page only works when opened from the ad". Removed the gate completely (server + form + DB default; existing rows set to false). Ad parameters are used only for attribution. Verified in Chrome: no params → view recorded, JOIN works, redirects to Telegram.
- Unresolved Meta macros (`{{campaign.id}}`…) opened outside an ad are discarded, never stored.
- Source is stored as `meta_ad` / `utm_campaign` / `organic` / `referral` / `direct`; nothing is invented.
- **Decision for you to confirm:** a real Join Request from non-ad traffic is saved and counted but **not sent to Meta** (status `skipped`), so Meta never receives a conversion that wasn't an ad conversion.

## 5. One link per landing page
Shown everywhere as the single "link": `<domain>/p/<id>?landing_page_id=<id>&campaign_id={{campaign.id}}&campaign_name={{campaign.name}}&adset_id=…&adset_name=…&ad_id=…&ad_name=…&utm_source={{site_source_name}}&utm_medium={{placement}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}`.
Meta fills the macros and appends `fbclid`. I removed the hard-coded `utm_source=facebook&utm_medium=paid`, otherwise a link shared on WhatsApp would be mislabeled as a paid Facebook visit. Preview is a button (tracking off), not a second link. Campaign A and B on the same page stay separate (first-touch per visitor session, stored per visit and copied onto each Join Request).

## 6. Your Services
Bottom-nav item "Your Services" (cloned from the Orders item so it matches) + hero button; opens a screen with tabs YOUR SERVICES | ORDERS. Each landing page card: name, ID, status, created date, link, COPY LINK, PREVIEW, ANALYTICS. "Other services" lists real non-landing orders only; nothing is invented.
**Caveat:** I don't have `index.html`, so nav injection finds the Orders item by its text and clones it. Tested on a mock nav with Home / Landing Page / Orders / Account, not on your real one. If it doesn't appear, add `onclick="GDXProjects.openServices()"` to a nav item.

## 7. Orders
- Every landing page created from now on creates a real order (service "Landing Page - <name>", amount 0.00 because creation isn't charged in your code, status completed), linked by `orders.project_id`, one per page. Old pages are NOT back-filled; they appear only in Your Services.
- Orders tab: order id (GDX-000123), service, date, status, landing page ID + link, COPY LINK, VIEW DETAILS. Detail: the full analytics + campaign breakdown + history of that page. Only the buyer can open an order (404 otherwise). Deleting a page keeps its order.
- I did not modify your existing Orders screen (it lives in `index.html`); the new Orders tab is in the overlay. `GET /api/orders` is unchanged.

## 8. Analytics and history
Overview, rates (formulas shown on screen), funnel (Telegram Opened and Confirmed Members = Unavailable), breakdown by Source / Campaign / Ad set / Ad / UTM*, CAPI counts incl. skipped. History (`GET /api/projects/:id/history`, also in details): created, updated, page opened, JOIN NOW clicked, Join Request received, Meta Subscribe sent / failed / will retry / skipped, order created — real records with timestamps, owner-only. New table `project_history`; clicks/views/joins come from their own tables.

## 9. Attribution and Subscribe trigger
Visit (view event, first-touch attribution) → JOIN NOW (click event; one unique invite link per visitor session) → Telegram `chat_join_request` found **by invite-link hash**, not by the browser → row saved in `join_events` → **only then** Subscribe to Meta, and only if the visitor came from a Meta ad (fbclid / fbc / campaign / ad set / ad id). Never on view, click, link opening or link creation. One row/Subscribe per user per channel; failures stay saved and are retried (v2 worker).

## 10. Migration (automatic at startup, additive)
`visitors.source_type`; `projects.require_fbclid` default false + existing rows set false; `projects.headline` default ''; new table `project_history`; `orders.project_id` (+ unique index per page). No table dropped.

## 11. Tests (executed)
`node tests/run.js` → **R1 24/24, R2 19/19, R3 18/18 (61 tests)**: real code vs mocks (fake router, in-memory store, mocked Telegram/Meta, test-only secure stub).
R3 covers: create with minimal fields; **restart persistence** (new server instance, same DB); saved fields; no duplicates; rollback; minimal page markup; direct URL / junk params / macros always 200; direct visitor join saved but not sent to Meta; macro stripping; source classification; ad attribution per campaign; Your Services; Orders + detail + cross-user 404; old pages without orders; deleted page keeps order; history; cross-user on every endpoint; repeat clicks/drop-off/duplicate webhook/Meta failure/DB failure.
Browser (headless Chrome, `tests/browser/`): the real page JS (direct, Meta-ad URL, unresolved macros → correct payloads and Telegram redirect) and the real dashboard JS against the real server routes (nav injection, re-injection after host re-render, Services, detail, Orders, order detail): no script errors.

## 12. NOT TESTED
- Real PostgreSQL (new SQL: history UNION, orders join, migration) — staging first.
- Live Meta + Telegram (Pixel validation, Subscribe delivery, real chat_join_request, real invite links).
- Your real `index.html` (nav placement, existing Orders screen), real Telegram WebApp, real `secure.js`.
