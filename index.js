// =============================================
// IMPORTS & SETUP
// =============================================
const express = require("express");
const fetch = require("node-fetch");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const { createClient } = require("redis");
const RedisStore = require("connect-redis").default;

/* ⭐️ BOT Disabler: The entire discord.js block is commented out.
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
  DISCORD_BOT_TOKEN,
  ROBLOX_PLACE_ID,
  DONATOR_ROLE_ID,
  BOOSTER_ROLE_ID,
  LEVEL_15_ROLE_ID,
  MEMBER_ROLE_ID,
  BLACKLISTED_ROLE_ID,
  APP_URL,
  SESSION_SECRET,
  REDIS_URL,
  REQUIRED_STATUS_TEXT,
  STATUS_ROLE_ID,
  GHOST_PING_CHANNEL_ID,
  ADMIN_USER_IDS,
  ADMIN_USERNAMES,
  FORCE_STATUS_ROLE_IDS,
  LOG_CHANNEL_ID,
} = process.env;

console.log(`[STARTUP] The APP_URL is currently set to: ${APP_URL}`);

const ROLES = {
  DONATOR: DONATOR_ROLE_ID,
  BOOSTER: BOOSTER_ROLE_ID,
  LEVEL_15: LEVEL_15_ROLE_ID,
  MEMBER: MEMBER_ROLE_ID,
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

app.get("/join", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).send("Error: Server ID is missing.");
  req.session.gameInstanceId = id;

  if (req.session.user && req.session.user.roles) {
    const tier = getUserTier(req.session.user.roles);
    const page = getPageForTier(tier);
    return res.redirect(`/${page}?id=${id}&placeId=${ROBLOX_PLACE_ID}`);
  }
  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(APP_URL + "/callback")}&response_type=code&scope=identify%20guilds.members.read`;
  res.redirect(discordAuthUrl);
});

app.get("/callback", async (req, res) => {
  const { code } = req.query;
  const gameInstanceId = req.session.gameInstanceId;
  if (!code || !gameInstanceId)
    return res.status(400).send("Error: Session invalid or login failed.");

  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: APP_URL + "/callback",
      }),
      headers: { "Content-Type": "application/x-w ww-form-urlencoded" },
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      throw new Error(`Discord API Error (${tokenResponse.status}): ${errorBody}`);
    }

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
        throw new Error("Failed to get access token, tokenData from Discord is empty.");
    }
    
    const memberResponse = await fetch(
      `https://discord.com/api/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
      {
        headers: { authorization: `Bearer ${tokenData.access_token}` },
      }
    );
    const memberData = await memberResponse.json();
    req.session.user = {
      id: memberData.user.id,
      username: memberData.user.username,
      roles: memberData.roles || [],
    };
    const tier = getUserTier(req.session.user.roles);
    const page = getPageForTier(tier);
    res.redirect(`/${page}?id=${gameInstanceId}&placeId=${ROBLOX_PLACE_ID}`);

  } catch (error) {
    console.error("Error in callback:", error); 
    res.status(500).send("An internal server error occurred. Check the bot's logs for details.");
  }
});


app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).send("Could not log you out.");
    res.send(
      '<body style="background-color:#2f3136;color:white;font-family:sans-serif;text-align:center;padding-top:50px;"><h1>You have been logged out successfully.</h1><p>You can now close this tab. To get your new roles, please click a new game link.</p></body>',
    );
  });
});

// =============================================
//  DISCORD.JS BOT SETUP
// =============================================

/* ⭐️ BOT Disabler: The entire Discord bot logic is commented out.

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences, // Required for status checks
  ],
});

const commands = [
  {
    name: "update-roles",
    description:
      "Checks your current roles and helps you update your web session.",
  },
  {
    name: "status-role",
    description: "Manually checks your status and assigns the status role.",
  },
  new SlashCommandBuilder()
    .setName("blacklist-user")
    // ... (and all other commands)
].map((command) => (command.toJSON ? command.toJSON() : command));

const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

async function sendLog(embed) {
    //...
}

async function updateMemberStatusRole(member) {
    //...
}


client.on("ready", async () => {
  console.log(`Discord bot logged in as ${client.user.tag}!`);
  try {
    console.log("Started refreshing application (/) commands.");
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
      { body: commands },
    );
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
});

client.on("presenceUpdate", async (oldPresence, newPresence) => {
    if (!newPresence.member || newPresence.member.user.bot) return;
    await updateMemberStatusRole(newPresence.member);
});

client.on("guildMemberAdd", async (member) => {
    //...
});

client.on("interactionCreate", async (interaction) => {
    //...
});

*/


// =============================================
//  START EVERYTHING
// =============================================
app.listen(3000, () => console.log("Web server is running on port 3000!"));

// ⭐️ BOT Disabler: This line is commented out to prevent the bot from trying to log in.
// client.login(DISCORD_BOT_TOKEN);
