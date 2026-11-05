const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. Railway Volume Persistent Storage Path (डेटा हमेशा सेफ रहेगा)
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

// Serve Dashboard UI
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- API ROUTES: Create & Manage Clients ---
app.post('/api/create-client', async (req, res) => {
    const { clientName, customDomain, botUsername, botApiToken, pixelId, accessToken, channelLink, imageUrl } = req.body;
    const clients = getClients();
    const newId = 'client_' + Date.now();
    
    const newClient = {
        id: newId,
        clientName: clientName || 'Landing Page',
        customDomain: customDomain || '',
        botUsername: botUsername || '',
        botApiToken: botApiToken || '',
        pixelId: pixelId || '',
        accessToken: accessToken || '',
        channelLink: channelLink || '',
        imageUrl: imageUrl || 'https://via.placeholder.com/150'
    };

    clients.push(newClient);
    saveClients(clients);

    // Automatically set Telegram Webhook for client bot if token is provided
    if (botApiToken) {
        try {
            const webhookUrl = `https://${req.get('host')}/api/telegram-webhook/${newId}`;
            await fetch(`https://api.telegram.org/bot${botApiToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
        } catch (err) {
            console.error("Webhook setup failed:", err);
        }
    }

    const landingPageUrl = customDomain ? `https://${customDomain}/p/${newId}` : `https://${req.get('host')}/p/${newId}`;
    res.json({ success: true, landingPageUrl, client: newClient });
});

app.get('/api/clients', (req, res) => {
    res.json(getClients());
});

app.post('/api/update-client/:id', (req, res) => {
    const clientId = req.params.id;
    const { clientName, customDomain, botUsername, botApiToken, pixelId, accessToken, channelLink, imageUrl } = req.body;
    const clients = getClients();
    const index = clients.findIndex(c => c.id === clientId);

    if (index === -1) return res.status(404).json({ success: false, message: "Not found" });

    clients[index] = {
        ...clients[index],
        clientName: clientName || clients[index].clientName,
        customDomain: customDomain !== undefined ? customDomain : clients[index].customDomain,
        botUsername: botUsername || clients[index].botUsername,
        botApiToken: botApiToken || clients[index].botApiToken,
        pixelId: pixelId || clients[index].pixelId,
        accessToken: accessToken || clients[index].accessToken,
        channelLink: channelLink || clients[index].channelLink,
        imageUrl: imageUrl || clients[index].imageUrl
    };

    saveClients(clients);
    res.json({ success: true, client: clients[index] });
});

// --- Dynamic Landing Page Route ---
app.get('/p/:id', (req, res) => {
    const clients = getClients();
    const client = clients.find(c => c.id === req.params.id);
    if (!client) return res.status(404).send("Landing page not found.");

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${client.clientName} - Exclusive Access</title>
        <script>
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._byq)f._byq=n;n.push=true;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${client.pixelId}');
          fbq('track', 'PageView');
        </script>
        <noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${client.pixelId}&ev=PageView&noscript=1"/></noscript>
        <style>
            body { font-family: Arial, sans-serif; background: #0f172a; color: #fff; text-align: center; padding: 50px 20px; }
            .card { max-width: 400px; margin: 0 auto; background: #1e293b; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
            img { width: 100px; height: 100px; border-radius: 50%; object-fit: cover; margin-bottom: 20px; border: 2px solid #3b82f6; }
            h1 { font-size: 24px; margin-bottom: 10px; }
            p { color: #94a3b8; font-size: 14px; margin-bottom: 25px; }
            .btn { display: block; background: #2563eb; color: white; padding: 12px; text-decoration: none; border-radius: 8px; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="card">
            <img src="${client.imageUrl}" alt="Channel">
            <h1>${client.clientName}</h1>
            <p>Join our exclusive Telegram channel to get instant updates.</p>
            <a href="${client.channelLink}" class="btn" target="_blank" onclick="fbq('track', 'Lead');">Join Telegram Channel</a>
        </div>
    </body>
    </html>
    `);
});

// --- Telegram Join Request Webhook (CAPI Tracking) ---
app.post('/api/telegram-webhook/:id', async (req, res) => {
    try {
        const clients = getClients();
        const client = clients.find(c => c.id === req.params.id);
        if (!client) return res.status(404).json({ error: "Not found" });

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

// --- Admin Bot Webhook for /start command (Open Admin Panel Button Fix) ---
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
                            inline_keyboard: [[
                                { text: "🚀 Open Admin Panel", web_app: { url: webAppUrl } }
                            ]}
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));