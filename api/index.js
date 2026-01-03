
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const cors = require("cors");
const https = require("https");

const app = express();

app.use(cors());
app.use(express.json());

const BASE = "https://tinywow.com";

// Setup HTTP Agent biar tidak dianggap bot & koneksi stabil
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
  rejectUnauthorized: false
});

// Helper untuk membuat axios client dengan header dinamis
const createClient = (session = null) => {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Origin": BASE,
    "Referer": `${BASE}/image/ai-image-generator`,
    "Connection": "keep-alive"
  };

  if (session) {
    headers["X-XSRF-TOKEN"] = session.xsrf;
    headers["Cookie"] = session.cookie;
    headers["Content-Type"] = "application/json;charset=UTF-8";
  }

  return axios.create({
    baseURL: BASE,
    httpsAgent: agent,
    headers: headers,
    timeout: 30000
  });
};

async function initSession() {
  const client = createClient();
  const res = await client.get("/image/ai-image-generator", {
    headers: { "Accept": "text/html" }
  });

  const cookies = res.headers["set-cookie"] || [];
  const cookieStr = cookies.map(v => v.split(";")[0]).join("; ");

  const xsrfCookie = cookies.find(v => v.startsWith("XSRF-TOKEN="));
  const xsrf = xsrfCookie ? decodeURIComponent(xsrfCookie.split("=")[1].split(";")[0]) : "";

  return { cookie: cookieStr, xsrf };
}

async function prepare(prompt, session) {
  const client = createClient(session);
  const res = await client.post("/image/prepare", {
    prompt,
    mode: "ai_image_generator",
    step: 1,
    is_ws: false,
    ws_id: crypto.randomUUID()
  });
  return res.data.task_id;
}

async function progress(taskId, session) {
  const client = createClient(session);
  const res = await client.post(`/task/progress/${taskId}`, {});
  return res.data;
}

// --- ENDPOINT 1: MULAI GENERATE ---
app.post("/api/start", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt required" });

  try {
    // 1. Ambil sesi baru
    const session = await initSession();
    if (!session.xsrf) throw new Error("Gagal mengambil session TinyWow");

    // 2. Kirim perintah generate
    const taskId = await prepare(prompt, session);

    // 3. Kembalikan Session & Task ID ke Frontend (supaya frontend yang nunggu)
    res.json({
      success: true,
      taskId: taskId,
      session: session // Kita butuh session ini untuk ngecek status nanti
    });

  } catch (error) {
    console.error("Start Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- ENDPOINT 2: CEK STATUS ---
app.post("/api/check", async (req, res) => {
  const { taskId, session } = req.body;
  if (!taskId || !session) return res.status(400).json({ error: "Missing data" });

  try {
    const result = await progress(taskId, session);
    
    // Kirim status apa adanya ke frontend
    res.json({
      success: true,
      state: result.state, // 'processing', 'completed', atau 'failed'
      images: result.images || []
    });

  } catch (error) {
    console.error("Check Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/", (req, res) => res.send("AI Backend v2 (Polling Mode)"));

module.exports = app;
