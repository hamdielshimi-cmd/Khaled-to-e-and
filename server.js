import express from "express";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the `public` directory (so GET / works)
const publicDir = path.join(process.cwd(), "public");
app.use(express.static(publicDir));

// Root route: serve `public/index.html` for GET /
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Authentication removed: app is open without login for knowledge-base usage.

// Ask - ENHANCED VERSION with comprehensive structured output
app.post("/ask", async (req, res) => {
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

  // Debug logging: show basic matching stats to help diagnose empty results
  console.debug("/ask question:", question);
  console.debug("INDEX size:", Array.isArray(INDEX) ? INDEX.length : typeof INDEX);
  console.debug("scored top:", scored.slice(0, 5).map(s => ({ file: s.file, score: s.score })));

  // If no high-confidence matches, fall back to the best match (if any) and mark low confidence
  let lowConfidence = false;
  if (relevant.length === 0) {
    if (scored.length === 0) {
      console.warn("No indexed chunks available to answer the question.");
      return res.json({
        answer_ar: "لا توجد معلومات كافية في المصادر الحالية.",
        sources: []
      });
    }
    // fallback: use the top-scoring chunk even if its score is low
    relevant.push(scored[0]);
    lowConfidence = true;
    console.info("No high-confidence matches — using top fallback chunk with score:", scored[0].score);
  }

  // ===== BUILD COMPREHENSIVE ANSWER =====
  const answer = buildComprehensiveAnswer(question, relevant, industry, scenario);
  
  res.json({ 
    answer_ar: answer, 
    low_confidence: lowConfidence,
    sources: relevant.map(s => ({
      file: path.basename(s.file),
      chunk_index: s.chunk_index,
      score: s.score
    }))
  });
});

  // Health check route
  app.get("/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime(), timestamp: Date.now() });
  });

// ===== COMPREHENSIVE ANSWER BUILDER =====
function buildComprehensiveAnswer(question, relevantChunks, industry, scenario) {
    let answer = "";
    
    // 1. INTRODUCTION
    answer += `# الإجابة الشاملة على سؤالك\n\n`;
    answer += `**السؤال:** ${question}\n\n`;
    
    if (industry) {
      answer += `**القطاع:** ${getIndustryLabel(industry)}\n`;
    }
    if (scenario) {
      answer += `**السيناريو:** ${getScenarioLabel(scenario)}\n`;
    }
    answer += `\n---\n\n`;

    // 2. EXECUTIVE SUMMARY
    answer += `## 📋 الملخص التنفيذي\n\n`;
    const summary = generateSummary(relevantChunks);
    answer += summary + "\n\n";
    answer += `---\n\n`;

    // 3. DETAILED EXPLANATION
    answer += `## 📖 الشرح التفصيلي\n\n`;
    answer += `### الهدف من هذا الحل:\n`;
    answer += `نحن هنا لنوضح لك بالضبط كيف يمكن استخدام Zoho لحل هذه المشكلة، بحيث كل خطوة واضحة ومفهومة.\n\n`;

    // 4. WORKFLOW STEPS
    answer += `### 🔄 دورة العمل الطبيعية:\n\n`;
    const workflow = generateWorkflow(relevantChunks, question);
    answer += workflow + "\n\n";

    // 5. DEPARTMENTS/MODULES INVOLVED
    answer += `### 🏢 الأقسام/الوحدات المشاركة:\n\n`;
    const modules = identifyModules(relevantChunks);
    answer += modules + "\n\n";

    // 6. STEP-BY-STEP IMPLEMENTATION
    answer += `## ⚙️ التطبيق خطوة بخطوة\n\n`;
    const steps = generateStepByStep(relevantChunks, question);
    answer += steps + "\n\n";

    // 7. COMMON PROBLEMS & SOLUTIONS
    answer += `## ⚠️ المشاكل الشائعة وحلولها\n\n`;
    const problems = generateProblemSolutions(relevantChunks);
    answer += problems + "\n\n";

    // 8. EXPECTED RESULTS
    answer += `## ✅ النتيجة المتوقعة:\n\n`;
    const results = generateExpectedResults(relevantChunks);
    answer += results + "\n\n";

    // 9. TECHNICAL DETAILS
    answer += `## 🔧 التفاصيل التقنية:\n\n`;
    const technical = extractTechnicalDetails(relevantChunks);
    answer += technical + "\n\n"; // Fix applied here

    // 10. PRICING / ROI (Structured based on previous intent)
    // This section was likely the source of the structural error.
    if (containsPricingInfo(relevantChunks)) {
        answer += `## 💰 الأسعار والعائد على الاستثمار\n\n`;
        const pricing = extractPricingInfo(relevantChunks);
        answer += pricing + "\n\n"; // Fixed and placed inside the IF block
    }
    // THE FUNCTION CONTINUES HERE, WITHOUT ANY PREMATURE CLOSING BRACE

    // 11. NEXT STEPS
    answer += `## 🎯 الخطوات التالية:\n\n`;
    answer += `1. **المراجعة:** راجع هذا الحل مع فريقك\n`;
    answer += `2. **التخطيط:** حدد الأولويات والجدول الزمني\n`;
    answer += `3. **التطبيق:** ابدأ بمرحلة تجريبية صغيرة\n`;
    answer += `4. **التوسع:** وسّع النطاق بعد النجاح الأولي\n\n`;

    // 12. SOURCE REFERENCES
    answer += `---\n\n`;
    answer += `## 📚 المصادر المستخدمة:\n\n`;
    relevantChunks.forEach((chunk, idx) => {
      answer += `${idx + 1}. **${path.basename(chunk.file)}** (جزء ${chunk.chunk_index}) - درجة التطابق: ${(chunk.score * 100).toFixed(1)}%\n`;
    });

    // THIS IS NOW THE CORRECT LINE (LINE 127 in the original code after fixes)
    return answer; 
} // <--- Final, correct closing brace for the function

// ===== HELPER FUNCTIONS =====

function generateSummary(chunks) {
  const allText = chunks.map(c => c.text).join(" ");
  const sentences = allText.split(/[.。！؟]/);
  const topSentences = sentences.slice(0, 3).filter(s => s.trim().length > 20);
  
  return topSentences.map((s, i) => `${i + 1}. ${s.trim()}.`).join("\n") || 
    "هذا الحل يساعدك على تحسين عملياتك باستخدام منصة Zoho المتكاملة.";
}

function generateWorkflow(chunks, question) {
  let workflow = "";
  
  const workflowKeywords = ["يقوم", "ثم", "بعد", "يتم", "يستلم", "يسلم", "يراجع"];
  const workflowSentences = [];
  
  chunks.forEach(chunk => {
    const sentences = chunk.text.split(/[.。]/);
    sentences.forEach(sent => {
      if (workflowKeywords.some(kw => sent.includes(kw))) {
        workflowSentences.push(sent.trim());
      }
    });
  });

  if (workflowSentences.length > 0) {
    workflowSentences.slice(0, 5).forEach((sent, idx) => {
      workflow += `**الخطوة ${idx + 1}:** ${sent}.\n\n`;
    });
  } else {
    workflow = `
**الخطوة 1:** تسجيل البيانات في النظام
**الخطوة 2:** معالجة المعلومات تلقائياً
**الخطوة 3:** مراجعة النتائج والموافقة
**الخطوة 4:** التنفيذ والمتابعة
**الخطوة 5:** إعداد التقارير والتحليل
    `;
  }
  
  return workflow;
}

function identifyModules(chunks) {
  const allText = chunks.map(c => c.text).join(" ");
  let modules = "";
  
  const zohoModules = {
    "CRM": "إدارة علاقات العملاء",
    "Books": "المحاسبة والمالية",
    "Inventory": "إدارة المخزون",
    "Desk": "خدمة العملاء والدعم",
    "People": "الموارد البشرية",
    "Projects": "إدارة المشاريع",
    "Campaigns": "الحملات التسويقية"
  };

  Object.entries(zohoModules).forEach(([key, value]) => {
    if (allText.toLowerCase().includes(key.toLowerCase())) {
      modules += `#### ${key} - ${value}\n`;
      modules += `**دوره:** يساعد في ${value.toLowerCase()} بشكل متكامل\n\n`;
    }
  });

  if (!modules) {
    modules = `#### Zoho One - المنصة المتكاملة\n`;
    modules += `**دوره:** توحيد جميع العمليات في نظام واحد\n\n`;
  }

  return modules;
}

function generateStepByStep(chunks, question) {
  let steps = "";
  const allText = chunks.map(c => c.text).join(" ");
  
  const numberedPattern = /(\d+)[.)]?\s+([^.\n]+)/g;
  const matches = [...allText.matchAll(numberedPattern)];
  
  if (matches.length > 2) {
    matches.slice(0, 6).forEach(match => {
      steps += `### ${match[1]}. ${match[2].trim()}\n\n`;
      steps += `**ما يحدث هنا:** يتم تنفيذ هذه الخطوة لضمان سير العمل بشكل صحيح.\n\n`;
      steps += `**✅ النتيجة:** تكتمل هذه المرحلة بنجاح وتنتقل للخطوة التالية.\n\n`;
    });
  } else {
    steps = `
### 1. التحضير والإعداد
**ما يحدث:** تجهيز النظام وإدخال البيانات الأساسية
**✅ النتيجة:** النظام جاهز للاستخدام

### 2. التنفيذ الفعلي
**ما يحدث:** بدء العمل على النظام وإدخال المعاملات
**✅ النتيجة:** المعاملات مسجلة بشكل صحيح

### 3. المراجعة والموافقة
**ما يحدث:** فحص البيانات والتأكد من صحتها
**✅ النتيجة:** البيانات معتمدة وجاهزة

### 4. التقارير والتحليل
**ما يحدث:** استخراج التقارير وتحليل الأداء
**✅ النتيجة:** رؤية واضحة للأداء والنتائج
    `;
  }
  
  return steps;
}

function generateProblemSolutions(chunks) {
  let problems = "";
  const allText = chunks.map(c => c.text).join(" ");
  
  const problemKeywords = ["مشكلة", "خطأ", "تحدي", "صعوبة", "عدم"];
  const solutionKeywords = ["حل", "معالجة", "تصحيح", "تحسين"];
  
  const sentences = allText.split(/[.。]/);
  let problemSolutions = [];
  
  sentences.forEach((sent, idx) => {
    if (problemKeywords.some(kw => sent.includes(kw))) {
      const problem = sent.trim();
      const nextSent = sentences[idx + 1]?.trim() || "";
      if (solutionKeywords.some(kw => nextSent.includes(kw))) {
        problemSolutions.push({ problem, solution: nextSent });
      }
    }
  });

  if (problemSolutions.length > 0) {
    problemSolutions.slice(0, 3).forEach((ps, idx) => {
      problems += `#### مثال ${idx + 1}: ${ps.problem}\n\n`;
      problems += `**الحل:** ${ps.solution}\n\n`;
      problems += `**كيف يتم داخل النظام:** يتم معالجة هذه الحالة تلقائياً مع إشعار الأطراف المعنية.\n\n`;
    });
  } else {
    problems = `
#### مثال 1: بيانات غير مكتملة
**الحل:** النظام ينبهك فوراً لإكمال البيانات المطلوبة
**كيف يتم:** رسالة تحذير واضحة مع تحديد الحقول المطلوبة

#### مثال 2: تأخير في التنفيذ
**الحل:** النظام يرسل تنبيهات تلقائية لجميع الأطراف المعنية
**كيف يتم:** إشعارات فورية عبر البريد والنظام

#### مثال 3: أخطاء في الحسابات
**الحل:** النظام يحسب تلقائياً ويمنع الأخطاء البشرية
**كيف يتم:** معادلات آلية ومراجعة مدمجة
    `;
  }
  
  return problems;
}

function generateExpectedResults(chunks) {
  return `
- ✅ **توفير الوقت:** تقليل الوقت المستغرق في العمليات اليدوية بنسبة 60-80%
- ✅ **دقة أعلى:** القضاء على الأخطاء البشرية في إدخال البيانات
- ✅ **رؤية واضحة:** تقارير فورية ودقيقة عن حالة العمل
- ✅ **تنسيق أفضل:** جميع الأقسام تعمل على نفس البيانات المحدثة
- ✅ **سهولة المتابعة:** كل معاملة موثقة ويمكن تتبعها بسهولة
  `;
}

function extractTechnicalDetails(chunks) {
  const allText = chunks.map(c => c.text).join(" ");
  let details = "";
  
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const urls = allText.match(urlPattern) || [];
  
  if (urls.length > 0) {
    details += `**الروابط المفيدة:**\n`;
    urls.slice(0, 3).forEach(url => {
      details += `- ${url}\n`;
    });
    details += `\n`;
  }
  
  details += `**المتطلبات التقنية:**\n`;
  details += `- متصفح حديث (Chrome, Firefox, Safari)\n`;
  details += `- اتصال إنترنت مستقر\n`;
  details += `- لا يتطلب تثبيت برامج إضافية\n\n`;
  
  details += `**الدعم والتكامل:**\n`;
  details += `- يتكامل مع أكثر من 1000 تطبيق\n`;
  details += `- API مفتوح للتطوير المخصص\n`;
  details += `- دعم فني 24/7\n`;
  
  return details;
}

function containsPricingInfo(chunks) {
  const allText = chunks.map(c => c.text).join(" ");
  return /(\d+)\s*(جنيه|EGP|dollar|USD)/i.test(allText) ||
         /سعر|تكلفة|pricing|price/i.test(allText);
}

function extractPricingInfo(chunks) {
  const allText = chunks.map(c => c.text).join(" ");
  let pricing = "";
  
  const pricePattern = /(\d+)\s*(جنيه|EGP|dollar|USD)/gi;
  const prices = allText.match(pricePattern) || [];
  
  if (prices.length > 0) {
    pricing += `**الأسعار المتاحة:**\n`;
    prices.slice(0, 5).forEach(price => {
      pricing += `- ${price}\n`;
    });
    pricing += `\n`;
  }
  
  pricing += `**العائد على الاستثمار (ROI):**\n`;
  pricing += `- توفير 47% من إجمالي تكلفة الملكية\n`;
  pricing += `- عائد استثمار 439% خلال 3 سنوات\n`;
  pricing += `- تقليل الوقت المستغرق بنسبة 70%\n`;
  
  return pricing;
}

function getIndustryLabel(industry) {
  const labels = {
    "retail": "التجزئة والتجارة الإلكترونية",
    "logistics": "الخدمات اللوجستية",
    "fintech": "التكنولوجيا المالية",
    "tourism": "السياحة والضيافة",
    "realestate": "العقارات والإنشاءات",
    "health": "الرعاية الصحية"
  };
  return labels[industry] || industry;
}

function getScenarioLabel(scenario) {
  const labels = {
    "discovery": "اكتشاف الاحتياجات",
    "objection": "معالجة الاعتراضات",
    "value": "توضيح القيمة",
    "recommend": "اختيار التطبيق المناسب",
    "workflow": "حل مشكلة تشغيلية",
    "closing": "إغلاق الصفقة"
  };
  return labels[scenario] || scenario;
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
