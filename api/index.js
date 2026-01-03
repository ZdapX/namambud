
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const cors = require("cors");
const https = require("https");

const app = express();

app.use(cors());
app.use(express.json());

const BASE = "https://tinywow.com";

// Setup Agent: Meniru browser modern
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
  rejectUnauthorized: false
});

// Helper Axios
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

// Routes
app.get("/", (req, res) => res.send("AI Service Online"));

app.post("/api/start", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt required" });

  try {
    const session = await initSession();
    if (!session.xsrf) throw new Error("Session Failed");
    const taskId = await prepare(prompt, session);
    res.json({ success: true, taskId, session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/check", async (req, res) => {
  const { taskId, session } = req.body;
  try {
    const result = await progress(taskId, session);
    res.json({ success: true, state: result.state, images: result.images || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;
