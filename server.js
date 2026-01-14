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
/*                        ✅ BROWSER-SAFE VIDEO API                            */
/* -------------------------------------------------------------------------- */
/*  This endpoint is for the XSEN frontend ONLY.
    It does NOT expose MCP auth.
    It reuses the already-loaded videoDB. */

app.get("/videos", (req, res) => {
  const query = (req.query.query || "").toLowerCase();
  const limit = Number(req.query.limit) || 3;

  if (!query) {
    return res.json({ results: [] });
  }

  if (!Array.isArray(videoDB) || videoDB.length === 0) {
    return res.status(503).json({
      error: "Video library still loading"
    });
  }

const matches = videoDB
  .map((v) => {
    const title = (v["OU Sooners videos"] || "").toLowerCase();
    const desc = (v["Description"] || "").toLowerCase();
    const qWords = query.split(" ").filter(Boolean);

    let score = 0;
    for (const word of qWords) {
      if (title.includes(word)) score += 2;
      if (desc.includes(word)) score += 1;
    }

    return { ...v, _score: score };
  })
  .filter((v) => v._score > 0) // discard 0-match items
  .sort((a, b) => b._score - a._score) // highest scores first
  .slice(0, limit)
  .map((v) => {
    const url = v["URL"] || "";
    const title = v["OU Sooners videos"] || "OU Video";
    const desc = v["Description"] || "";

    let videoId = "";
    if (url.includes("v=")) videoId = url.split("v=")[1].split("&")[0];
    else if (url.includes("youtu.be/")) videoId = url.split("youtu.be/")[1];

    return {
      title,
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      duration: "—",
      url: `${PLAYER_BASE}?v=${videoId}`,
      description: desc
    };
  });


  res.json({ results: matches });
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
                "Search OU Sooners video highlights and return XSEN embedded players.",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Search query for OU videos"
                  }
                },
                required: ["query"]
              }
            }
          ]
        }
      });
    }

    if (method === "tools/call") {
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
