
const $ = (selector) => document.querySelector(selector);

const canvas = $("#particles");
const ctx = canvas.getContext("2d");
const glow = $(".cursor-glow");
const sidebar = $("#sidebar");
const welcome = $("#welcome");
const messagesBox = $("#messages");
const form = $("#chatForm");
const promptBox = $("#prompt");
const sendButton = $("#sendButton");
const generateImageButton = $("#generateImageButton");

let imageGenerationBusy = false;
let mouse = { x: -1000, y: -1000 };
let particles = [];
let activeChat = null;
let chats = [];
let busy = false;
let ambient = true;
let particleFrame = 0;

let pendingImages = [];
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;

const imageInput = $("#imageInput");
const attachmentPreview = $("#attachmentPreview");

// Image preview / lightbox
const imageLightbox = $("#imageLightbox");
const lightboxImage = $("#lightboxImage");
const lightboxDownload = $("#lightboxDownload");

function openImagePreview(src) {
  if (!src) return;

  lightboxImage.src = src;
  lightboxDownload.href = src;
  imageLightbox.hidden = false;
  document.body.classList.add("lightbox-open");
}

function closeImagePreview() {
  imageLightbox.hidden = true;
  lightboxImage.src = "";
  lightboxDownload.removeAttribute("href");
  document.body.classList.remove("lightbox-open");
}

$("#lightboxClose").addEventListener("click", closeImagePreview);

imageLightbox.addEventListener("click", (event) => {
  if (event.target === imageLightbox) {
    closeImagePreview();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !imageLightbox.hidden) {
    closeImagePreview();
  }
});

// Theme selection
const themeSelector = $("#themeSelector");
const availableThemes = [
  "midnight",
  "cyberpunk",
  "ocean",
  "emerald",
  "light"
];

function applyTheme(theme) {
  const selectedTheme = availableThemes.includes(theme)
    ? theme
    : "midnight";

  document.body.dataset.theme = selectedTheme;
  themeSelector.value = selectedTheme;

  localStorage.setItem("dawids-ai-theme", selectedTheme);
}

themeSelector.addEventListener("change", () => {
  applyTheme(themeSelector.value);
});

applyTheme(localStorage.getItem("dawids-ai-theme") || "midnight");

function saveChats() {
  try {
    const allChats = [...chats];

    if (activeChat && !allChats.includes(activeChat)) {
      allChats.unshift(activeChat);
    }

    localStorage.setItem(
      "dawids-ai-chats",
      JSON.stringify(allChats.slice(0, 30))
    );
  } catch (error) {
    console.warn("Could not save conversations:", error);
  }
}

function renderAttachmentPreview() {
  attachmentPreview.replaceChildren();
  attachmentPreview.hidden = pendingImages.length === 0;

  pendingImages.forEach((image, index) => {
    const card = document.createElement("div");
    card.className = "attachment-card";

    const thumbnail = document.createElement("img");
    thumbnail.src = image.dataUrl;
    thumbnail.alt = image.name;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.className = "attachment-remove";
    remove.setAttribute("aria-label", `Remove ${image.name}`);
    remove.addEventListener("click", () => {
      pendingImages.splice(index, 1);
      renderAttachmentPreview();
    });

    card.append(thumbnail, remove);
    attachmentPreview.appendChild(card);
  });
}

$("#attachButton").addEventListener("click", () => {
  imageInput.click();
});

imageInput.addEventListener("change", async () => {
  const files = Array.from(imageInput.files || []);
  imageInput.value = "";

  for (const file of files) {
    if (pendingImages.length >= MAX_IMAGES) {
      alert("You can attach up to 3 images per message.");
      break;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      alert(`${file.name}: use a JPEG, PNG or WebP image.`);
      continue;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      alert(`${file.name}: please choose an image smaller than 2.5 MB.`);
      continue;
    }

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read image."));
        reader.readAsDataURL(file);
      });

      pendingImages.push({
        name: file.name,
        mime: file.type,
        dataUrl,
        data: dataUrl.split(",")[1],
      });
    } catch {
      alert(`Could not read ${file.name}.`);
    }
  }

  renderAttachmentPreview();
});


function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const particleCount = Math.min(
    115,
    Math.max(45, Math.floor((innerWidth * innerHeight) / 14000))
  );

  particles = Array.from({ length: particleCount }, () => ({
    x: Math.random() * innerWidth,
    y: Math.random() * innerHeight,
    r: Math.random() * 1.8 + 0.4,
    vx: (Math.random() - 0.5) * 0.32,
    vy: (Math.random() - 0.5) * 0.32,
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 0.018 + 0.006
  }));
}

function animateParticles() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  particleFrame++;

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  particles.forEach((p, i) => {
    if (!reducedMotion) {
      p.x += p.vx;
      p.y += p.vy;
      p.phase += p.speed;

      if (ambient) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const distance = Math.hypot(dx, dy);

        if (distance < 180 && distance > 0) {
          const force = (1 - distance / 180) * 0.018;
          p.x -= (dx / distance) * force * 12;
          p.y -= (dy / distance) * force * 12;
        }
      }
    }

    if (p.x < -10) p.x = innerWidth + 10;
    if (p.x > innerWidth + 10) p.x = -10;
    if (p.y < -10) p.y = innerHeight + 10;
    if (p.y > innerHeight + 10) p.y = -10;

    const twinkle = (Math.sin(p.phase) + 1) / 2;
    const alpha = ambient
      ? 0.2 + twinkle * 0.45
      : 0.12;

    // Soft particle glow
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 3.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(112, 145, 255, ${alpha * 0.12})`;
    ctx.fill();

    // Bright particle centre
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(175, 198, 255, ${alpha})`;
    ctx.fill();

    if (!ambient) return;

    // Connecting constellation lines
    for (let j = i + 1; j < particles.length; j++) {
      const q = particles[j];
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const distance = Math.hypot(dx, dy);

      if (distance < 115) {
        const strength = (1 - distance / 115) * 0.13;

        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.strokeStyle = `rgba(125, 153, 240, ${strength})`;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }

    // Subtle mouse energy field
    const mouseDistance = Math.hypot(
      mouse.x - p.x,
      mouse.y - p.y
    );

    if (mouseDistance < 125) {
      const strength = 1 - mouseDistance / 125;

      ctx.beginPath();
      ctx.arc(p.x, p.y, 2 + strength * 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(160, 190, 255, ${strength * 0.35})`;
      ctx.fill();
    }
  });

  requestAnimationFrame(animateParticles);
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("pointermove", (event) => {
  mouse.x = event.clientX;
  mouse.y = event.clientY;
  if (ambient) {
    glow.style.left = `${mouse.x}px`;
    glow.style.top = `${mouse.y}px`;
  }
});

resizeCanvas();
animateParticles();

$("#collapseSidebar").addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
});

$("#mobileMenu").addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
});

$("#ambientToggle").addEventListener("click", () => {
  ambient = !ambient;
  document.body.classList.toggle("ambient-off", !ambient);
});

// Focus mode controls
const focusButton = $("#focusButton");

const focusExitButton = document.createElement("button");
focusExitButton.id = "focusExitButton";
focusExitButton.type = "button";
focusExitButton.textContent = "✕ Exit focus mode";
focusExitButton.hidden = true;

document.body.appendChild(focusExitButton);

function setFocusMode(enabled) {
  document.body.classList.toggle("focus-mode", enabled);
  focusButton.classList.toggle("active", enabled);
  focusExitButton.hidden = !enabled;
}

focusButton.addEventListener("click", () => {
  const isActive = document.body.classList.contains("focus-mode");
  setFocusMode(!isActive);
});

focusExitButton.addEventListener("click", () => {
  setFocusMode(false);
});

$("#homeButton").addEventListener("click", () => {
  setFocusMode(false);
});

document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    document.body.classList.contains("focus-mode")
  ) {
    setFocusMode(false);
  }
});

function makeChat() {
  const chat = {
    id: Date.now() + Math.random(),
    title: "New conversation",
    messages: [],
  };

  chats.unshift(chat);
  activeChat = chat;
  renderHistory();
  renderChat();
  promptBox.focus();
  saveChats();
}

function renderHistory() {
  const history = $("#history");
  history.replaceChildren();

  chats.forEach((chat) => {
    const item = document.createElement("div");
    item.className = "history-entry";

    const button = document.createElement("button");
    button.className =
      "history-item" + (chat === activeChat ? " active" : "");
    button.textContent = chat.title;
    button.title = chat.title;

    button.addEventListener("click", () => {
      activeChat = chat;
      saveChats();
      renderHistory();
      renderChat();

      if (innerWidth <= 760) {
        sidebar.classList.add("collapsed");
      }
    });

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "history-menu-button";
    menuButton.textContent = "⋯";
    menuButton.title = "Chat options";
    menuButton.setAttribute("aria-label", `Options for ${chat.title}`);

    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();

      const existing = document.querySelector(".history-popup");
      const isSameMenu = existing?.dataset.chatId === String(chat.id);

      document.querySelectorAll(".history-popup").forEach((menu) => {
        menu.remove();
      });

      if (isSameMenu) return;

      const menu = document.createElement("div");
      menu.className = "history-popup";
      menu.dataset.chatId = String(chat.id);

      const rect = menuButton.getBoundingClientRect();

      const menuHeight = 100;
      const top =
        rect.bottom + menuHeight > window.innerHeight
          ? rect.top - menuHeight
          : rect.bottom + 6;

      const left = Math.min(
        window.innerWidth - 168,
        Math.max(8, rect.right - 160)
      );

menu.style.top = `${Math.max(8, top)}px`;
menu.style.left = `${left}px`;

      const renameButton = document.createElement("button");
      renameButton.type = "button";
      renameButton.textContent = "✎ Rename";

      renameButton.addEventListener("click", (event) => {
        event.stopPropagation();

        const newTitle = window.prompt(
          "Enter a new chat name:",
          chat.title
        );

        if (newTitle === null) return;

        const trimmedTitle = newTitle.trim();

        if (!trimmedTitle) {
          alert("The chat name cannot be empty.");
          return;
        }

        chat.title = trimmedTitle.slice(0, 60);
        saveChats();
        renderHistory();
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-chat-button";
      deleteButton.textContent = "✕ Delete";

      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();

        if (!window.confirm(`Delete "${chat.title}"? This cannot be undone.`)) {
          return;
        }

        chats = chats.filter((entry) => entry.id !== chat.id);

        if (activeChat?.id === chat.id) {
          activeChat = chats[0] || null;

          if (!activeChat) {
            makeChat();
            return;
          }

          renderChat();
        }

        saveChats();
        renderHistory();
      });

      menu.append(renameButton, deleteButton);
      document.body.appendChild(menu);
    });

    actions.appendChild(menuButton);
    item.append(button, actions);
    history.appendChild(item);
  });
}

// Close chat menus when clicking elsewhere.
document.addEventListener("click", () => {
  document.querySelectorAll(".history-popup").forEach((menu) => {
    menu.remove();
  });
});


function renderChat() {
  messagesBox.replaceChildren();
  messagesBox.classList.toggle(
    "visible",
    Boolean(activeChat?.messages.length)
  );
  welcome.hidden = Boolean(activeChat?.messages.length);

  if (!activeChat) return;

  activeChat.messages.forEach((message) => {
    appendMessage(
      message.role,
      message.content,
      message.attachments || []
    );
  });

  scrollToBottom();
}

function appendMessage(role, content = "", attachments = []) {
  const row = document.createElement("article");
  row.className = `message ${role} message-enter`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "assistant" ? "✦" : "Y";

  const body = document.createElement("div");
  body.className = "message-body";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent =
    role === "assistant" ? "DAWID'S AI" : "YOU";

  body.appendChild(meta);

  // Display image attachments above the user's message.
  if (attachments.length > 0) {
    const gallery = document.createElement("div");
    gallery.className = "sent-image-gallery";

    attachments.forEach((attachment) => {
      if (!attachment.dataUrl) return;

      const image = document.createElement("img");
      image.className = "sent-image";
      image.src = attachment.dataUrl;
      image.alt = attachment.name || "Attached image";
      image.loading = "lazy";

      image.addEventListener("click", () => {
        openImagePreview(image.src);
      });

      gallery.appendChild(image);
    });

    if (gallery.childElementCount > 0) {
      body.appendChild(gallery);
    }
  }

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = content;

  body.appendChild(text);
  row.append(avatar, body);
  messagesBox.appendChild(row);

  return text;
}

// Render model output as text, never as executable HTML.
function renderPlainText(element, text) {
  element.textContent = text;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    const stage = $(".chat-stage");
    stage.scrollTop = stage.scrollHeight;
  });
}

function showTyping() {
  const row = document.createElement("article");
  row.className = "message assistant";
  row.id = "typingIndicator";

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = "✦";

  const body = document.createElement("div");
  body.className = "message-body";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = "DAWID'S AI · THINKING";

  const dots = document.createElement("div");
  dots.className = "typing-dots";
  dots.innerHTML = "<span></span><span></span><span></span>";

  body.append(meta, dots);
  row.append(avatar, body);
  messagesBox.appendChild(row);
  scrollToBottom();
}

function setBusy(value) {
  busy = value;
  document.body.classList.toggle("ai-working", value);

  sendButton.disabled = value;
  promptBox.disabled = value;
  $("#sendIcon").textContent = value ? "…" : "↑";
  $(".send-label").textContent = value ? "Thinking" : "Send";
}


async function sendMessage(text) {
  const content = text.trim();

  if ((!content && pendingImages.length === 0) || busy) return;

  if (!activeChat) makeChat();

  const chat = activeChat;
  const imagesToSend = pendingImages.splice(0);

  renderAttachmentPreview();

  const userContent = content ||
    "Please describe and analyse the attached image(s).";

  // Keep image previews attached to the user's message.
  const attachments = imagesToSend.map(({ name, mime, dataUrl }) => ({
    name,
    mime,
    dataUrl
  }));

  const userMessage = {
    role: "user",
    content: userContent,
    attachments
  };

  chat.messages.push(userMessage);

  if (chat.messages.filter((m) => m.role === "user").length === 1) {
    chat.title = content
      ? (content.length > 29 ? content.slice(0, 29) + "…" : content)
      : "Image analysis";
  }

  // Save immediately, before waiting for the AI.
  saveChats();
  renderHistory();
  renderChat();

  promptBox.value = "";
  promptBox.style.height = "auto";
  messagesBox.classList.add("visible");
  welcome.hidden = true;


  setBusy(true);
  showTyping();

  let answer = "";
  const requestStartedAt = performance.now();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chat.messages.map(({ role, content }) => ({
          role,
          content
        })),
        images: imagesToSend.map(({ mime, data }) => ({
          mime,
          data
        }))
      })
    });

    console.log(
      `[Dawid AI] Server responded in ${
        ((performance.now() - requestStartedAt) / 1000).toFixed(2)
      } seconds`
    );

    $("#typingIndicator")?.remove();

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.error || `Request failed (${response.status})`
      );
    }

    const output = appendMessage("assistant", "");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      answer += decoder.decode(value, { stream: true });
      renderPlainText(output, answer);
      scrollToBottom();
    }

    answer += decoder.decode();
    renderPlainText(output, answer);

    if (!answer.trim()) {
      throw new Error("The model returned an empty response.");
    }

    chat.messages.push({
      role: "assistant",
      content: answer
    });

    // Save the completed answer too.
    saveChats();
    renderHistory();
  } catch (error) {
    $("#typingIndicator")?.remove();

    const message = error.message || "Something went wrong.";
    const output = appendMessage("assistant", `⚠ ${message}`);
    output.style.color = "#ff9daa";

    if (answer.trim()) {
      chat.messages.push({
        role: "assistant",
        content: answer
      });
    }

    // Keep the user's message and attachments in the history.
    saveChats();
    renderHistory();

    // Restore image attachments so the user can retry.
    if (imagesToSend.length) {
      pendingImages.unshift(...imagesToSend);
      renderAttachmentPreview();
    }
  } finally {
    $("#typingIndicator")?.remove();
    setBusy(false);
    promptBox.focus();
    scrollToBottom();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(promptBox.value);
});

promptBox.addEventListener("input", () => {
  promptBox.style.height = "auto";
  promptBox.style.height = `${Math.min(promptBox.scrollHeight, 160)}px`;
});

promptBox.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    promptBox.value = button.dataset.prompt;
    sendMessage(promptBox.value);
  });
});

$("#newChat").addEventListener("click", () => {
  makeChat();
  if (innerWidth <= 760) sidebar.classList.add("collapsed");
});

async function checkStatus() {
  const light = $("#statusLight");
  const title = $("#connectionTitle");
  const detail = $("#connectionDetail");

  try {
    const response = await fetch("/api/status");
    const status = await response.json();

    if (!response.ok || !status.connected) {
      throw new Error("Offline");
    }

    light.className = "status-light online";
    title.textContent = "Connected";

    const modelAvailable =
      status.textAvailable && status.visionAvailable;

    detail.textContent = modelAvailable
      ? "Text and vision models ready"
      : `Text: ${status.textAvailable ? "ready" : "missing"} · Vision: ${
          status.visionAvailable ? "ready" : "missing"
        }`;

    $("#modelName").textContent = "Cloudflare Workers AI";
  } catch {
    light.className = "status-light offline";
    title.textContent = "Connection unavailable";
    detail.textContent = "Connection unavailable";
    $("#modelName").textContent = "Unavailable";
  }
}

const voiceButton = $("#voiceButton");
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
  voiceButton.title = "Voice input is not supported by this browser.";
  voiceButton.addEventListener("click", () => {
    alert("Try a browser that supports Web Speech voice recognition.");
  });
} else {
  const recognition = new SpeechRecognition();
  recognition.lang = "en-GB";
  recognition.interimResults = true;

  let listening = false;

  voiceButton.addEventListener("click", () => {
    if (listening) {
      recognition.stop();
      return;
    }

    try {
      recognition.start();
      listening = true;
      voiceButton.classList.add("recording");
      voiceButton.textContent = "● Listening";
    } catch {
      alert("Voice recognition could not start. Please try again.");
    }
  });

  recognition.onresult = (event) => {
    let transcript = "";

    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }

    promptBox.value = transcript;
    promptBox.dispatchEvent(new Event("input"));
  };

  recognition.onend = () => {
    listening = false;
    voiceButton.classList.remove("recording");
    voiceButton.textContent = "♩ Voice";
  };

  recognition.onerror = () => {
    listening = false;
    voiceButton.classList.remove("recording");
    voiceButton.textContent = "♩ Voice";
  };
}


let lastTrailTime = 0;

window.addEventListener("pointermove", (event) => {
  if (!ambient || event.pointerType === "touch") return;

  const now = performance.now();
  if (now - lastTrailTime < 28) return;
  lastTrailTime = now;

  const spark = document.createElement("span");
  spark.className = "cursor-spark";
  spark.style.left = `${event.clientX}px`;
  spark.style.top = `${event.clientY}px`;

  document.body.appendChild(spark);
  spark.addEventListener("animationend", () => spark.remove(), {
    once: true,
  });
});


try {
  const saved = JSON.parse(
    localStorage.getItem("dawids-ai-chats") || "[]"
  );

  if (Array.isArray(saved)) {
    chats = saved.filter(
      (chat) =>
        chat &&
        typeof chat.title === "string" &&
        Array.isArray(chat.messages)
    ).slice(0, 30);
  }
} catch {
  chats = [];
}

if (chats.length) {
  activeChat = chats[0];
  renderHistory();
  renderChat();
} else {
  makeChat();
}

async function generateImage() {
  const prompt = promptBox.value.trim();

  if (!prompt) {
    promptBox.focus();
    promptBox.placeholder = "Describe the image you want to create...";
    return;
  }

  if (busy || imageGenerationBusy) return;

  if (!activeChat) makeChat();

  const chat = activeChat;
  imageGenerationBusy = true;
  generateImageButton.disabled = true;
  generateImageButton.textContent = "Creating…";
  promptBox.disabled = true;

  const userMessage = {
    role: "user",
    content: `Create an image: ${prompt}`,
    attachments: []
  };

  chat.messages.push(userMessage);

  if (chat.messages.filter(message => message.role === "user").length === 1) {
    chat.title = prompt.length > 29 ? prompt.slice(0, 29) + "…" : prompt;
  }

  saveChats();
  renderHistory();
  renderChat();

  promptBox.value = "";
  promptBox.style.height = "auto";
  messagesBox.classList.add("visible");
  welcome.hidden = true;

  const status = appendMessage("assistant", "Creating your image…");
  status.classList.add("image-generation-status");
  scrollToBottom();

  try {
    const response = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || `Image generation failed (${response.status})`);
    }

    // Accept common response property names from the server.
    const imageUrl =
      result.imageUrl ||
      result.image ||
      result.url ||
      (result.data?.image ? `data:image/png;base64,${result.data.image}` : "");

    if (typeof imageUrl !== "string" || !imageUrl) {
      throw new Error("The server response did not contain an image.");
    }

    status.remove();

    const imageCaption = appendMessage("assistant", `Generated image: ${prompt}`);
    const assistantMessage = {
      role: "assistant",
      content: `Generated image: ${prompt}`,
      attachments: [{
        name: "Generated image",
        mime: "image/png",
        dataUrl: imageUrl
      }]
    };

    chat.messages.push(assistantMessage);
    saveChats();
    renderHistory();

    // Add the image to the message currently shown.
    const row = imageCaption.closest(".message");
    const gallery = document.createElement("div");
    gallery.className = "sent-image-gallery";

    const image = document.createElement("img");
    image.className = "sent-image";
    image.src = imageUrl;
    image.alt = `Generated image: ${prompt}`;
    image.loading = "lazy";
    image.addEventListener("click", () => {
      openImagePreview(image.src);
    });

    gallery.appendChild(image);
    imageCaption.before(gallery);
    scrollToBottom();
  } catch (error) {
    status.textContent = `⚠ ${error.message || "Image generation failed."}`;
    status.style.color = "#ff9daa";
  } finally {
    imageGenerationBusy = false;
    generateImageButton.disabled = false;
    generateImageButton.textContent = "✦ Create image";
    promptBox.disabled = false;
    promptBox.focus();
  }
}

generateImageButton.addEventListener("click", generateImage);

checkStatus();
setInterval(checkStatus, 30000);