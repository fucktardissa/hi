// =============================================
// IMPORTS & SETUP
// =============================================
const express = require("express");
const fetch = require("node-fetch");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const { createClient } = require("redis");
const RedisStore = require("connect-redis").default;
const path = require("path");
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
app.use(express.urlencoded({ extended: true }));

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
  BYPASS_ROLE_ID,
  APP_URL,
  SESSION_SECRET,
  REDIS_URL,
  REQUIRED_STATUS_TEXT,
  STATUS_ROLE_ID,
  GHOST_PING_CHANNEL_ID,
  ADMIN_USER_IDS,
  FORCE_STATUS_ROLE_IDS,
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
let logQueue = [];

const redisClient = createClient({ url: REDIS_URL });
redisClient.connect().catch(console.error);

const redisStore = new RedisStore({ client: redisClient, prefix: "sess:" });

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

app.get("/join", (req, res) => {
    const { id } = req.query;
    if (!id) {
        return res.status(400).send("Error: Server ID is missing.");
    }

    req.session.gameInstanceId = id;

    // First, check if the user is already logged in
    if (req.session.user && req.session.user.roles) {
        // Check for bypass role
        if (BYPASS_ROLE_ID && req.session.user.roles.includes(BYPASS_ROLE_ID)) {
            console.log(`Bypass user ${req.session.user.username} found. Redirecting directly to game.`);
            const robloxUrl = `roblox://placeId=${ROBLOX_PLACE_ID}&gameInstanceId=${id}`;
            return res.redirect(robloxUrl);
        }
        
        // If they don't have bypass, send them to the launch page.
        console.log(`Returning user ${req.session.user.username} found. Sending to launch page.`);
        return res.redirect(`/launch.html?id=${id}&placeId=${ROBLOX_PLACE_ID}`);
    }

    // If they are a new user, send them to the Discord login page first.
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
    const userRoles = memberData.roles || [];
    
    req.session.user = {
      id: memberData.user.id,
      username: memberData.user.username,
      roles: userRoles,
    };
    
    if (LOG_CHANNEL_ID) {
        const tier = getUserTier(userRoles);
        const logEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle("Web Link Joined")
            .addFields(
                { name: "User", value: `${memberData.user.username} (${memberData.user.id})`, inline: true },
                { name: "Granted Tier", value: tier, inline: true },
                { name: "Game Instance ID", value: gameInstanceId || "N/A", inline: false }
            )
            .setTimestamp();
        sendLog(logEmbed);
    }
    
    if (BYPASS_ROLE_ID && userRoles.includes(BYPASS_ROLE_ID)) {
      console.log(`Bypass user ${memberData.user.username} logged in. Redirecting directly to game.`);
      const robloxUrl = `roblox://placeId=${ROBLOX_PLACE_ID}&gameInstanceId=${gameInstanceId}`;
      return res.redirect(robloxUrl);
    }
    
    res.redirect(`/launch.html?id=${gameInstanceId}&placeId=${ROBLOX_PLACE_ID}`);

  } catch (error) {
    console.error("Error in callback:", error);
    res.status(500).send("An internal server error occurred.");
  }
});

app.get("/logout", (req, res) => {
    if (LOG_CHANNEL_ID && req.session.user) {
      const logEmbed = new EmbedBuilder()
        .setColor(0xED4245) // Red
        .setTitle("Web Link Logout")
        .addFields({
          name: "User",
          value: `${req.session.user.username} (${req.session.user.id})`,
        })
        .setTimestamp();
      sendLog(logEmbed);
    }
  
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
    GatewayIntentBits.GuildPresences,
  ],
});

client.on('error', (error) => {
    console.error('An error occurred on the Discord client:', error);
});
process.on('unhandledRejection', error => {
	console.error('Unhandled promise rejection:', error);
});

const commands = [
  {
    name: "update-roles",
    description: "Checks your current roles and helps you update your web session.",
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
  new SlashCommandBuilder()
    .setName("unverify-user")
    .setDescription("Logs a user out from their web session, forcing re-verification.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to unverify and log out")
        .setRequired(true),
    )
    .setDMPermission(false),
].map((command) => (command.toJSON ? command.toJSON() : command));

const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

async function sendLog(embed) {
    if (!LOG_CHANNEL_ID) return;
  
    if (!client.isReady()) {
      logQueue.push(embed);
      return;
    }
  
    try {
      const channel = await client.channels.fetch(LOG_CHANNEL_ID);
      if (channel && channel.isTextBased()) {
        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error("Failed to send log message:", error);
    }
}

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
      return "added";
    } catch (error) {
      console.error(`Failed to add role to ${member.user.tag}:`, error);
      return "error";
    }
  } else if (!hasStatus && hasRole) {
    try {
      await member.roles.remove(STATUS_ROLE_ID);
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
  
    const readyEmbed = new EmbedBuilder()
      .setColor(0x57f287) // Green
      .setTitle("✅ Bot Online")
      .setDescription(`Bot has successfully connected to Discord.`)
      .setTimestamp();
    sendLog(readyEmbed);
  
    if (logQueue.length > 0) {
      console.log(`Sending ${logQueue.length} queued log messages...`);
      const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(console.error);
      if (channel && channel.isTextBased()) {
        for (const embed of logQueue) {
          await channel.send({ embeds: [embed] }).catch(console.error);
        }
      }
      logQueue = [];
    }
  
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
    const accessTier = getUserTier(userRoles);

    const replyContent = `I've checked your roles and your current highest access tier is: **${accessTier}**.\n\n` +
                         `To apply any changes, you must first log out of the website to clear your old session.`;

    const logoutButton = new ButtonBuilder()
      .setLabel("Logout & Reset Session")
      .setURL(APP_URL + "/logout")
      .setStyle(ButtonStyle.Link);
    const row = new ActionRowBuilder().addComponents(logoutButton);
    
    await interaction.reply({
      content: replyContent,
      components: [row],
      ephemeral: true,
    });
  } else if (commandName === "status-role") {
    await interaction.deferReply({ ephemeral: true });
    const statusResult = await updateMemberStatusRole(member);
    let replyMessage = "An unexpected error occurred.";
    switch (statusResult) {
      case "added": replyMessage = "Success! The status role has been added to your account."; break;
      case "removed": replyMessage = "The status role has been removed as I could no longer find the required text in your status."; break;
      case "already_has_role": replyMessage = "You already have the status role and the required text in your status."; break;
      case "missing_status": replyMessage = `I could not find "${REQUIRED_STATUS_TEXT}" in your custom status. Please update your status and try again.`; break;
      case "not_configured": replyMessage = "This feature is not fully configured yet."; break;
      case "error": replyMessage = "An error occurred while trying to update your roles."; break;
    }
    await interaction.editReply({ content: replyMessage });

  } else if (commandName === "force-status-role") {
    const authorizedRoleIds = (FORCE_STATUS_ROLE_IDS || "").split(",").filter(id => id.trim() !== "");
    const hasAuthorizedRole = member.roles.cache.some(r => authorizedRoleIds.includes(r.id));
    const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (!hasAuthorizedRole && !isAdmin) {
      return interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const targetUser = interaction.options.getUser("user");
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return interaction.editReply({ content: "Could not find that user in this server." });
    }
    const statusResult = await updateMemberStatusRole(targetMember);
    let replyMessage = `An unexpected error occurred while checking ${targetUser.tag}.`;
    switch (statusResult) {
      case "added": replyMessage = `Success! The status role has been added to **${targetUser.tag}**.`; break;
      case "removed": replyMessage = `The status role has been removed from **${targetUser.tag}**.`; break;
      case "already_has_role": replyMessage = `**${targetUser.tag}** already has the status role.`; break;
      case "missing_status": replyMessage = `**${targetUser.tag}** does not have the required status. Role not added.`; break;
      case "not_configured": replyMessage = "This feature is not fully configured yet."; break;
      case "error": replyMessage = `An error occurred while updating roles for **${targetUser.tag}**.`; break;
      case "is_bot": replyMessage = `I cannot check the status of a bot, **${targetUser.tag}**.`; break;
    }
    await interaction.editReply({ content: replyMessage });

  } else if (commandName === "blacklist-user" || commandName === "unblacklist-user") {
    const allowedUserIds = (ADMIN_USER_IDS || "").split(",").filter((id) => id.trim() !== "");
    if (!allowedUserIds.includes(user.id)) {
      return interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
    }
    if (!BLACKLISTED_ROLE_ID) {
      return interaction.reply({ content: "Error: The `BLACKLISTED_ROLE_ID` has not been configured.", ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const targetUser = interaction.options.getUser("user");
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return interaction.editReply({ content: "Could not find that user in this server." });
    }
    if (commandName === "blacklist-user") {
        const reason = interaction.options.getString("reason") || "No reason provided.";
        try {
            await targetMember.roles.add(BLACKLISTED_ROLE_ID);
            await interaction.editReply(`Successfully blacklisted **${targetUser.tag}**.`);
            const logEmbed = new EmbedBuilder().setColor(0xed4245).setTitle("User Blacklisted").addFields(
                { name: "Target User", value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                { name: "Moderator", value: `${user.tag} (${user.id})`, inline: true },
                { name: "Reason", value: reason }
            ).setTimestamp();
            await sendLog(logEmbed);
        } catch (error) {
            console.error("Failed to apply blacklist role:", error);
            await interaction.editReply({ content: "I failed to apply the blacklist role." });
        }
    } else { // unblacklist-user
        if (!targetMember.roles.cache.has(BLACKLISTED_ROLE_ID)) {
            return interaction.editReply({ content: `**${targetUser.tag}** is not currently blacklisted.` });
        }
        try {
            await targetMember.roles.remove(BLACKLISTED_ROLE_ID);
            await interaction.editReply(`Successfully unblacklisted **${targetUser.tag}**.`);
            const logEmbed = new EmbedBuilder().setColor(0x57f287).setTitle("User Unblacklisted").addFields(
                { name: "Target User", value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                { name: "Moderator", value: `${user.tag} (${user.id})`, inline: true }
            ).setTimestamp();
            await sendLog(logEmbed);
        } catch (error) {
            console.error("Failed to remove blacklist role:", error);
            await interaction.editReply({ content: "I failed to remove the blacklist role." });
        }
    }
  } else if (commandName === "unverify-user") {
    const allowedUserIds = (ADMIN_USER_IDS || "").split(",").filter((id) => id.trim() !== "");
    if (!allowedUserIds.includes(user.id)) {
      return interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });
    const targetUser = interaction.options.getUser("user");

    let sessionsDeleted = 0;
    try {
      for await (const key of redisClient.scanIterator({ MATCH: "sess:*" })) {
        const sessionDataString = await redisClient.get(key);
        if (sessionDataString) {
          try {
            const sessionData = JSON.parse(sessionDataString);
            if (sessionData.user && sessionData.user.id === targetUser.id) {
              await redisClient.del(key);
              sessionsDeleted++;
            }
          } catch (e) {
            console.warn(`Could not parse session data for key ${key}.`);
          }
        }
      }

      if (sessionsDeleted > 0) {
        await interaction.editReply(
          `Successfully deleted **${sessionsDeleted}** web session(s) for **${targetUser.tag}**. They will be required to log in again.`,
        );
        const logEmbed = new EmbedBuilder()
          .setColor(0xfeb842)
          .setTitle("User Session Cleared (Unverified)")
          .addFields(
            { name: "Target User", value: `${targetUser.tag} (${targetUser.id})`, inline: true },
            { name: "Moderator", value: `${user.tag} (${user.id})`, inline: true },
          )
          .setTimestamp();
        await sendLog(logEmbed);
      } else {
        await interaction.editReply(
          `No active web sessions were found for **${targetUser.tag}**. No action was needed.`,
        );
      }
    } catch (error) {
      console.error("Error during unverify command:", error);
      await interaction.editReply("An error occurred while trying to access the session store.");
    }
  }
});

// =============================================
//  START EVERYTHING
// =============================================
app.listen(3000, () => console.log("Web server is running on port 3000!"));
client.login(DISCORD_BOT_TOKEN);
