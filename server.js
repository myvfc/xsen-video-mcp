import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const PORT = process.env.PORT || 8080;

// Location of your videos.json repo
const VIDEOS_URL =
  process.env.VIDEOS_URL ||
  "https://raw.githubusercontent.com/myvfc/video-db/main/videos.json";

// Optional auth for PayMeGPT (leave blank to disable)
const AUTH_TOKEN = process.env.MCP_AUTH || "";

// XSEN Player base URL (permanent)
const PLAYER_BASE = process.env.XSEN_PLAYER_URL || "https://player.xsen.fun";

// In-memory DB
let videoDB = [];

/* ----------------------------- Load Videos ------------------------------- */
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

/* ----------------------------- Express Setup ----------------------------- */
const app = express();
app.use(cors());
app.use(express.json());

/* ---------------------------- Health Check ------------------------------- */
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

/* ------------------------------ HEARTBEAT ------------------------------- */
/*
  Railway sleeps containers that have no network output.
  This heartbeat prints a log entry every 12s and ensures
  Railway sees continuous activity.
*/
setInterval(() => {
  console.log("💓 Heartbeat: XSEN MCP is alive");
}, 12000);

/* ---------------------------- Auth Middleware ---------------------------- */
function requireAuth(req, res, next) {
  if (!AUTH_TOKEN) return next();

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (token && token === AUTH_TOKEN) return next();

  return res.status(401).json({ error: "Unauthorized" });
}

/* --------------------------- Helper: Video ID ---------------------------- */
function extractVideoId(url = "") {
  if (!url) return "";
  if (url.includes("v=")) return url.split("v=")[1].split("&")[0];
  if (url.includes("youtu.be/")) return url.split("youtu.be/")[1].split("?")[0];
  return "";
}

/* --------------------------- Tool: xsen_search --------------------------- */
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

  let responseText = "";

  for (const v of matches) {
    const url = v["URL"] || "";
    const title = v["OU Sooners videos"] || "OU Video";
    const desc = v["Description"] || "";
    const videoId = extractVideoId(url);

    if (!videoId) continue;

    const playerUrl = `${PLAYER_BASE}?v=${videoId}`;

    responseText += `\n**${title}**\n\n`;

    responseText += `
<div style="position:relative; width:100%; padding-bottom:56.25%; height:0; overflow:hidden; border-radius:12px; margin-bottom:12px;">
  <iframe
    src="${playerUrl}"
    style="position:absolute; top:0; left:0; width:100%; height:100%; border:0;"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
    loading="lazy"
  ></iframe>
</div>
`.trim() + "\n\n";

    if (desc) responseText += `*${desc}*\n\n`;
  }

  responseText += "Boomer Sooner! Want another clip?";
  return responseText;
}

/* ----------------------------- JSON-RPC MCP ------------------------------ */
app.post("/mcp", requireAuth, async (req, res) => {
  try {
    const { jsonrpc, method, id, params } = req.body || {};

    console.log(`🔧 MCP: ${method}`);

    if (jsonrpc !== "2.0") {
      return res.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Invalid JSON-RPC version" },
      });
    }

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

    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "xsen_search",
              description:
                "Search OU Sooners videos and return XSEN embedded players.",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description:
                      "Search phrase (e.g., '2025 OU Alabama highlights')",
                  },
                },
                required: ["query"],
              },
            },
          ],
        },
      });
    }

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

/* ------------------------------ Start Server ----------------------------- */
app.listen(PORT, () => {
  console.log(`🚀 XSEN Video MCP running on port ${PORT}`);

  // Load videos AFTER server binds so Railway healthcheck passes
  setTimeout(() => {
    loadVideos().then(() => {
      console.log("📊 Video DB ready");
      setInterval(loadVideos, 15 * 60 * 1000);
    });
  }, 2500);
});
