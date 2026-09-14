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
  /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/(@?[A-Za-z0-9_]{1,15})(?=[/?#\s]|$)/i;

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
  const match = text.match(PROFILE_URL_REGEX);
  if (!match) return null;
  const handle = match[1].replace(/^@/, "");
  if (RESERVED_PATHS.has(handle.toLowerCase())) return null;
  return handle;
}

function formatCount(n) {
  if (n === null || n === undefined) return "N/A";
  return n.toLocaleString("en-US");
}

async function fetchProfile(username) {
  const response = await axios.get("https://api.twitterapi.io/twitter/user/info", {
    params: { userName: username },
    headers: { "X-API-Key": TWITTERAPI_KEY },
    timeout: 15000,
  });
  return response.data;
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Send me an X (Twitter) profile link — e.g. https://x.com/OGMA_AI — and I'll reply with its follower count."
  );
});

bot.on("message", async (msg) => {
  const text = msg.text;
  if (!text || text.startsWith("/start")) return;

  const username = extractUsername(text);
  if (!username) return; // silently ignore unrelated messages

  const chatId = msg.chat.id;
  let statusMsg;
  try {
    statusMsg = await bot.sendMessage(chatId, `Looking up @${username}...`);
  } catch (e) {
    // ignore, continue anyway
  }

  try {
    const data = await fetchProfile(username);

    // twitterapi.io wraps the profile under `data`, with a `status`/`msg` envelope.
    const profile = data && (data.data || data);
    if (!profile || (data.status && data.status !== "success") || !profile.userName) {
      throw new Error("not_found");
    }

    const followers = profile.followers ?? profile.followers_count ?? null;
    const following = profile.following ?? profile.friends_count ?? null;
    const displayName = profile.name || username;
    const verified = profile.isBlueVerified || profile.verified ? " \u2705" : "";

    const reply =
      `*${displayName}*${verified} (@${profile.userName})\n` +
      `Followers: *${formatCount(followers)}*\n` +
      (following !== null ? `Following: ${formatCount(following)}\n` : "");

    if (statusMsg) {
      await bot.editMessageText(reply, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: "Markdown",
      });
    } else {
      await bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
    }
  } catch (err) {
    const notFound =
      err.message === "not_found" ||
      err.response?.status === 404 ||
      err.response?.data?.status === "error";

    const errorText = notFound
      ? `Couldn't find an X account @${username}. Double check the link.`
      : `Something went wrong fetching @${username}. Try again in a moment.`;

    if (!notFound) {
      console.error("twitterapi.io error:", err.response?.data || err.message);
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
});

bot.on("polling_error", (err) => {
  console.error("Polling error:", err.message);
});

console.log("Bot is running...");
