// =============================================
// IMPORTS & SETUP
// =============================================
const express = require("express");
const fetch = require("node-fetch");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const { createClient } = require("redis");
const RedisStore = require("connect-redis").default;

// All discord.js code is commented out.

const app = express();
app.set("trust proxy", 1);

// =============================================
//  LOAD SECRETS
// =============================================
const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_GUILD_ID,
  ROBLOX_PLACE_ID,
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
    const { id } = req.query;
    const placeId = ROBLOX_PLACE_ID;

    // This makes sure both pieces of info are present before redirecting.
    if (!id || !placeId) {
        return res.status(400).send("<h1>ERROR: Missing server or place information.</h1>");
    }

    // This redirects the user to your down.html page and, crucially,
    // passes along the id and placeId so your script in that file can use them.
    res.redirect(`/down.html?id=${id}&placeId=${placeId}`);
});


// The /callback route will not be used, but we can leave it for when you re-enable logins.
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
      '<body style="background-color:#2f3136;color:white;font-family:sans-serif;text-align:center;padding-top:50px;"><h1>You have been logged out successfully.</h1></body>',
    );
  });
});

// All discord.js bot code is commented out.

// =============================================
//  START EVERYTHING
// =============================================
app.listen(3000, () => console.log("Web server is running on port 3000!"));
