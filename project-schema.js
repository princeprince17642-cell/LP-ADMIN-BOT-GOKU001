'use strict';
// Database tables for the "Landing Page + Tracking Generator" (multi-tenant).
// Every project belongs to ONE owner (owner_telegram_id). All owner queries filter by it.
// Tokens are stored ENCRYPTED (columns ending in _enc). They are never logged or returned.
// Safe to run many times (CREATE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS).

async function initProjectSchema(pool) {

    await pool.query(`
        CREATE TABLE IF NOT EXISTS projects (
            id                  BIGSERIAL PRIMARY KEY,
            public_id           TEXT NOT NULL UNIQUE,
            owner_telegram_id   BIGINT NOT NULL REFERENCES users(telegram_id),
            status              TEXT NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'active', 'paused')),
            template_key        TEXT NOT NULL,
            theme               JSONB NOT NULL DEFAULT '{}'::jsonb,
            channel_name        TEXT NOT NULL,
            headline            TEXT NOT NULL,
            button_text         TEXT NOT NULL DEFAULT 'JOIN NOW',
            image_url           TEXT NOT NULL DEFAULT '',
            pixel_id            TEXT NOT NULL,
            capi_token_enc      TEXT NOT NULL,
            test_event_code     TEXT NOT NULL DEFAULT '',
            bot_token_enc       TEXT NOT NULL,
            bot_id              BIGINT NOT NULL,
            bot_username        TEXT NOT NULL DEFAULT '',
            channel_id          BIGINT NOT NULL,
            channel_title       TEXT NOT NULL DEFAULT '',
            webhook_secret_hash TEXT NOT NULL,
            webhook_set_at      TIMESTAMPTZ,
            require_fbclid      BOOLEAN NOT NULL DEFAULT TRUE,
            turnstile_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
            validated_at        TIMESTAMPTZ,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS content JSONB NOT NULL DEFAULT '{}'::jsonb`);
    // One bot = one project (a Telegram bot can have only one webhook)
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_bot ON projects (bot_id)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_owner_channel ON projects (owner_telegram_id, channel_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner_telegram_id)`);

    // A visitor = one browser session. Attribution is saved at the FIRST visit and never overwritten.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS visitors (
            id          BIGSERIAL PRIMARY KEY,
            project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            session_id  TEXT NOT NULL,
            fbc         TEXT NOT NULL DEFAULT '',
            fbp         TEXT NOT NULL DEFAULT '',
            fbclid      TEXT NOT NULL DEFAULT '',
            source_url  TEXT NOT NULL DEFAULT '',
            ip          TEXT NOT NULL DEFAULT '',
            user_agent  TEXT NOT NULL DEFAULT '',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (project_id, session_id)
        )
    `);
    const visitorCols = [
        `referrer TEXT NOT NULL DEFAULT ''`,
        `campaign_id TEXT NOT NULL DEFAULT ''`,
        `adset_id TEXT NOT NULL DEFAULT ''`,
        `ad_id TEXT NOT NULL DEFAULT ''`,
        `utm_source TEXT NOT NULL DEFAULT ''`,
        `utm_medium TEXT NOT NULL DEFAULT ''`,
        `utm_campaign TEXT NOT NULL DEFAULT ''`,
        `utm_content TEXT NOT NULL DEFAULT ''`,
        `utm_term TEXT NOT NULL DEFAULT ''`,
        `last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
    ];
    for (const col of visitorCols) {
        await pool.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS ${col}`);
    }
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_visitors_ip ON visitors (project_id, ip, created_at DESC)`);

    // One unique invite link per visitor session (creates_join_request = true), short expiry
    await pool.query(`
        CREATE TABLE IF NOT EXISTS invite_links (
            id          BIGSERIAL PRIMARY KEY,
            project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            visitor_id  BIGINT NOT NULL UNIQUE REFERENCES visitors(id) ON DELETE CASCADE,
            link        TEXT NOT NULL,
            link_hash   TEXT NOT NULL,
            expires_at  TIMESTAMPTZ NOT NULL,
            used_at     TIMESTAMPTZ,
            revoked_at  TIMESTAMPTZ,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (project_id, link_hash)
        )
    `);

    // One row per (project, channel, user): this prevents duplicate Subscribe events
    await pool.query(`
        CREATE TABLE IF NOT EXISTS join_events (
            id                   BIGSERIAL PRIMARY KEY,
            project_id           BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            telegram_user_id     BIGINT NOT NULL,
            chat_id              BIGINT NOT NULL,
            invite_link_id       BIGINT REFERENCES invite_links(id) ON DELETE SET NULL,
            visitor_id           BIGINT REFERENCES visitors(id) ON DELETE SET NULL,
            event_id             TEXT NOT NULL,
            status               TEXT NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
            attempts             INTEGER NOT NULL DEFAULT 0,
            capi_http_status     INTEGER,
            capi_events_received INTEGER,
            capi_fbtrace_id      TEXT,
            capi_error           TEXT,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            sent_at              TIMESTAMPTZ,
            UNIQUE (project_id, chat_id, telegram_user_id)
        )
    `);
    // Snapshot of the campaign attribution at the moment of the join (survives visitor deletion)
    await pool.query(`ALTER TABLE join_events ADD COLUMN IF NOT EXISTS attribution JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await pool.query(`ALTER TABLE join_events ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE join_events ADD COLUMN IF NOT EXISTS visitor_session TEXT NOT NULL DEFAULT ''`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_join_events_project ON join_events (project_id, created_at DESC)`);

    // Structured log of EVERY Meta CAPI call. No tokens are ever stored here.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS capi_log (
            id              BIGSERIAL PRIMARY KEY,
            project_id      BIGINT REFERENCES projects(id) ON DELETE CASCADE,
            kind            TEXT NOT NULL CHECK (kind IN ('join', 'test', 'validate')),
            event_id        TEXT NOT NULL DEFAULT '',
            ok              BOOLEAN NOT NULL,
            http_status     INTEGER,
            events_received INTEGER,
            fbtrace_id      TEXT NOT NULL DEFAULT '',
            error_message   TEXT NOT NULL DEFAULT '',
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_capi_log_project ON capi_log (project_id, created_at DESC)`);

    // Dashboard counters (one row per project per day, UTC)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS project_stats_daily (
            project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            day           DATE NOT NULL,
            page_views    INTEGER NOT NULL DEFAULT 0,
            join_clicks   INTEGER NOT NULL DEFAULT 0,
            link_requests INTEGER NOT NULL DEFAULT 0,
            links_issued  INTEGER NOT NULL DEFAULT 0,
            join_requests INTEGER NOT NULL DEFAULT 0,
            capi_success  INTEGER NOT NULL DEFAULT 0,
            capi_failed   INTEGER NOT NULL DEFAULT 0,
            blocked       INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (project_id, day)
        )
    `);
    // Join requests that did NOT come through our unique links (never sent to Meta)
    await pool.query(`ALTER TABLE project_stats_daily ADD COLUMN IF NOT EXISTS unattributed_join_requests INTEGER NOT NULL DEFAULT 0`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS blocked_daily (
            project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            day         DATE NOT NULL,
            reason      TEXT NOT NULL,
            count       INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (project_id, day, reason)
        )
    `);

    console.log('Project schema ready: projects, visitors, invite_links, join_events, capi_log, stats tables OK');
}

module.exports = { initProjectSchema };
