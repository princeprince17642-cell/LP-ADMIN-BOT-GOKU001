'use strict';
// Telegram Bot API + Meta Conversions API helpers.
// IMPORTANT: error messages that leave this file never contain tokens.
const { sha256 } = require('./secure');

class UserError extends Error {
    constructor(message, field, status, code) {
        super(message);
        this.isUserError = true;
        this.field = field || null;
        this.status = status || 400;
        this.code = code || null;
    }
}

const ATTR_KEYS = ['campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

function withTimeout(ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

// ---------------- Telegram ----------------

async function tgCall(token, method, params) {
    const t = withTimeout(12000);
    let res;
    try {
        res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params || {}),
            signal: t.signal
        });
    } catch (e) {
        // never pass the original error on (it may contain the URL with the token)
        throw new Error('Could not reach Telegram. Please try again.');
    } finally {
        t.done();
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!data || !data.ok) {
        const err = new Error((data && data.description) || 'Telegram request failed');
        err.tgCode = data && data.error_code;
        throw err;
    }
    return data.result;
}

// Checks the bot token, the channel and the bot's permissions.
async function verifyBotAndChannel(botToken, channelId) {
    let me;
    try { me = await tgCall(botToken, 'getMe'); } catch (e) {
        throw new UserError('This bot token is not valid. Copy it again from @BotFather.', 'botToken');
    }
    if (!me || !me.is_bot) throw new UserError('This token does not belong to a bot.', 'botToken');

    let chat;
    try { chat = await tgCall(botToken, 'getChat', { chat_id: channelId }); } catch (e) {
        throw new UserError('Channel not found. Add your bot to the channel as an admin and check the Channel ID (it starts with -100).', 'channelId');
    }
    if (chat.type !== 'channel' && chat.type !== 'supergroup') {
        throw new UserError('This ID is not a channel or group. Use the ID of your channel (it starts with -100).', 'channelId');
    }

    let member;
    try { member = await tgCall(botToken, 'getChatMember', { chat_id: channelId, user_id: me.id }); } catch (e) {
        throw new UserError('Could not read the bot permissions in this channel. Make the bot an admin and try again.', 'channelId');
    }
    const isAdmin = member.status === 'administrator' || member.status === 'creator';
    const canInvite = member.status === 'creator' || member.can_invite_users === true;

    return {
        bot: { id: String(me.id), username: me.username || '' },
        chat: { id: String(chat.id), title: chat.title || '', type: chat.type },
        isAdmin,
        canInvite
    };
}

function assertBotReady(v) {
    if (!v.isAdmin) {
        throw new UserError('The bot is not an admin of this channel. Add it as an admin first.', 'channelId');
    }
    if (!v.canInvite) {
        throw new UserError('The bot is an admin but does not have the "Invite users via link" permission. Turn that permission on for the bot.', 'channelId');
    }
}

async function createInviteLink(botToken, chatId, name, expireUnix) {
    const r = await tgCall(botToken, 'createChatInviteLink', {
        chat_id: chatId,
        name,
        expire_date: expireUnix,
        creates_join_request: true
    });
    if (!r || !r.invite_link) throw new Error('No invite link returned');
    return r.invite_link;
}

function setWebhook(botToken, url, secret) {
    return tgCall(botToken, 'setWebhook', {
        url,
        secret_token: secret,
        allowed_updates: ['chat_join_request'],
        max_connections: 20
    });
}

function getWebhookInfo(botToken) {
    return tgCall(botToken, 'getWebhookInfo', {});
}

function deleteWebhook(botToken) {
    return tgCall(botToken, 'deleteWebhook', { drop_pending_updates: false });
}

// ---------------- Meta Conversions API ----------------

function graphBase() {
    return 'https://graph.facebook.com/' + (process.env.META_API_VERSION || 'v25.0');
}

function scrub(text, token) {
    let s = String(text || '');
    if (token) s = s.split(token).join('[hidden]');
    return s.slice(0, 300);
}

// Reads the Graph error object into plain fields (never includes the token).
function parseGraphError(data, token) {
    const e = (data && data.error) || {};
    return {
        code: Number(e.code) || 0,
        subcode: Number(e.error_subcode) || 0,
        type: String(e.type || ''),
        message: scrub(e.message || 'unknown error', token),
        fbtraceId: e.fbtrace_id || ''
    };
}

const TOKEN_ERR = 'This CAPI access token is invalid or expired. Generate a new one in Events Manager > your Pixel > Settings > Conversions API > Generate access token.';

// Validates a Pixel ID + CAPI token WITHOUT sending a real conversion.
//
// WHY the old check failed for valid credentials: it did GET /{pixel}?fields=id,name. A CAPI token generated in
// Events Manager is allowed to POST events but is often NOT allowed to read the Pixel object, and Meta then answers
// with code 100 ("...does not exist, cannot be loaded due to missing permissions"). The old code turned EVERY
// code 100/200/803 into "Pixel ID not found or token has no access", so a perfectly valid pair was rejected.
//
// Now: 1) try to read the Pixel (proves id + access).  2) If Meta says "cannot read" (ambiguous), prove WRITE access
// with a Test-Events-only probe when a Test Event Code is given.  3) Otherwise accept but report verified:false.
// Definite problems (bad token, malformed id, rate limit, network, Meta errors) are still rejected with their real reason.
async function checkPixel(pixelId, accessToken, opts) {
    opts = opts || {};
    pixelId = String(pixelId || '').trim();
    if (!/^\d{8,20}$/.test(pixelId)) {
        throw new UserError('Pixel ID must be 8 to 20 digits (copy it from Meta Events Manager).', 'pixelId');
    }
    if (!accessToken) throw new UserError('CAPI access token is missing.', 'capiToken');

    const t = withTimeout(12000);
    let res, data = null;
    try {
        res = await fetch(`${graphBase()}/${pixelId}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`, { signal: t.signal });
        try { data = await res.json(); } catch (e) { /* ignore */ }
    } catch (e) {
        throw new UserError('Could not reach Meta to check your Pixel. Please try again.', 'pixelId', 502);
    } finally {
        t.done();
    }

    if (res.ok && data && data.id) {
        if (String(data.id) !== pixelId) throw new UserError('Meta returned a different Pixel than the one you entered.', 'pixelId');
        return { id: String(data.id), name: data.name || '', verified: true, method: 'read', warning: '' };
    }

    const err = parseGraphError(data, accessToken);
    if (err.code === 190) throw new UserError(TOKEN_ERR, 'capiToken');
    if ([4, 17, 32, 613].includes(err.code)) {
        throw new UserError('Meta is rate-limiting requests right now. Wait a minute and try again.', 'pixelId', 429);
    }
    if (res.status >= 500) throw new UserError('Meta is having a problem right now. Please try again in a few minutes.', 'pixelId', 502);

    // Ambiguous on purpose: Meta uses these for BOTH "does not exist" and "token cannot read it".
    const ambiguous = [100, 200, 10, 803, 294].includes(err.code);
    if (!ambiguous) throw new UserError('Meta rejected the Pixel or token: ' + err.message, 'pixelId');

    if (opts.testEventCode) {
        const probe = await sendEvents({
            pixelId, accessToken, testEventCode: opts.testEventCode,
            events: [buildSubscribeEvent({ userId: 'validate_' + Date.now(), eventId: 'validate_' + Date.now(), eventTime: Math.floor(Date.now() / 1000), attribution: {} })]
        });
        if (probe.ok) return { id: pixelId, name: '', verified: true, method: 'test_event', warning: '' };
        if (probe.errorCode === 190) throw new UserError(TOKEN_ERR, 'capiToken');
        if ([100, 200, 10, 803, 294].includes(probe.errorCode)) {
            throw new UserError('Meta would not accept events for this Pixel ID with this token. Check that the Pixel ID is correct and that the token was generated for THIS Pixel.', 'pixelId');
        }
        throw new UserError('Meta did not accept the validation event: ' + (probe.error || 'unknown error'), 'pixelId');
    }

    return {
        id: pixelId, name: '', verified: false, method: 'none',
        warning: 'Pixel saved, but it could not be verified: this token cannot read Pixel details (normal for tokens generated in Events Manager). ' +
                 'Add a Test Event Code and tap SEND TEST EVENT to confirm events reach this Pixel.'
    };
}

// Sends events to Meta. Returns a plain result object; never throws.
async function sendEvents({ pixelId, accessToken, events, testEventCode }) {
    const body = { data: events };
    if (testEventCode) body.test_event_code = testEventCode;
    const t = withTimeout(15000);
    try {
        const res = await fetch(`${graphBase()}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: t.signal
        });
        let data = null;
        try { data = await res.json(); } catch (e) { /* ignore */ }
        const received = data && typeof data.events_received === 'number' ? data.events_received : 0;
        const ge = parseGraphError(data, accessToken);
        return {
            ok: res.ok && received >= 1,
            httpStatus: res.status,
            errorCode: ge.code,
            errorSubcode: ge.subcode,
            eventsReceived: received,
            fbtraceId: (data && (data.fbtrace_id || (data.error && data.error.fbtrace_id))) || '',
            error: res.ok ? (received >= 1 ? '' : 'Meta accepted the request but reported 0 events received') : ge.message === 'unknown error' ? 'Meta returned an error' : ge.message
        };
    } catch (e) {
        return { ok: false, httpStatus: 0, errorCode: 0, errorSubcode: 0, eventsReceived: 0, fbtraceId: '', error: 'Could not reach Meta' };
    } finally {
        t.done();
    }
}

// One Subscribe event for a genuine Join Request.
function buildSubscribeEvent(o) {
    const userData = { external_id: [sha256(o.userId)] };
    if (o.fbc) userData.fbc = o.fbc;
    if (o.fbp) userData.fbp = o.fbp;
    if (o.ip) userData.client_ip_address = o.ip;
    if (o.userAgent) userData.client_user_agent = o.userAgent;

    const ev = {
        event_name: 'Subscribe',
        event_time: o.eventTime,
        event_id: o.eventId,
        action_source: 'system_generated',
        user_data: userData
    };
    if (o.sourceUrl) ev.event_source_url = o.sourceUrl;

    const custom = {};
    ATTR_KEYS.forEach(k => { if (o.attribution && o.attribution[k]) custom[k] = o.attribution[k]; });
    if (o.attribution && o.attribution.fbclid) custom.fbclid = o.attribution.fbclid;
    if (o.landingPageId) custom.landing_page_id = o.landingPageId;
    if (o.landingPageUrl) custom.landing_page_url = o.landingPageUrl;
    if (Object.keys(custom).length) ev.custom_data = custom;
    return ev;
}

module.exports = {
    UserError, ATTR_KEYS, tgCall, verifyBotAndChannel, assertBotReady, createInviteLink,
    setWebhook, deleteWebhook, getWebhookInfo, checkPixel, sendEvents, buildSubscribeEvent
};
