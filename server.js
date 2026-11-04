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

    // Automatically set Telegram Webhook for this bot if token is provided
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