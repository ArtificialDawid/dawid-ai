
const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const CHAT_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

const CLOUDFLARE_URL = (model) =>
  `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`;

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

// Basic per-IP rate limiter.
// Note: counts reset if the server restarts.
const requestCounts = new Map();

function rateLimit(maxRequests, message) {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress;
    const now = Date.now();
    const windowMs = 60 * 1000;

    let entry = requestCounts.get(ip);

    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
    }

    entry.count++;
    requestCounts.set(ip, entry);

    if (entry.count > maxRequests) {
      return res.status(429).json({ error: message });
    }

    // Remove expired entries.
    for (const [key, value] of requestCounts) {
      if (now - value.start >= windowMs) {
        requestCounts.delete(key);
      }
    }

    next();
  };
}

function cloudflareConfigured() {
  return Boolean(
    CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_TOKEN
  );
}

async function callCloudflare(model, body) {
  return fetch(CLOUDFLARE_URL(model), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000)
  });
}

// Website and AI connection status.
app.get("/api/status", (req, res) => {
  const configured = cloudflareConfigured();

  res.json({
    connected: configured,
    provider: "Cloudflare Workers AI",
    textModel: CHAT_MODEL,
    visionModel: CHAT_MODEL,
    imageModel: IMAGE_MODEL,
    textAvailable: configured,
    visionAvailable: configured,
    imageGenerationAvailable: configured
  });
});

// Chat and image recognition.
app.post(
  "/api/chat",
  rateLimit(
    10,
    "Too many messages. Please wait a minute and try again."
  ),
  async (req, res) => {
    if (!cloudflareConfigured()) {
      return res.status(503).json({
        error: "Cloudflare AI is not configured."
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
      const upstream = await callCloudflare(CHAT_MODEL, {
        messages: cloudflareMessages,
        stream: false,
        max_tokens: 512,
        temperature: 0.6
      });

      const data = await upstream.json().catch(() => ({}));

      if (!upstream.ok || data.success === false) {
        console.error("Cloudflare chat error:", data.errors || data);

        return res.status(502).json({
          error:
            data.errors?.[0]?.message ||
            `Cloudflare returned HTTP ${upstream.status}.`
        });
      }

      const answer = data.result?.response;

      if (typeof answer !== "string") {
        return res.status(502).json({
          error: "Cloudflare returned an unexpected chat response."
        });
      }

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Content-Type-Options", "nosniff");

      res.send(answer);

    } catch (error) {
      console.error("Cloudflare chat failed:", error.message);

      res.status(502).json({
        error: "Could not connect to Cloudflare AI. Please try again."
      });
    }
  }
);


// AI image generation.
app.post(
  "/api/generate-image",
  rateLimit(
    3,
    "You've reached the image generation limit. Please wait a minute."
  ),
  async (req, res) => {
    if (!cloudflareConfigured()) {
      return res.status(503).json({
        error: "Cloudflare AI is not configured."
      });
    }

    const prompt =
      typeof req.body?.prompt === "string"
        ? req.body.prompt.trim()
        : "";

    if (!prompt) {
      return res.status(400).json({
        error: "Please enter an image description."
      });
    }

    if (prompt.length > 2048) {
      return res.status(400).json({
        error: "Your prompt must be 2048 characters or fewer."
      });
    }

    try {
      const upstream = await callCloudflare(IMAGE_MODEL, {
        prompt,
        steps: 4
      });

      if (!upstream.ok) {
        const errorText = await upstream.text();
        console.error("Cloudflare image error:", errorText);

        return res.status(502).json({
          error: `Image generation failed (HTTP ${upstream.status}).`
        });
      }

      // FLUX returns binary image data, not JSON.
      const imageBuffer = Buffer.from(
        await upstream.arrayBuffer()
      );

      if (!imageBuffer.length) {
        throw new Error("Cloudflare returned an empty image.");
      }

      const contentType =
        upstream.headers.get("content-type") || "image/jpeg";

      if (!contentType.startsWith("image/")) {
        console.error("Unexpected image content type:", contentType);

        throw new Error("Cloudflare did not return a valid image.");
      }

      // Convert binary image data into a Base64 data URL.
      const base64Image = imageBuffer.toString("base64");

      res.json({
        success: true,
        image: `data:${contentType};base64,${base64Image}`,
        prompt
      });

    } catch (error) {
      console.error("Image generation failed:", error.message);

      res.status(502).json({
        error: error.message || "Could not generate your image. Please try again."
      });
    }
  }
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dawid's AI is running on port ${PORT}`);
  console.log("AI provider: Cloudflare Workers AI");
  console.log(`Chat model: ${CHAT_MODEL}`);
  console.log(`Image model: ${IMAGE_MODEL}`);
});