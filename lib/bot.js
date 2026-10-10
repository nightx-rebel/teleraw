// lib/bot.js — Telegram Raw Inspector Bot v3 (Vercel webhook + Upstash Redis)

const { Telegraf, Markup } = require('telegraf');
const { redis } = require('./store');
const { TOKEN, ALLOWED, OWNER } = require('./config');

if (!TOKEN) throw new Error('BOT_TOKEN is not set');

const LIMIT = 3500;          // max escaped chars per text message
const MAX_PARTS = 5;         // more than this → sent as a file
const HISTORY_SIZE = 50;     // updates kept in Redis for /history
const MEDIA = ['photo', 'video', 'audio', 'voice', 'document', 'animation', 'video_note', 'sticker'];
const KINDS = ['text', ...MEDIA, 'contact', 'location', 'venue', 'poll', 'dice', 'game'];

// ---------- settings (per user, stored in Redis hash "settings") ----------
const DEFAULTS = { mode: 'auto', scope: 'message', indent: 2, groups: false };
const CYCLE = {
  mode: ['auto', 'text', 'file'],
  scope: ['message', 'update'],
  indent: [2, 0],
  groups: [false, true],
};

const getCfg = async (ctx) => {
  if (ctx.state.cfg) return ctx.state.cfg;
  const key = String(ctx.from?.id ?? OWNER ?? 0);
  let saved = null;
  try { saved = await redis.hget('settings', key); }
  catch (e) { console.error('settings load failed:', e.message); }
  ctx.state.cfgKey = key;
  ctx.state.cfg = { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
  return ctx.state.cfg;
};

const saveCfg = (ctx) => redis.hset('settings', { [ctx.state.cfgKey]: ctx.state.cfg });

// ---------- helpers ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const typeOf = (u) => Object.keys(u).find((k) => k !== 'update_id');
const inner = (u) => u[typeOf(u)];
const target = (ctx) => ctx.message.reply_to_message || ctx.message;
const arg = (ctx) => (ctx.message.text.split(/\s+/)[1] || '').trim();
const fileOf = (m, t) => (t === 'photo' ? m.photo[m.photo.length - 1] : m[t]);
const ownerOnly = (fn) => (ctx) =>
  ctx.from?.id === OWNER ? fn(ctx) : ctx.reply('⛔ Owner only.');

const who = (u = {}) => {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.title || '?';
  return `${esc(name)}${u.username ? ` (@${esc(u.username)})` : ''} <code>${u.id}</code>`;
};

const headerFor = (type, d = {}) => {
  const bits = [`<b>${esc(type)}</b>`];
  if (d.chat) bits.push(`${esc(d.chat.title || d.chat.username || d.chat.type)} <code>${d.chat.id}</code>`);
  const f = d.from || d.user;
  if (f) bits.push(`user <code>${f.id}</code>`);
  return '📨 ' + bits.join(' • ');
};

const mediaLines = (m = {}) =>
  MEDIA.filter((t) => m[t]).map((t) => `<b>${t}</b>: <code>${esc(fileOf(m, t).file_id)}</code>`);

// split escaped JSON into Telegram-safe parts (never cuts an HTML entity)
function chunkEscaped(raw) {
  const parts = [];
  let cur = '';
  for (const line of raw.split('\n')) {
    const pieces = esc(line).length > LIMIT ? line.match(/[\s\S]{1,500}/g) : [line];
    pieces.forEach((p, i) => {
      const e = esc(p);
      const sep = cur && i === 0 ? '\n' : '';
      if (cur && cur.length + sep.length + e.length > LIMIT) { parts.push(cur); cur = e; }
      else cur += sep + e;
    });
  }
  parts.push(cur);
  return parts;
}

const BTN_FILE = Markup.button.callback('📎 JSON file', 'raw:file');
const BTN_DEL = Markup.button.callback('🗑 Delete', 'raw:del');

// ---------- core: send raw ----------
async function sendRaw(ctx, data, { file = false, to, header = '' } = {}) {
  const cfg = await getCfg(ctx);
  const raw = JSON.stringify(data, null, cfg.indent || 0) ?? 'undefined';
  const type = typeOf(ctx.update);
  const chatId = to ?? ctx.chat?.id ?? ctx.from?.id;
  const reply = !to && ctx.msg?.message_id
    ? { reply_parameters: { message_id: ctx.msg.message_id, allow_sending_without_reply: true } }
    : {};

  const parts = chunkEscaped(raw);
  const asFile =
    file || cfg.mode === 'file' || parts.length > MAX_PARTS ||
    (cfg.mode === 'auto' && parts.length > 1);

  if (asFile) {
    const media = mediaLines(data?.update_id ? inner(data) : data);
    let caption = [`${header || `<b>${esc(type)}</b>`} • ${raw.length} chars`, ...media].join('\n');
    if (caption.length > 1000) caption = caption.split('\n')[0];
    return ctx.telegram.sendDocument(
      chatId,
      { source: Buffer.from(raw, 'utf8'), filename: `${type}_${ctx.update.update_id}.json` },
      { ...reply, caption, parse_mode: 'HTML', ...Markup.inlineKeyboard([[BTN_DEL]]) }
    );
  }

  for (let i = 0; i < parts.length; i++) {
    const extra = { parse_mode: 'HTML', ...(i === 0 ? reply : {}) };
    if (parts.length === 1) Object.assign(extra, Markup.inlineKeyboard([[BTN_FILE, BTN_DEL]]));
    const head = i === 0 && header ? header + '\n' : '';
    await ctx.telegram.sendMessage(
      chatId,
      `${head}<pre><code class="language-json">${parts[i]}</code></pre>`,
      extra
    );
  }
}

const HELP = `<b>🔍 Raw Inspector Bot</b>
Send me any message and I'll reply with its raw JSON.
Small output is sent as text, large output as a .json file.

<b>Inspect</b>
/raw — reply to a message to get its raw JSON
/file — same, but always as a file
/summary — human-readable overview of a message
/entities — list entities (links, mentions, etc.)
/fileinfo — file_id, size and path of replied media
/path &lt;a.b.c&gt; — extract one field from a replied message
/id — user, chat, message and forward IDs
/chat [id|@user] — full getChat info
/member [id] — chat member info (groups)

<b>Settings</b>
/settings — settings panel
/mode auto|text|file — output style
/scope message|update — message only or full update

<b>Other</b>
/ping — latency check
/history [n] — last updates as a file (owner)
/stats — bot statistics (owner)
/help — this menu

<b>Tips</b>
• 📎 button turns a text reply into a file
• Media file_ids are shown in the file caption
• Edited messages, reactions and member changes are supported
• In groups, use /raw as a reply (auto-dump is off by default)
• Path example: <code>/path from.id</code> or <code>/path photo.-1.file_id</code>`;

// ---------- bot ----------
const bot = new Telegraf(TOKEN);

// access control
bot.use((ctx, next) => {
  if (ALLOWED.length && ctx.from && !ALLOWED.includes(ctx.from.id)) return;
  return next();
});

// flood protection + stats + history (one Redis round trip)
bot.use(async (ctx, next) => {
  const type = typeOf(ctx.update);
  try {
    const id = ctx.from?.id;
    const p = redis.pipeline();
    if (id) {
      const k = `thr:${id}:${Math.floor(Date.now() / 10_000)}`;
      p.incr(k);
      p.expire(k, 20);
    }
    p.hincrby('stats:counts', type, 1);
    p.lpush('history', ctx.update);
    p.ltrim('history', 0, HISTORY_SIZE - 1);
    const res = await p.exec();
    if (id && res[0] > 20) return; // more than 20 updates / 10 s → ignore
  } catch (e) {
    console.error('redis middleware failed:', e.message);
  }
  return next();
});

bot.start((ctx) => ctx.replyWithHTML(HELP));
bot.help((ctx) => ctx.replyWithHTML(HELP));

// /raw (reply) & /file
for (const [name, file] of [['raw', false], ['file', true]]) {
  bot.command(name, (ctx) => sendRaw(ctx, target(ctx), { file }));
}

// /id
bot.command('id', (ctx) => {
  const m = ctx.message;
  const r = m.reply_to_message;
  const L = [
    `👤 You: <code>${m.from.id}</code>`,
    `💬 Chat: <code>${m.chat.id}</code> (${m.chat.type})`,
    `✉️ Message: <code>${m.message_id}</code>`,
  ];
  if (m.message_thread_id) L.push(`🧵 Thread: <code>${m.message_thread_id}</code>`);
  if (r) {
    L.push(`↩️ Reply message: <code>${r.message_id}</code>`);
    L.push(`↩️ Reply user: <code>${r.from?.id ?? r.sender_chat?.id ?? '?'}</code>`);
    const o = r.forward_origin;
    if (o) {
      const id = o.sender_user?.id ?? o.sender_chat?.id ?? o.chat?.id ?? 'hidden';
      L.push(`↪️ Forward (${o.type}): <code>${id}</code>`);
      if (o.type === 'hidden_user') L.push(`   name: ${esc(o.sender_user_name)}`);
    }
  }
  return ctx.replyWithHTML(L.join('\n'));
});

// /summary
bot.command('summary', (ctx) => {
  const m = target(ctx);
  const kinds = KINDS.filter((t) => m[t]);
  const text = m.text ?? m.caption ?? '';
  const ents = (m.entities?.length || 0) + (m.caption_entities?.length || 0);
  const L = [
    `<b>📋 Message summary</b>`,
    `Type: ${kinds.join(', ') || 'service / other'}`,
    `Sent: <code>${new Date(m.date * 1000).toISOString()}</code>`,
  ];
  if (m.edit_date) L.push(`Edited: <code>${new Date(m.edit_date * 1000).toISOString()}</code>`);
  L.push(`From: ${m.from ? who(m.from) : who(m.sender_chat)}`);
  if (m.from?.language_code) L.push(`Language: ${esc(m.from.language_code)}`);
  if (m.from?.is_bot) L.push('Is bot: yes');
  L.push(`Chat: ${esc(m.chat.title || m.chat.type)} <code>${m.chat.id}</code>`);
  if (text) L.push(`Text length: ${text.length}`);
  if (ents) L.push(`Entities: ${ents}`);
  if (m.forward_origin) L.push(`Forward: ${m.forward_origin.type}`);
  if (m.via_bot) L.push(`Via bot: ${who(m.via_bot)}`);
  if (m.media_group_id) L.push(`Media group: <code>${esc(m.media_group_id)}</code>`);
  if (m.message_thread_id) L.push(`Thread: <code>${m.message_thread_id}</code>`);
  L.push(`Keys: <code>${esc(Object.keys(m).join(', '))}</code>`);
  return ctx.replyWithHTML(L.join('\n'));
});

// /entities
bot.command('entities', (ctx) => {
  const m = target(ctx);
  const txt = m.text ?? m.caption ?? '';
  const ents = [...(m.entities || []), ...(m.caption_entities || [])];
  if (!ents.length) return ctx.reply('ℹ️ No entities found in this message.');
  const lines = ents.slice(0, 40).map((e) => {
    let s = `<b>${e.type}</b>: <code>${esc(txt.slice(e.offset, e.offset + e.length).slice(0, 60))}</code>`;
    if (e.url) s += ` → ${esc(e.url)}`;
    if (e.user) s += ` (id ${e.user.id})`;
    if (e.language) s += ` [${esc(e.language)}]`;
    if (e.custom_emoji_id) s += ` (emoji ${esc(e.custom_emoji_id)})`;
    return s;
  });
  if (ents.length > 40) lines.push(`… and ${ents.length - 40} more`);
  return ctx.replyWithHTML(lines.join('\n'));
});

// /fileinfo
bot.command('fileinfo', async (ctx) => {
  const m = target(ctx);
  const items = MEDIA.filter((t) => m[t]);
  if (!items.length) return ctx.reply('ℹ️ Reply to a message that contains media.');
  const out = [];
  for (const t of items) {
    const f = fileOf(m, t);
    const rows = [
      `<b>${t}</b>`,
      `file_id: <code>${esc(f.file_id)}</code>`,
      `unique_id: <code>${esc(f.file_unique_id)}</code>`,
    ];
    for (const k of ['file_name', 'mime_type', 'width', 'height', 'duration', 'file_size', 'emoji', 'set_name']) {
      if (f[k] !== undefined) rows.push(`${k}: <code>${esc(f[k])}</code>`);
    }
    try {
      const info = await ctx.telegram.getFile(f.file_id);
      rows.push(`file_path: <code>${esc(info.file_path)}</code>`);
    } catch (e) {
      rows.push(`file_path: ❌ ${esc(e.response?.description || e.message)}`);
    }
    out.push(rows.join('\n'));
  }
  return ctx.replyWithHTML(out.join('\n\n'));
});

// /path a.b.c  (supports negative indexes, e.g. photo.-1)
bot.command('path', (ctx) => {
  const expr = arg(ctx);
  if (!expr) return ctx.reply('Usage: reply to a message and send /path from.id');
  let v = target(ctx);
  for (const k of expr.split(/[.\[\]]+/).filter(Boolean)) {
    v = Array.isArray(v) && /^-\d+$/.test(k) ? v[v.length + Number(k)] : v?.[k];
  }
  if (v === undefined) return ctx.reply('❌ Path not found.');
  return sendRaw(ctx, v);
});

// /chat [id|@username]
bot.command('chat', async (ctx) => {
  let a = arg(ctx) || ctx.chat.id;
  if (/^-?\d+$/.test(String(a))) a = Number(a);
  try {
    const info = await ctx.telegram.getChat(a);
    let count;
    if (info.type !== 'private') {
      count = await ctx.telegram.getChatMemberCount(info.id).catch(() => undefined);
    }
    await sendRaw(ctx, count === undefined ? info : { ...info, _member_count: count });
  } catch (e) {
    await ctx.reply('❌ ' + (e.response?.description || e.message));
  }
});

// /member [id]  (reply, ID, or yourself)
bot.command('member', async (ctx) => {
  const m = ctx.message;
  if (m.chat.type === 'private') return ctx.reply('ℹ️ Use this command in a group or channel.');
  const a = arg(ctx);
  const uid = m.reply_to_message?.from?.id ?? (/^\d+$/.test(a) ? Number(a) : m.from.id);
  try {
    await sendRaw(ctx, await ctx.telegram.getChatMember(m.chat.id, uid));
  } catch (e) {
    await ctx.reply('❌ ' + (e.response?.description || e.message));
  }
});

// /ping
bot.command('ping', async (ctx) => {
  const t = Date.now();
  const sent = await ctx.reply('🏓 Pinging...');
  await ctx.telegram.editMessageText(
    sent.chat.id, sent.message_id, undefined, `🏓 Pong! ${Date.now() - t} ms`
  );
});

// /history [n]  (owner)
bot.command('history', ownerOnly(async (ctx) => {
  const n = Math.min(Math.max(Number(arg(ctx)) || 10, 1), HISTORY_SIZE);
  const data = (await redis.lrange('history', 0, n - 1)).reverse(); // oldest → newest
  return ctx.replyWithDocument(
    { source: Buffer.from(JSON.stringify(data, null, 2), 'utf8'), filename: `history_${data.length}.json` },
    { caption: `🕘 Last ${data.length} updates (kept in Redis, max ${HISTORY_SIZE})` }
  );
}));

// /stats  (owner)
bot.command('stats', ownerOnly(async (ctx) => {
  const [counts, users, since] = await Promise.all([
    redis.hgetall('stats:counts'),
    redis.hlen('settings'),
    redis.get('stats:since'),
  ]);
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((n, [, v]) => n + Number(v), 0);
  const top = entries.map(([k, v]) => `• ${esc(k)}: ${v}`).join('\n') || '• none yet';
  return ctx.replyWithHTML(
    `<b>📊 Stats</b>\nTracking since: ${since ? new Date(Number(since)).toISOString().slice(0, 10) : 'n/a'}\n` +
    `Total updates: ${total}\nUsers with settings: ${users}\nNode: ${process.version}\n\n<b>Updates</b>\n${top}`
  );
}));

// ---------- settings ----------
const settingsView = (cfg) => ({
  text:
    `<b>⚙️ Settings</b>\n\nOutput mode: <b>${cfg.mode}</b>\nScope: <b>${cfg.scope}</b>\n` +
    `Format: <b>${cfg.indent ? 'pretty' : 'compact'}</b>\nGroup auto-dump: <b>${cfg.groups ? 'on' : 'off'}</b>\n\n` +
    `<i>Tap a button to cycle its value.</i>`,
  kb: Markup.inlineKeyboard([
    [Markup.button.callback(`Mode: ${cfg.mode}`, 'cfg:mode'),
     Markup.button.callback(`Scope: ${cfg.scope}`, 'cfg:scope')],
    [Markup.button.callback(`Format: ${cfg.indent ? 'pretty' : 'compact'}`, 'cfg:indent'),
     Markup.button.callback(`Groups: ${cfg.groups ? 'on' : 'off'}`, 'cfg:groups')],
  ]),
});

bot.command('settings', async (ctx) => {
  const v = settingsView(await getCfg(ctx));
  return ctx.replyWithHTML(v.text, v.kb);
});

bot.action(/^cfg:(mode|scope|indent|groups)$/, async (ctx) => {
  const key = ctx.match[1];
  const cfg = await getCfg(ctx);
  const opts = CYCLE[key];
  cfg[key] = opts[(opts.indexOf(cfg[key]) + 1) % opts.length];
  const saved = await saveCfg(ctx).then(() => true, (e) => { console.error('save failed:', e.message); return false; });
  const v = settingsView(cfg);
  await ctx.editMessageText(v.text, { parse_mode: 'HTML', ...v.kb }).catch(() => {});
  await ctx.answerCbQuery(saved ? 'Saved' : 'Save failed').catch(() => {});
});

const setOpt = (key, vals) => async (ctx) => {
  const v = arg(ctx).toLowerCase();
  const cfg = await getCfg(ctx);
  if (!vals.includes(v))
    return ctx.replyWithHTML(`${key}: <b>${cfg[key]}</b>\nOptions: ${vals.join(' | ')}`);
  cfg[key] = v;
  try {
    await saveCfg(ctx);
    return ctx.reply(`✅ ${key} = ${v}`);
  } catch (e) {
    console.error('save failed:', e.message);
    return ctx.reply('❌ Could not save settings. Check the Redis connection.');
  }
};
bot.command('mode', setOpt('mode', CYCLE.mode));
bot.command('scope', setOpt('scope', CYCLE.scope));

// ---------- inline buttons ----------
bot.action('raw:del', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.deleteMessage().catch(() => {});
});
bot.action('raw:file', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const msg = ctx.callbackQuery.message;
  const pre = msg?.entities?.find((e) => e.type === 'pre');
  const text = pre ? msg.text.slice(pre.offset, pre.offset + pre.length) : msg?.text || '';
  await ctx.replyWithDocument(
    { source: Buffer.from(text, 'utf8'), filename: 'raw.json' },
    { caption: '📎 Raw JSON' }
  );
});

// ---------- everything else → raw ----------
const TO_OWNER = new Set([
  'channel_post', 'edited_channel_post',
  'my_chat_member', 'chat_member', 'chat_join_request',
  'message_reaction', 'message_reaction_count',
]);

bot.use(async (ctx) => {
  const u = ctx.update;
  const type = typeOf(u);
  const cfg = await getCfg(ctx);
  const data = cfg.scope === 'update' ? u : inner(u);

  // stop the loading spinner on unknown buttons
  if (u.callback_query) await ctx.answerCbQuery().catch(() => {});

  // channel posts and member/reaction updates → owner's DM
  if (TO_OWNER.has(type)) {
    if (!OWNER) return;
    return sendRaw(ctx, data, { to: OWNER, header: headerFor(type, inner(u)) });
  }

  // no auto-dump in groups unless enabled in /settings
  const t = ctx.chat?.type;
  if (t && t !== 'private' && !cfg.groups) return;

  return sendRaw(ctx, data, { header: type !== 'message' ? headerFor(type, inner(u)) : '' });
});

bot.catch((err, ctx) => console.error(`[${typeOf(ctx.update)}]`, err.message));

module.exports = { bot };
