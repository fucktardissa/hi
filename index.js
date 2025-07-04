// =============================================
// IMPORTS & SETUP
// =============================================
const express = require("express");
const fetch = require("node-fetch");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const { createClient } = require("redis");
const RedisStore = require("connect-redis").default;

// All discord.js code is commented out
/*
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType,
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder,
} = require("discord.js");
*/

const app = express();
app.set("trust proxy", 1);

// =============================================
//  LOAD SECRETS
// =============================================
const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_GUILD_ID,
  // ... other variables
  BLACKLISTED_ROLE_ID,
  APP_URL,
  SESSION_SECRET,
  REDIS_URL,
} = process.env;

console.log(`[STARTUP] The APP_URL is currently set to: ${APP_URL}`);

const ROLES = {
  DONATOR: process.env.DONATOR_ROLE_ID,
  BOOSTER: process.env.BOOSTER_ROLE_ID,
  LEVEL_15: process.env.LEVEL_15_ROLE_ID,
  MEMBER: process.env.MEMBER_ROLE_ID,
};

// =============================================
//  EXPRESS WEB SERVER SETUP
// =============================================
const redisClient = createClient({
    url: REDIS_URL
});
redisClient.connect().catch(console.error);

const redisStore = new RedisStore({
    client: redisClient,
    prefix: "sess:",
});

app.use(cookieParser());
app.use(
  session({
    store: redisStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      sameSite: "none",
    },
  }),
);
app.use(express.static(__dirname));

// --- WEB FUNCTIONS & ROUTES ---
function getUserTier(userRoles = []) {
  if (!Array.isArray(userRoles)) return "Denied";
  if (userRoles.includes(BLACKLISTED_ROLE_ID)) return "Denied";
  if (userRoles.includes(ROLES.DONATOR)) return "Donator";
  if (userRoles.includes(ROLES.BOOSTER)) return "Booster";
  if (userRoles.includes(ROLES.LEVEL_15)) return "Level15";
  if (userRoles.includes(ROLES.MEMBER)) return "Member";
  return "Denied";
}

function getPageForTier(tier) {
  const tierPageMap = {
    Donator: "donator.html",
    Booster: "booster.html",
    Level15: "level15.html",
    Member: "member.html",
    Denied: "denied.html",
  };
  return tierPageMap[tier] || "denied.html";
}

// ⭐️ MODIFIED /join ROUTE
app.get("/join", (req, res) => {
    // This will now show a maintenance message instead of trying to contact Discord.
    res.status(503).send(
        '<body style="background-color:#2f3136;color:white;font-family:sans-serif;text-align:center;padding-top:50px;"><h1>Login Temporarily Disabled</h1><p>The login service is temporarily unavailable due to a rate limit from Discord. Please try again in a few hours.</p></body>'
    );
});

// The /callback route can stay, it just won't be used while /join is disabled.
app.get("/callback", async (req, res) => {
  // ... (callback code remains here)
});


app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).send("Could not log you out.");
    res.send(
      '<body style="background-color:#2f3136;color:white;font-family:sans-serif;text-align:center;padding-top:50px;"><h1>You have been logged out successfully.</h1></body>',
    );
  });
});

// All discord.js bot code is commented out.

// =============================================
//  START EVERYTHING
// =============================================
app.listen(3000, () => console.log("Web server is running on port 3000!"));

// client.login is commented out.
