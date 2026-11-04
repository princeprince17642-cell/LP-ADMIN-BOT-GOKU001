const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const CLIENTS_FILE = path.join(__dirname, 'clients.json');

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

// --- FRONTEND UI (Telegram Mini App Dashboard) ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="hi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Agency Dashboard</title>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <style>
            body { font-family: Arial, sans-serif; background: #0f172a; color: #fff; margin: 0; padding: 20px; }
            .container { max-width: 500px; margin: 0 auto; }
            h1 { font-size: 20px; text-align: center; margin-bottom: 20px; color: #38bdf8; }
            .card { background: #1e293b; padding: 20px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
            label { display: block; font-size: 13px; color: #94a3b8; margin-bottom: 5px; margin-top: 10px; }
            input, textarea { width: 100%; padding: 10px; background: #0f172a; border: 1px solid #334155; color: #fff; border-radius: 6px; box-sizing: border-box; }
            button { width: 100%; background: #2563eb; color: white; border: none; padding: 12px; border-radius: 6px; font-weight: bold; margin-top: 15px; cursor: pointer; }
            button:hover { background: #1d4ed8; }
            .client-item { background: #334155; padding: 12px; border-radius: 8px; margin-top: 10px; font-size: 14px; }
            .client-item a { color: #38bdf8; word-break: break-all; text-decoration: none; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Jack Digital Dashboard</h1>
            
            <div class="card">
                <h3>Create New Landing Page</h3>
                <form id="createForm">
                    <label>Client Name</label>
                    <input type="text" id="clientName" required placeholder="e.g. Cybox">
                    
                    <label>Bot Username</label>
                    <input type="text" id="botUsername" required placeholder="@Syvoxlandingpagebot">
                    
                    <label>Meta Pixel ID</label>
                    <input type="text" id="pixelId" required placeholder="1115936117748992">
                    
                    <label>Meta Access Token</label>
                    <textarea id="accessToken" required placeholder="EABBqGSM..."></textarea>
                    
                    <label>Telegram Channel Invite Link</label>
                    <input type="text" id="channelLink" required placeholder="https://t.me/+...">
                    
                    <label>Channel Image URL</label>
                    <input type="text" id="imageUrl" placeholder="https://... (Optional)">
                    
                    <button type="submit">Generate Landing Page</button>
                </form>
                <div id="resultMsg" style="margin-top: 15px; font-size: 13px; color: #4ade80;"></div>
            </div>

            <div class="card">
                <h3>Manage Landing Pages</h3>
                <div id="clientsList">Loading...</div>
            </div>
        </div>

        <script>
            const tg = window.Telegram.WebApp;
            tg.expand();

            async function loadClients() {
                const res = await fetch('/api/clients');
                const clients = await res.json();
                const listDiv = document.getElementById('clientsList');
                if(clients.length === 0) {
                    listDiv.innerHTML = '<p style="color: #94a3b8; font-size: 13px;">No landing pages created yet.</p>';
                    return;
                }
                listDiv.innerHTML = clients.map(c => `
                    <div class="client-item">
                        <strong>${c.clientName}</strong><br>
                        <a href="/p/${c.id}" target="_blank">View: /p/${c.id}</a>
                    </div>
                `).join('');
            }

            document.getElementById('createForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const data = {
                    clientName: document.getElementById('clientName').value,
                    botUsername: document.getElementById('botUsername').value,
                    pixelId: document.getElementById('pixelId').value,
                    accessToken: document.getElementById('accessToken').value,
                    channelLink: document.getElementById('channelLink').value,
                    imageUrl: document.getElementById('imageUrl').value
                };

                const res = await fetch('/api/create-client', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await res.json();
                if(result.success) {
                    document.getElementById('resultMsg').innerText = "Success! Link: " + result.landingPageUrl;
                    document.getElementById('createForm').reset();
                    loadClients();
                } else {
                    alert("Error creating landing page");
                }
            });

            loadClients();
        </script>
    </body>
    </html>
    `);
});

// --- API ROUTES ---
app.post('/api/create-client', (req, res) => {
    const { clientName, botUsername, pixelId, accessToken, channelLink, imageUrl } = req.body;
    const clients = getClients();
    const newId = 'client_' + Date.now();
    
    const newClient = {
        id: newId,
        clientName: clientName || 'Landing Page',
        botUsername: botUsername || '',
        pixelId: pixelId || '',
        accessToken: accessToken || '',
        channelLink: channelLink || '',
        imageUrl: imageUrl || 'https://via.placeholder.com/150'
    };

    clients.push(newClient);
    saveClients(clients);

    const landingPageUrl = `https://${req.get('host')}/p/${newId}`;
    res.json({ success: true, landingPageUrl, client: newClient });
});

app.get('/api/clients', (req, res) => {
    res.json(getClients());
});

app.post('/api/update-client/:id', (req, res) => {
    const clientId = req.params.id;
    const { clientName, botUsername, pixelId, accessToken, channelLink, imageUrl } = req.body;
    const clients = getClients();
    const index = clients.findIndex(c => c.id === clientId);

    if (index === -1) return res.status(404).json({ success: false, message: "Not found" });

    clients[index] = {
        ...clients[index],
        clientName: clientName || clients[index].clientName,
        botUsername: botUsername || clients[index].botUsername,
        pixelId: pixelId || clients[index].pixelId,
        accessToken: accessToken || clients[index].accessToken,
        channelLink: channelLink || clients[index].channelLink,
        imageUrl: imageUrl || clients[index].imageUrl
    };

    saveClients(clients);
    res.json({ success: true, client: clients[index] });
});

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));