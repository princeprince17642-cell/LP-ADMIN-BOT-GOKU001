const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Railway Volume Persistent Storage Path
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');

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

// --- Subdomain & Landing Page Handler (Wildcard logic) ---
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

// Serve Main App Dashboard UI
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- API ROUTES ---
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

app.get('/api/clients', (req, res) => {
    res.json(getClients());
});

// --- Telegram Webhook CAPI Trigger ---
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

// --- Admin Bot Webhook for /start command ---
app.post('/api/admin-bot-webhook', async (req, res) => {
    try {
        const update = req.body;
        if (update.message && update.message.text === '/start') {
            const chatId = update.message.chat.id;
            const adminBotToken = process.env.ADMIN_BOT_TOKEN; 
            const webAppUrl = `https://${req.get('host')}/`;

            if (adminBotToken) {
                await fetch(`https://api.telegram.org/bot${adminBotToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: "नमस्ते बॉस! अपना एडमिन पैनल खोलने के लिए नीचे दिए गए बटन पर क्लिक करें:",
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "🚀 Open Admin Panel", web_app: { url: webAppUrl } }
                                ]
                            ]
                        }
                    })
                });
            }
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false });
    }
});

// --- Landing Page HTML Template ---
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));