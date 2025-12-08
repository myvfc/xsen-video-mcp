import express from "express";
import cors from "cors";
import fetch from "node-fetch";

/* -------------------------------------------------------------------------- */
/*                               EXPRESS SETUP                                */
/* -------------------------------------------------------------------------- */

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(".")); // required so manifest.json is served

/* -------------------------------------------------------------------------- */
/*                          PORT (Railway Compatible)                         */
/* -------------------------------------------------------------------------- */

const PORT = process.env.PORT ?? 8080;

/* -------------------------------------------------------------------------- */
/*                            ENVIRONMENT VARIABLES                           */
/* -------------------------------------------------------------------------- */

const VIDEOS_URL =
  process.env.VIDEOS_URL ||
  "https://raw.githubusercontent.com/myvfc/video-db/main/videos.json";

const PLAYER_BASE = process.env.XSEN_PLAYER_URL || "https://player.xsen.fun";

let videoDB = [];

/* -------------------------------------------------------------------------- */
/*                            LOAD videos.json                                */
/* -------------------------------------------------------------------------- */

async function loadVideos() {
  console.log("📡 Fetching videos.json…");
  try {
    const res = await fetch(VIDEOS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    videoDB = json;
    console.log(`✅ Loaded ${videoDB.length} videos`);
  } catch (err) {
    console.error("❌ Failed to load videos:", err.message);
  }
}

/* -------------------------------------------------------------------------- */
/*                                HEALTHCHECK                                 */
/* -------------------------------------------------------------------------- */

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "XSEN Video MCP",
    videos: videoDB.length,
    uptime: process.uptime(),
  });
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/* -------------------------------------------------------------------------- */
/*                            KEEP-ALIVE HEARTBEAT                             */
/* -------------------------------------------------------------------------- */

setInterval(async () => {
  try {
    const response = await fetch(`http://localhost:${PORT}/health`);
    console.log("💓 Keep-alive ping:", response.ok ? "OK" : "FAILED");
  } catch (err) {
    console.log("💓 Keep-alive ping failed (server might be starting)");
  }
}, 5 * 60 * 1000);

/* -------------------------------------------------------------------------- */
/*                            HELPER: EXTRACT VIDEO ID                         */
/* -------------------------------------------------------------------------- */

function extractVideoId(url = "") {
  if (!url) return "";
  if (url.includes("v=")) return url.split("v=")[1].split("&")[0];
  if (url.includes("youtu.be/")) return url.split("youtu.be/")[1].split("?")[0];
  return "";
}

/* -------------------------------------------------------------------------- */
/*                        TOOL: xsen_search IMPLEMENTATION                     */
/* -------------------------------------------------------------------------- */

async function handleXsenSearch(params) {
  const query = params?.query?.toLowerCase() || "";
  console.log(`🔍 xsen_search: "${query}"`);

  if (!query) {
    return "Give me something to search — a game, season, player, or rivalry.";
  }

  if (!Array.isArray(videoDB) || videoDB.length === 0) {
    return "Video library is still loading — try again in a few seconds.";
  }

  const matches = videoDB
    .filter((v) => {
      const title = (v["OU Sooners videos"] || "").toLowerCase();
      const desc = (v["Description"] || "").toLowerCase();
      return title.includes(query) || desc.includes(query);
    })
    .slice(0, 3);

  console.log(`✅ Found ${matches.length} videos`);

  if (matches.length === 0) {
    return `No XSEN videos found for "${query}". Try another moment or matchup.`;
  }

  let response = "";

  for (const v of matches) {
    const url = v["URL"] || "";
    const title = v["OU Sooners videos"] || "OU Video";
    const desc = v["Description"] || "";
    const videoId = extractVideoId(url);

    if (!videoId) continue;

    const playerUrl = `${PLAYER_BASE}?v=${videoId}`;

    response += `\n**${title}**\n\n`;

response += `
<div style="position:relative; width:100%; max-width:640px; padding-bottom:56.25%; height:0; overflow:hidden; border-radius:12px; margin:0 auto 12px auto;">
  <iframe
    src="${playerUrl}"
    style="position:absolute; top:0; left:0; width:100%; height:100%; border:0;"
    allowfullscreen
    loading="lazy"
  ></iframe>
</div>\n\n`;

    if (desc) response += `*${desc}*\n\n`;
  }

  response += "Boomer Sooner! Want another clip?";
  return response;
}

/* -------------------------------------------------------------------------- */
/*                                MCP ENDPOINT                                 */
/* -------------------------------------------------------------------------- */

app.post("/mcp", async (req, res) => {
  try {
    // AUTH CHECK
    const authHeader = req.headers.authorization;
    const expectedAuth = `Bearer ${process.env.MCP_AUTH_KEY}`;
    
    if (!authHeader || authHeader !== expectedAuth) {
      return res.status(401).json({
        jsonrpc: "2.0",
        id: req.body?.id || null,
        error: { code: -32600, message: "Unauthorized" }
      });
    }

    const { jsonrpc, method, id, params } = req.body || {};
    // ... rest of your existing code

    // ---- INITIALIZE ----
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "XSEN Video MCP", version: "1.0.0" },
          capabilities: { tools: {} },
        },
      });
    }

    if (method === "notifications/initialized") {
      return res.status(200).end();
    }

  
 // ---- LIST TOOLS ----
// ---- LIST TOOLS ----
// ---- LIST TOOLS ----
if (method === "tools/list") {
  return res.json({
    jsonrpc: "2.0",
    id,
    result: {
      tools: [
        {
          name: "xsen_search",
          description: "Search OU Sooners video highlights and return XSEN embedded players. Use this when users request videos, highlights, or game footage.",
          inputSchema: {  // camelCase - CRITICAL!
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query for OU videos (e.g. 'Baker Mayfield highlights')"
              }
            },
            required: ["query"]
          }
        }
      ]
    }
  });
}

    // ---- CALL TOOL ----
    if (method === "tools/call") {
      const toolName = params?.name;

      if (toolName !== "xsen_search") {
        return res.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        });
      }

      const args = params?.arguments || {};
      const text = await handleXsenSearch(args);

      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text }],
        },
      });
    }

    // ---- UNKNOWN METHOD ----
    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown method: ${method}` },
    });
  } catch (err) {
    console.error("❌ MCP Error:", err.message);
    return res.json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: "Internal error" },
    });
  }
});

/* -------------------------------------------------------------------------- */
/*                              START THE SERVER                               */
/* -------------------------------------------------------------------------- */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 XSEN Video MCP running on port ${PORT}`);

  setTimeout(() => {
    loadVideos().then(() => {
      console.log("📊 Video DB ready");
      setInterval(loadVideos, 15 * 60 * 1000);
    });
  }, 2500);
});
