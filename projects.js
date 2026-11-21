'use strict';
// "Landing Page + Tracking Generator": routes, visitor filtering, attribution and Meta CAPI.
//
// Strict rules implemented here:
//  * Subscribe is sent ONLY for a Join Request that arrives through a unique invite link created by
//    OUR landing page. Any other join request (external/manual link, search...) is never sent to Meta.
//  * One bot = one project. Each project uses its OWN bot token, Pixel and channel (entered by the owner).
//  * Tokens are AES-256-GCM encrypted at rest and are never logged or returned to the browser.
//  * A user can only read/change their own projects.

const path = require('path');
const secure = require('./secure');
const integ = require('./integrations');
const { renderProjectPage, TEMPLATE_KEYS, BG_KEYS } = require('./landing-page');
const { initProjectSchema } = require('./project-schema');

const { UserError, ATTR_KEYS } = integ;
const { sha256 } = secure;

// ---------------- Settings ----------------
const LINK_TTL_MIN = 30;           // invite links expire after 30 minutes
const MAX_PROJECTS_PER_USER = 20;
const MIN_VISIT_AGE_MS = 1000;     // a real person needs at least ~1s on the page
const LIMIT_LINKS_PER_IP = 20;     // invite links per IP per 10 minutes
const LIMIT_VISITS_PER_IP = 150;   // page views per IP per 10 minutes
const RATE_WINDOW_MIN = 10;

const RE = {
    publicId: /^[a-f0-9]{16}$/,
    sid: /^[A-Za-z0-9_-]{16,64}$/,
    fbclid: /^[A-Za-z0-9_-]{10,300}$/,
    fbc: /^fb\.[0-2]\.\d{10,13}\.[A-Za-z0-9_-]{10,300}$/,
    fbp: /^fb\.[0-2]\.\d{10,13}\.\d{5,25}$/,
    numId: /^\d{5,25}$/,
    pixelId: /^\d{8,20}$/,
    capiToken: /^[A-Za-z0-9_-]{20,600}$/,
    botToken: /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/,
    channelId: /^-100\d{6,14}$/,
    testCode: /^[A-Za-z0-9_-]{3,40}$/,
    hex: /^#[0-9a-fA-F]{6}$/
};

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|meta-externalagent|headless|phantomjs|selenium|puppeteer|playwright|lighthouse|pagespeed|python-requests|python-urllib|aiohttp|httpx|curl\/|wget|libwww|java\/|okhttp\/\d|go-http-client|node-fetch|axios|undici|scrapy|httpclient|postman|insomnia|telegrambot|whatsapp|twitterbot|linkedinbot|discordbot|preview/i;

// ---------------- Small helpers ----------------

function clean(v, max) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max || 200);
}
function logJson(evt, data) {
    console.log(JSON.stringify(Object.assign({ evt, t: new Date().toISOString() }, data || {})));
}
function scrubError(e) {
    return String((e && e.message) || e || '').replace(/\d{6,12}:[A-Za-z0-9_-]{30,50}/g, '[bot-token]').slice(0, 300);
}
function isBotUa(ua) {
    return !ua || BOT_UA.test(ua);
}
function clientIp(req) {
    const real = clean(req.headers['x-real-ip'], 64);
    if (real) return real;
    const xff = clean(String(req.headers['x-forwarded-for'] || '').split(',')[0], 64);
    return xff || clean(req.socket && req.socket.remoteAddress, 64);
}
function httpUrl(v) {
    const s = clean(v, 1000);
    return /^https?:\/\/\S+$/i.test(s) ? s : '';
}

// Attribution that travels from the first visit -> Join click -> invite link -> Join Request.
function normalizeAttribution(b) {
    b = b || {};
    const out = { sid: clean(b.sid, 64), fbclid: '', fbc: '', fbp: '', sourceUrl: httpUrl(b.url), referrer: httpUrl(b.ref) };
    const fbc = clean(b.fbc, 400);
    const fbclid = clean(b.fbclid, 300);
    const fbp = clean(b.fbp, 100);
    if (RE.fbc.test(fbc)) out.fbc = fbc;
    if (RE.fbp.test(fbp)) out.fbp = fbp;
    if (RE.fbclid.test(fbclid)) out.fbclid = fbclid;
    if (!out.fbclid && out.fbc) out.fbclid = out.fbc.split('.').slice(3).join('.');
    if (!out.fbc && out.fbclid) out.fbc = 'fb.1.' + Date.now() + '.' + out.fbclid;
    ['campaign_id', 'adset_id', 'ad_id'].forEach(k => {
        const v = clean(b[k], 40);
        out[k] = RE.numId.test(v) ? v : '';
    });
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(k => { out[k] = clean(b[k], 200); });
    return out;
}

function snapshotAttribution(v) {
    const s = { fbclid: v.fbclid || '', fbc: v.fbc || '', fbp: v.fbp || '', source_url: v.source_url || '' };
    ATTR_KEYS.forEach(k => { s[k] = v[k] || ''; });
    return s;
}

// ---------------- Input validation ----------------

function bad(field, message) { throw new UserError(message, field); }

function validateProjectInput(body, partial, findTemplate) {
    const b = body || {};
    const out = {};
    const has = (k) => b[k] !== undefined;
    const need = (k) => !partial || has(k);

    if (need('templateKey')) {
        const t = clean(b.templateKey, 40);
        if (!TEMPLATE_KEYS.includes(t) || (findTemplate && !findTemplate(t))) bad('templateKey', 'Please choose one of the four designs.');
        out.templateKey = t;
    }
    if (!partial) {
        const pixel = clean(b.pixelId, 30);
        if (!RE.pixelId.test(pixel)) bad('pixelId', 'Pixel ID must be 8 to 20 digits (copy it from Meta Events Manager).');
        out.pixelId = pixel;
        const capi = clean(b.capiToken, 700);
        if (!RE.capiToken.test(capi)) bad('capiToken', 'The CAPI access token looks incomplete. Paste the full token from Events Manager.');
        out.capiToken = capi;
        const bot = clean(b.botToken, 100);
        if (!RE.botToken.test(bot)) bad('botToken', 'The bot token looks wrong. It should look like 123456789:ABC... (copy it from @BotFather).');
        out.botToken = bot;
        const ch = clean(b.channelId, 30);
        if (!RE.channelId.test(ch)) bad('channelId', 'Channel ID must start with -100 followed by digits.');
        out.channelId = ch;
    }
    if (need('channelName')) {
        const v = clean(b.channelName, 80);
        if (v.length < 2 || v.length > 60) bad('channelName', 'Channel name must be 2 to 60 characters.');
        out.channelName = v;
    }
    if (need('headline')) {
        const v = clean(b.headline, 200);
        if (v.length < 3 || v.length > 120) bad('headline', 'Headline must be 3 to 120 characters.');
        out.headline = v;
    }
    if (need('buttonText')) {
        const v = clean(b.buttonText, 60);
        if (v.length < 2 || v.length > 30) bad('buttonText', 'Button text must be 2 to 30 characters.');
        out.buttonText = v;
    }
    if (has('imageUrl')) {
        const v = clean(b.imageUrl, 600);
        if (v) {
            let ok = false;
            try { ok = new URL(v).protocol === 'https:' && v.length <= 500; } catch (e) { ok = false; }
            if (!ok) bad('imageUrl', 'Image URL must be a full https:// link (max 500 characters).');
        }
        out.imageUrl = v;
    } else if (!partial) { out.imageUrl = ''; }

    if (has('testEventCode')) {
        const v = clean(b.testEventCode, 60);
        if (v && !RE.testCode.test(v)) bad('testEventCode', 'Test Event Code looks wrong. Copy it from the Test Events tab (example: TEST12345).');
        out.testEventCode = v;
    } else if (!partial) { out.testEventCode = ''; }

    if (has('description') || has('guidePoints') || has('subtitle') || !partial) {
        const content = {};
        const desc = clean(b.description, 600);
        if (desc.length > 400) bad('description', 'Description can be up to 400 characters.');
        if (desc) content.description = desc;
        const sub = clean(b.subtitle, 300);
        if (sub.length > 200) bad('subtitle', 'Subtitle can be up to 200 characters.');
        if (sub) content.subtitle = sub;
        let points = b.guidePoints;
        if (typeof points === 'string') points = points.split('\n');
        if (Array.isArray(points)) {
            points = points.map(x => clean(x, 200)).filter(Boolean);
            if (points.length > 5) bad('guidePoints', 'Use at most 5 guide points.');
            if (points.some(x => x.length > 120)) bad('guidePoints', 'Each guide point can be up to 120 characters.');
            if (points.length) content.guidePoints = points;
        }
        out.content = content;
    }

    if (has('theme') || !partial) {
        const t = b.theme || {};
        const theme = {};
        const accent = clean(t.accent, 10);
        if (accent) { if (!RE.hex.test(accent)) bad('theme', 'Accent color must look like #FFAA00.'); theme.accent = accent; }
        const bg = clean(t.bg, 20) || 'template';
        if (!BG_KEYS.includes(bg)) bad('theme', 'Unknown background style.');
        theme.bg = bg;
        out.theme = theme;
    }

    if (has('requireFbclid') || !partial) out.requireFbclid = b.requireFbclid === undefined ? true : !!b.requireFbclid;
    if (has('turnstileEnabled') || !partial) out.turnstileEnabled = !!b.turnstileEnabled;
    if (partial && has('status')) {
        if (!['active', 'paused'].includes(b.status)) bad('status', 'Status must be active or paused.');
        out.status = b.status;
    }
    return out;
}

// ---------------- Postgres data layer ----------------
// All SQL lives here, so the route logic above/below can be tested without a database.

const STAT_FIELDS = ['page_views', 'join_clicks', 'link_requests', 'links_issued', 'join_requests',
    'capi_success', 'capi_failed', 'blocked', 'unattributed_join_requests'];

function createPgStore(getPool) {
    const q = (text, params) => getPool().query(text, params);
    const one = async (text, params) => { const r = await q(text, params); return r.rows[0] || null; };

    return {
        async listOwned(ownerId) {
            const r = await q(
                `SELECT p.*, COALESCE((SELECT SUM(join_requests) FROM project_stats_daily s WHERE s.project_id = p.id), 0) AS total_joins
                 FROM projects p WHERE p.owner_telegram_id = $1 ORDER BY p.created_at DESC`, [ownerId]);
            return r.rows;
        },
        getOwned: (publicId, ownerId) => one(`SELECT * FROM projects WHERE public_id = $1 AND owner_telegram_id = $2`, [publicId, ownerId]),
        getByPublicId: (publicId) => one(`SELECT * FROM projects WHERE public_id = $1`, [publicId]),
        async countOwned(ownerId) {
            const r = await one(`SELECT COUNT(*) AS c FROM projects WHERE owner_telegram_id = $1`, [ownerId]);
            return Number(r.c);
        },
        async botTaken(botId) {
            return !!(await one(`SELECT 1 AS x FROM projects WHERE bot_id = $1`, [botId]));
        },
        insertProject: (p) => one(
            `INSERT INTO projects (public_id, owner_telegram_id, status, template_key, theme, content, channel_name, headline,
                button_text, image_url, pixel_id, capi_token_enc, test_event_code, bot_token_enc, bot_id, bot_username,
                channel_id, channel_title, webhook_secret_hash, require_fbclid, turnstile_enabled, validated_at)
             VALUES ($1,$2,'active',$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
             RETURNING *`,
            [p.publicId, p.ownerId, p.templateKey, JSON.stringify(p.theme), JSON.stringify(p.content), p.channelName, p.headline,
             p.buttonText, p.imageUrl, p.pixelId, p.capiTokenEnc, p.testEventCode, p.botTokenEnc, p.botId, p.botUsername,
             p.channelId, p.channelTitle, p.webhookSecretHash, p.requireFbclid, p.turnstileEnabled]),
        async markWebhook(id) { await q(`UPDATE projects SET webhook_set_at = NOW() WHERE id = $1`, [id]); },
        async deleteById(id) { await q(`DELETE FROM projects WHERE id = $1`, [id]); },
        async updateOwned(publicId, ownerId, patch) {
            const map = { templateKey: 'template_key', channelName: 'channel_name', headline: 'headline', buttonText: 'button_text',
                imageUrl: 'image_url', testEventCode: 'test_event_code', requireFbclid: 'require_fbclid',
                turnstileEnabled: 'turnstile_enabled', status: 'status', theme: 'theme', content: 'content' };
            const sets = []; const vals = [publicId, ownerId];
            Object.keys(patch).forEach(k => {
                if (!map[k]) return;
                vals.push(k === 'theme' || k === 'content' ? JSON.stringify(patch[k]) : patch[k]);
                sets.push(`${map[k]} = $${vals.length}${k === 'theme' || k === 'content' ? '::jsonb' : ''}`);
            });
            if (!sets.length) return this.getOwned(publicId, ownerId);
            return one(`UPDATE projects SET ${sets.join(', ')}, updated_at = NOW() WHERE public_id = $1 AND owner_telegram_id = $2 RETURNING *`, vals);
        },
        async deleteOwned(publicId, ownerId) {
            const r = await q(`DELETE FROM projects WHERE public_id = $1 AND owner_telegram_id = $2`, [publicId, ownerId]);
            return r.rowCount > 0;
        },

        async bump(projectId, field, n) {
            if (!STAT_FIELDS.includes(field)) return;
            await q(`INSERT INTO project_stats_daily (project_id, day, ${field}) VALUES ($1, CURRENT_DATE, $2)
                     ON CONFLICT (project_id, day) DO UPDATE SET ${field} = project_stats_daily.${field} + EXCLUDED.${field}`,
                [projectId, n || 1]);
        },
        async blocked(projectId, reason) {
            await q(`INSERT INTO blocked_daily (project_id, day, reason, count) VALUES ($1, CURRENT_DATE, $2, 1)
                     ON CONFLICT (project_id, day, reason) DO UPDATE SET count = blocked_daily.count + 1`, [projectId, reason]);
            await this.bump(projectId, 'blocked', 1);
        },

        // First-touch: existing non-empty values are never overwritten.
        upsertVisitor: (projectId, v) => one(
            `INSERT INTO visitors (project_id, session_id, fbc, fbp, fbclid, source_url, referrer, ip, user_agent,
                campaign_id, adset_id, ad_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             ON CONFLICT (project_id, session_id) DO UPDATE SET
                fbc = CASE WHEN visitors.fbc = '' THEN EXCLUDED.fbc ELSE visitors.fbc END,
                fbp = CASE WHEN visitors.fbp = '' THEN EXCLUDED.fbp ELSE visitors.fbp END,
                fbclid = CASE WHEN visitors.fbclid = '' THEN EXCLUDED.fbclid ELSE visitors.fbclid END,
                source_url = CASE WHEN visitors.source_url = '' THEN EXCLUDED.source_url ELSE visitors.source_url END,
                referrer = CASE WHEN visitors.referrer = '' THEN EXCLUDED.referrer ELSE visitors.referrer END,
                ip = CASE WHEN visitors.ip = '' THEN EXCLUDED.ip ELSE visitors.ip END,
                user_agent = CASE WHEN visitors.user_agent = '' THEN EXCLUDED.user_agent ELSE visitors.user_agent END,
                campaign_id = CASE WHEN visitors.campaign_id = '' THEN EXCLUDED.campaign_id ELSE visitors.campaign_id END,
                adset_id = CASE WHEN visitors.adset_id = '' THEN EXCLUDED.adset_id ELSE visitors.adset_id END,
                ad_id = CASE WHEN visitors.ad_id = '' THEN EXCLUDED.ad_id ELSE visitors.ad_id END,
                utm_source = CASE WHEN visitors.utm_source = '' THEN EXCLUDED.utm_source ELSE visitors.utm_source END,
                utm_medium = CASE WHEN visitors.utm_medium = '' THEN EXCLUDED.utm_medium ELSE visitors.utm_medium END,
                utm_campaign = CASE WHEN visitors.utm_campaign = '' THEN EXCLUDED.utm_campaign ELSE visitors.utm_campaign END,
                utm_content = CASE WHEN visitors.utm_content = '' THEN EXCLUDED.utm_content ELSE visitors.utm_content END,
                utm_term = CASE WHEN visitors.utm_term = '' THEN EXCLUDED.utm_term ELSE visitors.utm_term END,
                last_seen_at = NOW()
             RETURNING id, created_at, (xmax = 0) AS inserted`,
            [projectId, v.sid, v.fbc, v.fbp, v.fbclid, v.sourceUrl, v.referrer, v.ip, v.ua,
             v.campaign_id, v.adset_id, v.ad_id, v.utm_source, v.utm_medium, v.utm_campaign, v.utm_content, v.utm_term]),
        getVisitorById: (id) => one(`SELECT * FROM visitors WHERE id = $1`, [id]),
        getVisitorBySession: (projectId, sid) => one(`SELECT fbclid, fbc FROM visitors WHERE project_id = $1 AND session_id = $2`, [projectId, sid]),
        async countVisitorsByIp(projectId, ip, minutes) {
            if (!ip) return 0;
            const r = await one(`SELECT COUNT(*) AS c FROM visitors WHERE project_id = $1 AND ip = $2 AND created_at > NOW() - ($3::int * INTERVAL '1 minute')`, [projectId, ip, minutes]);
            return Number(r.c);
        },
        async countLinksByIp(projectId, ip, minutes) {
            if (!ip) return 0;
            const r = await one(`SELECT COUNT(*) AS c FROM invite_links l JOIN visitors v ON v.id = l.visitor_id
                                 WHERE l.project_id = $1 AND v.ip = $2 AND l.created_at > NOW() - ($3::int * INTERVAL '1 minute')`, [projectId, ip, minutes]);
            return Number(r.c);
        },

        getLinkByVisitor: (visitorId) => one(`SELECT * FROM invite_links WHERE visitor_id = $1`, [visitorId]),
        insertLink: (l) => one(
            `INSERT INTO invite_links (project_id, visitor_id, link, link_hash, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [l.projectId, l.visitorId, l.link, l.linkHash, l.expiresAt]),
        findLinkByHash: (projectId, hash) => one(`SELECT * FROM invite_links WHERE project_id = $1 AND link_hash = $2`, [projectId, hash]),
        async markLinkUsed(id) { await q(`UPDATE invite_links SET used_at = COALESCE(used_at, NOW()) WHERE id = $1`, [id]); },

        // Returns the new row, or null when this user already has a join event in this channel (dedupe).
        insertJoinEvent: (j) => one(
            `INSERT INTO join_events (project_id, telegram_user_id, chat_id, invite_link_id, visitor_id, event_id, attribution, source_url, visitor_session)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
             ON CONFLICT (project_id, chat_id, telegram_user_id) DO NOTHING RETURNING id`,
            [j.projectId, j.telegramUserId, j.chatId, j.inviteLinkId, j.visitorId, j.eventId, JSON.stringify(j.attribution), j.sourceUrl, j.visitorSession]),
        async finishJoinEvent(id, r) {
            await q(`UPDATE join_events SET status = $2, attempts = $3, capi_http_status = $4, capi_events_received = $5,
                        capi_fbtrace_id = $6, capi_error = $7, sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE NULL END WHERE id = $1`,
                [id, r.ok ? 'sent' : 'failed', r.attempts, r.httpStatus, r.eventsReceived, r.fbtraceId, r.error]);
        },
        async logCapi(l) {
            await q(`INSERT INTO capi_log (project_id, kind, event_id, ok, http_status, events_received, fbtrace_id, error_message)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [l.projectId, l.kind, l.eventId || '', l.ok, l.httpStatus, l.eventsReceived, l.fbtraceId || '', l.error || '']);
        },

        async getStats(projectId, days) {
            const totals = await one(
                `SELECT COALESCE(SUM(page_views),0) AS page_views, COALESCE(SUM(join_clicks),0) AS join_clicks,
                        COALESCE(SUM(link_requests),0) AS link_requests, COALESCE(SUM(links_issued),0) AS links_issued,
                        COALESCE(SUM(join_requests),0) AS join_requests, COALESCE(SUM(capi_success),0) AS capi_success,
                        COALESCE(SUM(capi_failed),0) AS capi_failed, COALESCE(SUM(blocked),0) AS blocked,
                        COALESCE(SUM(unattributed_join_requests),0) AS unattributed_join_requests
                 FROM project_stats_daily WHERE project_id = $1 AND day >= CURRENT_DATE - ($2::int - 1)`, [projectId, days]);
            const blocked = (await q(
                `SELECT reason, SUM(count) AS count FROM blocked_daily WHERE project_id = $1 AND day >= CURRENT_DATE - ($2::int - 1)
                 GROUP BY reason ORDER BY SUM(count) DESC`, [projectId, days])).rows;
            const attribution = (await q(
                `SELECT COALESCE(NULLIF(attribution->>'campaign_id',''),'(unknown)') AS campaign_id,
                        COALESCE(NULLIF(attribution->>'adset_id',''),'(unknown)') AS adset_id,
                        COALESCE(NULLIF(attribution->>'ad_id',''),'(unknown)') AS ad_id,
                        COUNT(*) AS joins, COUNT(*) FILTER (WHERE status = 'sent') AS sent
                 FROM join_events WHERE project_id = $1 GROUP BY 1,2,3 ORDER BY COUNT(*) DESC LIMIT 20`, [projectId])).rows;
            const recentCapi = (await q(
                `SELECT kind, event_id, ok, http_status, events_received, fbtrace_id, error_message, created_at
                 FROM capi_log WHERE project_id = $1 ORDER BY created_at DESC LIMIT 8`, [projectId])).rows;
            const num = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));
            return {
                totals: num(totals),
                blocked: blocked.map(b => ({ reason: b.reason, count: Number(b.count) })),
                attribution: attribution.map(a => ({ campaignId: a.campaign_id, adsetId: a.adset_id, adId: a.ad_id, joins: Number(a.joins), sent: Number(a.sent) })),
                recentCapi: recentCapi.map(c => ({ kind: c.kind, eventId: c.event_id, ok: c.ok, httpStatus: c.http_status, eventsReceived: c.events_received, fbtraceId: c.fbtrace_id, error: c.error_message, createdAt: c.created_at }))
            };
        }
    };
}

// ---------------- Routes ----------------

function mount(app, ctx) {
    const store = ctx.store;
    const baseUrl = ctx.baseUrl;
    const pending = new Set();
    const verifyHits = new Map();
    const retryDelays = ctx.retryDelays || [0, 1500, 4000];
    const turnstile = ctx.turnstile || { siteKey: process.env.TURNSTILE_SITE_KEY || '', secret: process.env.TURNSTILE_SECRET || '' };
    const turnstileReady = !!(turnstile.siteKey && turnstile.secret);

    const auth = ctx.requireTelegramAuth;
    const track = (p) => { pending.add(p); p.finally(() => pending.delete(p)); return p; };

    function sendError(res, e) {
        if (res.headersSent) return;
        if (e && e.isUserError) {
            return res.status(e.status || 400).json({ ok: false, error: e.message, field: e.field || undefined, code: e.code || undefined });
        }
        logJson('error', { message: scrubError(e) });
        res.status(500).json({ ok: false, error: 'Something went wrong on our side. Please try again.' });
    }
    const handle = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { sendError(res, e); } };

    function needReady() {
        if (!ctx.isDbReady()) throw new UserError('This feature is starting up. Please try again in a moment.', null, 503);
        if (!secure.isEncryptionReady()) throw new UserError('Project tokens cannot be stored yet. The server owner must set TOKEN_ENCRYPTION_KEY.', null, 503);
    }

    const cors = (req, res, next) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '86400');
        if (req.method === 'OPTIONS') return res.status(204).end();
        next();
    };

    const pageUrl = (p) => `${baseUrl}/p/${p.public_id}`;

    function serialize(p) {
        return {
            id: p.public_id,
            status: p.status,
            templateKey: p.template_key,
            channelName: p.channel_name,
            headline: p.headline,
            buttonText: p.button_text,
            imageUrl: p.image_url,
            content: p.content || {},
            theme: p.theme || {},
            pixelId: p.pixel_id,
            hasCapiToken: !!p.capi_token_enc,   // the token itself is never returned
            hasBotToken: !!p.bot_token_enc,
            testEventCode: p.test_event_code,
            botUsername: p.bot_username,
            channelId: String(p.channel_id),
            channelTitle: p.channel_title,
            requireFbclid: !!p.require_fbclid,
            turnstileEnabled: !!p.turnstile_enabled,
            pageUrl: pageUrl(p),
            joinRequests: p.total_joins !== undefined ? Number(p.total_joins) : undefined,
            createdAt: p.created_at,
            updatedAt: p.updated_at
        };
    }

    async function owned(req) {
        const id = String(req.params.id || '');
        const p = RE.publicId.test(id) ? await store.getOwned(id, req.tgUser.id) : null;
        if (!p) throw new UserError('Project not found.', null, 404);
        return p;
    }

    async function publicProject(publicId) {
        const p = RE.publicId.test(String(publicId)) ? await store.getByPublicId(String(publicId)) : null;
        if (!p || p.status !== 'active') throw new UserError('This page is not available.', null, 404);
        return p;
    }

    // ----- health + UI file -----
    app.get('/health', (req, res) => res.json({ ok: true, db: !!ctx.isDbReady(), time: new Date().toISOString() }));
    app.get('/projects-ui.js', (req, res) => {
        res.set('Cache-Control', 'no-cache');
        res.type('application/javascript');
        res.sendFile(path.join(__dirname, 'projects-ui.js'));
    });

    // ----- public landing page -----
    app.get('/p/:publicId', handle(async (req, res) => {
        let p = null;
        if (ctx.isDbReady() && RE.publicId.test(String(req.params.publicId))) p = await store.getByPublicId(req.params.publicId);
        if (!p || p.status !== 'active') {
            return res.status(404).type('html').send('<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#0b0f19;color:#cbd5e1;display:grid;place-items:center;min-height:100vh;text-align:center"><div><h2>Page not available</h2><p>This page does not exist or is paused.</p></div>');
        }
        res.set('Cache-Control', 'no-cache');
        res.set('X-Content-Type-Options', 'nosniff');
        res.type('html').send(renderProjectPage(p, { apiBase: '', turnstileSiteKey: turnstileReady ? turnstile.siteKey : '' }));
    }));

    // ----- tracking: page view (saves the FIRST-touch attribution) -----
    app.options('/api/track/:publicId/view', cors);
    app.post('/api/track/:publicId/view', cors, handle(async (req, res) => {
        needReady();
        const project = await publicProject(req.params.publicId);
        const ua = clean(req.headers['user-agent'], 400);
        if (isBotUa(ua) || (req.body && req.body.webdriver === true)) return res.status(204).end();
        const a = normalizeAttribution(req.body);
        if (!RE.sid.test(a.sid)) return res.status(400).json({ ok: false, error: 'Bad session.' });
        const ip = clientIp(req);
        if (await store.countVisitorsByIp(project.id, ip, RATE_WINDOW_MIN) >= LIMIT_VISITS_PER_IP) return res.status(204).end();
        await store.upsertVisitor(project.id, Object.assign({}, a, { ip, ua }));
        await store.bump(project.id, 'page_views');
        res.json({ ok: true });
    }));

    // ----- Join click: filter -> unique invite link (creates_join_request) -----
    async function checkTurnstile(token, ip) {
        if (!turnstileReady || !token) return false;
        try {
            const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ secret: turnstile.secret, response: String(token), remoteip: ip || '' }).toString()
            });
            const d = await r.json();
            return !!(d && d.success);
        } catch (e) { return false; }
    }

    app.options('/api/invite/:publicId', cors);
    app.post('/api/invite/:publicId', cors, handle(async (req, res) => {
        needReady();
        const project = await publicProject(req.params.publicId);
        const b = req.body || {};
        const ua = clean(req.headers['user-agent'], 400);
        const ip = clientIp(req);
        await store.bump(project.id, 'join_clicks');

        const deny = async (reason, status, message) => {
            await store.blocked(project.id, reason);
            logJson('blocked', { project: project.public_id, reason });
            return res.status(status).json({ ok: false, code: reason, error: message });
        };

        if (isBotUa(ua) || b.webdriver === true) return deny('bot', 403, 'Automated traffic is not allowed.');
        if (project.turnstile_enabled && turnstileReady && !(await checkTurnstile(b.turnstile, ip))) {
            return deny('turnstile', 403, 'Verification failed. Please try again.');
        }
        const a = normalizeAttribution(b);
        if (!RE.sid.test(a.sid)) return deny('bad_session', 400, 'Please reload the page and try again.');
        // Attribution must survive navigation: if this request lost the ad params, use the ones saved at the first visit.
        let hasClick = !!(a.fbclid || a.fbc);
        if (!hasClick && project.require_fbclid) {
            const prev = await store.getVisitorBySession(project.id, a.sid);
            hasClick = !!(prev && (prev.fbclid || prev.fbc));
        }
        if (project.require_fbclid && !hasClick) {
            return deny('no_fbclid', 403, 'This page only works when opened from the ad. Please open the ad link again.');
        }
        if (await store.countLinksByIp(project.id, ip, RATE_WINDOW_MIN) >= LIMIT_LINKS_PER_IP) {
            return deny('rate_limit', 429, 'Too many attempts. Please wait a few minutes and try again.');
        }

        // Save / keep the visitor (first-touch attribution is never overwritten)
        const v = await store.upsertVisitor(project.id, Object.assign({}, a, { ip, ua }));
        if (Date.now() - new Date(v.created_at).getTime() < MIN_VISIT_AGE_MS) {
            return deny('too_fast', 429, 'One moment please...');
        }

        await store.bump(project.id, 'link_requests');

        // One invite link per visitor session
        const existing = await store.getLinkByVisitor(v.id);
        if (existing) {
            if (new Date(existing.expires_at) > new Date()) return res.json({ ok: true, link: existing.link });
            return res.status(410).json({ ok: false, code: 'expired', error: 'This link expired. Please try again.' });
        }

        const botToken = secure.decrypt(project.bot_token_enc);
        const expireUnix = Math.floor(Date.now() / 1000) + LINK_TTL_MIN * 60;
        let link;
        try {
            link = await integ.createInviteLink(botToken, String(project.channel_id), ('v' + v.id).slice(0, 32), expireUnix);
        } catch (e) {
            logJson('invite_failed', { project: project.public_id, message: scrubError(e) });
            throw new UserError('We could not create your invite link right now. Please try again in a minute.', null, 502);
        }
        await store.insertLink({ projectId: project.id, visitorId: v.id, link, linkHash: sha256(link), expiresAt: new Date(expireUnix * 1000) });
        await store.bump(project.id, 'links_issued');
        res.json({ ok: true, link });
    }));

    // ----- Telegram webhook (one per bot / project) -----
    async function sendWithRetry(project, event) {
        const token = secure.decrypt(project.capi_token_enc);
        let last = null;
        for (let i = 0; i < retryDelays.length; i++) {
            if (retryDelays[i]) await new Promise(r => setTimeout(r, retryDelays[i]));
            last = await integ.sendEvents({ pixelId: project.pixel_id, accessToken: token, events: [event], testEventCode: '' });
            last.attempts = i + 1;
            if (last.ok) break;
            const transient = last.httpStatus === 0 || last.httpStatus >= 500 || last.httpStatus === 429;
            if (!transient) break;
        }
        return last;
    }

    async function handleJoinRequest(project, jr) {
        if (String(jr.chat && jr.chat.id) !== String(project.channel_id)) return;
        const userId = jr.from && jr.from.id;
        if (!userId) return;

        const linkUrl = jr.invite_link && jr.invite_link.invite_link;
        const link = linkUrl ? await store.findLinkByHash(project.id, sha256(linkUrl)) : null;

        // STRICT: only requests made through OUR unique link are attributed and sent to Meta.
        if (!link) {
            await store.bump(project.id, 'unattributed_join_requests');
            logJson('join_unattributed', { project: project.public_id });
            return;
        }

        await store.markLinkUsed(link.id);
        const visitor = await store.getVisitorById(link.visitor_id);
        const attribution = visitor ? snapshotAttribution(visitor) : {};
        const chatId = String(jr.chat.id);
        const eventId = `join_${chatId}_${userId}`;

        const row = await store.insertJoinEvent({
            projectId: project.id, telegramUserId: userId, chatId, inviteLinkId: link.id,
            visitorId: visitor ? visitor.id : null, eventId, attribution,
            sourceUrl: visitor ? (visitor.source_url || '') : '', visitorSession: visitor ? visitor.session_id : ''
        });
        if (!row) { logJson('join_duplicate', { project: project.public_id }); return; }   // one Subscribe per user per channel

        await store.bump(project.id, 'join_requests');

        const event = integ.buildSubscribeEvent({
            userId, eventId,
            eventTime: Number(jr.date) || Math.floor(Date.now() / 1000),
            fbc: visitor && visitor.fbc, fbp: visitor && visitor.fbp,
            ip: visitor && visitor.ip, userAgent: visitor && visitor.user_agent,
            sourceUrl: visitor && visitor.source_url, attribution
        });
        const result = await sendWithRetry(project, event);
        await store.finishJoinEvent(row.id, result);
        await store.logCapi({ projectId: project.id, kind: 'join', eventId, ok: result.ok, httpStatus: result.httpStatus,
            eventsReceived: result.eventsReceived, fbtraceId: result.fbtraceId, error: result.error });
        await store.bump(project.id, result.ok ? 'capi_success' : 'capi_failed');
        logJson('capi', { project: project.public_id, kind: 'join', ok: result.ok, http: result.httpStatus,
            received: result.eventsReceived, fbtrace: result.fbtraceId, attempts: result.attempts, error: result.error || undefined });
    }

    app.post('/api/tg/:publicId', async (req, res) => {
        try {
            if (!ctx.isDbReady() || !RE.publicId.test(String(req.params.publicId))) return res.status(404).end();
            const project = await store.getByPublicId(req.params.publicId);
            const given = String(req.get('x-telegram-bot-api-secret-token') || '');
            if (!project || !given || !secure.safeEqual(sha256(given), project.webhook_secret_hash)) return res.status(403).end();
            res.status(200).json({ ok: true });                       // answer Telegram immediately
            const jr = req.body && req.body.chat_join_request;
            if (!jr || project.status !== 'active') return;
            track(handleJoinRequest(project, jr).catch(e => logJson('join_error', { project: project.public_id, message: scrubError(e) })));
        } catch (e) {
            logJson('webhook_error', { message: scrubError(e) });
            if (!res.headersSent) res.status(200).json({ ok: true });
        }
    });

    // ----- owner API -----
    app.get('/api/projects/config', auth, (req, res) => {
        res.json({ ok: true, encryptionReady: secure.isEncryptionReady(), turnstileAvailable: turnstileReady, maxProjects: MAX_PROJECTS_PER_USER, baseUrl });
    });

    app.post('/api/projects/verify-channel', auth, handle(async (req, res) => {
        const now = Date.now();
        const hits = (verifyHits.get(req.tgUser.id) || []).filter(t => now - t < 60000);
        if (hits.length >= 10) throw new UserError('Too many checks. Please wait a minute.', null, 429);
        hits.push(now); verifyHits.set(req.tgUser.id, hits);

        const botToken = clean(req.body && req.body.botToken, 100);
        const channelId = clean(req.body && req.body.channelId, 30);
        if (!RE.botToken.test(botToken)) bad('botToken', 'The bot token looks wrong. It should look like 123456789:ABC...');
        if (!RE.channelId.test(channelId)) bad('channelId', 'Channel ID must start with -100 followed by digits.');
        const v = await integ.verifyBotAndChannel(botToken, channelId);
        res.json({ ok: true, botUsername: v.bot.username, channelTitle: v.chat.title, isAdmin: v.isAdmin, canInvite: v.canInvite, ready: v.isAdmin && v.canInvite });
    }));

    app.post('/api/projects', auth, handle(async (req, res) => {
        needReady();
        const v = validateProjectInput(req.body, false, ctx.findTemplate);
        if (ctx.ensureUser) await ctx.ensureUser(req.tgUser);   // the owner must exist in the users table
        const ownerId = req.tgUser.id;
        if (await store.countOwned(ownerId) >= MAX_PROJECTS_PER_USER) {
            throw new UserError(`You can create up to ${MAX_PROJECTS_PER_USER} projects.`, null, 400);
        }
        const botIdFromToken = v.botToken.split(':')[0];
        if (ctx.mainBotId && String(ctx.mainBotId) === botIdFromToken) {
            bad('botToken', 'This is the GDX admin bot. Every project must use its own separate bot from @BotFather.');
        }
        if (await store.botTaken(botIdFromToken)) {
            throw new UserError('This bot is already connected to another project. Each project needs its own bot.', 'botToken', 409);
        }

        const check = await integ.verifyBotAndChannel(v.botToken, v.channelId);
        integ.assertBotReady(check);
        if (check.bot.id !== botIdFromToken) bad('botToken', 'This bot token is not valid.');
        await integ.checkPixel(v.pixelId, v.capiToken);

        const publicId = secure.randomToken(8);
        const webhookSecret = secure.randomToken(24);
        let row;
        try {
            row = await store.insertProject({
                publicId, ownerId, templateKey: v.templateKey, theme: v.theme, content: v.content,
                channelName: v.channelName, headline: v.headline, buttonText: v.buttonText, imageUrl: v.imageUrl,
                pixelId: v.pixelId, capiTokenEnc: secure.encrypt(v.capiToken), testEventCode: v.testEventCode,
                botTokenEnc: secure.encrypt(v.botToken), botId: botIdFromToken, botUsername: check.bot.username,
                channelId: v.channelId, channelTitle: check.chat.title, webhookSecretHash: sha256(webhookSecret),
                requireFbclid: v.requireFbclid, turnstileEnabled: v.turnstileEnabled && turnstileReady
            });
        } catch (e) {
            if (e && e.code === '23505') throw new UserError('This bot or channel is already used in another project.', 'botToken', 409);
            throw e;
        }

        try {
            await integ.setWebhook(v.botToken, `${baseUrl}/api/tg/${publicId}`, webhookSecret);
            await store.markWebhook(row.id);
        } catch (e) {
            await store.deleteById(row.id);          // roll back: no half-created project
            throw new UserError('Could not connect your bot to this page: ' + scrubError(e), 'botToken', 502);
        }
        logJson('project_created', { project: publicId, owner: String(ownerId), template: v.templateKey });
        res.json({ ok: true, project: serialize(row) });
    }));

    app.get('/api/projects', auth, handle(async (req, res) => {
        needReady();
        const rows = await store.listOwned(req.tgUser.id);
        res.json({ ok: true, projects: rows.map(serialize) });
    }));

    app.get('/api/projects/:id', auth, handle(async (req, res) => {
        needReady();
        const p = await owned(req);
        const stats = await store.getStats(p.id, 30);
        res.json({
            ok: true, project: serialize(p), stats,
            adParams: 'campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}'
        });
    }));

    app.patch('/api/projects/:id', auth, handle(async (req, res) => {
        needReady();
        const p = await owned(req);
        const patch = validateProjectInput(req.body, true, ctx.findTemplate);
        if (patch.turnstileEnabled && !turnstileReady) patch.turnstileEnabled = false;
        const row = await store.updateOwned(p.public_id, req.tgUser.id, patch);
        res.json({ ok: true, project: serialize(row) });
    }));

    app.delete('/api/projects/:id', auth, handle(async (req, res) => {
        needReady();
        const p = await owned(req);
        try { await integ.deleteWebhook(secure.decrypt(p.bot_token_enc)); } catch (e) { /* best effort */ }
        await store.deleteOwned(p.public_id, req.tgUser.id);
        logJson('project_deleted', { project: p.public_id });
        res.json({ ok: true });
    }));

    // Sends a test Subscribe. It goes to the Meta "Test Events" tab ONLY (needs a Test Event Code),
    // so it can never be counted as a real conversion.
    app.post('/api/projects/:id/test-event', auth, handle(async (req, res) => {
        needReady();
        const p = await owned(req);
        if (!p.test_event_code) {
            throw new UserError('Add a Test Event Code first (Edit project). Open Events Manager > Test Events to copy it.', 'testEventCode');
        }
        const eventId = 'test_' + secure.randomToken(6);
        const event = integ.buildSubscribeEvent({
            userId: 'test_' + p.public_id, eventId, eventTime: Math.floor(Date.now() / 1000),
            sourceUrl: pageUrl(p), attribution: {}
        });
        const r = await integ.sendEvents({ pixelId: p.pixel_id, accessToken: secure.decrypt(p.capi_token_enc), events: [event], testEventCode: p.test_event_code });
        await store.logCapi({ projectId: p.id, kind: 'test', eventId, ok: r.ok, httpStatus: r.httpStatus, eventsReceived: r.eventsReceived, fbtraceId: r.fbtraceId, error: r.error });
        logJson('capi', { project: p.public_id, kind: 'test', ok: r.ok, http: r.httpStatus, received: r.eventsReceived, fbtrace: r.fbtraceId, error: r.error || undefined });
        if (!r.ok) throw new UserError('Meta did not accept the test event: ' + (r.error || 'unknown error'), null, 502);
        res.json({ ok: true, eventsReceived: r.eventsReceived, fbtraceId: r.fbtraceId });
    }));

    app.get('/api/projects/:id/html', auth, handle(async (req, res) => {
        needReady();
        const p = await owned(req);
        res.set('Content-Disposition', `attachment; filename="gdx-landing-${p.public_id}.html"`);
        res.type('html').send(renderProjectPage(p, { apiBase: baseUrl, turnstileSiteKey: turnstileReady ? turnstile.siteKey : '' }));
    }));

    return {
        whenIdle: () => Promise.allSettled([...pending]),
        pendingCount: () => pending.size
    };
}

// ---------------- Production entry ----------------

function setup(app, deps) {
    const store = createPgStore(deps.getPool);
    const mainBotId = String(deps.mainBotToken || '').split(':')[0];
    const api = mount(app, {
        store,
        requireTelegramAuth: deps.requireTelegramAuth,
        ensureUser: deps.ensureUser,
        findTemplate: deps.findTemplate,
        isDbReady: deps.isDbReady,
        baseUrl: deps.baseUrl,
        mainBotId
    });

    // Graceful shutdown: stop accepting requests, finish in-flight CAPI sends, close the DB pool.
    let server = null;
    const origListen = app.listen.bind(app);
    app.listen = function () { server = origListen.apply(app, arguments); return server; };
    let closing = false;
    async function shutdown(signal) {
        if (closing) return;
        closing = true;
        logJson('shutdown', { signal });
        const force = setTimeout(() => process.exit(1), 10000);
        force.unref();
        try {
            if (server) await new Promise(r => server.close(r));
            await api.whenIdle();
            const pool = deps.getPool();
            if (pool) await pool.end();
        } catch (e) { /* ignore */ }
        process.exit(0);
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    return {
        async init() {
            const pool = deps.getPool();
            if (!pool) return;
            await initProjectSchema(pool);
            if (!secure.isEncryptionReady()) {
                console.error('WARNING: TOKEN_ENCRYPTION_KEY is missing or invalid. Projects cannot be created until it is set in Railway > Variables.');
            }
        }
    };
}

module.exports = { setup, mount, normalizeAttribution, isBotUa, validateProjectInput, clientIp, createPgStore };
