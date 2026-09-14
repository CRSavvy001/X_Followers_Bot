const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TWITTERAPI_KEY = process.env.TWITTERAPI_IO_KEY;

if (!TELEGRAM_TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN environment variable.");
  process.exit(1);
}
if (!TWITTERAPI_KEY) {
  console.error("Missing TWITTERAPI_IO_KEY environment variable.");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Matches x.com/handle or twitter.com/handle, with optional query params/trailing slash,
// and ignores non-profile paths like /home, /i/..., /search etc.
const PROFILE_URL_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/(@?[A-Za-z0-9_]{1,15})(?=[/?#)\]}>,.!;:\s]|$)/i;

const RESERVED_PATHS = new Set([
  "home",
  "i",
  "search",
  "explore",
  "notifications",
  "messages",
  "settings",
  "compose",
  "intent",
  "share",
  "hashtag",
]);

function extractUsername(text) {
  if (!text) return null;
  const match = text.match(PROFILE_URL_REGEX);
  if (!match) return null;
  const handle = match[1].replace(/^@/, "");
  if (RESERVED_PATHS.has(handle.toLowerCase())) return null;
  return handle;
}

// Gathers every place a link could be hiding in a message: the plain text/caption,
// plus any inline hyperlink entities where the displayed label differs from the URL
// (e.g. a "View chart" link whose visible text isn't the raw URL).
function findUsernameInMessage(msg) {
  const text = msg.text || msg.caption || "";
  const direct = extractUsername(text);
  if (direct) return direct;

  const entities = msg.entities || msg.caption_entities || [];
  for (const entity of entities) {
    if (entity.type === "text_link" && entity.url) {
      const fromEntity = extractUsername(entity.url);
      if (fromEntity) return fromEntity;
    }
  }
  return null;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatCount(n) {
  if (n === null || n === undefined) return "N/A";
  return n.toLocaleString("en-US");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// twitterapi.io free tier allows 1 request every 5 seconds — pad slightly for safety.
const REQUEST_GAP_MS = 5500;
let queueTail = Promise.resolve();

function enqueue(fn) {
  const result = queueTail.then(fn, fn);
  queueTail = result.catch(() => {}).then(() => sleep(REQUEST_GAP_MS));
  return result;
}

async function fetchProfile(username, attempt = 0) {
  try {
    const response = await axios.get("https://api.twitterapi.io/twitter/user/info", {
      params: { userName: username },
      headers: { "X-API-Key": TWITTERAPI_KEY },
      timeout: 15000,
    });
    return response.data;
  } catch (err) {
    const status = err.response?.status;
    const retryable = status === 429 || (status >= 500 && status < 600) || !status;
    if (retryable && attempt < 3) {
      const backoff = status === 429 ? 5500 * (attempt + 1) : 1000 * Math.pow(2, attempt);
      console.warn(
        `twitterapi.io request for @${username} failed (status ${status || "network error"}), retrying in ${backoff}ms...`
      );
      await sleep(backoff);
      return fetchProfile(username, attempt + 1);
    }
    throw err;
  }
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Send me an X (Twitter) profile link — e.g. https://x.com/OGMA_AI — and I'll reply with its follower count."
  );
});

// Many scanner/alert bots post a message and then edit it repeatedly (adding the
// X link only in a later edit). Telegram delivers edits as `edited_message`, not
// `message`, so we listen to both. We dedupe per (chat, message_id, username) so
// an alert that keeps getting edited afterward doesn't trigger repeat replies.
const processedKeys = new Set();

async function handleIncomingMessage(msg) {
  const rawText = msg.text || "";
  if (rawText.startsWith("/start")) return;

  const username = findUsernameInMessage(msg);
  if (!username) return; // silently ignore unrelated messages

  const chatId = msg.chat.id;
  const dedupeKey = `${chatId}:${msg.message_id}:${username.toLowerCase()}`;
  if (processedKeys.has(dedupeKey)) return;
  processedKeys.add(dedupeKey);

  let statusMsg;
  try {
    statusMsg = await bot.sendMessage(chatId, `Looking up @${username}...`);
  } catch (e) {
    // ignore, continue anyway
  }

  try {
    const data = await enqueue(() => fetchProfile(username));

    // twitterapi.io wraps the profile under `data`, with a `status`/`msg` envelope.
    const profile = data && (data.data || data);
    if (!profile || (data.status && data.status !== "success") || !profile.userName) {
      throw new Error("not_found");
    }

    const followers = profile.followers ?? profile.followers_count ?? null;
    const following = profile.following ?? profile.friends_count ?? null;
    const displayName = escapeHtml(profile.name || username);
    const verified = profile.isBlueVerified || profile.verified ? " \u2705" : "";
    const profileUrl = `https://x.com/${profile.userName}`;

    const reply =
      `<b>${displayName}</b>${verified} <a href="${profileUrl}">${profileUrl}</a>\n` +
      `Followers: <b>${formatCount(followers)}</b>\n` +
      (following !== null ? `Following: ${formatCount(following)}\n` : "");

    if (statusMsg) {
      await bot.editMessageText(reply, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: "HTML",
      });
    } else {
      await bot.sendMessage(chatId, reply, { parse_mode: "HTML" });
    }
  } catch (err) {
    const notFound =
      err.message === "not_found" ||
      err.response?.status === 404 ||
      err.response?.data?.status === "error";
    const rateLimited = err.response?.status === 429;

    const errorText = notFound
      ? `Couldn't find an X account @${username}. Double check the link.`
      : rateLimited
      ? `Hit a rate limit fetching @${username} after several retries. Try again shortly.`
      : `Something went wrong fetching @${username}. Try again in a moment.`;

    if (!notFound) {
      console.error(
        `twitterapi.io error for @${username} (status ${err.response?.status || "n/a"}):`,
        err.response?.data || err.message
      );
    }

    if (statusMsg) {
      await bot.editMessageText(errorText, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      });
    } else {
      await bot.sendMessage(chatId, errorText);
    }
  }
}

bot.on("message", handleIncomingMessage);
bot.on("edited_message", handleIncomingMessage);

bot.on("polling_error", (err) => {
  console.error("Polling error:", err.message);
});

console.log("Bot is running...");
