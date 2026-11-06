/* =========================================================
   DAWID'S AI — WORKSPACE UPGRADES
   Chat search, gallery, Markdown, code, message actions,
   settings, export and chat management.
========================================================= */

(() => {
  "use strict";

  const $ = (selector, parent = document) =>
    parent.querySelector(selector);

  const $$ = (selector, parent = document) =>
    Array.from(parent.querySelectorAll(selector));

  const STORAGE_KEY = "dawids-ai-chats";
  const THEME_KEY = "dawids-ai-theme";

  let currentSearch = "";

  /* ---------------------------------------------------------
     GENERAL HELPERS
  --------------------------------------------------------- */

  function getChats() {
    try {
      const chats = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(chats) ? chats : [];
    } catch {
      return [];
    }
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }

  function downloadFile(filename, content, type = "text/plain") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);

      if (button) {
        const oldText = button.textContent;
        button.textContent = "Copied!";
        setTimeout(() => {
          button.textContent = oldText;
        }, 1400);
      }
    } catch {
      alert("Copying was blocked by your browser. Try using HTTPS.");
    }
  }

  /* ---------------------------------------------------------
     CHAT SEARCH
  --------------------------------------------------------- */

  const searchWrapper = document.createElement("div");
  searchWrapper.className = "upgrade-search";

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search conversations...";
  searchInput.setAttribute("aria-label", "Search conversations");

  const searchIcon = document.createElement("span");
  searchIcon.textContent = "⌕";
  searchIcon.setAttribute("aria-hidden", "true");

  searchWrapper.append(searchIcon, searchInput);

  const history = $("#history");
  const historyHeading = $(".history-heading");

  if (history && historyHeading) {
    historyHeading.insertAdjacentElement("afterend", searchWrapper);
  }

  function filterHistory() {
    currentSearch = searchInput.value.trim().toLowerCase();

    $$(".history-entry", history || document).forEach(entry => {
      const button = $(".history-item", entry);
      const title = button?.textContent.toLowerCase() || "";

      const chat = getChats().find(item => item.title === button?.textContent);

      const messageText = chat
        ? chat.messages.map(message => message.content || "").join(" ").toLowerCase()
        : "";

      entry.hidden = Boolean(
        currentSearch &&
        !title.includes(currentSearch) &&
        !messageText.includes(currentSearch)
      );
    });
  }

  searchInput.addEventListener("input", filterHistory);

  if (history) {
    new MutationObserver(filterHistory).observe(history, {
      childList: true,
      subtree: true
    });
  }

  /* ---------------------------------------------------------
     MARKDOWN RENDERER
     Safe DOM output: AI text is never inserted as HTML.
  --------------------------------------------------------- */

  function highlightCode(code, language) {
    const escaped = escapeHTML(code);

    if (!language) return escaped;

    const keywords = {
      javascript: /\b(const|let|var|function|return|if|else|for|while|class|new|async|await|try|catch|throw|import|export|from|default|this|true|false|null|undefined)\b/g,
      js: /\b(const|let|var|function|return|if|else|for|while|class|new|async|await|try|catch|throw|import|export|from|default|this|true|false|null|undefined)\b/g,
      html: null,
      css: /\b(color|background|display|flex|grid|margin|padding|position|width|height|font-size|border|transform|animation|transition)\b/g,
      python: /\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|with|lambda|True|False|None|async|await)\b/g
    };

    const key = language.toLowerCase();
    const pattern = keywords[key];

    if (!pattern) return escaped;

    // Basic highlighting without interpreting the code as HTML.
    return escaped.replace(
      pattern,
      '<span class="code-keyword">$1</span>'
    );
  }

  function inlineMarkdown(text, parent) {
    const pattern =
      /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|~~([^~]+)~~)/g;

    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      parent.appendChild(
        document.createTextNode(text.slice(lastIndex, match.index))
      );

      if (match[2] && match[3]) {
        const link = document.createElement("a");
        link.textContent = match[2];
        link.href = match[3];
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        parent.appendChild(link);
      } else if (match[4]) {
        const code = document.createElement("code");
        code.className = "inline-code";
        code.textContent = match[4];
        parent.appendChild(code);
      } else if (match[5] || match[6]) {
        const strong = document.createElement("strong");
        strong.textContent = match[5] || match[6];
        parent.appendChild(strong);
      } else if (match[7] || match[8]) {
        const italic = document.createElement("em");
        italic.textContent = match[7] || match[8];
        parent.appendChild(italic);
      } else if (match[9]) {
        const deleted = document.createElement("del");
        deleted.textContent = match[9];
        parent.appendChild(deleted);
      }

      lastIndex = pattern.lastIndex;
    }

    parent.appendChild(
      document.createTextNode(text.slice(lastIndex))
    );
  }

  function renderMarkdown(element, markdown) {
    if (!element) return;

    const source = String(markdown || "").replace(/\r\n/g, "\n");
    const lines = source.split("\n");
    const fragment = document.createDocumentFragment();

    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (!line.trim()) {
        index++;
        continue;
      }

      // Fenced code blocks
      const codeStart = line.match(/^```([\w#+.-]*)\s*$/);

      if (codeStart) {
        const language = codeStart[1] || "code";
        const codeLines = [];
        index++;

        while (index < lines.length && !/^```\s*$/.test(lines[index])) {
          codeLines.push(lines[index]);
          index++;
        }

        if (index < lines.length) index++;

        const wrapper = document.createElement("div");
        wrapper.className = "markdown-code-block";

        const header = document.createElement("div");
        header.className = "code-header";

        const languageLabel = document.createElement("span");
        languageLabel.textContent = language;

        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "code-copy";
        copyButton.textContent = "Copy code";

        const codeText = codeLines.join("\n");

        copyButton.addEventListener("click", () => {
          copyText(codeText, copyButton);
        });

        header.append(languageLabel, copyButton);

        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.className = `language-${language}`;

        // Highlighting output is escaped before spans are added.
        code.innerHTML = highlightCode(codeText, language);

        pre.appendChild(code);
        wrapper.append(header, pre);
        fragment.appendChild(wrapper);
        continue;
      }

      // Headings
      const heading = line.match(/^(#{1,6})\s+(.+)$/);

      if (heading) {
        const elementName = `h${heading[1].length}`;
        const headingElement = document.createElement(elementName);
        inlineMarkdown(heading[2], headingElement);
        fragment.appendChild(headingElement);
        index++;
        continue;
      }

      // Horizontal rule
      if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(=\s*){3,}$/.test(line.trim())) {
        fragment.appendChild(document.createElement("hr"));
        index++;
        continue;
      }

      // Tables
      if (
        line.includes("|") &&
        index + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1]) &&
        lines[index + 1].includes("-")
      ) {
        const rows = [line];
        index += 2;

        while (index < lines.length && lines[index].includes("|")) {
          rows.push(lines[index]);
          index++;
        }

        const table = document.createElement("table");
        table.className = "markdown-table";

        rows.forEach((row, rowIndex) => {
          const values = row
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map(value => value.trim());

          if (rowIndex === 0) {
            const thead = document.createElement("thead");
            const tr = document.createElement("tr");

            values.forEach(value => {
              const th = document.createElement("th");
              inlineMarkdown(value, th);
              tr.appendChild(th);
            });

            thead.appendChild(tr);
            table.appendChild(thead);
          } else {
            const tbody = table.querySelector("tbody") ||
              table.appendChild(document.createElement("tbody"));

            const tr = document.createElement("tr");

            values.forEach(value => {
              const td = document.createElement("td");
              inlineMarkdown(value, td);
              tr.appendChild(td);
            });

            tbody.appendChild(tr);
          }
        });

        fragment.appendChild(table);
        continue;
      }

      // Blockquotes
      if (/^\s*>\s?/.test(line)) {
        const quote = document.createElement("blockquote");

        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          const paragraph = document.createElement("p");
          inlineMarkdown(lines[index].replace(/^\s*>\s?/, ""), paragraph);
          quote.appendChild(paragraph);
          index++;
        }

        fragment.appendChild(quote);
        continue;
      }

      // Unordered lists
      if (/^\s*[-*+]\s+/.test(line)) {
        const list = document.createElement("ul");
        list.className = "markdown-list";

        while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
          const item = document.createElement("li");
          inlineMarkdown(lines[index].replace(/^\s*[-*+]\s+/, ""), item);
          list.appendChild(item);
          index++;
        }

        fragment.appendChild(list);
        continue;
      }

      // Ordered lists
      if (/^\s*\d+\.\s+/.test(line)) {
        const list = document.createElement("ol");
        list.className = "markdown-list";

        while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
          const item = document.createElement("li");
          inlineMarkdown(lines[index].replace(/^\s*\d+\.\s+/, ""), item);
          list.appendChild(item);
          index++;
        }

        fragment.appendChild(list);
        continue;
      }

      // Paragraph
      const paragraph = document.createElement("p");
      inlineMarkdown(line, paragraph);
      fragment.appendChild(paragraph);
      index++;
    }

    element.replaceChildren(fragment);
  }

  /* ---------------------------------------------------------
     CONNECT MARKDOWN TO YOUR EXISTING APP
  --------------------------------------------------------- */

  if (typeof window.renderPlainText === "function") {
    window.renderPlainText = (element, text) => {
      renderMarkdown(element, text);
    };
  }

  if (typeof window.appendMessage === "function") {
    const originalAppendMessage = window.appendMessage;

    window.appendMessage = function(role, content = "", attachments = []) {
      const output = originalAppendMessage(role, content, attachments);

      if (output) {
        renderMarkdown(output, content);

        if (role === "assistant") {
          const row = output.closest(".message");

          if (row && !$(".message-actions", row)) {
            const actions = document.createElement("div");
            actions.className = "message-actions";

            const copyButton = document.createElement("button");
            copyButton.type = "button";
            copyButton.textContent = "Copy";
            copyButton.title = "Copy this AI response";

            copyButton.addEventListener("click", () => {
              copyText(output.textContent, copyButton);
            });

            actions.appendChild(copyButton);
            row.querySelector(".message-body")?.appendChild(actions);
          }
        }
      }

      return output;
    };
  }

  /* ---------------------------------------------------------
     IMAGE GALLERY
  --------------------------------------------------------- */

  const galleryModal = document.createElement("div");
  galleryModal.className = "upgrade-modal";
  galleryModal.id = "galleryModal";
  galleryModal.hidden = true;

  galleryModal.innerHTML = `
    <div class="upgrade-modal-card gallery-modal-card">
      <div class="upgrade-modal-header">
        <div>
          <span class="upgrade-eyebrow">YOUR COLLECTION</span>
          <h2>Image gallery</h2>
          <p>Your saved AI-generated images.</p>
        </div>
        <button class="upgrade-close" type="button" aria-label="Close gallery">×</button>
      </div>
      <div class="upgrade-gallery-grid" id="upgradeGalleryGrid"></div>
      <p class="upgrade-empty" id="galleryEmpty" hidden>No saved images yet. Generate an image to see it here.</p>
    </div>
  `;

  document.body.appendChild(galleryModal);

  const galleryGrid = $("#upgradeGalleryGrid", galleryModal);
  const galleryEmpty = $("#galleryEmpty", galleryModal);

  function closeModal(modal) {
    modal.hidden = true;
    document.body.classList.remove("upgrade-modal-open");
  }

  function openModal(modal) {
    modal.hidden = false;
    document.body.classList.add("upgrade-modal-open");
  }

  $(".upgrade-close", galleryModal).addEventListener("click", () => {
    closeModal(galleryModal);
  });

  galleryModal.addEventListener("click", event => {
    if (event.target === galleryModal) closeModal(galleryModal);
  });

  function renderGallery() {
    galleryGrid.replaceChildren();

    const images = [];

    getChats().forEach(chat => {
      (chat.messages || []).forEach(message => {
        if (message.role !== "assistant") return;

        (message.attachments || []).forEach(attachment => {
          if (!attachment.dataUrl) return;

          images.push({
            src: attachment.dataUrl,
            name: attachment.name || "AI image",
            prompt: message.content || "",
            chatTitle: chat.title || "Conversation"
          });
        });
      });
    });

    galleryEmpty.hidden = images.length > 0;

    images.forEach(item => {
      const card = document.createElement("article");
      card.className = "upgrade-gallery-card";

      const image = document.createElement("img");
      image.src = item.src;
      image.alt = item.name;
      image.loading = "lazy";

      image.addEventListener("click", () => {
        const lightbox = $("#imageLightbox");
        const lightboxImage = $("#lightboxImage");
        const download = $("#lightboxDownload");

        if (lightbox && lightboxImage && download) {
          lightboxImage.src = item.src;
          download.href = item.src;
          lightbox.hidden = false;
          document.body.classList.add("lightbox-open");
          closeModal(galleryModal);
        }
      });

      const info = document.createElement("div");
      info.className = "upgrade-gallery-info";

      const title = document.createElement("strong");
      title.textContent = item.chatTitle;

      const prompt = document.createElement("p");
      prompt.textContent = item.prompt.replace(/^Generated image:\s*/i, "");

      const download = document.createElement("a");
      download.href = item.src;
      download.download = "dawids-ai-image.png";
      download.textContent = "↓ Download";

      info.append(title, prompt, download);
      card.append(image, info);
      galleryGrid.appendChild(card);
    });
  }

  /* ---------------------------------------------------------
     SETTINGS PANEL
  --------------------------------------------------------- */

  const settingsModal = document.createElement("div");
  settingsModal.className = "upgrade-modal";
  settingsModal.id = "settingsModal";
  settingsModal.hidden = true;

  settingsModal.innerHTML = `
    <div class="upgrade-modal-card settings-modal-card">
      <div class="upgrade-modal-header">
        <div>
          <span class="upgrade-eyebrow">PERSONALISE YOUR SPACE</span>
          <h2>Workspace settings</h2>
          <p>Adjust how Dawid's AI looks and feels.</p>
        </div>
        <button class="upgrade-close" type="button" aria-label="Close settings">×</button>
      </div>

      <div class="upgrade-setting">
        <div>
          <strong>Appearance</strong>
          <small>Choose your workspace theme.</small>
        </div>
        <select id="upgradeTheme">
          <option value="midnight">Midnight</option>
          <option value="cyberpunk">Cyberpunk</option>
          <option value="ocean">Ocean</option>
          <option value="emerald">Emerald</option>
          <option value="light">Light</option>
        </select>
      </div>

      <div class="upgrade-setting">
        <div>
          <strong>Ambient effects</strong>
          <small>Particles, cursor glow and background effects.</small>
        </div>
        <button class="upgrade-switch" id="upgradeAmbient" type="button">On</button>
      </div>

      <div class="upgrade-setting">
        <div>
          <strong>Export conversations</strong>
          <small>Download all your saved chats as Markdown.</small>
        </div>
        <button class="upgrade-action" id="exportAllChats" type="button">Export all</button>
      </div>

      <div class="upgrade-setting upgrade-danger-setting">
        <div>
          <strong>Clear all conversations</strong>
          <small>Permanently remove saved chat history from this browser.</small>
        </div>
        <button class="upgrade-action danger" id="clearAllChats" type="button">Clear history</button>
      </div>
    </div>
  `;

  document.body.appendChild(settingsModal);

  $(".upgrade-close", settingsModal).addEventListener("click", () => {
    closeModal(settingsModal);
  });

  settingsModal.addEventListener("click", event => {
    if (event.target === settingsModal) closeModal(settingsModal);
  });

  const upgradeTheme = $("#upgradeTheme");
  const upgradeAmbient = $("#upgradeAmbient");

  function syncSettings() {
    const themeSelector = $("#themeSelector");
    upgradeTheme.value = document.body.dataset.theme || "midnight";

    const isAmbientOff = document.body.classList.contains("ambient-off");
    upgradeAmbient.textContent = isAmbientOff ? "Off" : "On";
    upgradeAmbient.classList.toggle("is-off", isAmbientOff);
  }

  upgradeTheme.addEventListener("change", () => {
    const selector = $("#themeSelector");

    if (selector) {
      selector.value = upgradeTheme.value;
      selector.dispatchEvent(new Event("change"));
    } else {
      document.body.dataset.theme = upgradeTheme.value;
      localStorage.setItem(THEME_KEY, upgradeTheme.value);
    }
  });

  upgradeAmbient.addEventListener("click", () => {
    $("#ambientToggle")?.click();
    syncSettings();
  });

  /* ---------------------------------------------------------
     EXPORT
  --------------------------------------------------------- */

  function chatToMarkdown(chat) {
    const lines = [
      `# ${chat.title || "Untitled conversation"}`,
      "",
      `Exported: ${new Date().toLocaleString()}`,
      ""
    ];

    (chat.messages || []).forEach(message => {
      lines.push(message.role === "assistant" ? "## Dawid's AI" : "## You");
      lines.push("");

      if (message.content) {
        lines.push(message.content);
        lines.push("");
      }

      (message.attachments || []).forEach(attachment => {
        lines.push(`- Attachment: ${attachment.name || "Image"}`);
      });

      lines.push("");
    });

    return lines.join("\n");
  }

  function exportChat(chat) {
    const filename = (chat.title || "conversation")
      .replace(/[<>:"/\\|?*]+/g, "-")
      .slice(0, 70);

    downloadFile(
      `${filename}.md`,
      chatToMarkdown(chat),
      "text/markdown;charset=utf-8"
    );
  }

  $("#exportAllChats", settingsModal).addEventListener("click", () => {
    const chats = getChats();

    if (!chats.length) {
      alert("There are no conversations to export.");
      return;
    }

    const content = chats
      .map(chatToMarkdown)
      .join("\n\n---\n\n");

    downloadFile(
      "dawids-ai-conversations.md",
      content,
      "text/markdown;charset=utf-8"
    );
  });

  /* ---------------------------------------------------------
     CHAT MANAGEMENT
  --------------------------------------------------------- */

  $("#clearAllChats", settingsModal).addEventListener("click", () => {
    const confirmed = confirm(
      "Delete ALL saved conversations? This cannot be undone."
    );

    if (!confirmed) return;

    localStorage.removeItem(STORAGE_KEY);
    closeModal(settingsModal);

    // Reload lets the existing app initialise a fresh conversation.
    window.location.reload();
  });

  /* ---------------------------------------------------------
     TOPBAR WORKSPACE BUTTONS
  --------------------------------------------------------- */

  const topbarRight = $(".topbar-right");

  function createTopbarButton(id, label, icon, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "upgrade-topbar-button";
    button.id = id;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.innerHTML = `<span aria-hidden="true">${icon}</span><span>${label}</span>`;
    return button;
  }

  if (topbarRight) {
    const galleryButton = createTopbarButton(
      "openGallery",
      "Gallery",
      "▧",
      "Open image gallery"
    );

    const settingsButton = createTopbarButton(
      "openSettings",
      "Settings",
      "⚙",
      "Open workspace settings"
    );

    const modelName = $("#modelName");

    if (modelName) {
      const modelPill = modelName.closest(".model-pill");
      if (modelPill) modelPill.insertAdjacentElement("afterend", galleryButton);
      else topbarRight.prepend(galleryButton);
    } else {
      topbarRight.prepend(galleryButton);
    }

    topbarRight.appendChild(settingsButton);

    galleryButton.addEventListener("click", () => {
      renderGallery();
      openModal(galleryModal);
    });

    settingsButton.addEventListener("click", () => {
      syncSettings();
      openModal(settingsModal);
    });
  }

  /* ---------------------------------------------------------
     CHAT EXPORT BUTTON
  --------------------------------------------------------- */

  function addExportToChatMenu() {
    $$(".history-entry").forEach(entry => {
      const menuButton = $(".history-menu-button", entry);

      if (!menuButton || menuButton.dataset.exportUpgrade === "true") return;

      menuButton.dataset.exportUpgrade = "true";

      menuButton.addEventListener("click", () => {
        setTimeout(() => {
          const popup = $(".history-popup");

          if (!popup || $(".export-chat-button", popup)) return;

          const title = $(".history-item", entry)?.textContent;
          const chat = getChats().find(item => item.title === title);

          if (!chat) return;

          const exportButton = document.createElement("button");
          exportButton.type = "button";
          exportButton.className = "export-chat-button";
          exportButton.textContent = "↓ Export Markdown";

          exportButton.addEventListener("click", event => {
            event.stopPropagation();
            exportChat(chat);
            popup.remove();
          });

          popup.appendChild(exportButton);
        }, 0);
      });
    });
  }

  if (history) {
    new MutationObserver(addExportToChatMenu).observe(history, {
      childList: true,
      subtree: true
    });

    addExportToChatMenu();
  }

  /* ---------------------------------------------------------
     MODAL KEYBOARD ACCESS
  --------------------------------------------------------- */

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeModal(galleryModal);
      closeModal(settingsModal);
    }
  });

  console.info("Dawid's AI workspace upgrades loaded.");
})();