const crypto = require('crypto');

const TOKEN = process.env.BOT_TOKEN;

// first ID = owner; empty list = everyone allowed
const ALLOWED = (process.env.ALLOWED_IDS || '')
  .split(',').map((s) => Number(s.trim())).filter(Boolean);
const OWNER = ALLOWED[0];

// protects /api/setup
const SETUP_KEY = process.env.SETUP_KEY || '';

// Telegram sends this in a header with every webhook call.
// Derived from the bot token unless you set WEBHOOK_SECRET yourself.
const WEBHOOK_SECRET =
  process.env.WEBHOOK_SECRET ||
  (TOKEN ? crypto.createHash('sha256').update('webhook:' + TOKEN).digest('hex').slice(0, 48) : '');

const COMMANDS = [
  { command: 'raw', description: 'Raw JSON of the replied message' },
  { command: 'file', description: 'Send raw JSON as a file' },
  { command: 'summary', description: 'Readable message overview' },
  { command: 'entities', description: 'List message entities' },
  { command: 'fileinfo', description: 'File details of replied media' },
  { command: 'path', description: 'Extract one field (e.g. from.id)' },
  { command: 'id', description: 'User / chat / message IDs' },
  { command: 'chat', description: 'Full chat info' },
  { command: 'member', description: 'Chat member info' },
  { command: 'settings', description: 'Settings panel' },
  { command: 'mode', description: 'auto | text | file' },
  { command: 'scope', description: 'message | update' },
  { command: 'ping', description: 'Latency check' },
  { command: 'help', description: 'Help menu' },
];

const ALLOWED_UPDATES = [
  'message', 'edited_message', 'channel_post', 'edited_channel_post',
  'callback_query', 'my_chat_member', 'chat_member', 'chat_join_request',
  'message_reaction', 'message_reaction_count',
];

module.exports = { TOKEN, ALLOWED, OWNER, SETUP_KEY, WEBHOOK_SECRET, COMMANDS, ALLOWED_UPDATES };
