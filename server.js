app.post('/api/create-client', async (req, res) => {
    const { clientName, botUsername, botApiToken, pixelId, accessToken, channelLink, imageUrl } = req.body;
    const clients = getClients();
    const newId = 'client_' + Date.now();
    
    const newClient = {
        id: newId,
        clientName: clientName || 'Landing Page',
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

    const landingPageUrl = `https://${req.get('host')}/p/${newId}`;
    res.json({ success: true, landingPageUrl, client: newClient });
});