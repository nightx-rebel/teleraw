const crypto = require('crypto');
const { Telegram } = require('telegraf');
const { redis } = require('../lib/store');
const { TOKEN, SETUP_KEY, WEBHOOK_SECRET, COMMANDS, ALLOWED_UPDATES } = require('../lib/config');

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Open once after every deploy to a new domain:
//   https://YOUR-APP.vercel.app/api/setup?key=YOUR_SETUP_KEY
module.exports = async (req, res) => {
  if (!TOKEN) return res.status(500).json({ ok: false, error: 'BOT_TOKEN is not set' });
  if (!SETUP_KEY) return res.status(500).json({ ok: false, error: 'SETUP_KEY is not set' });
  if (!same(req.query.key || '', SETUP_KEY)) return res.status(401).json({ ok: false, error: 'wrong key' });

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `https://${host}/api/webhook`;

  try {
    const tg = new Telegram(TOKEN);
    await tg.setWebhook(url, {
      secret_token: WEBHOOK_SECRET,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: true,
    });
    await tg.setMyCommands(COMMANDS);
    await redis.setnx('stats:since', Date.now()).catch(() => {});
    res.status(200).json({ ok: true, webhook: url, commands: COMMANDS.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.response?.description || e.message });
  }
};
