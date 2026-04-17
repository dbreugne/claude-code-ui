import { readdir, readFile, writeFile, stat, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const PUBLIC_DIR = join(import.meta.dir, "public");
const PORT = Number(process.env.PORT ?? 4477);
const CONFIG_DIR = join(homedir(), ".claude-code-ui");
const TITLES_FILE = join(CONFIG_DIR, "titles.json");

async function loadTitles(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(TITLES_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveTitle(sessionId: string, title: string) {
  await mkdir(CONFIG_DIR, { recursive: true });
  const titles = await loadTitles();
  if (title.trim()) titles[sessionId] = title.trim().slice(0, 200);
  else delete titles[sessionId];
  await writeFile(TITLES_FILE, JSON.stringify(titles, null, 2));
  return titles;
}

type Entry = Record<string, any>;

async function listProjects() {
  const dirs = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const out: { slug: string; label: string; sessionCount: number; lastActivity: number }[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const projectPath = join(PROJECTS_DIR, d.name);
    let files: string[] = [];
    try {
      files = (await readdir(projectPath)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    let lastActivity = 0;
    for (const f of files) {
      const s = await stat(join(projectPath, f));
      if (s.mtimeMs > lastActivity) lastActivity = s.mtimeMs;
    }
    out.push({
      slug: d.name,
      label: d.name.replace(/^-/, "").replace(/-/g, "/"),
      sessionCount: files.length,
      lastActivity,
    });
  }
  return out.sort((a, b) => b.lastActivity - a.lastActivity);
}

function extractTextFromContent(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const b of content) {
    if (b?.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n");
}

function isBoilerplate(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.startsWith("<command-") || t.startsWith("<local-command")) return true;
  if (t.startsWith("<system-reminder>")) return true;
  if (t.startsWith("[Request interrupted")) return true;
  if (t.startsWith("Caveat:")) return true;
  return false;
}

function firstUserText(entries: Entry[]): string {
  for (const e of entries) {
    if (e?.type !== "user") continue;
    const text = extractTextFromContent(e.message?.content).trim();
    if (text && !isBoilerplate(text)) return text;
  }
  return "";
}

function buildTopic(entries: Entry[]): { title: string; summary: string } {
  const userTexts: string[] = [];
  for (const e of entries) {
    if (e?.type !== "user") continue;
    const text = extractTextFromContent(e.message?.content).trim();
    if (text && !isBoilerplate(text)) userTexts.push(text);
    if (userTexts.length >= 3) break;
  }
  const first = userTexts[0] ?? "";
  const title = first.replace(/\s+/g, " ").slice(0, 80);
  const summary = userTexts.slice(0, 3).map((t) => t.replace(/\s+/g, " ").slice(0, 140)).join(" · ");
  return { title, summary };
}

function computeStats(entries: Entry[]) {
  let userMsgs = 0;
  let assistantMsgs = 0;
  let toolUses = 0;
  const models = new Set<string>();
  const toolNames = new Map<string, number>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;

  for (const e of entries) {
    if (e?.type === "user") userMsgs++;
    if (e?.type === "assistant") {
      assistantMsgs++;
      const msg = e.message;
      if (msg?.model) models.add(msg.model);
      const u = msg?.usage;
      if (u) {
        inputTokens += u.input_tokens ?? 0;
        outputTokens += u.output_tokens ?? 0;
        cacheReadTokens += u.cache_read_input_tokens ?? 0;
      }
      if (Array.isArray(msg?.content)) {
        for (const b of msg.content) {
          if (b?.type === "tool_use") {
            toolUses++;
            toolNames.set(b.name, (toolNames.get(b.name) ?? 0) + 1);
          }
        }
      }
    }
  }

  const topTools = [...toolNames.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return {
    userMsgs,
    assistantMsgs,
    toolUses,
    models: [...models],
    topTools,
    inputTokens,
    outputTokens,
    cacheReadTokens,
  };
}

async function parseJsonl(path: string): Promise<Entry[]> {
  const raw = await readFile(path, "utf8");
  const out: Entry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

async function listSessions(projectSlug: string) {
  const dir = join(PROJECTS_DIR, projectSlug);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  const titles = await loadTitles();

  const out: any[] = [];

  await Promise.all(
    files.map(async (f) => {
      const full = join(dir, f);
      const s = await stat(full);
      const entries = await parseJsonl(full);
      const messages = entries.filter((e) => e.type === "user" || e.type === "assistant");
      const meta = entries.find((e) => e.cwd) ?? entries.find((e) => e.sessionId) ?? {};
      const first = messages[0];
      const last = messages[messages.length - 1];
      const topic = buildTopic(entries);
      const stats = computeStats(entries);
      const sessionId = f.replace(/\.jsonl$/, "");
      const customTitle = titles[sessionId];

      out.push({
        sessionId,
        title: customTitle || topic.title || "(untitled)",
        originalTitle: topic.title || "",
        customTitle: customTitle || null,
        summary: topic.summary,
        firstTs: first?.timestamp ?? null,
        lastTs: last?.timestamp ?? null,
        messageCount: messages.length,
        cwd: meta.cwd ?? null,
        gitBranch: meta.gitBranch ?? null,
        version: meta.version ?? null,
        sizeBytes: s.size,
        ...stats,
      });
    }),
  );

  return out.sort((a, b) => {
    const ta = a.lastTs ? Date.parse(a.lastTs) : 0;
    const tb = b.lastTs ? Date.parse(b.lastTs) : 0;
    return tb - ta;
  });
}

async function getSession(projectSlug: string, sessionId: string) {
  const full = join(PROJECTS_DIR, projectSlug, `${sessionId}.jsonl`);
  const entries = await parseJsonl(full);
  return entries;
}

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

async function deleteSession(projectSlug: string, sessionId: string) {
  if (!SAFE_ID.test(sessionId)) throw new Error("invalid session id");
  if (projectSlug.includes("/") || projectSlug.includes("..")) throw new Error("invalid project");
  const src = join(PROJECTS_DIR, projectSlug, `${sessionId}.jsonl`);
  const trashDir = join(PROJECTS_DIR, projectSlug, ".trash");
  await mkdir(trashDir, { recursive: true });
  const dest = join(trashDir, `${sessionId}.jsonl.${Date.now()}`);
  await rename(src, dest);
  return { ok: true, movedTo: dest };
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = Bun.file(join(PUBLIC_DIR, rel));
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file);
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    try {
      if (p === "/api/projects") return json(await listProjects());
      if (p === "/api/sessions") {
        const project = url.searchParams.get("project");
        if (!project) return json({ error: "missing project" }, { status: 400 });
        return json(await listSessions(project));
      }
      const m = p.match(/^\/api\/session\/([^/]+)\/([^/]+)$/);
      if (m) {
        const project = decodeURIComponent(m[1]);
        const id = decodeURIComponent(m[2]);
        if (req.method === "DELETE") return json(await deleteSession(project, id));
        return json(await getSession(project, id));
      }
      const t = p.match(/^\/api\/title\/([^/]+)$/);
      if (t && req.method === "PUT") {
        const id = decodeURIComponent(t[1]);
        if (!SAFE_ID.test(id)) return json({ error: "invalid id" }, { status: 400 });
        const body = await req.json().catch(() => ({}));
        const title = typeof body?.title === "string" ? body.title : "";
        await saveTitle(id, title);
        return json({ ok: true });
      }
    } catch (err: any) {
      return json({ error: err?.message ?? String(err) }, { status: 500 });
    }

    return serveStatic(p);
  },
});

console.log(`Claude session viewer running at http://localhost:${PORT}`);
