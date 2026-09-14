# # X Followers Telegram Bot

Paste an X (Twitter) profile link into the chat, and the bot replies with that account's follower count — powered by [twitterapi.io](https://twitterapi.io).

## How it works

1. You send a message containing a link like `https://x.com/OGMA_AI` (or `twitter.com/...`).
2. The bot extracts the username and queries twitterapi.io's `/twitter/user/info` endpoint.
3. It replies with the display name, follower count, and following count.

Messages without an X/Twitter link are ignored, so you can drop the bot into a group chat (like the one your alert bot posts to) and it'll only react to relevant links.

## Local setup

```bash
npm install
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN and TWITTERAPI_IO_KEY in .env
npm start
```

To load `.env` locally you'll need something like `node -r dotenv/config bot.js`, or just export the variables in your shell — Railway injects them directly so the bot itself doesn't depend on the `dotenv` package.

## Getting your credentials

- **Telegram bot token**: message [@BotFather](https://t.me/BotFather) on Telegram, run `/newbot`, follow the prompts.
- **twitterapi.io key**: sign up at [twitterapi.io](https://twitterapi.io), grab your API key from the dashboard. New accounts get a small free credit balance.

## Deploying on Railway

1. Push this repo to GitHub.
2. In Railway, click **New Project → Deploy from GitHub repo** and pick this repo.
3. Railway auto-detects Node.js and runs `npm install` then `npm start` (from `package.json`).
4. Go to your service's **Variables** tab and add:
   - `TELEGRAM_BOT_TOKEN`
   - `TWITTERAPI_IO_KEY`
5. Deploy. Check the **Deploy Logs** — you should see `Bot is running...`.

No public URL or webhook setup is needed — the bot uses long polling, so it just needs to be running continuously, which Railway handles.

## Notes / things to keep in mind

- twitterapi.io is an **unofficial** third-party API, not affiliated with X. It's cheap and generally reliable, but could break if X changes anti-scraping measures — the bot fails gracefully with an error message rather than crashing if a lookup fails.
- If you hit rate limits or run out of credits, the bot will show a generic error; check your twitterapi.io dashboard for balance/usage.
- Only usernames 1–15 characters (X's max handle length) are matched, and non-profile paths like `/home`, `/search`, `/i/...` are filtered out so they don't get mistaken for usernames.
