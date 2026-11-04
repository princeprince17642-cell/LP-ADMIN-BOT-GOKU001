const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_FILE = path.join(__dirname, 'clients.json');
const BOT_TOKEN = "9028563887:AAGBY-CmAL2Cn8uVKC-r8mGaRXmBqG-r4bI";

function getClients() {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveClients(clients) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(clients, null, 2));
}

// 1. एडमिन डैशबोर्ड (Telegram Mini App UI - जो टेलीग्राम के अंदर खुलेगा)
app.get('/', (req, res) => {
    const clients = getClients();
    let html = `
    <!DOCTYPE html>
    <html lang="hi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Agency Mini App</title>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <style>
            body { font-family: Arial, sans-serif; background: var(--tg-theme-bg-color, #0f172a); color: var(--tg-theme-text-color, #f8fafc); padding: 15px; margin: 0; }
            .container { max-width: 100%; margin: auto; background: var(--tg-theme-secondary-bg-color, #1e293b); padding: 15px; border-radius: 10px; }
            h2 { color: #38bdf8; text-align: center; font-size: 18px; }
            .client-card { background: #0f172a; padding: 12px; margin-bottom: 12px; border-radius: 8px; border: 1px solid #334155; }
            label { font-size: 11px; color: #94a3b8; display: block; margin-top: 5px; }
            input { width: 100%; padding: 8px; margin-top: 2px; background: #1e293b; border: 1px solid #475569; color: #fff; border-radius: 4px; box-sizing: border-box; font-size: 12px; }
            button { background: #0284c7; color: white; border: none; padding: 8px 12px; width: 100%; border-radius: 4px; cursor: pointer; font-weight: bold; margin-top: 10px; font-size: 14px; }
            button:hover { background: #0ea5e9; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>🚀 Agency Mini App Panel</h2>`;

    clients.forEach(c => {
        html += `
            <div class="client-card">
                <form action="/update" method="POST">
                    <input type="hidden" name="id" value="${c.id}">
                    <label>क्लाइंट नाम:</label>
                    <input type="text" name="clientName" value="${c.clientName}">
                    <label>Meta Pixel ID:</label>
                    <input type="text" name="pixelId" value="${c.pixelId}">
                    <label>Access Token:</label>
                    <input type="text" name="accessToken" value="${c.accessToken}">
                    <label>Telegram Invite Link:</label>
                    <input type="text" name="inviteLink" value="${c.inviteLink}">
                    <button type="submit">सेव करो</button>
                </form>
            </div>`;
    });

    html += `</div>
    <script>
        let tg = window.Telegram.WebApp;
        tg.expand(); // ऐप को फुल स्क्रीन में खोलेगा
    </script>
    </body></html>`;
    res.send(html);
});

// 2. डेटा अपडेट करने की राउट
app.post('/update', (req, res) => {
    const { id, clientName, pixelId, accessToken, inviteLink } = req.body;
    let clients = getClients();
    clients = clients.map(c => c.id === id ? { id, clientName, pixelId, accessToken, inviteLink } : c);
    saveClients(clients);
    res.redirect('/');
});

// 3. टेलीग्राम बोट अपडेट्स (स्टार्ट कमांड और वेबहुक)
app.post('/webhook', async (req, res) => {
    try {
        const update = req.body;

        // अगर यूजर ने /start दबाया है, तो उसे 'Open Admin Panel' वाला बटन भेज दो
        if (update.message && update.message.text === '/start') {
            const chatId = update.message.chat.id;
            const railwayUrl = process.env.RENDER_EXTERNAL_URL || req.protocol + '://' + req.get('host'); // अपने आप रेलवे का URL पकड़ लेगा

            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: "नमस्ते बॉस! अपना एडमिन पैनल खोलने के लिए नीचे दिए गए बटन पर क्लिक करें:",
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: "🚀 Open Admin Panel",
                                web_app: { url: railwayUrl }
                            }
                        ]]
                    }
                })
            });
        }

        // अगर टेलीग्राम पर कोई नया ज्वाइन रिक्वेस्ट आया है, तो CAPI हिट करो
        const event = update.chat_join_request;
        if (event) {
            const userId = event.from.id;
            const date = event.date;
            const inviteLinkUrl = event.invite_link?.invite_link;

            const clients = getClients();
            const matchedClient = clients.find(c => c.inviteLink === inviteLinkUrl);

            if (matchedClient && matchedClient.pixelId && matchedClient.accessToken) {
                const payload = {
                    data: [{
                        event_name: "Subscribe",
                        event_time: date || Math.floor(Date.now() / 1000),
                        action_source: "system_generated",
                        event_id: `telegram_sub_${userId}_${date}`,
                        user_data: {
                            external_id: require('crypto').createHash('sha256').update(String(userId)).digest('hex')
                        }
                    }]
                };

                await fetch(`https://graph.facebook.com/v19.0/${matchedClient.pixelId}/events?access_token=${matchedClient.accessToken}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
            }
        }

        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(400).json({ ok: false });
    }
});

const PORT = process.env.PORT || 30