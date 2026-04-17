const $projects = document.getElementById("projects");
const $sessions = document.getElementById("sessions");
const $thread = document.getElementById("thread");
const $meta = document.getElementById("session-meta");
const $search = document.getElementById("search");

const state = {
  projects: [],
  activeProject: null,
  sessions: [],
  filteredSessions: [],
  activeSession: null,
};

function fmtRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

function fmtFull(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function fmtDuration(firstTs, lastTs) {
  if (!firstTs || !lastTs) return "—";
  const diff = (Date.parse(lastTs) - Date.parse(firstTs)) / 1000;
  if (diff < 60) return `${Math.round(diff)}s`;
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  const h = Math.floor(diff / 3600);
  const m = Math.round((diff % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtNum(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function dateGroup(iso) {
  if (!iso) return "Older";
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOf = new Date(d);
  dayOf.setHours(0, 0, 0, 0);
  const daysDiff = Math.round((today - dayOf) / 86400000);
  if (daysDiff <= 0) return "Today";
  if (daysDiff === 1) return "Yesterday";
  if (daysDiff < 7) return "Previous 7 days";
  if (daysDiff < 30) return "Previous 30 days";
  if (daysDiff < 365) return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return String(d.getFullYear());
}

function escape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Lightweight markdown rendering for message bodies (safe-by-default: all raw text escaped first)
function renderMarkdown(text) {
  if (!text) return "";
  const escaped = escape(text);
  // Code fences
  let html = escaped.replace(/```(\w+)?\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre><code>${code.replace(/\n$/, "")}</code></pre>`;
  });
  // Inline code
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // Bold
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  // Bare URLs
  html = html.replace(
    /(^|[\s(])((https?:\/\/)[^\s<)]+)/g,
    (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`,
  );
  // Paragraphs (split by blank lines, join single newlines)
  const parts = html.split(/\n{2,}/).map((p) => {
    if (p.startsWith("<pre>") || p.startsWith("<code>")) return p;
    return `<p>${p.replace(/\n/g, "<br>")}</p>`;
  });
  return parts.join("");
}

async function loadProjects() {
  const res = await fetch("/api/projects");
  state.projects = await res.json();
  renderProjects();
  if (state.projects.length) selectProject(state.projects[0].slug);
}

function renderProjects() {
  const itemsHtml = state.projects
    .map(
      (p) => `
    <div class="project-item ${p.slug === state.activeProject ? "active" : ""}" data-slug="${escape(p.slug)}">
      <span class="project-label" title="${escape(p.label)}">${escape(p.label)}</span>
      <span class="count">${p.sessionCount}</span>
    </div>
  `,
    )
    .join("");
  $projects.innerHTML = `<div class="projects-label">Projects</div>${itemsHtml}`;
  $projects.querySelectorAll(".project-item").forEach((el) => {
    el.onclick = () => selectProject(el.dataset.slug);
  });
}

async function selectProject(slug) {
  state.activeProject = slug;
  state.activeSession = null;
  renderProjects();
  $sessions.innerHTML = '<div class="loading">Loading sessions...</div>';
  const res = await fetch(`/api/sessions?project=${encodeURIComponent(slug)}`);
  state.sessions = await res.json();
  applyFilter();
}

function applyFilter() {
  const q = $search.value.trim().toLowerCase();
  state.filteredSessions = !q
    ? state.sessions
    : state.sessions.filter(
        (s) =>
          (s.title || "").toLowerCase().includes(q) ||
          (s.summary || "").toLowerCase().includes(q) ||
          s.sessionId.toLowerCase().includes(q) ||
          (s.gitBranch || "").toLowerCase().includes(q) ||
          (s.cwd || "").toLowerCase().includes(q),
      );
  renderSessions();
}

function renderSessions() {
  if (!state.filteredSessions.length) {
    $sessions.innerHTML = '<div class="loading">No sessions.</div>';
    return;
  }

  const groups = new Map();
  for (const s of state.filteredSessions) {
    const g = dateGroup(s.lastTs);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }

  const html = [];
  for (const [group, items] of groups) {
    html.push(`<div class="group-label">${escape(group)}</div>`);
    for (const s of items) {
      const branch = s.gitBranch ? `<span class="branch">${escape(s.gitBranch)}</span>` : "";
      html.push(`
        <div class="session-item ${s.sessionId === state.activeSession ? "active" : ""}" data-id="${s.sessionId}">
          <div class="session-actions">
            <button class="session-action" data-action="rename" title="Rename">✎</button>
            <button class="session-action danger" data-action="delete" title="Delete">✕</button>
          </div>
          <div class="session-title" data-title>${escape(s.title || "(untitled)")}</div>
          ${s.summary && s.summary !== s.title ? `<div class="session-summary">${escape(s.summary)}</div>` : ""}
          <div class="session-meta-line">
            <span>${escape(fmtRelative(s.lastTs))}</span>
            <span class="dot"></span>
            <span>${s.messageCount} msgs</span>
            ${branch ? `<span class="dot"></span>${branch}` : ""}
          </div>
        </div>
      `);
    }
  }
  $sessions.innerHTML = html.join("");
  $sessions.querySelectorAll(".session-item").forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest(".session-actions")) return;
      selectSession(el.dataset.id);
    };
    el.querySelector('[data-action="rename"]').onclick = (e) => {
      e.stopPropagation();
      startRename(el);
    };
    el.querySelector('[data-action="delete"]').onclick = (e) => {
      e.stopPropagation();
      confirmDelete(el);
    };
  });
}

function startRename(itemEl) {
  const id = itemEl.dataset.id;
  const sess = state.sessions.find((s) => s.sessionId === id);
  const titleEl = itemEl.querySelector("[data-title]");
  const current = sess?.title || "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rename-input";
  input.value = current;
  input.onclick = (e) => e.stopPropagation();
  input.onkeydown = async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await commitRename(id, input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      titleEl.textContent = current;
    }
  };
  input.onblur = async () => {
    await commitRename(id, input.value);
  };
  titleEl.innerHTML = "";
  titleEl.appendChild(input);
  input.focus();
  input.select();
}

async function commitRename(id, newTitle) {
  const sess = state.sessions.find((s) => s.sessionId === id);
  if (!sess) return;
  const trimmed = newTitle.trim();
  if (trimmed === (sess.title || "")) {
    renderSessions();
    return;
  }
  await fetch(`/api/title/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: trimmed }),
  });
  sess.title = trimmed || sess.originalTitle || "(untitled)";
  sess.customTitle = trimmed || null;
  applyFilter();
  if (state.activeSession === id) {
    renderMeta(sess);
  }
}

function confirmDelete(itemEl) {
  const btn = itemEl.querySelector('[data-action="delete"]');
  if (btn.classList.contains("confirm")) {
    deleteSession(itemEl.dataset.id);
    return;
  }
  btn.classList.add("confirm");
  btn.textContent = "delete?";
  const reset = () => {
    btn.classList.remove("confirm");
    btn.textContent = "✕";
  };
  setTimeout(reset, 3000);
}

async function deleteSession(id) {
  await fetch(
    `/api/session/${encodeURIComponent(state.activeProject)}/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  state.sessions = state.sessions.filter((s) => s.sessionId !== id);
  if (state.activeSession === id) {
    state.activeSession = null;
    $meta.classList.remove("visible");
    $thread.innerHTML =
      '<div class="empty-state"><div class="empty-icon">◐</div><div class="empty-title">Session deleted</div><div class="empty-sub">Moved to .trash — recoverable from <code>~/.claude/projects/&lt;project&gt;/.trash/</code></div></div>';
  }
  applyFilter();
}

async function selectSession(id) {
  state.activeSession = id;
  renderSessions();
  $thread.innerHTML = '<div class="loading">Loading session...</div>';
  const info = state.sessions.find((s) => s.sessionId === id);
  const res = await fetch(
    `/api/session/${encodeURIComponent(state.activeProject)}/${encodeURIComponent(id)}`,
  );
  const entries = await res.json();
  renderMeta(info, entries);
  renderThread(entries);
}

function copySessionId(el, id) {
  navigator.clipboard.writeText(id).then(() => {
    el.classList.add("copied");
    const orig = el.textContent;
    el.textContent = "copied";
    setTimeout(() => {
      el.classList.remove("copied");
      el.textContent = orig;
    }, 1200);
  });
}

function renderMeta(info) {
  if (!info) {
    $meta.classList.remove("visible");
    return;
  }
  $meta.classList.add("visible");
  const totalTokens = info.inputTokens + info.outputTokens;
  const toolsText = info.topTools?.length
    ? info.topTools.map((t) => `${t.name}×${t.count}`).join(", ")
    : "—";
  const modelsText = info.models?.length ? info.models.join(", ") : "—";
  $meta.innerHTML = `
    <div class="meta-id-row">
      <span class="meta-label">Session</span>
      <span class="session-id" id="sid" title="Click to copy">${escape(info.sessionId)}</span>
    </div>
    <h2 class="meta-title">${escape(info.title || "(untitled)")}</h2>
    ${info.summary && info.summary !== info.title ? `<p class="meta-summary">${escape(info.summary)}</p>` : ""}
    <div class="meta-chips">
      <span class="chip">Started <b>${escape(fmtFull(info.firstTs))}</b></span>
      <span class="chip">Last <b>${escape(fmtFull(info.lastTs))}</b></span>
      <span class="chip">Duration <b>${escape(fmtDuration(info.firstTs, info.lastTs))}</b></span>
      <span class="chip">Messages <b>${info.messageCount}</b> <span class="badge">${info.userMsgs}u / ${info.assistantMsgs}a</span></span>
      <span class="chip">Tool uses <b>${info.toolUses}</b></span>
      <span class="chip">Tokens <b>${fmtNum(totalTokens)}</b> <span class="badge">in ${fmtNum(info.inputTokens)} · out ${fmtNum(info.outputTokens)}${info.cacheReadTokens ? ` · cache ${fmtNum(info.cacheReadTokens)}` : ""}</span></span>
      <span class="chip">Model <b>${escape(modelsText)}</b></span>
      <span class="chip">Top tools <b>${escape(toolsText)}</b></span>
      ${info.gitBranch ? `<span class="chip">Branch <b>${escape(info.gitBranch)}</b></span>` : ""}
      ${info.version ? `<span class="chip">Version <b>${escape(info.version)}</b></span>` : ""}
      ${info.cwd ? `<span class="chip">cwd <b>${escape(info.cwd)}</b></span>` : ""}
      <span class="chip">Size <b>${(info.sizeBytes / 1024).toFixed(1)} KB</b></span>
    </div>
  `;
  const sid = document.getElementById("sid");
  if (sid) sid.onclick = () => copySessionId(sid, info.sessionId);
}

function renderContentBlocks(content) {
  if (typeof content === "string") return `<div class="msg-body">${renderMarkdown(content)}</div>`;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => {
      if (!b || typeof b !== "object") return "";
      if (b.type === "text") return `<div class="msg-body">${renderMarkdown(b.text || "")}</div>`;
      if (b.type === "thinking") {
        const t = (b.thinking || "").trim();
        if (!t) return "";
        return `<details class="block block-thinking"><summary>Thinking</summary><div class="block-content">${escape(t)}</div></details>`;
      }
      if (b.type === "tool_use") {
        const inputStr = b.input === undefined ? "" : JSON.stringify(b.input, null, 2);
        return `<details class="block block-tool-use"><summary>🔧 <span class="tool-name">${escape(b.name || "tool")}</span></summary><div class="block-content">${escape(inputStr)}</div></details>`;
      }
      if (b.type === "tool_result") {
        let content = b.content;
        if (Array.isArray(content))
          content = content.map((c) => (typeof c === "string" ? c : c?.text || "")).join("\n");
        const text = String(content ?? "").slice(0, 20000);
        const errClass = b.is_error ? " error" : "";
        return `<details class="block block-tool-result${errClass}"><summary>↩ tool_result${b.is_error ? " (error)" : ""}</summary><div class="block-content">${escape(text)}</div></details>`;
      }
      if (b.type === "image") return `<div class="msg-body"><em>[image]</em></div>`;
      return `<div class="msg-body">${escape(JSON.stringify(b))}</div>`;
    })
    .join("");
}

function renderThread(entries) {
  const out = [];
  for (const e of entries) {
    if (e.type === "user" || e.type === "assistant") {
      const role = e.type;
      const ts = e.timestamp ? new Date(e.timestamp).toLocaleString() : "";
      const model =
        e.type === "assistant" && e.message?.model
          ? `<span class="model">${escape(e.message.model)}</span>`
          : "";
      const content = e.message?.content ?? "";
      out.push(`
        <div class="msg ${role}">
          <div class="msg-role">
            <span class="role-label"><span class="role-dot"></span>${role}${model ? " " + model : ""}</span>
            <span class="ts">${escape(ts)}</span>
          </div>
          ${renderContentBlocks(content)}
        </div>
      `);
    } else if (e.type === "summary") {
      out.push(
        `<div class="msg summary"><div class="msg-role"><span class="role-label">summary</span></div><div class="msg-body">${renderMarkdown(e.summary || "")}</div></div>`,
      );
    }
  }
  $thread.innerHTML =
    out.join("") ||
    '<div class="empty-state"><div class="empty-title">Empty session</div></div>';
  $thread.scrollTop = 0;
}

$search.addEventListener("input", applyFilter);

// Theme
const THEME_KEY = "claude-code-ui:theme";
const $themeToggle = document.getElementById("theme-toggle");
function applyTheme(theme) {
  document.documentElement.classList.toggle("light", theme === "light");
  $themeToggle.textContent = theme === "light" ? "☀" : "☾";
  $themeToggle.title = theme === "light" ? "Switch to dark" : "Switch to light";
}
const saved = localStorage.getItem(THEME_KEY) || "dark";
applyTheme(saved);
$themeToggle.onclick = () => {
  const next = document.documentElement.classList.contains("light") ? "dark" : "light";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
};

loadProjects();
