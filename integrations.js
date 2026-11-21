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

const ATTR_KEYS = ['campaign_id', 'adset_id', 'ad_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

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

function deleteWebhook(botToken) {
    return tgCall(botToken, 'deleteWebhook', { drop_pending_updates: false });
}

// ---------------- Meta Conversions API ----------------

function graphBase() {
    return 'https://graph.facebook.com/' + (process.env.META_API_VERSION || 'v21.0');
}

function scrub(text, token) {
    let s = String(text || '');
    if (token) s = s.split(token).join('[hidden]');
    return s.slice(0, 300);
}

// Read-only check: the Pixel exists and the token can access it. Does NOT send any event.
async function checkPixel(pixelId, accessToken) {
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
    if (res.ok && data && data.id) return { id: String(data.id), name: data.name || '' };

    const err = (data && data.error) || {};
    if (err.code === 190) {
        throw new UserError('This CAPI access token is invalid or expired. Generate a new one in Events Manager.', 'capiToken');
    }
    if (err.code === 100 || err.code === 803 || err.code === 200) {
        throw new UserError('Pixel ID not found, or this token has no access to that Pixel.', 'pixelId');
    }
    throw new UserError('Meta rejected the Pixel or token: ' + scrub(err.message || 'unknown error', accessToken), 'pixelId');
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
        return {
            ok: res.ok && received >= 1,
            httpStatus: res.status,
            eventsReceived: received,
            fbtraceId: (data && (data.fbtrace_id || (data.error && data.error.fbtrace_id))) || '',
            error: res.ok ? '' : scrub((data && data.error && data.error.message) || 'Meta returned an error', accessToken)
        };
    } catch (e) {
        return { ok: false, httpStatus: 0, eventsReceived: 0, fbtraceId: '', error: 'Could not reach Meta' };
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
    if (Object.keys(custom).length) ev.custom_data = custom;
    return ev;
}

module.exports = {
    UserError, ATTR_KEYS, tgCall, verifyBotAndChannel, assertBotReady, createInviteLink,
    setWebhook, deleteWebhook, checkPixel, sendEvents, buildSubscribeEvent
};
