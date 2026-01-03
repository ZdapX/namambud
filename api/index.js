
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const cors = require("cors");
const https = require("https");

const app = express();

app.use(cors());
app.use(express.json());

const BASE = "https://tinywow.com";

// 1. Konfigurasi Agent agar koneksi stabil & menyamar seperti browser
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
  // Bypass beberapa cek SSL strict yang kadang memblokir server-to-server
  rejectUnauthorized: false 
});

// 2. Header KONSTAN (Penting: Jangan berubah-ubah antar request)
const COMMON_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Origin": BASE,
  "Referer": `${BASE}/image/ai-image-generator`,
  "Connection": "keep-alive",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Pragma": "no-cache",
  "Cache-Control": "no-cache"
};

// Buat instance axios khusus
const client = axios.create({
  baseURL: BASE,
  httpsAgent: agent,
  headers: COMMON_HEADERS,
  timeout: 30000 // 30 detik timeout internal
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function initSession() {
  // Request awal untuk dapat cookie
  const res = await client.get("/image/ai-image-generator", {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
    }
  });

  const cookies = res.headers["set-cookie"] || [];
  const cookieStr = cookies.map(v => v.split(";")[0]).join("; ");

  // Cari token XSRF
  let xsrf = "";
  const xsrfCookie = cookies.find(v => v.startsWith("XSRF-TOKEN="));
  if (xsrfCookie) {
    xsrf = decodeURIComponent(xsrfCookie.split("=")[1].split(";")[0]);
  }

  // Jika gagal ambil dari cookie, coba cari di body HTML (opsional, kadang ada di meta tag)
  
  return { cookie: cookieStr, xsrf };
}

async function prepare(prompt, session) {
  // Payload harus persis
  const payload = {
    prompt,
    mode: "ai_image_generator",
    step: 1,
    is_ws: false,
    ws_id: crypto.randomUUID()
  };

  const res = await client.post("/image/prepare", payload, {
    headers: {
      "X-XSRF-TOKEN": session.xsrf,
      "Cookie": session.cookie,
      "Content-Type": "application/json;charset=UTF-8" // Case sensitive kadang pengaruh
    }
  });

  return res.data.task_id;
}

async function progress(taskId, session) {
  const res = await client.post(`/task/progress/${taskId}`, {}, {
    headers: {
      "X-XSRF-TOKEN": session.xsrf,
      "Cookie": session.cookie,
      "Content-Type": "application/json;charset=UTF-8"
    }
  });
  return res.data;
}

// --- Route Handlers ---

app.get("/", (req, res) => {
  res.send({ status: "Online", message: "AI Generator Ready" });
});

app.post("/api/generate", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) return res.status(400).json({ error: "Prompt kosong" });

  try {
    console.log(`[1] Memulai sesi untuk prompt: "${prompt}"`);
    const session = await initSession();
    
    if (!session.xsrf) {
      throw new Error("Gagal mendapatkan Token XSRF dari TinyWow.");
    }

    console.log(`[2] Session OK. Menyiapkan gambar...`);
    const taskId = await prepare(prompt, session);
    
    console.log(`[3] Task ID: ${taskId}. Menunggu proses...`);

    let result;
    let attempts = 0;
    const maxAttempts = 20; // Max 40 detik

    while (attempts < maxAttempts) {
      await sleep(2000);
      result = await progress(taskId, session);
      
      console.log(`[Check ${attempts+1}] Status: ${result.state}`);

      if (result.state === "completed") break;
      if (result.state === "failed") throw new Error("TinyWow gagal memproses gambar.");
      
      attempts++;
    }

    if (result.state !== "completed") {
      throw new Error("Waktu habis (Timeout). Server terlalu sibuk.");
    }

    res.json({
      success: true,
      images: result.images
    });

  } catch (error) {
    console.error("ERROR LOG:", error.message);
    
    // Cek jika error dari Axios (Network/HTTP Error)
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
      
      if (error.response.status === 403 || error.response.status === 522) {
        return res.status(500).json({ 
          error: "Server diblokir oleh Cloudflare (IP Vercel terdeteksi). Coba deploy ulang atau jalankan di Localhost." 
        });
      }
    }

    res.status(500).json({ error: error.message });
  }
});

module.exports = app;
