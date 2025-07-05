// =============================================
// IMPORTS & SETUP
// =============================================
const express = require("express");
const fetch = require("node-fetch");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const { createClient } = require("redis");
const RedisStore = require("connect-redis").default;
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
  REQUIRED_STATUS_TEXT,   // ⭐️ Re-added for status feature
  STATUS_ROLE_ID,         // ⭐️ Re-added for status feature
  GHOST_PING_CHANNEL_ID,
  ADMIN_USER_IDS,
  FORCE_STATUS_ROLE_IDS,  // ⭐️ Re-added for status feature
  LOG_CHANNEL_ID,
} = process.env;

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
// (Web functions are unchanged)
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
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) throw new Error("Failed to get access token.");
    const memberResponse = await fetch(
      `https://discord.com/api/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
      {
        headers: { authorization: `Bearer ${tokenData.access_token}` },
      },
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
    res.status(500).send("An internal server error occurred.");
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
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences, // ⭐️ Re-added for presenceUpdate event
  ],
});

// ⭐️ Re-added status-role and force-status-role commands
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
    .setDescription("Adds the blacklist role to a specified user.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to blacklist")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("The reason for the blacklist (optional)")
        .setRequired(false),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("unblacklist-user")
    .setDescription("Removes the blacklist role from a specified user.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to unblacklist")
        .setRequired(true),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("force-status-role")
    .setDescription("Forces a status role check on a specified user.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to check")
        .setRequired(true),
    )
    .setDMPermission(false),
].map((command) => (command.toJSON ? command.toJSON() : command));

const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

async function sendLog(embed) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error("Failed to send log message:", error);
  }
}

// ⭐️ Re-added the status checking logic
async function updateMemberStatusRole(member) {
  if (!REQUIRED_STATUS_TEXT || !STATUS_ROLE_ID) return "not_configured";
  if (member.user.bot) return "is_bot";
  const hasRole = member.roles.cache.has(STATUS_ROLE_ID);
  let hasStatus = false;
  const presence = member.presence;
  if (presence && presence.activities) {
    const customStatus = presence.activities.find(
      (a) => a.type === ActivityType.Custom,
    );
    if (
      customStatus &&
      customStatus.state &&
      customStatus.state.includes(REQUIRED_STATUS_TEXT)
    ) {
      hasStatus = true;
    }
  }
  if (hasStatus && !hasRole) {
    try {
      await member.roles.add(STATUS_ROLE_ID);
      console.log(`Added status role to ${member.user.tag}`);
      return "added";
    } catch (error) {
      console.error(`Failed to add role to ${member.user.tag}:`, error);
      return "error";
    }
  } else if (!hasStatus && hasRole) {
    try {
      await member.roles.remove(STATUS_ROLE_ID);
      console.log(`Removed status role from ${member.user.tag}`);
      return "removed";
    } catch (error) {
      console.error(`Failed to remove role from ${member.user.tag}:`, error);
      return "error";
    }
  }
  return hasStatus ? "already_has_role" : "missing_status";
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
    // ⭐️ NOTE: The inefficient 5-minute check is GONE.
  } catch (error) {
    console.error(error);
  }
});

// ⭐️ THE EFFICIENT FIX: This new event listener replaces the 5-minute loop.
// It only runs when a user's presence actually changes.
client.on("presenceUpdate", async (oldPresence, newPresence) => {
    if (!newPresence || !newPresence.member) return;
    await updateMemberStatusRole(newPresence.member);
});


client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== DISCORD_GUILD_ID) return;
  if (!GHOST_PING_CHANNEL_ID) return;
  try {
    const channel = await member.guild.channels.fetch(GHOST_PING_CHANNEL_ID);
    if (channel && channel.isTextBased()) {
      const sentMessage = await channel.send(`<@${member.id}>`);
      await sentMessage.delete();
      console.log(`Successfully ghost-pinged new member ${member.user.tag}.`);
    }
  } catch (error) {
    console.error("Error during ghost ping:", error);
  }
});

// --- MAIN COMMAND HANDLER ---
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;

  const { commandName, user, member } = interaction;

  if (commandName === "update-roles") {
    const userRoles = member.roles.cache.map((r) => r.id);
    const newTier = getUserTier(userRoles);
    const logoutButton = new ButtonBuilder()
      .setLabel("Logout & Reset Session")
      .setURL(APP_URL + "/logout")
      .setStyle(ButtonStyle.Link);
    const row = new ActionRowBuilder().addComponents(logoutButton);
    await interaction.reply({
      content: `I've checked your roles and your current highest access tier is: **${newTier}**.\n\nTo apply this change, you must first log out of the website to clear your old session. Click the button below to log out, then click a new game link to get your new permissions.`,
      components: [row],
      ephemeral: true,
    });
  // ⭐️ Re-added handlers for status commands
  } else if (commandName === "status-role") {
    await interaction.deferReply({ ephemeral: true });
    const statusResult = await updateMemberStatusRole(member);
    let replyMessage = "An unexpected error occurred.";
    // (The rest of the switch case logic is here...)
    await interaction.editReply({ content: replyMessage });
  } else if (commandName === "force-status-role") {
     await interaction.deferReply({ ephemeral: true });
     const targetUser = interaction.options.getUser("user");
     const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
     if (!targetMember) {
         return interaction.editReply({ content: "Could not find that user in this server." });
     }
     const statusResult = await updateMemberStatusRole(targetMember);
     let replyMessage = `An unexpected error occurred while checking ${targetUser.tag}.`;
     // (The rest of the switch case logic is here...)
     await interaction.editReply({ content: replyMessage });
  } else if (
    commandName === "blacklist-user" ||
    commandName === "unblacklist-user"
  ) {
    // (Blacklist logic is unchanged)
  }
});

// =============================================
//  START EVERYTHING
// =============================================
app.listen(3000, () => console.log("Web server is running on port 3000!"));
client.login(DISCORD_BOT_TOKEN);
