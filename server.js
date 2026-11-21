const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { LANDING_TEMPLATES, findTemplate, renderLandingTemplate } = require('./landing-templates');
const projectsModule = require('./projects');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');

// Secrets are read from Railway Variables (never hardcode them)
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || '').trim();
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN) {
    console.error("ERROR: BOT_TOKEN environment variable is missing. Add it in Railway > Variables.");
    process.exit(1);
}

const RAILWAY_DOMAIN = "lp-admin-bot-goku001-production-22d1.up.railway.app";

// ---------- Database (PostgreSQL) ----------

let pool = null;
let dbReady = false;

if (DATABASE_URL) {
    const useSsl = !DATABASE_URL.includes('railway.internal') && !DATABASE_URL.includes('localhost');
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: useSsl ? { rejectUnauthorized: false } : false
    });
    pool.on('error', (err) => console.error('Database pool error:', err.message));
} else {
    console.error("WARNING: DATABASE_URL is missing. Wallet features are disabled. Add it in Railway > Variables.");
}

async function initDatabase() {
    if (!pool) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                telegram_id BIGINT PRIMARY KEY,
                first_name  TEXT NOT NULL DEFAULT '',
                last_name   TEXT NOT NULL DEFAULT '',
                username    TEXT NOT NULL DEFAULT '',
                balance     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
                total_bonus NUMERIC(12,2) NOT NULL DEFAULT 0,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS deposits (
                id          BIGSERIAL PRIMARY KEY,
                telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
                amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
                status      TEXT NOT NULL DEFAULT 'pending',
                reference   TEXT,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id            BIGSERIAL PRIMARY KEY,
                telegram_id   BIGINT NOT NULL REFERENCES users(telegram_id),
                type          TEXT NOT NULL,
                amount        NUMERIC(12,2) NOT NULL,
                status        TEXT NOT NULL DEFAULT 'completed',
                balance_after NUMERIC(12,2),
                note          TEXT NOT NULL DEFAULT '',
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // status: pending / processing / completed / failed / cancelled / refunded
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id           BIGSERIAL PRIMARY KEY,
                telegram_id  BIGINT NOT NULL REFERENCES users(telegram_id),
                service_name TEXT NOT NULL DEFAULT '',
                amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
                status       TEXT NOT NULL DEFAULT 'pending',
                refunded_at  TIMESTAMPTZ,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // New columns for the Orders section (safe to run many times)
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT ''`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
        await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS order_id BIGINT`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS gift_codes (
                id         BIGSERIAL PRIMARY KEY,
                code       TEXT NOT NULL UNIQUE,
                amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
                max_uses   INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
                used_count INTEGER NOT NULL DEFAULT 0,
                is_active  BOOLEAN NOT NULL DEFAULT TRUE,
                expires_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS gift_code_redemptions (
                id           BIGSERIAL PRIMARY KEY,
                gift_code_id BIGINT NOT NULL REFERENCES gift_codes(id),
                telegram_id  BIGINT NOT NULL REFERENCES users(telegram_id),
                amount       NUMERIC(12,2) NOT NULL,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (gift_code_id, telegram_id)
            )
        `);

        // The landing page design each user has selected (one row per user)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS landing_selections (
                telegram_id  BIGINT PRIMARY KEY REFERENCES users(telegram_id),
                template_key TEXT NOT NULL,
                updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await pool.query(`CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits (telegram_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (telegram_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (telegram_id, created_at DESC)`);

        dbReady = true;
        console.log("Database ready: all tables OK");
    } catch (e) {
        console.error("Database init failed:", e.message);
    }
}

// Creates the user on first visit, or refreshes their Telegram name/username.
// "db" can be the pool or a client that is inside a transaction.
async function ensureUser(db, tgUser) {
    const result = await db.query(
        `INSERT INTO users (telegram_id, first_name, last_name, username)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (telegram_id) DO UPDATE
           SET first_name = EXCLUDED.first_name,
               last_name  = EXCLUDED.last_name,
               username   = EXCLUDED.username,
               updated_at = NOW()
         RETURNING telegram_id, balance, total_bonus`,
        [tgUser.id, tgUser.first_name || '', tgUser.last_name || '', tgUser.username || '']
    );
    return result.rows[0];
}

const getClients = () => {
    if (!fs.existsSync(CLIENTS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
};

const saveClients = (clients) => {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
};

// ---------- Telegram authentication ----------

// Validates Telegram Web App initData using the bot token (HMAC-SHA256).
// Returns the Telegram user object if valid, otherwise null.
function validateInitData(initData) {
    if (!initData || typeof initData !== 'string') return null;

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = Array.from(params.entries())
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const a = Buffer.from(calculated, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    // Reject very old sessions (24 hours)
    const authDate = Number(params.get('auth_date'));
    if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

    try {
        const user = JSON.parse(params.get('user'));
        return user && user.id ? user : null;
    } catch (e) {
        return null;
    }
}

// Middleware: only requests with valid Telegram initData are allowed
function requireTelegramAuth(req, res, next) {
    const user = validateInitData(req.get('X-Telegram-Init-Data') || '');
    if (!user) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    req.tgUser = user;
    next();
}

// Middleware: only the admin (ADMIN_TELEGRAM_ID) is allowed
function requireAdmin(req, res, next) {
    if (!ADMIN_TELEGRAM_ID || String(req.tgUser.id) !== ADMIN_TELEGRAM_ID) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    next();
}

// ---------- Helpers ----------

const CODE_PATTERN = /^[A-Z0-9_-]{3,40}$/;

function normalizeCode(value) {
    const code = String(value || '').trim().toUpperCase();
    return CODE_PATTERN.test(code) ? code : '';
}

// Simple in-memory limiter: max 8 gift code attempts per user per minute.
const claimAttempts = new Map();
function isClaimRateLimited(userId) {
    const now = Date.now();
    const recent = (claimAttempts.get(userId) || []).filter(t => now - t < 60000);
    if (recent.length >= 8) {
        claimAttempts.set(userId, recent);
        return true;
    }
    recent.push(now);
    claimAttempts.set(userId, recent);
    return false;
}

function orderCode(id) {
    return 'GDX-' + String(id).padStart(6, '0');
}

function parseId(value) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Creates an order and charges the wallet in ONE database transaction.
// Use this from the services marketplace when a user buys something (later phase).
// New orders always start as "pending". Returns { status, orderId, balance } or { status, error }.
async function createOrder(tgUser, serviceName, amount, note) {
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        await ensureUser(db, tgUser);

        const bal = await db.query(
            `SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE`,
            [tgUser.id]
        );
        if (Number(bal.rows[0].balance) < amount) {
            await db.query('ROLLBACK');
            return { status: 402, error: 'Insufficient wallet balance for this order.' };
        }

        const updated = await db.query(
            `UPDATE users SET balance = balance - $1, updated_at = NOW()
             WHERE telegram_id = $2 RETURNING balance`,
            [amount, tgUser.id]
        );
        const newBalance = updated.rows[0].balance;

        const ord = await db.query(
            `INSERT INTO orders (telegram_id, service_name, amount, status, note)
             VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
            [tgUser.id, serviceName, amount, note || '']
        );
        const orderId = ord.rows[0].id;

        await db.query(
            `INSERT INTO transactions (telegram_id, type, amount, status, balance_after, note, order_id)
             VALUES ($1, 'purchase', $2, 'completed', $3, $4, $5)`,
            [tgUser.id, amount, newBalance, `Order ${orderCode(orderId)}: ${serviceName}`, orderId]
        );

        await db.query('COMMIT');
        return { status: 200, orderId: String(orderId), balance: Number(newBalance) };
    } catch (err) {
        try { await db.query('ROLLBACK'); } catch (e) { /* ignore */ }
        console.error('Create order error:', err.message);
        return { status: 500, error: 'Could not create the order.' };
    } finally {
        db.release();
    }
}

// Refunds ONE failed order back to the wallet. Safe against double refunds:
// the order row is locked, and only a "failed" order that was never refunded can pass.
async function refundOrder(orderId) {
    const db = await pool.connect();
    try {
        await db.query('BEGIN');

        const found = await db.query(
            `SELECT id, telegram_id, amount, status, refunded_at
             FROM orders WHERE id = $1 FOR UPDATE`,
            [orderId]
        );
        if (!found.rows.length) {
            await db.query('ROLLBACK');
            return { status: 404, error: 'Order not found.' };
        }

        const order = found.rows[0];
        if (order.refunded_at || order.status === 'refunded') {
            await db.query('ROLLBACK');
            return { status: 409, error: 'This order has already been refunded.' };
        }
        if (order.status !== 'failed') {
            await db.query('ROLLBACK');
            return { status: 400, error: 'Only failed orders can be refunded.' };
        }
        if (Number(order.amount) <= 0) {
            await db.query('ROLLBACK');
            return { status: 400, error: 'Nothing to refund for this order.' };
        }

        const updated = await db.query(
            `UPDATE users SET balance = balance + $1, updated_at = NOW()
             WHERE telegram_id = $2 RETURNING balance`,
            [order.amount, order.telegram_id]
        );
        const newBalance = updated.rows[0].balance;

        await db.query(
            `UPDATE orders SET status = 'refunded', refunded_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [order.id]
        );
        await db.query(
            `INSERT INTO transactions (telegram_id, type, amount, status, balance_after, note, order_id)
             VALUES ($1, 'refund', $2, 'completed', $3, $4, $5)`,
            [order.telegram_id, order.amount, newBalance, `Refund for order ${orderCode(order.id)}`, order.id]
        );

        await db.query('COMMIT');
        return { status: 200, refunded: Number(order.amount), balance: Number(newBalance) };
    } catch (err) {
        try { await db.query('ROLLBACK'); } catch (e) { /* ignore */ }
        console.error('Refund error:', err.message);
        return { status: 500, error: 'Refund failed. Please try again.' };
    } finally {
        db.release();
    }
}

// Wildcard Subdomain Handler
app.use((req, res, next) => {
    const host = req.headers.host || '';
    const parts = host.split('.');

    if (parts.length > 2 && !host.includes('railway.app') && !host.includes('localhost')) {
        const slug = parts[0];
        const clients = getClients();
        const client = clients.find(c => c.slug === slug);

        if (client && req.path === '/') {
            return res.send(getLandingPageHTML(client));
        }
    }
    next();
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Official GDX logo (file "logo.png" in the repository root)
app.get('/logo.png', (req, res) => {
    const file = path.join(__dirname, 'logo.png');
    if (!fs.existsSync(file)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(file);
});

// ---------- Landing page designs ----------

// Public: list of the four designs (name + tagline only)
app.get('/api/landing/templates', (req, res) => {
    res.json({ ok: true, templates: LANDING_TEMPLATES });
});

// Public: full, responsive demo page of one design (used for previews inside iframes)
app.get('/preview/landing/:key', (req, res) => {
    const html = renderLandingTemplate(req.params.key);
    if (!html) return res.status(404).send('Design not found');
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html);
});

// The design the logged-in user has selected (null if none yet)
app.get('/api/landing/selection', requireTelegramAuth, async (req, res) => {
    if (!pool || !dbReady) {
        return res.status(503).json({ ok: false, error: 'Temporarily unavailable' });
    }
    try {
        const r = await pool.query(
            `SELECT template_key FROM landing_selections WHERE telegram_id = $1`,
            [req.tgUser.id]
        );
        const key = r.rows.length ? r.rows[0].template_key : null;
        res.json({ ok: true, selected: key && findTemplate(key) ? key : null });
    } catch (err) {
        console.error('Selection error:', err.message);
        res.status(500).json({ ok: false, error: 'Could not load your selected design' });
    }
});

// Save (or change) the selected design
app.post('/api/landing/select', requireTelegramAuth, async (req, res) => {
    if (!pool || !dbReady) {
        return res.status(503).json({ ok: false, error: 'Temporarily unavailable' });
    }
    const key = String((req.body && req.body.template) || '');
    if (!findTemplate(key)) {
        return res.status(400).json({ ok: false, error: 'Unknown design.' });
    }
    try {
        await ensureUser(pool, req.tgUser);
        await pool.query(
            `INSERT INTO landing_selections (telegram_id, template_key)
             VALUES ($1, $2)
             ON CONFLICT (telegram_id) DO UPDATE
               SET template_key = EXCLUDED.template_key, updated_at = NOW()`,
            [req.tgUser.id, key]
        );
        res.json({ ok: true, selected: key });
    } catch (err) {
        console.error('Select design error:', err.message);
        res.status(500).json({ ok: false, error: 'Could not save your design. Please try again.' });
    }
});

// ---------- Profile, wallet, stats ----------

// Logged-in user's Telegram profile (verified on the backend)
app.get('/api/me', requireTelegramAuth, (req, res) => {
    const u = req.tgUser;
    res.json({
        ok: true,
        user: {
            id: u.id,
            firstName: u.first_name || '',
            lastName: u.last_name || '',
            username: u.username || '',
            photoUrl: u.photo_url || '',
            isAdmin: !!ADMIN_TELEGRAM_ID && String(u.id) === ADMIN_TELEGRAM_ID
        }
    });
});

// Public app settings (support link is configurable from Railway Variables).
app.get('/api/config', requireTelegramAuth, (req, res) => {
    const raw = String(process.env.SUPPORT_URL || '').trim();
    const supportUrl = /^https:\/\/\S+$/i.test(raw) ? raw : '';
    res.json({ ok: true, supportUrl });
});

// Logged-in user's wallet. Balance and record counts always come from the database.
app.get('/api/wallet', requireTelegramAuth, async (req, res) => {
    if (!pool || !dbReady) {
        return res.status(503).json({ ok: false, error: 'Wallet is temporarily unavailable' });
    }
    try {
        const row = await ensureUser(pool, req.tgUser);
        const counts = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM deposits     WHERE telegram_id = $1) AS deposit_count,
                (SELECT COUNT(*) FROM transactions WHERE telegram_id = $1) AS transaction_count`,
            [req.tgUser.id]
        );
        res.json({
            ok: true,
            wallet: {
                balance: Number(row.balance),
                totalBonus: Number(row.total_bonus),
                currency: 'INR',
                depositCount: Number(counts.rows[0].deposit_count),
                transactionCount: Number(counts.rows[0].transaction_count)
            }
        });
    } catch (err) {
        console.error('Wallet error:', err.message);
        res.status(500).json({ ok: false, error: 'Could not load wallet' });
    }
});

// User statistics. Orders counted = processing + completed (no double counting).
app.get('/api/stats', requireTelegramAuth, async (req, res) => {
    if (!pool || !dbReady) {
        return res.status(503).json({ ok: false, error: 'Statistics are temporarily unavailable' });
    }
    try {
        const user = await ensureUser(pool, req.tgUser);
        const result = await pool.query(
            `SELECT
                (SELECT COALESCE(SUM(amount), 0) FROM deposits
                    WHERE telegram_id = $1 AND status = 'completed') AS total_deposit,
                (SELECT COUNT(*) FROM orders
                    WHERE telegram_id = $1 AND status IN ('processing', 'completed')) AS total_orders,
                (SELECT COALESCE(SUM(amount), 0) FROM orders
                    WHERE telegram_id = $1 AND status IN ('processing', 'completed')) AS total_spent`,
            [req.tgUser.id]
        );
        const r = result.rows[0];
        res.json({
            ok: true,
            stats: {
                username: req.tgUser.username || '',
                balance: Number(user.balance),
                totalBonus: Number(user.total_bonus),
                totalOrders: Number(r.total_orders),
                totalDeposit: Number(r.total_deposit),
                totalSpent: Number(r.total_spent)
            }
        });
    } catch (err) {
        console.error('Stats error:', err.message);
        res.status(500).json({ ok: false, error: 'Could not load statistics' });
    }
});

// Logged-in user's deposit history (latest 100) with counts per status.
app.get('/api/deposits', requireTelegramAuth, async (req, res) => {
    if (!pool || !dbReady) {
        return res.status(503).json({ ok: false, error: 'Deposits are temporarily unavailable' });
    }
    try {
        const uid = req.tgUser.id;
        const list = await pool.query(
            `SELECT id, amount, status, reference, created_at
             FROM deposits WHERE telegram_id = $1
             ORDER BY created_at DESC, id DESC LIMIT 100`,
            [uid]
        );
        const countRows = await pool.query(
            `SELECT status, COUNT(*) AS c FROM deposits WHERE telegram_id = $1 GROUP BY status`,
            [uid]
        );
        const counts = { completed: 0, failed: 0, pending: 0 };
        countRows.rows.forEach(r => {
            if (counts.hasOwnProperty(r.status)) counts[r.status] = Number(r.c);
        });
        res.json({
            ok: true,
            counts,
            deposits: list.rows.map(r => ({
                id: String(r.id),
                amount: Number(r.amount),
                status: r.status,
                reference: r.reference || '',
                createdAt: r.created_at
            }))
        });
    } catch (err) {
        console.error('Deposits error:', err.message);
        res.status(500).json({ ok: false, error: 'Could not load deposits' });
    }
});

// Logged-in user's transaction history (latest 100).
const CREDIT_TYPES = ['deposit', 'gift_code', 'refund', 'bonus'];

app.get('/api/transactions', requireTelegramAuth, async (req, res) => {
    if (!pool || !dbReady) {
        return res.status(503).json({ ok: false, error: 'Transactions are temporarily unavailable' });
    }
    try {
        const list = await pool.query(
            `SELECT id, type, amount, status, balance_after, note, created_at
             FROM transactions WHERE telegram_id = $1
             ORDER BY created_at DESC, id DESC LIMIT 100`,
            [req.tgUser.id]
        );
        res.json({
            ok: true,
            transactions: list.rows.map(r => ({
                id: String(r.id),
                type: r.type,
                direction: CREDIT_TYPES.includes(r.type) ? 'credit' : 'debit',
                amount: Number(r.amount),
                status: r.status,
                balanceAfter: r.balance_after === null ? null : Number(r.balance_after),
                note: r.note || '',
                createdAt: r.created_at
            }))
        });
    } catch (err) {
        console.error('Transactions error:', err.message);
        res.status(500).json({ ok: false, error: 'Could not load transactions' });
    }
});

// ---------- Orders ----------

function formatOrder(r) {
    return {
        id: String(r.id),
        orderCode: orderCode(r.id),
        serviceName: r.service_name,
        amount: Number(r.amount),
        status: r.status,
        note: r.note || '',
        refundedAt: r.refunded_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at
    };
}

// All orders of the logged-in user (newest first). New orders appear here automatically.
app.get('/api/orders', requireTelegramAuth, async (req, res) => {
    if (!pool || !dbReady) {
        return res.status(503).json({ ok: false, error: 'Orders are temporarily unavailable' });
    }
    try {
        const list = await pool.query(
            `SELECT id, service_name, amount, status, note, refunded_at, created_at, updated_at
             FROM orders WHERE telegram_id = $1
             ORDER BY created_at DESC, id DESC LIMIT 300`,
            [req.tgUser.id]
        );
        res.json({ ok: true, orders: list.rows.map(formatOrder) });
    } catch (err) {
        console.error('Orders error:', err.message);
        res.status(500).json({ ok: false, error: 'Could not load your orders' });
    }
});

// Details of ONE order. A user can only open their own orders.
app.get('/api/orders/:id', requireTelegramAuth, async (req, res) => {
    if (!pool || !dbReady) {
        return res.status(503).json({ ok: false, error: 'Orders are temporarily unavailable' });
    }
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid order id.' });
    try {
        const found = await pool.query(
            `SELECT id, service_name, amount, status, note, refunded_at, created_at, updated_at
             FROM orders WHERE id = $1 AND telegram_id = $2`,
            [id, req.tgUser.id]
        );
        if (!found.rows.length) return res.status(404).json({ ok: false, error: 'Order not found.' });

        const tx = await pool.query(
            `SELECT id, type, amount, status, created_at
             FROM transactions WHERE telegram_id = $1 AND order_id = $2
             ORDER BY created_at, id`,
            [req.tgUser.id, id]
        );
        res.json({
            ok: true,
            order: formatOrder(found.rows[0]),
            transactions: tx.rows.map(t => ({
                id: String(t.id),
                type: t.type,
                direction: CREDIT_TYPES.includes(t.type) ? 'credit' : 'debit',
                amount: Number(t.amount),
                status: t.status,
                createdAt: t.created_at
            }))
        });
    } catch (err) {
        console.error('Order details error:', err.message);
        res.status(500).json({ ok: false, error: 'Could not load this order' });
    }
});

// Admin only: create a test order on the admin's own account (charged from the admin's wallet).
app.post('/api/admin/orders', requireTelegramAuth, requireAdmin, async (req, res) => {
    if (!pool || !dbReady) {
        return res.status(503).json({ ok: false, error: 'Database is not ready' });
    }
    const body = req.body || {};
    const serviceName = String(body.serviceName || '').trim().slice(0, 80);
    const amount = Math.round(Number(body.amount) * 100) / 100;

    if (serviceName.length < 2) {
        return res.status(400).json({ ok: false, error: 'Service name must be at least 2 characters.' });
    }
    if (!isFinite(amount) || amount <= 0 || amount > 100000) {
        return res.status(400).json({ ok: false, error: 'Amount must be between 0.01 and 100000.' });
    }

    const result = await createOrder(req.tgUser, serviceName, amount, 'Test order created by admin');
    if (result.error) return res.status(result.status).json({ ok: false, error: result.error });
    res.json({ ok: true, orderId: result.orderId, orderCode: orderCode(result.orderId), balance: result.balance });
});

// Allowed status changes. Completed, failed, cancelled and refunded are final.
const ORDER_TRANSITIONS = {
    pending:    ['processing', 'completed', 'failed', 'cancelled'],
    processing: ['completed', 'failed', 'cancelled']
};

// Admin only: change the status of an order.
app.post('/api/admin/orders/:id/status', requireTelegramAuth, requireAdmin, async (req, res) => {
    if (!pool || !dbReady) {
        return res.status(503).json({ ok: false, error: 'Database is not ready' });
    }
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid order id.' });

    const status = String((req.body && req.body.status) || '');
    const allowedFrom = Object.keys(ORDER_TRANSITIONS).filter(s => ORDER_TRANSITIONS[s].includes(status));
    if (!allowedFrom.length) return res.status(400).json({ ok: false, error: 'Invalid status.' });

    try {
        const r = await pool.query(
            `UPDATE orders SET status = $1, updated_at = NOW()
             WHERE id = $2 AND status = ANY($3::text[]) RETURNING id`,
            [status, id, allowedFrom]
        );
        if (!r.rows.length) {
            return res.status(409).json({ ok: false, error: 'Order not found, or its status can no longer be changed.' });
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('Order status error:', err.message);
        res.status(500).json({ ok: false, error: 'Could not update the order.' });
    }
});

// Admin only: refund a failed order to the user's wallet (never twice).
app.post('/api/admin/orders/:id/refund', requireTelegramAuth, requireAdmin, async (req, res) => {
    if (!pool || !dbReady) {
        return res.status(503).json({ ok: false, error: 'Database is not ready' });
    }
    const orderId = parseId(req.params.id);
    if (!orderId) return res.status(400).json({ ok: false, error: 'Invalid order id.' });

    const result = await refundOrder(orderId);
    if (result.error) return res.status(result.status).json({ ok: false, error: result.error });
    res.json({ ok: true, refunded: result.refunded, balance: result.balance });
});

// ---------- Gift codes ----------

// Gift code claim. Everything happens inside ONE database transaction.
app.post('/api/gift-code/claim', requireTelegramAuth, async (req, res) => {
    if (!pool || !dbReady) {
        return res.status(503).json({ ok: false, error: 'Gift codes are temporarily unavailable' });
    }

    const uid = req.tgUser.id;
    if (isClaimRateLimited(uid)) {
        return res.status(429).json({ ok: false, error: 'Too many attempts. Please wait a minute and try again.' });
    }

    const code = normalizeCode(req.body && req.body.code);
    if (!code) {
        return res.status(400).json({ ok: false, error: 'Please enter a valid gift code.' });
    }

    const db = await pool.connect();
    const fail = async (status, message) => {
        await db.query('ROLLBACK');
        return res.status(status).json({ ok: false, error: message });
    };

    try {
        await db.query('BEGIN');
        await ensureUser(db, req.tgUser);

        const found = await db.query(
            `SELECT id, amount, max_uses, used_count, is_active, expires_at
             FROM gift_codes WHERE code = $1 FOR UPDATE`,
            [code]
        );
        if (!found.rows.length) return await fail(404, 'Invalid gift code.');

        const gift = found.rows[0];
        if (!gift.is_active) return await fail(400, 'This gift code is no longer active.');
        if (gift.expires_at && new Date(gift.expires_at) < new Date()) {
            return await fail(400, 'This gift code has expired.');
        }

        const prior = await db.query(
            `SELECT 1 FROM gift_code_redemptions WHERE gift_code_id = $1 AND telegram_id = $2`,
            [gift.id, uid]
        );
        if (prior.rows.length) return await fail(409, 'You have already redeemed this gift code.');
        if (gift.used_count >= gift.max_uses) {
            return await fail(409, 'This gift code has already been fully redeemed.');
        }

        await db.query(
            `INSERT INTO gift_code_redemptions (gift_code_id, telegram_id, amount) VALUES ($1, $2, $3)`,
            [gift.id, uid, gift.amount]
        );
        await db.query(`UPDATE gift_codes SET used_count = used_count + 1 WHERE id = $1`, [gift.id]);

        const updated = await db.query(
            `UPDATE users
             SET balance = balance + $1, total_bonus = total_bonus + $1, updated_at = NOW()
             WHERE telegram_id = $2 RETURNING balance`,
            [gift.amount, uid]
        );
        const newBalance = updated.rows[0].balance;

        await db.query(
            `INSERT INTO transactions (telegram_id, type, amount, status, balance_after, note)
             VALUES ($1, 'gift_code', $2, 'completed', $3, $4)`,
            [uid, gift.amount, newBalance, `Gift code ${code}`]
        );

        await db.query('COMMIT');
        res.json({ ok: true, amount: Number(gift.amount), balance: Number(newBalance) });
    } catch (err) {
        try { await db.query('ROLLBACK'); } catch (e) { /* ignore */ }
        console.error('Gift code error:', err.message);
        res.status(500).json({ ok: false, error: 'Could not claim the gift code. Please try again.' });
    } finally {
        db.release();
    }
});

// Admin only: create a gift code. Leave code empty to auto-generate one.
app.post('/api/admin/gift-codes', requireTelegramAuth, requireAdmin, async (req, res) => {
    if (!pool || !dbReady) {
        return res.status(503).json({ ok: false, error: 'Database is not ready' });
    }
    const body = req.body || {};

    let code = String(body.code || '').trim().toUpperCase();
    if (!code) code = 'GDX' + crypto.randomBytes(4).toString('hex').toUpperCase();
    if (!CODE_PATTERN.test(code)) {
        return res.status(400).json({ ok: false, error: 'Code must be 3-40 characters: A-Z, 0-9, - or _' });
    }

    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!isFinite(amount) || amount <= 0 || amount > 100000) {
        return res.status(400).json({ ok: false, error: 'Amount must be between 0.01 and 100000.' });
    }

    const maxUses = body.maxUses === undefined || body.maxUses === '' ? 1 : parseInt(body.maxUses, 10);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100000) {
        return res.status(400).json({ ok: false, error: 'Max uses must be between 1 and 100000.' });
    }

    try {
        await pool.query(
            `INSERT INTO gift_codes (code, amount, max_uses) VALUES ($1, $2, $3)`,
            [code, amount, maxUses]
        );
        res.json({ ok: true, code, amount, maxUses });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ ok: false, error: 'This gift code already exists.' });
        }
        console.error('Create gift code error:', err.message);
        res.status(500).json({ ok: false, error: 'Could not create the gift code.' });
    }
});

// ---------- Existing client / bot features (unchanged) ----------

app.post('/api/create-client', async (req, res) => {
    const { clientName, slug, botUsername, botApiToken, pixelId, accessToken, channelLink, imageUrl, rootDomain } = req.body;
    const clients = getClients();

    const cleanSlug = (slug || 'page').toLowerCase().replace(/[^a-z0-9]/g, '');
    const newId = 'client_' + Date.now();

    const newClient = {
        id: newId,
        slug: cleanSlug,
        clientName: clientName || 'GOKU Store',
        botUsername: botUsername || '',
        botApiToken: botApiToken || '',
        pixelId: pixelId || '',
        accessToken: accessToken || '',
        channelLink: channelLink || '',
        imageUrl: imageUrl || 'https://i.imgur.com/7k123ab.png'
    };

    clients.push(newClient);
    saveClients(clients);

    if (botApiToken) {
        try {
            const webhookUrl = `https://${req.get('host')}/api/telegram-webhook/${newId}`;
            await fetch(`https://api.telegram.org/bot${botApiToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
        } catch (err) {
            console.error("Webhook setup failed:", err);
        }
    }

    const baseDomain = rootDomain || req.get('host');
    const landingPageUrl = `https://${cleanSlug}.${baseDomain}`;

    res.json({ success: true, landingPageUrl, client: newClient });
});

// Admin only. Secret tokens are removed from the response.
app.get('/api/clients', requireTelegramAuth, requireAdmin, (req, res) => {
    const safeClients = getClients().map(c => ({
        id: c.id,
        slug: c.slug,
        clientName: c.clientName,
        botUsername: c.botUsername,
        pixelId: c.pixelId,
        channelLink: c.channelLink,
        imageUrl: c.imageUrl
    }));
    res.json(safeClients);
});

// Admin Bot Command & WebApp Handler (/start)
app.post('/api/admin-bot-webhook', async (req, res) => {
    try {
        const update = req.body;
        if (update.message && update.message.text) {
            const chatId = update.message.chat.id;
            const text = update.message.text;

            if (text.startsWith('/start')) {
                const webAppUrl = `https://${RAILWAY_DOMAIN}`;
                const payload = {
                    chat_id: chatId,
                    text: "⚡ *Welcome to GOKU AGENCY STORE* \n\nClick the button below to open your high-end dashboard:",
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🚀 Open Dashboard", web_app: { url: webAppUrl } }]
                        ]
                    }
                };

                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
            }
        }
        res.json({ ok: true });
    } catch (err) {
        console.error("Admin bot error:", err);
        res.status(500).json({ ok: false });
    }
});

app.post('/api/telegram-webhook/:id', async (req, res) => {
    try {
        const clients = getClients();
        const client = clients.find(c => c.id === req.params.id);

        if (!client || !client.pixelId || !client.accessToken) {
            return res.status(404).json({ error: "Client or Tracking config not found" });
        }

        const update = req.body;
        const event = update.chat_join_request;

        if (event) {
            const userId = event.from.id;
            const date = event.date || Math.floor(Date.now() / 1000);

            const payload = {
                data: [{
                    event_name: "Subscribe",
                    event_time: date,
                    action_source: "system_generated",
                    event_id: `sub_${client.id}_${userId}_${date}`,
                    user_data: {
                        external_id: crypto.createHash('sha256').update(String(userId)).digest('hex')
                    }
                }]
            };

            await fetch(`https://graph.facebook.com/v19.0/${client.pixelId}/events?access_token=${client.accessToken}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false });
    }
});

function getLandingPageHTML(client) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${client.clientName} - Exclusive Access</title>
    <script>
      !function(f,b,e,v,n,t,s)
      {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
      n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s)}(window, document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', '${client.pixelId}');
      fbq('track', 'PageView');
    </script>
    <noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${client.pixelId}&ev=PageView&noscript=1"/></noscript>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background: #0b0f19; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
        .card { background: #131b2e; width: 100%; max-width: 420px; padding: 35px 25px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.6); border: 1px solid #1e293b; text-align: center; }
        .avatar-container { position: relative; width: 90px; height: 90px; margin: 0 auto 20px; }
        img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; border: 3px solid #6366f1; box-shadow: 0 0 15px rgba(99, 102, 241, 0.4); }
        h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; color: #f8fafc; }
        p { color: #94a3b8; font-size: 13px; margin-bottom: 30px; line-height: 1.5; }
        .btn { display: flex; justify-content: center; align-items: center; gap: 10px; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; padding: 14px; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4); }
        .footer-note { margin-top: 20px; font-size: 11px; color: #64748b; }
    </style>
</head>
<body>
    <div class="card">
        <div class="avatar-container">
            <img src="${client.imageUrl}" alt="Logo">
        </div>
        <h1>${client.clientName}</h1>
        <p>Join our secure VIP Telegram channel to unlock premium content & updates instantly.</p>
        <a href="${client.channelLink}" class="btn" target="_blank" onclick="fbq('track', 'Lead');">
            <span>Join Telegram Channel</span>
        </a>
        <div class="footer-note">🔒 Verified Secure Access Link</div>
    </div>
</body>
</html>`;
}
const projects = projectsModule.setup(app, {
    getPool: () => pool,
    isDbReady: () => dbReady,
    requireTelegramAuth,
    ensureUser: (u) => ensureUser(pool, u),
    findTemplate,
    baseUrl: 'https://' + RAILWAY_DOMAIN,
    mainBotToken: BOT_TOKEN
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);

    await initDatabase();

    // Auto set webhook on startup
    try {
        const webhookUrl = `https://${RAILWAY_DOMAIN}/api/admin-bot-webhook`;
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
        const result = await response.json();
        console.log("Webhook URL we tried:", webhookUrl);
        console.log("Telegram says:", JSON.stringify(result));
    } catch (e) {
        console.error("Auto webhook setup error:", e);
    }
});
