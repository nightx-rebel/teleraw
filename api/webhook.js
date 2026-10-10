const { bot } = require('../lib/bot');
const { WEBHOOK_SECRET } = require('../lib/config');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('POST only');

  // only Telegram knows this secret (set via /api/setup)
  if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
    return res.status(401).send('unauthorized');
  }

  try {
    if (!bot.botInfo) bot.botInfo = await bot.telegram.getMe();
    // must finish before responding, or Vercel freezes the function mid-work
    await bot.handleUpdate(req.body);
  } catch (e) {
    console.error('update failed:', e.message);
  }

  // always 200, otherwise Telegram keeps retrying the same update
  res.status(200).send('ok');
};
