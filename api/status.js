const { Telegram } = require('telegraf');
const { redis } = require('../lib/store');
const { TOKEN, ALLOWED, COMMANDS } = require('../lib/config');

// Public, read-only overview for the web page. No tokens, user IDs or message content.
module.exports = async (req, res) => {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const expectedWebhook = `https://${host}/api/webhook`;
  const tg = TOKEN ? new Telegram(TOKEN) : null;
  const noToken = () => Promise.reject(new Error('BOT_TOKEN is not set'));

  const [me, wh, rd] = await Promise.allSettled([
    tg ? tg.getMe() : noToken(),
    tg ? tg.getWebhookInfo() : noToken(),
    (async () => {
      const t = Date.now();
      const p = redis.pipeline();
      p.hgetall('stats:counts');
      p.hlen('settings');
      p.get('stats:since');
      p.llen('history');
      const r = await p.exec();
      return { ms: Date.now() - t, r };
    })(),
  ]);

  const out = {
    time: new Date().toISOString(),
    env: {
      botToken: Boolean(TOKEN),
      redis: Boolean(
        (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
        (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
      ),
      setupKey: Boolean(process.env.SETUP_KEY),
      restricted: ALLOWED.length > 0,
    },
    bot: null,
    webhook: null,
    redis: { ok: false },
    stats: null,
    commands: COMMANDS,
  };

  if (me.status === 'fulfilled') {
    out.bot = { name: me.value.first_name, username: me.value.username, id: me.value.id };
  } else {
    out.botError = me.reason.message;
  }

  if (wh.status === 'fulfilled') {
    const w = wh.value;
    out.webhook = {
      ok: w.url === expectedWebhook,
      url: w.url || null,
      expected: expectedWebhook,
      pending: w.pending_update_count,
      lastError: w.last_error_message || null,
      lastErrorDate: w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : null,
    };
  }

  if (rd.status === 'fulfilled') {
    const [counts, users, since, historySize] = rd.value.r;
    const c = counts || {};
    out.redis = { ok: true, latencyMs: rd.value.ms };
    out.stats = {
      total: Object.values(c).reduce((n, v) => n + Number(v), 0),
      counts: c,
      settingsUsers: Number(users) || 0,
      historySize: Number(historySize) || 0,
      since: since ? new Date(Number(since)).toISOString() : null,
    };
  } else {
    out.redis = { ok: false, error: rd.reason.message };
  }

  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
  res.status(200).json(out);
};
