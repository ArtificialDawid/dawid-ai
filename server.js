
const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

const CLOUDFLARE_URL = CLOUDFLARE_ACCOUNT_ID
  ? `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${MODEL}`
  : null;

const SYSTEM_PROMPT =
  "You are Dawid's AI, a helpful personal assistant. " +
  "When the user sends an image, inspect it carefully and answer " +
  "their question directly. If it contains a question, maths problem, " +
  "worksheet, code, or instructions, solve it rather than merely " +
  "describing it. Explain your reasoning briefly when useful. " +
  "Only transcribe text if the user asks for transcription. " +
  "If you cannot understand an image, say so honestly. " +
  "Be concise, accurate, and conversational.";

app.set("trust proxy", 1);

app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Basic per-IP request limit to help protect your free AI allowance.
const requestCounts = new Map();

app.use("/api/chat", (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress;
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 10;

  let entry = requestCounts.get(ip);

  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
  }

  entry.count++;
  requestCounts.set(ip, entry);

  if (entry.count > maxRequests) {
    return res.status(429).json({
      error: "Too many messages. Please wait a minute and try again."
    });
  }

  // Keep the in-memory rate-limit map from growing indefinitely.
  for (const [key, value] of requestCounts) {
    if (now - value.start > windowMs) {
      requestCounts.delete(key);
    }
  }

  next();
});

app.get("/api/status", (req, res) => {
  const configured = Boolean(
    CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_TOKEN
  );

  res.json({
    connected: configured,
    textModel: MODEL,
    visionModel: MODEL,
    textAvailable: configured,
    visionAvailable: configured
  });
});

app.post("/api/chat", async (req, res) => {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
    return res.status(503).json({
      error: "Cloudflare AI is not configured yet."
    });
  }

  const { messages, images } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: "Send a message first."
    });
  }

  const attachedImages = images || [];

  if (!Array.isArray(attachedImages) || attachedImages.length > 3) {
    return res.status(400).json({
      error: "Attach no more than 3 images per message."
    });
  }

  // Validate uploaded images.
  for (const image of attachedImages) {
    if (
      !image ||
      !["image/jpeg", "image/png", "image/webp"].includes(image.mime) ||
      typeof image.data !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) ||
      image.data.length > 3_500_000
    ) {
      return res.status(400).json({
        error: "Unsupported image or image too large."
      });
    }
  }

  const safeMessages = messages
    .filter(
      (m) =>
        ["user", "assistant"].includes(m.role) &&
        typeof m.content === "string"
    )
    .slice(-20)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 12000)
    }));

  if (
    !safeMessages.length ||
    safeMessages[safeMessages.length - 1].role !== "user"
  ) {
    return res.status(400).json({
      error: "Send a user message first."
    });
  }

  // Convert the conversation to Cloudflare's message format.
  const cloudflareMessages = [
    {
      role: "system",
      content: SYSTEM_PROMPT
    },
    ...safeMessages.map((message, index) => {
      if (
        index === safeMessages.length - 1 &&
        message.role === "user" &&
        attachedImages.length > 0
      ) {
        return {
          role: "user",
          content: [
            {
              type: "text",
              text: message.content
            },
            ...attachedImages.map((image) => ({
              type: "image_url",
              image_url: {
                url: `data:${image.mime};base64,${image.data}`
              }
            }))
          ]
        };
      }

      return message;
    })
  ];

  try {
    const upstream = await fetch(CLOUDFLARE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: cloudflareMessages,
        stream: false,
        max_tokens: 512,
        temperature: 0.6
      }),
      signal: AbortSignal.timeout(120000)
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok || data.success === false) {
      console.error("Cloudflare error:", data.errors || data);
      return res.status(502).json({
        error:
          data.errors?.[0]?.message ||
          `Cloudflare returned HTTP ${upstream.status}.`
      });
    }

    const answer = data.result?.response;

    if (typeof answer !== "string") {
      console.error("Unexpected Cloudflare response:", data);
      return res.status(502).json({
        error: "Cloudflare returned an unexpected response."
      });
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Content-Type-Options", "nosniff");

    res.send(answer);

  } catch (error) {
    console.error("Cloudflare request failed:", error.message);

    if (!res.headersSent) {
      res.status(502).json({
        error: "Could not connect to Cloudflare AI. Please try again."
      });
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dawid's AI is running on port ${PORT}`);
});