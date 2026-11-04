const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_FILE = path.join(__dirname, 'clients.json');

// डेटा पढ़ने और लिखने के लिए फंगशन्स
function getClients() {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveClients(clients) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(clients, null, 2));
}

// 1. एडमिन डैशबोर्ड (UI) - जहाँ सारे क्लाइंट दिखेंगे और एडिट बटन होगा
app.get('/', (req, res) => {
    const clients = getClients();
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Agency Dashboard</title>
        <style>
            body { font-family: Arial, sans-serif; background: #0f172a; color: #f8fafc; padding: 30px; }
            .container { max-width: 900px; margin: auto; background: #1e293b; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
            h2 { color: #38bdf8; text-align: center; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { padding: 12px; border-bottom: 1px solid #334155; text-align: left; font-size: 14px; }
            th { background: #0f172a; color: #38bdf8; }
            input { width: 90%; padding: 8px; background: #0f172a; border: 1px solid #475569; color: #fff; border-radius: 6px; }
            button { background: #0284c7; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; }
            button:hover { background: #0ea5e9; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>🚀 Agency Client Manager Dashboard</h2>
            <table>
                <tr>
                    <th>Client Name</th>
                    <th>Meta Pixel ID</th>
                    <th>Access Token</th>
                    <th>Telegram Invite Link</th>
                    <th>Action</th>
                </tr>`;

    clients.forEach(c => {
        html += `
                <tr>
                    <form action="/update" method="POST">
                        <input type="hidden" name="id" value="${c.id}">
                        <td><input type="text" name="clientName" value="${c.clientName}"></td>
                        <td><input type="text" name="pixelId" value="${c.pixelId}"></td>
                        <td><input type="text" name="accessToken" value="${c.accessToken}"></td>
                        <td><input type="text" name="inviteLink" value="${c.inviteLink}"></td>
                        <td><button type="submit">Save</button></td>
                    </form>
                </tr>`;
    });

    html += `</table></div></body></html>`;
    res.send(html);
});

// क्लाइंट डेटा अपडेट करने की राउट
app.post('/update', (req, res) => {
    const { id, clientName, pixelId, accessToken, inviteLink } = req.body;
    let clients = getClients();
    clients = clients.map(c => c.id === id ? { id, clientName, pixelId, accessToken, inviteLink } : c);
    saveClients(clients);
    res.redirect('/');
});

// 2. टेलीग्राम वेबहुक - जो टेलीग्राम से जॉइन रिक्वेस्ट पकड़ेगा और सही क्लाइंट के पिक्सेल पर भेजेगा
app.post('/webhook', async (req, res) => {
    try {
        const update = req.body;
        const event = update.chat_join_request;

        if (event) {
            const userId = event.from.id;
            const date = event.date;
            const inviteLinkUrl = event.invite_link?.invite_link;

            console.log("Incoming Join Request for Link:", inviteLinkUrl);

            // डेटाबेस से चेक करो कि यह इनवाइट लिंक किस क्लाइंट की है
            const clients = getClients();
            const matchedClient = clients.find(c => c.inviteLink === inviteLinkUrl);

            if (matchedClient && matchedClient.pixelId && matchedClient.accessToken) {
                console.log(`Matched Client: ${matchedClient.clientName}! Sending Meta CAPI...`);

                const payload = {
                    data: [
                        {
                            event_name: "Subscribe",
                            event_time: date || Math.floor(Date.now() / 1000),
                            action_source: "system_generated",
                            event_id: `telegram_sub_${userId}_${date}`,
                            user_data: {
                                external_id: require('crypto').createHash('sha256').update(String(userId)).digest('hex')
                            }
                        }
                    ]
                };

                await fetch(`https://graph.facebook.com/v19.0/${matchedClient.pixelId}/events?access_token=${matchedClient.accessToken}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
            } else {
                console.log("Ignored: Link not matched with any client.");
            }
        }

        res.json({ ok: true });
    } catch (err) {
        console.error("Webhook Error:", err);
        res.status(400).json({ ok: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));