# Telegram Raw Inspector Bot (Vercel + Upstash Redis)

Send any message to the bot and it replies with the raw JSON.
The Vercel domain shows a status page (bot, webhook, Redis, update counts).
User settings, stats and `/history` live in Upstash Redis.

## Files

```
api/webhook.js    Telegram sends updates here
api/setup.js      one-time: connects the webhook + sets bot commands
api/status.js     JSON used by the web page
lib/bot.js        the bot (all commands)
lib/config.js     env vars, command list
lib/store.js      Upstash Redis client
public/index.html status web page
```

## Deploy

1. Upload this folder to a GitHub repo.
2. Vercel → Add New → Project → import the repo → Deploy.
3. Create a free database at upstash.com (Redis). Copy the REST URL and REST token.
   (Or add Upstash from Vercel's Marketplace, which fills the variables for you.)
4. Vercel → Settings → Environment Variables:

| Name | Value |
|---|---|
| `BOT_TOKEN` | token from @BotFather |
| `ALLOWED_IDS` | `123,456` (first = owner). Empty = everyone |
| `SETUP_KEY` | any long random text |
| `UPSTASH_REDIS_REST_URL` | from Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | from Upstash |

5. Redeploy (Deployments → ⋯ → Redeploy) so the variables apply.
6. Open once: `https://YOUR-APP.vercel.app/api/setup?key=YOUR_SETUP_KEY`
   It should answer `{"ok":true,...}`.
7. Open `https://YOUR-APP.vercel.app` to see the status page, then message your bot.

Use the production domain for step 6. Preview URLs can be protected by Vercel login, and Telegram cannot pass that.
Run step 6 again if you ever change the domain.

## Notes

- Free Upstash databases are archived after a long period without use. Your bot keeps it active.
- `/history` stores the last 50 updates (including message content) in your Redis database.
- Each update costs about 5 to 6 Redis commands, so the free 500K monthly commands covers roughly 80K updates.
- Local test of the code: `npm i`, then `vercel dev`.
# teleraw
