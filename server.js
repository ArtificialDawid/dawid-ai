
const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;
const OLLAMA_URL = "http://127.0.0.1:11434";

const TEXT_MODEL = "llama3.2:1b";
const VISION_MODEL = "llava:7b";

app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) throw new Error("Ollama unavailable");

    const data = await response.json();
    const models = (data.models || []).map((m) => m.name);

    const hasModel = (name) =>
      models.some((m) => m === name || m.startsWith(`${name}:`));

    res.json({
      connected: true,
      textModel: TEXT_MODEL,
      visionModel: VISION_MODEL,
      textAvailable: hasModel(TEXT_MODEL),
      visionAvailable: hasModel(VISION_MODEL),
    });
  } catch {
    res.status(503).json({
      connected: false,
      textModel: TEXT_MODEL,
      visionModel: VISION_MODEL,
      textAvailable: false,
      visionAvailable: false,
    });
  }
});

app.post("/api/chat", async (req, res) => {
  const { messages, images } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Send a message first." });
  }

  if (
    !Array.isArray(images || []) ||
    (images || []).length > 3
  ) {
    return res.status(400).json({
      error: "Attach no more than 3 images per message.",
    });
  }

  const attachedImages = images || [];

  // Only accept base64-encoded JPEG, PNG or WebP images.
  for (const image of attachedImages) {
    if (
      !image ||
      !["image/jpeg", "image/png", "image/webp"].includes(image.mime) ||
      typeof image.data !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) ||
      image.data.length > 3_500_000
    ) {
      return res.status(400).json({
        error: "Unsupported image or image too large. Use JPEG, PNG or WebP.",
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
      content: m.content.slice(0, 12000),
    }));

  if (!safeMessages.length || safeMessages.at(-1).role !== "user") {
    return res.status(400).json({ error: "Send a user message first." });
  }

  const hasImages = attachedImages.length > 0;
  const model = hasImages ? VISION_MODEL : TEXT_MODEL;

  // Images belong to the current user message only.
  const lastMessage = safeMessages[safeMessages.length - 1];

  const ollamaMessages = [
    {
      role: "system",
      content:
      "You are Dawid's AI, a helpful personal assistant. " +
      "When the user sends an image, inspect the image carefully and " +
      "answer the user's question directly. If the image contains a " +
      "question, maths problem, worksheet, code, or instructions, solve " +
      "the problem or follow the instructions instead of merely copying " +
      "or describing the text. Explain your reasoning briefly when useful. " +
      "Only transcribe text if the user asks for transcription. " +
      "If you cannot read or understand the image, say so honestly. " +
      "For text-only messages, answer the text directly without mentioning " +
      "an image unless the conversation actually requires it. Be concise, " +
      "accurate, and conversational."

    },
    ...safeMessages.map((m, index) => {
      if (index === safeMessages.length - 1 && m.role === "user" && hasImages) {
        return {
          ...m,
          images: attachedImages.map((image) => image.data),
        };
      }
      return m;
    }),
  ];

  let upstream;

  try {
    upstream = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: ollamaMessages,
        stream: true,
      }),
      signal: AbortSignal.timeout(300000),
    });
  } catch {
    return res.status(502).json({
      error: "Cannot reach Ollama. Check that its server is running.",
    });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return res.status(502).json({
      error: `Ollama returned HTTP ${upstream.status}. ${
        detail.slice(0, 250) || "Check that the required model is installed."
      }`,
    });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Accel-Buffering", "no");

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        const chunk = JSON.parse(line);

        if (chunk.error) throw new Error(chunk.error);

        if (chunk.message?.content) {
          res.write(chunk.message.content);
        }
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      const chunk = JSON.parse(buffer);
      if (chunk.error) throw new Error(chunk.error);
      if (chunk.message?.content) res.write(chunk.message.content);
    }

    res.end();
  } catch (error) {
    console.error("Ollama response error:", error.message);
    if (!res.headersSent) {
      res.status(502).json({ error: "The AI response was interrupted." });
    } else {
      res.destroy();
    }
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Dawid's AI is running at http://127.0.0.1:${PORT}`);
});