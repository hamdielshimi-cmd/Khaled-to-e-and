
/**
 * Zoho QnA App - Enhanced with simple auth, CI/CD-ready, Railway-ready.
 * Run:
 *   npm install
 *   ADMIN_USER=admin ADMIN_PASS=password node server.js
 *
 * Notes:
 * - For production, set ADMIN_USER and ADMIN_PASS (or ADMIN_PASS_HASH) in Railway/GitHub secrets.
 * - To enable Gemini integration, set GEMINI_API_KEY in environment variables on the host.
 */

import express from "express";
import fs from "fs/promises";
import path from "path";
import process from "process";
import session from "express-session";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
dotenv.config();

const DATA_DIR = "/mnt/data";
const KB_FILES = [
  path.join(DATA_DIR, "s.txt"),
  path.join(DATA_DIR, "Zoho tutrial.txt"),
  path.join(DATA_DIR, "how to use zoho.txt")
];
const KEY_PATH = path.join(DATA_DIR, "key.txt");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "password"; // used only if ADMIN_PASS_HASH not set
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || null;

const app = express();
app.use(express.json());
app.use(express.urlencoded({extended:true}));

// session
app.use(session({
  secret: process.env.SESSION_SECRET || "change_this_secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // set true if using HTTPS
}));

// serve login and static (but protect main files)
app.use("/public", express.static(path.join(process.cwd(), "public")));
app.use("/static", express.static(path.join(process.cwd(), "public")));
app.get("/", (req,res)=>{
  if(req.session && req.session.user){
    return res.sendFile(path.join(process.cwd(),"public","index.html"));
  } else {
    return res.sendFile(path.join(process.cwd(),"public","login.html"));
  }
});

// simple auth endpoints
app.post("/login", async (req,res)=>{
  const {username, password} = req.body || {};
  if(!username || !password) return res.status(400).json({ok:false, error:"username and password required"});
  // compare to env
  let valid = false;
  if(ADMIN_PASS_HASH){
    valid = await bcrypt.compare(password, ADMIN_PASS_HASH);
  } else {
    valid = (username === ADMIN_USER && password === ADMIN_PASS);
  }
  if(valid){
    req.session.user = username;
    return res.json({ok:true});
  } else return res.status(401).json({ok:false, error:"invalid credentials"});
});
app.post("/logout", (req,res)=>{
  req.session.destroy(()=>res.json({ok:true}));
});

// auth middleware
function ensureAuth(req,res,next){
  if(req.session && req.session.user) return next();
  return res.status(401).json({error:"auth required"});
}

/* In-memory index */
let INDEX = [];

/* Utilities (same as before) */
function splitToChunks(text, maxWords=220){
  const words = text.split(/\s+/);
  const chunks = [];
  for(let i=0;i<words.length;i+=maxWords){
    chunks.push(words.slice(i, i+maxWords).join(" "));
  }
  return chunks;
}
function tokenize(text){
  return text.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF\s]/gi," ").split(/\s+/).filter(Boolean);
}
function termFreqVector(tokens){
  const m = {};
  for(const t of tokens) m[t] = (m[t]||0)+1;
  return m;
}
function cosine(v1, v2){
  let num=0, n1=0, n2=0;
  for(const k in v1){
    if(v2[k]) num += v1[k]*v2[k];
    n1 += v1[k]*v1[k];
  }
  for(const k in v2) n2 += v2[k]*v2[k];
  if(n1===0 || n2===0) return 0;
  return num / (Math.sqrt(n1)*Math.sqrt(n2));
}

/* Protected ingest endpoint */
app.post("/ingest", ensureAuth, async (req,res)=>{
  INDEX = [];
  let total=0;
  for(const f of KB_FILES){
    try{
      const txt = await fs.readFile(f, "utf8");
      const chunks = splitToChunks(txt, 220);
      for(let i=0;i<chunks.length;i++){
        const chunk = chunks[i];
        const tokens = tokenize(chunk);
        const vec = termFreqVector(tokens);
        INDEX.push({
          id: `${path.basename(f)}::${i}`,
          file: f,
          chunk_index: i,
          text: chunk,
          tokens,
          vec
        });
        total++;
      }
    }catch(e){
      console.warn("Failed to read", f, e.message);
    }
  }
  res.json({ok:true, indexed: total});
});

/* Local search (protected) */
app.post("/search-local", ensureAuth, async (req,res)=>{
  const {question, top_k=6} = req.body || {};
  if(!question) return res.status(400).json({error:"question required"});
  const qtokens = tokenize(question);
  const qvec = termFreqVector(qtokens);
  const scored = INDEX.map(c=>{
    return {id:c.id, file:c.file, chunk_index:c.chunk_index, text:c.text, score: cosine(qvec, c.vec)};
  }).sort((a,b)=>b.score-a.score).slice(0, top_k);
  res.json({results: scored});
});

/* Ask endpoint: protected */
async function readKey(){
  try{
    const k = (await fs.readFile(KEY_PATH, "utf8")).trim();
    if(k) return k;
  }catch(e){}
  return null;
}
function buildPromptArabic(question, industry, scenario, chunks){
  let prompt = `أنت منسق محتوى لوكلاء مبيعات e& لمنتجات Zoho. استخدم فقط المقتطفات المرفقة. لا تضف معلومات خارجها.\n`;
  prompt += `سؤال: ${question}\nصناعة: ${industry||"عام"}\nنوع السؤال: ${scenario||"عام"}\n\nمقتطفات:\n`;
  for(let i=0;i<chunks.length;i++){
    const c = chunks[i];
    prompt += `### مقتطف ${i+1} (من: ${path.basename(c.file)}, index:${c.chunk_index})\n${c.text}\n\n`;
  }
  prompt += `\nأعطِ: 1) ملخص سريع 2) شرح تفصيلي 3) تطبيقات مقترحة 4) نصائح لمواجهة الاعتراضات 5) المراجع.\n`;
  return prompt;
}
async function callGeminiAPI(key, prompt){
  // Not implemented in this package. Use GEMINI_API_KEY env or /mnt/data/key.txt and implement HTTP call here.
  return {answer_ar: "Gemini integration not active in this package. Displaying local-generated answer."};
}
function assembleLocalAnswer(question, industry, scenario, chunks){
  if(!chunks || chunks.length===0){
    return "لا توجد معلومات مؤكدة داخل قاعدة المعرفة المحلية حول هذا السؤال. اقترح: تفعيل البحث على الإنترنت أو إضافة مصادر داخلية إضافية.";
  }
  const summary = `ملخّص سريع: ${chunks[0].text.slice(0,200)}...`;
  let details = `\nالشرح التفصيلي:\n`;
  details += `- لماذا هذا الحل مناسب: ${chunks[0].text.slice(0,180)}...\n`;
  details += `- خطوات مقترحة للتطبيق:\n`;
  details += `  1) ربط القنوات المناسبة\n  2) ضبط بيانات المنتجات/المخزون\n  3) تفعيل التنبيهات والتقارير\n`;
  details += `\nتطبيقات مقترحة: Zoho CRM, Zoho Inventory, Zoho Books (اعتمادًا على الحاجة).\n`;
  details += `\nنصائح للاعتراضات:\n- إذا قال العميل 'التكلفة': أرِه القيمة المتوقعة من تقليل الأخطاء وزيادة الكفاءة.\n`;
  const refs = chunks.map((c,i)=>`- ${path.basename(c.file)} (chunk ${c.chunk_index}) — score ${(c.score||0).toFixed(3)}`).join("\n");
  const confidence = Math.max(0, Math.min(1, chunks.reduce((s,c)=>s+(c.score||0),0)/chunks.length));
  return `${summary}\n${details}\nالمراجع:\n${refs}\n\nدرجة الثقة: ${confidence.toFixed(2)}`;
}

app.post("/ask", ensureAuth, async (req,res)=>{
  const {question, industry=null, scenario=null, top_k=6, use_gemini=false} = req.body || {};
  if(!question) return res.status(400).json({error:"question required"});
  const qtokens = tokenize(question);
  const qvec = termFreqVector(qtokens);
  const scored = INDEX.map(c=>({id:c.id, file:c.file, chunk_index:c.chunk_index, text:c.text, score:cosine(qvec,c.vec)}))
                     .sort((a,b)=>b.score-a.score).slice(0, top_k);
  const chunks = scored.filter(s => s.score>0.01);
  const confidence = chunks.length ? Math.max(0, Math.min(1, chunks.reduce((s,c)=>s+c.score,0)/chunks.length)) : 0;
  const key = await readKey();
  if(use_gemini && key){
    try{
      const prompt = buildPromptArabic(question, industry, scenario, chunks);
      const g = await callGeminiAPI(key, prompt);
      return res.json({answer_ar: g.answer_ar, sources: chunks, confidence});
    }catch(e){
      console.warn("Gemini call failed:", e.message);
    }
  }
  const ans = assembleLocalAnswer(question, industry, scenario, chunks);
  res.json({answer_ar: ans, sources: chunks, confidence});
});

// admin route to list sessions or index status
app.get("/admin/status", ensureAuth, (req,res)=>{
  res.json({ok:true, indexed: INDEX.length});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Zoho QnA server running on http://localhost:${PORT}`));
