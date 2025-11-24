import express from "express";
import fs from "fs/promises";
import path from "path";
import process from "process";
import session from "express-session";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import multer from "multer";

dotenv.config();

// ========== Paths ==========
const DATA_DIR = "/mnt/data";
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const KB_FILES = [
  path.join(DATA_DIR, "s.txt"),
  path.join(DATA_DIR, "Zoho tutrial.txt"),
  path.join(DATA_DIR, "how to use zoho.txt"),
  // any uploaded files will go into /mnt/data/uploads
];
const KEY_PATH = path.join(DATA_DIR, "key.txt");

// Ensure /mnt/data/uploads exists
await fs.mkdir(UPLOAD_DIR, { recursive: true });

// ========== Auth ==========
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "password";
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || null;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change_this_secret",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);

// Serve frontend
app.use("/public", express.static(path.join(process.cwd(), "public")));
app.get("/", (req, res) => {
  if (req.session && req.session.user) {
    return res.sendFile(path.join(process.cwd(), "public", "index.html"));
  } else {
    return res.sendFile(path.join(process.cwd(), "public", "login.html"));
  }
});

// Login
app.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ ok: false, error: "username and password required" });

  let valid = false;
  if (ADMIN_PASS_HASH) {
    valid = await bcrypt.compare(password, ADMIN_PASS_HASH);
  } else {
    valid = username === ADMIN_USER && password === ADMIN_PASS;
  }

  if (valid) {
    req.session.user = username;
    return res.json({ ok: true });
  } else {
    return res.status(401).json({ ok: false, error: "invalid credentials" });
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Protect endpoints
function ensureAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: "auth required" });
}

// ========== Multer for Upload ==========
const upload = multer({
  dest: UPLOAD_DIR,
});

// Upload files
app.post("/upload-files", ensureAuth, upload.array("files"), async (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ ok: false, error: "no files uploaded" });

  return res.json({ ok: true, uploaded: req.files.length });
});

// ======== RAG Engine ========
let INDEX = [];

function splitToChunks(text, maxWords = 220) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }
  return chunks;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF\s]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function termFreqVector(tokens) {
  const m = {};
  for (const t of tokens) m[t] = (m[t] || 0) + 1;
  return m;
}

function cosine(v1, v2) {
  let num = 0,
    n1 = 0,
    n2 = 0;
  for (const k in v1) {
    if (v2[k]) num += v1[k] * v2[k];
    n1 += v1[k] * v1[k];
  }
  for (const k in v2) n2 += v2[k] * v2[k];
  if (n1 === 0 || n2 === 0) return 0;
  return num / (Math.sqrt(n1) * Math.sqrt(n2));
}

// Ingest all files
app.post("/ingest", ensureAuth, async (req, res) => {
  INDEX = [];
  let total = 0;

  // Include uploaded files
  const uploadedFiles = await fs.readdir(UPLOAD_DIR);
  const uploadPaths = uploadedFiles.map((f) => path.join(UPLOAD_DIR, f));

  const allFiles = [...KB_FILES, ...uploadPaths];

  for (const f of allFiles) {
    try {
      const txt = await fs.readFile(f, "utf8");
      const chunks = splitToChunks(txt, 220);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const tokens = tokenize(chunk);
        const vec = termFreqVector(tokens);

        INDEX.push({
          id: `${path.basename(f)}::${i}`,
          file: f,
          chunk_index: i,
          text: chunk,
          tokens,
          vec,
        });
        total++;
      }
    } catch (e) {
      console.warn("Failed to read", f, e.message);
    }
  }

  res.json({ ok: true, indexed: total });
});

// Search
app.post("/search-local", ensureAuth, async (req, res) => {
  const { question, top_k = 6 } = req.body || {};
  if (!question) return res.status(400).json({ error: "question required" });

  const qtokens = tokenize(question);
  const qvec = termFreqVector(qtokens);

  const scored = INDEX.map((c) => ({
    id: c.id,
    file: c.file,
    chunk_index: c.chunk_index,
    text: c.text,
    score: cosine(qvec, c.vec),
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, top_k);

  res.json({ results: scored });
});

// Ask
app.post("/ask", ensureAuth, async (req, res) => {
  const { question, industry, scenario, top_k = 6 } = req.body || {};
  if (!question) return res.status(400).json({ error: "question required" });

  const qtokens = tokenize(question);
  const qvec = termFreqVector(qtokens);

  const scored = INDEX.map((c) => ({
    id: c.id,
    file: c.file,
    chunk_index: c.chunk_index,
    text: c.text,
    score: cosine(qvec, c.vec),
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, top_k);

  const relevant = scored.filter((s) => s.score > 0.01);

  const answerText =
    relevant.length === 0
      ? "لا توجد معلومات كافية في المصادر الحالية."
      : relevant
          .map(
            (c) =>
              `🔹 من (${path.basename(c.file)} - جزء ${c.chunk_index}):\n${c.text.slice(
                0,
                250
              )}...\n`
          )
          .join("\n");

  res.json({ answer_ar: answerText, sources: relevant });
});

// Status
app.get("/admin/status", ensureAuth, (req, res) => {
  res.json({ ok: true, indexed: INDEX.length });
});

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Zoho QnA server running on http://localhost:${PORT}`)
);
