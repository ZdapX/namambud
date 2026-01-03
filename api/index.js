
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const cors = require("cors");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

const BASE = "https://tinywow.com";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Logic dari Script Kamu ---
async function initSession() {
  const res = await axios.get(BASE + "/image/ai-image-generator", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
  });

  const cookies = res.headers["set-cookie"] || [];
  const cookieStr = cookies.map((v) => v.split(";")[0]).join("; ");

  const xsrfRaw = cookies.find((v) => v.startsWith("XSRF-TOKEN="));
  if (!xsrfRaw) throw new Error("Gagal mendapatkan XSRF Token");
  
  const xsrf = decodeURIComponent(xsrfRaw.split("=")[1].split(";")[0]);

  return { cookie: cookieStr, xsrf };
}

async function prepare(prompt, session) {
  const res = await axios.post(
    BASE + "/image/prepare",
    {
      prompt,
      mode: "ai_image_generator",
      step: 1,
      is_ws: false,
      ws_id: crypto.randomUUID(),
    },
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=utf-8",
        "X-XSRF-TOKEN": session.xsrf,
        Cookie: session.cookie,
        Origin: BASE,
        Referer: BASE + "/image/ai-image-generator",
      },
    }
  );
  return res.data.task_id;
}

async function progress(taskId, session) {
  const res = await axios.post(
    BASE + `/task/progress/${taskId}`,
    {},
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=utf-8",
        "X-XSRF-TOKEN": session.xsrf,
        Cookie: session.cookie,
        Origin: BASE,
        Referer: BASE + "/image/ai-image-generator",
      },
    }
  );
  return res.data;
}

// --- Route API ---

app.get("/", (req, res) => {
  res.send("Backend AI Image Generator Active!");
});

app.post("/api/generate", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    const session = await initSession();
    const taskId = await prepare(prompt, session);

    let result;
    let attempts = 0;
    
    // Loop max 30 detik (10 kali x 3 detik) untuk menghindari timeout Vercel Free Tier
    while (attempts < 15) {
      await sleep(2000); // Tunggu 2 detik
      result = await progress(taskId, session);
      
      if (result.state === "completed") break;
      if (result.state === "failed") throw new Error("Generation Failed");
      
      attempts++;
    }

    if (result.state !== "completed") {
      return res.status(504).json({ error: "Timeout: Generation took too long." });
    }

    res.json({
      success: true,
      task_id: taskId,
      images: result.images, // Array URL gambar
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      error: "Internal Server Error", 
      details: error.message 
    });
  }
});

// Penting untuk Vercel: Export app
module.exports = app;
