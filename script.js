// =============================================
// EXAMEDGE — script.js
// Supports overall timer AND section-wise timer.
// =============================================

// ── STATE ──────────────────────────────────
let questions = [];
let currentIndex = 0;
let userAnswers = {};
let questionState = {};
let timerInterval;
let timeLeft = 3600;
let isReviewMode = false;
let paletteFilter = "all";
let lastResult = null;
let isPaused = false;
let currentUser = null;

// Session vars
let examType = sessionStorage.getItem("examType") || "cgl";
let examMode = sessionStorage.getItem("examMode") || "full";
let selectedSubject = sessionStorage.getItem("selectedSubject") || null;
let selectedChapter = sessionStorage.getItem("selectedChapter") || null;
let mockNumber = parseInt(sessionStorage.getItem("mockNumber") || "0");
let timerMode = sessionStorage.getItem("timerMode") || "overall";

// Section-wise timer state
const SECTION_ORDER_DEFAULT = ["Reasoning", "GS", "Quant", "English"];
// Dynamic section order based on exam
function getSectionOrder() {
  const cfg = getCfg();
  return cfg.sections && cfg.sections.length
    ? cfg.sections
    : SECTION_ORDER_DEFAULT;
}
let sectionTimes = {}; // { Reasoning: 900, GS: 900, ... } in seconds
let currentSection = null; // active section name (section-timer mode)
let sectionExpired = {}; // { Reasoning: true/false, ... }

// ── FIREBASE AUTH ───────────────────────────
try {
  firebase.auth().onAuthStateChanged((user) => {
    currentUser = user;
  });
} catch (e) {}

// ── EXAM CONFIG ─────────────────────────────
// Each exam defines its own sections, marking, time, and question distribution
const EXAM_CONFIG = {
  cgl: {
    timeSeconds: 3600,
    label: "SSC CGL Tier 1",
    sections: ["Reasoning", "GS", "Quant", "English"],
    sectionIcons: { Reasoning: "🧩", GS: "🌍", Quant: "🔢", English: "📖" },
    sectionLabels: {
      Reasoning: "Reasoning",
      GS: "GS",
      Quant: "Quant",
      English: "English",
    },
    correctMark: 2,
    wrongMark: 0.5,
    totalQ: 100,
    perSection: { Reasoning: 25, GS: 25, Quant: 25, English: 25 },
  },
  chsl: {
    timeSeconds: 3600,
    label: "SSC CHSL Tier 1",
    sections: ["Reasoning", "GS", "Quant", "English"],
    sectionIcons: { Reasoning: "🧩", GS: "🌍", Quant: "🔢", English: "📖" },
    sectionLabels: {
      Reasoning: "Reasoning",
      GS: "GS",
      Quant: "Quant",
      English: "English",
    },
    correctMark: 2,
    wrongMark: 0.5,
    totalQ: 100,
    perSection: { Reasoning: 25, GS: 25, Quant: 25, English: 25 },
  },
  rrb_ntpc_g: {
    timeSeconds: 5400,
    label: "RRB NTPC Graduate",
    // RRB has NO English — only 3 sections, random order
    sections: ["Reasoning", "Quant", "GS"],
    sectionIcons: { Reasoning: "🧩", Quant: "🔢", GS: "🌍" },
    sectionLabels: {
      Reasoning: "Reasoning",
      Quant: "Mathematics",
      GS: "General Awareness",
    },
    correctMark: 1,
    wrongMark: 1 / 3,
    totalQ: 100,
    perSection: { Reasoning: 30, Quant: 30, GS: 40 },
    randomOrder: true, // questions shown in original random order, not grouped by section
  },
  jkp_si: {
    timeSeconds: 7200,
    label: "JKSSB Sub Inspector",
    sections: [
      "Reasoning",
      "General Awareness",
      "Quantitative Aptitude",
      "English",
      "Mathematical Abilities",
      "Computer Proficiency",
    ],
    sectionIcons: {
      Reasoning: "🧩",
      "General Awareness": "🌍",
      "Quantitative Aptitude": "🔢",
      English: "📖",
      "Mathematical Abilities": "📐",
      "Computer Proficiency": "💻",
    },
    sectionLabels: {
      Reasoning: "Reasoning",
      "General Awareness": "GK",
      "Quantitative Aptitude": "Quant",
      English: "English",
      "Mathematical Abilities": "Maths",
      "Computer Proficiency": "Computer",
    },
    correctMark: 2,
    wrongMark: 0.5,
    totalQ: 100,
    perSection: {
      Reasoning: 20,
      "General Awareness": 20,
      "Quantitative Aptitude": 15,
      English: 15,
      "Mathematical Abilities": 15,
      "Computer Proficiency": 15,
    },
  },
  rrb_ntpc_ug: {
    timeSeconds: 5400,
    label: "RRB NTPC Undergraduate",
    sections: ["Reasoning", "Quant", "GS"],
    sectionIcons: { Reasoning: "🧩", Quant: "🔢", GS: "🌍" },
    sectionLabels: {
      Reasoning: "Reasoning",
      Quant: "Mathematics",
      GS: "General Awareness",
    },
    correctMark: 1,
    wrongMark: 1 / 3,
    totalQ: 100,
    perSection: { Reasoning: 30, Quant: 30, GS: 40 },
    randomOrder: true,
  },
  jkp_ja: {
    timeSeconds: 4800,
    label: "JKSSB Junior Assistant",
    sections: [
      "English",
      "General Awareness",
      "Reasoning",
      "Computer Proficiency",
    ],
    sectionIcons: {
      English: "📖",
      "General Awareness": "🌍",
      Reasoning: "🧩",
      "Computer Proficiency": "💻",
    },
    sectionLabels: {
      English: "English",
      "General Awareness": "GK (J&K)",
      Reasoning: "Reasoning",
      "Computer Proficiency": "Computer",
    },
    correctMark: 1,
    wrongMark: 0.25,
    totalQ: 80,
    perSection: {
      English: 20,
      "General Awareness": 20,
      Reasoning: 20,
      "Computer Proficiency": 20,
    },
  },
  subject: {
    timeSeconds: 1500,
    label: "Subject Practice",
    sections: [],
    sectionIcons: {},
    sectionLabels: {},
    correctMark: 2,
    wrongMark: 0.5,
  },
};

// Helper: get config for current exam
function getCfg() {
  return EXAM_CONFIG[examType] || EXAM_CONFIG.cgl;
}

const SUBJECT_FILE = {
  Quant: "quant",
  Reasoning: "reasoning",
  GS: "gs",
  English: "english",
};

// ── AUTO QUESTION BANK ───────────────────────
// Extract questions from all mock JSONs automatically.
// Just add mock2.json, mock3.json etc. and they are included automatically.
const MOCK_PATTERNS = {
  cgl: { prefix: "mock", maxMocks: 20 },
  chsl: { prefix: "chsl_mock", maxMocks: 20 },
  rrb_ntpc_g: { prefix: "rrb_ntpc_g_mock", maxMocks: 20 },
  rrb_ntpc_ug: { prefix: "rrb_ntpc_ug_mock", maxMocks: 20 },
  jkp_si: { prefix: "jkp_si_mock", maxMocks: 20 },
  jkp_ja: { prefix: "jkp_ja_mock", maxMocks: 20 },
};

async function fetchAllMocksPool(examTypeKey) {
  const pattern = MOCK_PATTERNS[examTypeKey];
  if (!pattern) return [];
  const pool = [];
  for (let i = 1; i <= pattern.maxMocks; i++) {
    try {
      const r = await fetch(`data/${pattern.prefix}${i}.json`);
      if (!r.ok) break;
      const arr = await r.json();
      if (!Array.isArray(arr) || arr.length < 5) break;
      arr.forEach((q) => pool.push(normalizeSubject(q)));
    } catch (e) {
      break;
    }
  }
  return pool;
}

function dedupePool(pool) {
  const seen = new Set();
  return pool.filter((q) => {
    const key = (q.question || "").trim().toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Normalize subject names for CGL/CHSL/RRB — JKP keeps its own subject names
const CGL_RRB_SUBJECT_MAP = {
  "General Intelligence and Reasoning": "Reasoning",
  "General Intelligence & Reasoning": "Reasoning",
  "General Knowledge": "GS",
  "General Awareness": "GS",
  "Quantitative Aptitude": "Quant",
  Mathematics: "Quant",
  "English Comprehension": "English",
  "English Language": "English",
};
// JKP keeps these subject names as-is (they match examConfig sections exactly)
const JKP_SUBJECTS = new Set([
  "Reasoning",
  "General Awareness",
  "Quantitative Aptitude",
  "English",
  "Mathematical Abilities",
  "Computer Proficiency",
]);

function normalizeSubject(q) {
  if (examType === "jkp_si") return q; // JKP subjects stay as-is
  return { ...q, subject: CGL_RRB_SUBJECT_MAP[q.subject] || q.subject };
}

// ── AUDIO ───────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}
function playSound(type) {
  try {
    const ctx = getAudioCtx(),
      osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === "select") {
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } else if (type === "correct") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(523, ctx.currentTime);
      osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(784, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } else if (type === "wrong") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      osc.frequency.setValueAtTime(150, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else if (type === "navigate") {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
      osc.start();
      osc.stop(ctx.currentTime + 0.07);
    }
  } catch (e) {}
}

// ── CONFETTI ────────────────────────────────
function launchConfetti() {
  const canvas = document.getElementById("confettiCanvas");
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = [
    "#2563eb",
    "#38ef7d",
    "#f7b733",
    "#f093fb",
    "#00c6ff",
    "#f7294c",
    "#a78bfa",
  ];
  const pieces = Array.from({ length: 160 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height - canvas.height,
    w: Math.random() * 10 + 6,
    h: Math.random() * 5 + 3,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * 360,
    vy: Math.random() * 4 + 2,
    vx: (Math.random() - 0.5) * 2,
    vr: (Math.random() - 0.5) * 6,
    opacity: 1,
  }));
  let frame;
  (function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach((p) => {
      if (p.y < canvas.height + 20) {
        alive = true;
        p.y += p.vy;
        p.x += p.vx;
        p.rot += p.vr;
        if (p.y > canvas.height * 0.7) p.opacity -= 0.015;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    });
    if (alive) frame = requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  })();
  setTimeout(() => {
    cancelAnimationFrame(frame);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, 5000);
}

// ── DARK MODE ───────────────────────────────
function toggleDark() {
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  html.setAttribute("data-theme", isDark ? "light" : "dark");
  const btn = document.querySelector(".dark-toggle");
  if (btn) btn.textContent = isDark ? "🌙" : "☀️";
  localStorage.setItem("ssc-theme", isDark ? "light" : "dark");
}
function applyStoredTheme() {
  const t = localStorage.getItem("ssc-theme");
  if (t === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    const btn = document.querySelector(".dark-toggle");
    if (btn) btn.textContent = "☀️";
  }
}

// ── DIFFICULTY ──────────────────────────────
function getDifficulty(q) {
  if (q.difficulty) return q.difficulty;
  return ["Easy", "Medium", "Hard"][
    parseInt(q.id?.replace(/\D/g, "")?.slice(-1) || 0) % 3
  ];
}
function diffClass(d) {
  return d === "Easy"
    ? "diff-easy"
    : d === "Hard"
      ? "diff-hard"
      : "diff-medium";
}

// ── PROGRESS BAR ────────────────────────────
function updateProgressBar() {
  const answered = Object.values(questionState).filter(
    (s) => s === "answered",
  ).length;
  const pct = questions.length ? (answered / questions.length) * 100 : 0;
  const el = document.getElementById("topProgressFill");
  if (el) el.style.width = pct + "%";
}

// ── SECTION TABS ────────────────────────────
function updateSectionTabs() {
  const q = questions[currentIndex];
  if (!q) return;
  document.querySelectorAll(".section-select button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.sec === q.subject);
  });
  // Scroll active tab into view on mobile
  const active = document.querySelector(".section-select button.active");
  if (active)
    active.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: "smooth",
    });
}

// ════════════════════════════════════════════
// LOAD MOCK — main entry point
// ════════════════════════════════════════════
async function loadFullMock() {
  applyStoredTheme();
  const _aid = new URLSearchParams(window.location.search).get("analyse");
  if (_aid) {
    restoreAttemptForReview(_aid);
    return;
  }
  if (
    !sessionStorage.getItem("examType") &&
    !sessionStorage.getItem("examMode")
  ) {
    window.location.href = "exams.html";
    return;
  }
  const cfg = getCfg();
  if (examMode !== "subject" && examMode !== "chapter")
    timeLeft = cfg.timeSeconds;
  showLoadingOverlay(true);
  const titleEl = document.getElementById("examTitle");

  // ── Subject practice — extracts directly from all mock files, no separate JSON needed ──
  if (examMode === "subject" && selectedSubject) {
    if (titleEl)
      titleEl.textContent = `${cfg.sectionLabels[selectedSubject] || selectedSubject} Practice`;
    const subjectMins =
      parseInt(sessionStorage.getItem("subjectTimeMins") || "25") || 25;
    const qCount =
      parseInt(sessionStorage.getItem("practiceQCount") || "25") || 25;
    timeLeft = subjectMins * 60;
    try {
      // Pull from ALL available mocks for this exam — no separate subject JSON files required
      const srcExam = sessionStorage.getItem("practiceExamType") || "cgl";
      const mockPool = await fetchAllMocksPool(srcExam);
      const arr = dedupePool(
        mockPool.filter((q) => q.subject === selectedSubject),
      );
      if (!arr.length)
        throw new Error(
          `No questions found for "${selectedSubject}". Make sure mock files exist in data/ folder.`,
        );
      questions = smartPick(arr, qCount);
      // Re-index so qno matches palette position
      questions.forEach((q, i) => {
        q._idx = i;
      });
      initMock();
    } catch (err) {
      showLoadError(err);
    }
    return;
  }

  // ── Chapter practice — uses topic-tagged questions from mock pool or subject JSONs ──
  if (examMode === "chapter" && selectedSubject && selectedChapter) {
    const chapterLabel = selectedChapter
      .replace(/_/g, " ")
      .replace(/\w/g, (c) => c.toUpperCase());
    if (titleEl) titleEl.textContent = `${selectedSubject} · ${chapterLabel}`;
    const chapterMins =
      parseInt(sessionStorage.getItem("subjectTimeMins") || "15") || 15;
    const qCount =
      parseInt(sessionStorage.getItem("practiceQCount") || "15") || 15;
    timeLeft = chapterMins * 60;
    try {
      let pool = [];
      // First try dedicated subject JSON (has topic tags)
      const file = SUBJECT_FILE[selectedSubject];
      if (file) {
        try {
          const r = await fetch(`data/${file}.json`);
          if (r.ok) {
            const arr = await r.json();
            pool = arr.filter((q) => (q.topic || "") === selectedChapter);
          }
        } catch (e) {}
      }
      // Fallback: scan mock pool for topic-tagged questions
      if (!pool.length) {
        const srcExam = sessionStorage.getItem("practiceExamType") || "cgl";
        const mockPool = await fetchAllMocksPool(srcExam);
        pool = mockPool.filter(
          (q) =>
            q.subject === selectedSubject &&
            (q.topic || "") === selectedChapter,
        );
      }
      if (!pool.length)
        throw new Error(
          `No topic-tagged questions found for "${chapterLabel}". Add a topic field to your JSON questions.`,
        );
      questions = shuffle(pool).slice(0, Math.min(qCount, pool.length));
      questions.forEach((q, i) => {
        q._idx = i;
      });
      initMock();
    } catch (err) {
      showLoadError(err);
    }
    return;
  }

  // ── Full mock: load specific numbered file ──
  if (mockNumber >= 1) {
    const pattern = MOCK_PATTERNS[examType];
    const prefix = pattern ? pattern.prefix : "mock";
    if (titleEl) titleEl.textContent = `${cfg.label} — Mock ${mockNumber}`;
    try {
      const r = await fetch(`data/${prefix}${mockNumber}.json`);
      if (!r.ok)
        throw new Error(`Mock ${mockNumber} not found (HTTP ${r.status})`);
      const arr = await r.json();
      if (!arr || arr.length < 10)
        throw new Error(`Mock file has too few questions (${arr?.length})`);
      const normalized = arr.map(normalizeSubject);
      if (cfg.randomOrder) {
        questions = normalized; // RRB keeps original random order
      } else {
        const secs = cfg.sections || [];
        questions = [
          ...secs.flatMap((sec) => normalized.filter((q) => q.subject === sec)),
          ...normalized.filter((q) => !secs.includes(q.subject)),
        ];
      }
      initMock();
    } catch (err) {
      showLoadError(err);
    }
    return;
  }

  // ── Fallback: build random mock from all available mocks ──
  if (titleEl) titleEl.textContent = cfg.label;
  try {
    const pool = dedupePool(await fetchAllMocksPool(examType));
    if (pool.length >= 10) {
      const secs = cfg.sections || ["Reasoning", "GS", "Quant", "English"];
      const perSec = cfg.perSection || {};
      questions = secs.flatMap((sec) =>
        shuffle(pool.filter((q) => q.subject === sec)).slice(
          0,
          perSec[sec] || 25,
        ),
      );
      if (questions.length < 10)
        throw new Error("Not enough questions in pool");
      initMock();
    } else {
      throw new Error(
        "No mock files found. Add mock JSON files to data/ folder.",
      );
    }
  } catch (err) {
    showLoadError(err);
  }
}

// ── SMART PICK ──────────────────────────────
function smartPick(pool, target) {
  const standalones = pool.filter((q) => !q.passage_id);
  const passageMap = {};
  pool
    .filter((q) => q.passage_id)
    .forEach((q) => {
      if (!passageMap[q.passage_id]) passageMap[q.passage_id] = [];
      passageMap[q.passage_id].push(q);
    });
  Object.values(passageMap).forEach((g) =>
    g.sort((a, b) => (a.qno || 0) - (b.qno || 0)),
  );

  const passageGroups = shuffle(Object.values(passageMap));
  const shuffledAlone = shuffle(standalones);
  const selected = [];
  let slots = target,
    pgUsed = 0;

  for (const group of passageGroups) {
    if (slots <= 0 || pgUsed >= 1) break;
    if (group.length <= slots) {
      selected.push(...group);
      slots -= group.length;
      pgUsed++;
    }
  }
  for (const q of shuffledAlone) {
    if (slots <= 0) break;
    selected.push(q);
    slots--;
  }

  const aloneSelected = selected.filter((q) => !q.passage_id);
  const passageBlocks = {};
  selected
    .filter((q) => q.passage_id)
    .forEach((q) => {
      if (!passageBlocks[q.passage_id]) passageBlocks[q.passage_id] = [];
      passageBlocks[q.passage_id].push(q);
    });
  const aloneBlocks = aloneSelected.map((q) => [q]);
  const pBlockList = Object.values(passageBlocks);
  if (!pBlockList.length) return aloneBlocks.flat();
  const insertAt =
    aloneBlocks.length > 2
      ? 1 + Math.floor(Math.random() * (aloneBlocks.length - 1))
      : Math.floor(Math.random() * (aloneBlocks.length + 1));
  return [
    ...aloneBlocks.slice(0, insertAt),
    ...pBlockList,
    ...aloneBlocks.slice(insertAt),
  ].flat();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── LOADING / ERROR ─────────────────────────
function showLoadingOverlay(show) {
  let overlay = document.getElementById("loadingOverlay");
  if (!overlay && show) {
    overlay = document.createElement("div");
    overlay.id = "loadingOverlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:var(--bg,#f8fafc);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:999;gap:16px";
    overlay.innerHTML = `<div style="font-size:48px">⏳</div><p style="font-size:16px;color:var(--text2,#64748b)">Loading questions…</p>`;
    document.body.appendChild(overlay);
  } else if (overlay && !show) {
    overlay.remove();
  }
}
function showLoadError(err) {
  console.error("❌ Failed to load questions:", err);
  showLoadingOverlay(false);
  const container = document.getElementById("mainContainer");
  if (container) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px">
        <div style="font-size:56px;margin-bottom:16px">⚠️</div>
        <h2 style="margin-bottom:8px">Failed to Load Questions</h2>
        <p style="color:var(--text2);margin-bottom:8px">${err.message || err}</p>
        <button class="btn-primary" style="padding:12px 32px;border-radius:12px" onclick="location.reload()">🔄 Retry</button>
        <button class="btn-secondary" style="padding:12px 32px;border-radius:12px;margin-left:10px" onclick="goToExams()">← Back</button>
      </div>`;
    container.style.display = "block";
  }
  const ss = document.querySelector(".section-select");
  if (ss) ss.style.display = "none";
}

// ═══════════════════════════════════════════
// BROWSER BACK-BUTTON GUARD
// Push a dummy state so the browser back press
// fires popstate instead of leaving the page.
// ═══════════════════════════════════════════
function setupBackGuard() {
  // Push a state so there's something to pop back to
  history.pushState({ examPage: true }, "", location.href);

  window.addEventListener("popstate", function onPop(e) {
    // If the exam is already submitted / in result/review mode — allow leaving
    if (lastResult !== null) return;

    // Otherwise intercept: push state again so back-button doesn't leave,
    // pause the timer, and show the leave-confirmation modal.
    history.pushState({ examPage: true }, "", location.href);

    if (!isPaused) {
      clearInterval(timerInterval);
      isPaused = true;
      const overlay = document.getElementById("pauseOverlay");
      const pauseBtn = document.getElementById("pauseBtn");
      if (overlay) overlay.classList.add("active");
      if (pauseBtn) {
        pauseBtn.textContent = "▶ Resume";
        pauseBtn.classList.add("resumed");
      }
      const displayTime =
        timerMode === "section" && currentSection
          ? sectionTimes[currentSection]
          : timeLeft;
      const pt = document.getElementById("pauseTimer");
      if (pt) pt.textContent = fmtTime(displayTime);
    }

    // Show leave-confirmation modal
    confirmBack();
  });
}

// ═══════════════════════════════════════════
// INIT MOCK
// ═══════════════════════════════════════════
// ── BUILD SECTION TABS (exam-aware) ─────────
function buildSectionTabs() {
  const sel = document.getElementById("sectionSelect");
  if (!sel) return;
  const cfg = getCfg();
  if (examMode === "subject" || examMode === "chapter") {
    sel.style.display = "none";
    return;
  }
  const icons = cfg.sectionIcons || {
    Reasoning: "🧩",
    GS: "🌍",
    Quant: "🔢",
    English: "📖",
  };
  const labels = cfg.sectionLabels || {};
  // Use configured sections that have matching questions; fall back to actual subjects present
  const configured = cfg.sections || [];
  let present = configured.filter((sec) =>
    questions.some((q) => q.subject === sec),
  );
  if (present.length === 0) {
    const seen = new Set();
    questions.forEach((q) => {
      if (!seen.has(q.subject)) {
        seen.add(q.subject);
        present.push(q.subject);
      }
    });
  }
  if (present.length <= 1) {
    sel.style.display = "none";
    return;
  }
  sel.innerHTML = present
    .map(
      (sec) =>
        `<button onclick="jumpSection('${sec}')" data-sec="${sec}">${icons[sec] || "📋"} ${labels[sec] || sec}</button>`,
    )
    .join("");
  sel.style.display = "flex";
}

function initMock() {
  questions.forEach((q) => (questionState[q.id] = "notVisited"));
  currentIndex = 0;
  showLoadingOverlay(false);
  setupBackGuard();

  const backBtn = document.getElementById("backBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  if (backBtn) backBtn.style.display = "none";
  if (pauseBtn) pauseBtn.style.display = "flex";

  // ── Set up timer based on mode ──
  if (timerMode === "section") {
    initSectionTimer();
  } else {
    if (examMode !== "subject" && examMode !== "chapter") {
      const cfg = EXAM_CONFIG[examType] || EXAM_CONFIG.cgl;
      timeLeft = cfg.timeSeconds;
    }
  }

  buildSectionTabs();
  loadQuestion();
  renderPalette();
  startTimer();
}

// ═══════════════════════════════════════════
// SECTION-WISE TIMER SETUP
// ═══════════════════════════════════════════
function initSectionTimer() {
  // Load per-section times from sessionStorage (in minutes → convert to seconds)
  let stored = {};
  try {
    stored = JSON.parse(sessionStorage.getItem("sectionTimes") || "{}");
  } catch (e) {}

  const secs = getSectionOrder().filter((sec) =>
    questions.some((q) => q.subject === sec),
  );

  secs.forEach((sec) => {
    sectionTimes[sec] = (parseInt(stored[sec]) || 15) * 60;
    sectionExpired[sec] = false;
  });

  // Set global timeLeft = total of all section times
  timeLeft = Object.values(sectionTimes).reduce((a, b) => a + b, 0);

  // Set current section to first one
  currentSection = secs[0] || null;

  // Build strip chips
  buildSectionTimerStrip(secs);

  // Show strip
  const strip = document.getElementById("sectionTimerStrip");
  if (strip) strip.classList.add("visible");

  // Hide overall timer box, use strip instead
  const timerBox = document.getElementById("timerBox");
  if (timerBox) timerBox.style.display = "none";
}

function buildSectionTimerStrip(secs) {
  const strip = document.getElementById("sectionTimerStrip");
  if (!strip) return;
  const cfg = getCfg();
  const icons = cfg.sectionIcons || {
    Reasoning: "🧩",
    GS: "🌍",
    Quant: "🔢",
    English: "📖",
  };
  const labels = cfg.sectionLabels || {};
  strip.innerHTML = secs
    .map(
      (sec) => `
    <div class="sec-timer-chip ${sec === currentSection ? "active-sec" : ""}" id="chip-${sec}">
      <span class="sec-chip-name">${icons[sec] || "📋"} ${labels[sec] || sec}</span>
      <span class="sec-chip-time" id="chipTime-${sec}">${fmtTime(sectionTimes[sec])}</span>
    </div>`,
    )
    .join("");
}

function updateSectionStrip() {
  if (timerMode !== "section") return;
  const secs = getSectionOrder().filter((sec) =>
    questions.some((q) => q.subject === sec),
  );
  secs.forEach((sec) => {
    const chip = document.getElementById(`chip-${sec}`);
    const timeEl = document.getElementById(`chipTime-${sec}`);
    if (!chip || !timeEl) return;

    chip.classList.toggle("active-sec", sec === currentSection);
    chip.classList.toggle("expired-sec", sectionExpired[sec]);

    if (sectionExpired[sec]) {
      timeEl.textContent = "Done";
      timeEl.className = "sec-chip-time";
    } else if (sec === currentSection) {
      const t = sectionTimes[sec];
      timeEl.textContent = fmtTime(t);
      timeEl.className =
        "sec-chip-time" + (t < 60 ? " danger" : t < 180 ? " warning" : "");
    }
  });
}

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60),
    s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════
// TIMER
// ═══════════════════════════════════════════
function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (timerMode === "section") {
      tickSectionTimer();
    } else {
      timeLeft--;
      updateTimerDisplay();
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        submitTest();
      }
    }
  }, 1000);
}

function tickSectionTimer() {
  if (!currentSection) {
    submitTest();
    return;
  }

  sectionTimes[currentSection]--;
  timeLeft = Object.values(sectionTimes).reduce((a, b) => a + b, 0);
  updateSectionStrip();

  // Update main timer display with current-section time
  const el = document.getElementById("timer");
  if (el) el.textContent = fmtTime(sectionTimes[currentSection]);
  const box = document.getElementById("timerBox");
  if (box) {
    box.classList.remove("timer-warning", "timer-danger");
    if (sectionTimes[currentSection] < 60) box.classList.add("timer-danger");
    else if (sectionTimes[currentSection] < 180)
      box.classList.add("timer-warning");
  }

  if (sectionTimes[currentSection] <= 0) {
    sectionTimes[currentSection] = 0;
    sectionExpired[currentSection] = true;
    clearInterval(timerInterval);
    onSectionTimeUp(currentSection);
  }
}

function onSectionTimeUp(sec) {
  const nextSec = getNextSection(sec);
  const banner = document.getElementById("sectionLockedBanner");
  const title = document.getElementById("slbTitle");
  const sub = document.getElementById("slbSub");
  if (!banner) return;

  if (nextSec) {
    if (title) title.textContent = `⏰ ${sec} Time Up!`;
    if (sub)
      sub.textContent = `Moving to ${nextSec} section. Your answers are saved.`;
    banner.classList.add("visible");
  } else {
    // All sections done
    submitTest();
  }
}

function getNextSection(sec) {
  const secs = getSectionOrder().filter(
    (s) =>
      questions.some((q) => q.subject === s) && !sectionExpired[s] && s !== sec,
  );
  return secs[0] || null;
}

function advanceToNextSection() {
  const banner = document.getElementById("sectionLockedBanner");
  if (banner) banner.classList.remove("visible");

  const nextSec = getNextSection(currentSection);
  if (!nextSec) {
    submitTest();
    return;
  }
  currentSection = nextSec;
  jumpSection(nextSec);
  startTimer();
}

function updateTimerDisplay() {
  if (timerMode === "section") return; // handled by tickSectionTimer
  const el = document.getElementById("timer");
  if (el) el.textContent = fmtTime(timeLeft);
  const box = document.getElementById("timerBox");
  if (box) {
    box.classList.remove("timer-warning", "timer-danger");
    if (timeLeft < 300) box.classList.add("timer-danger");
    else if (timeLeft < 600) box.classList.add("timer-warning");
  }
}

// ── LOAD QUESTION ───────────────────────────
function loadQuestion() {
  if (isReviewMode) return;
  const q = questions[currentIndex];
  if (!q) return;
  if (questionState[q.id] === "notVisited") questionState[q.id] = "notAnswered";

  document.getElementById("qNumber").textContent =
    `Q${currentIndex + 1} / ${questions.length}`;
  // Show chapter name instead of subject key when in chapter mode
  const subjectLabel =
    examMode === "chapter" && selectedChapter
      ? selectedChapter
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : q.subject;
  document.getElementById("qSubject").textContent = subjectLabel;

  let passageHtml = "";
  if (q.passage_id && q.passage_text) {
    const range = getPassageRange(q);
    passageHtml = `<div class="passage-box"><span class="passage-label">📄 Passage${range ? " (Q" + range + ")" : ""}</span><p>${q.passage_text}</p></div>`;
  }
  const qnoTag = q.qno
    ? `<span class="q-orig-no">[Paper Q${q.qno}]</span>`
    : "";
  document.getElementById("question").innerHTML =
    passageHtml + `<p class="q-text">${qnoTag} ${q.question}</p>`;

  const letters = ["A", "B", "C", "D"];
  document.getElementById("options").innerHTML = q.options
    .map(
      (o, i) => `
    <div class="option-label ${userAnswers[q.id] === i ? "selected" : ""}" onclick="selectAnswer(${i})">
      <span class="option-letter">${letters[i]}</span><span>${o}</span>
    </div>`,
    )
    .join("");

  updateStatusCount();
  updateProgressBar();
  updateSectionTabs();
  renderPalette();
}

// ── ANSWERS ──────────────────────────────────
function selectAnswer(ans) {
  const q = questions[currentIndex];
  userAnswers[q.id] = ans;
  questionState[q.id] = "answered";
  playSound("select");
  document
    .querySelectorAll(".option-label")
    .forEach((el, i) => el.classList.toggle("selected", i === ans));
  updateStatusCount();
  updateProgressBar();
  renderPalette();
}
function clearResponse() {
  const q = questions[currentIndex];
  delete userAnswers[q.id];
  questionState[q.id] = "notAnswered";
  loadQuestion();
}

// ── NAVIGATION ───────────────────────────────
function saveNext() {
  playSound("navigate");
  if (currentIndex < questions.length - 1) {
    currentIndex++;
    loadQuestion();
  } else {
    // Last question reached — show popup
    showLastQuestionPopup();
  }
}

function showLastQuestionPopup() {
  // Remove any existing popup
  const existing = document.getElementById("lastQPopup");
  if (existing) existing.remove();

  const popup = document.createElement("div");
  popup.id = "lastQPopup";
  popup.innerHTML = `
    <div style="
      position:fixed;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(6px);
      z-index:8000;display:flex;align-items:center;justify-content:center;
      animation:fadeIn 0.2s ease;
    ">
      <div style="
        background:var(--surface);border-radius:20px;padding:36px 32px;
        max-width:380px;width:92%;text-align:center;
        box-shadow:0 20px 60px rgba(0,0,0,0.25);border:1px solid var(--border);
        animation:slideUp 0.25s ease;
      ">
        <div style="font-size:48px;margin-bottom:12px">🏁</div>
        <h3 style="font-family:'Cabinet Grotesk',sans-serif;font-size:20px;font-weight:800;margin-bottom:8px;color:var(--text)">
          You've reached the last question!
        </h3>
        <p style="color:var(--text2);font-size:14px;margin-bottom:24px;line-height:1.6">
          Would you like to go back to <strong>Question 1</strong> to review your answers?
        </p>
        <div style="display:flex;gap:10px;">
          <button onclick="closeLastQPopup()" style="
            flex:1;padding:12px;border:1.5px solid var(--border);background:transparent;
            color:var(--text2);border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;
          ">Stay Here</button>
          <button onclick="goToFirstQuestion()" style="
            flex:1;padding:12px;border:none;
            background:linear-gradient(135deg,var(--primary),var(--accent));
            color:#fff;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;
          ">Go to Q1 →</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(popup);
}

function closeLastQPopup() {
  const p = document.getElementById("lastQPopup");
  if (p) p.remove();
}

function goToFirstQuestion() {
  closeLastQPopup();
  currentIndex = 0;
  loadQuestion();
}
function prevQuestion() {
  playSound("navigate");
  if (currentIndex > 0) {
    currentIndex--;
    loadQuestion();
  }
}
function markReview() {
  const q = questions[currentIndex];
  questionState[q.id] = "review";
  saveNext();
}

// ── PALETTE ──────────────────────────────────
function jumpQuestion(i) {
  currentIndex = i;
  isReviewMode ? showReviewQuestion(i) : loadQuestion();
}
function jumpSection(sec) {
  // For random-order exams (RRB), jump to first question of that subject
  const i = questions.findIndex((q) => q.subject === sec);
  if (i === -1) return;
  currentIndex = i;
  isReviewMode ? showReviewQuestion(i) : loadQuestion();
}
function renderPalette() {
  let sections;
  if (examMode === "subject" || examMode === "chapter") {
    sections = [selectedSubject];
  } else {
    const cfg = getCfg();
    const configured = cfg.sections && cfg.sections.length ? cfg.sections : [];
    // Only use configured sections that actually have questions in this mock
    const matched = configured.filter((sec) =>
      questions.some((q) => q.subject === sec),
    );
    if (matched.length > 0) {
      sections = matched;
    } else {
      // Fallback: use whatever subjects are actually present, preserving order of first appearance
      const seen = new Set();
      sections = [];
      questions.forEach((q) => {
        if (!seen.has(q.subject)) {
          seen.add(q.subject);
          sections.push(q.subject);
        }
      });
    }
  }
  let html = "";
  sections.forEach((sec) => {
    let btns = "";
    questions.forEach((q, i) => {
      if (q.subject !== sec) return;
      if (isReviewMode) {
        const u = userAnswers[q.id];
        if (paletteFilter === "correct" && !(u !== undefined && u === q.answer))
          return;
        if (paletteFilter === "wrong" && !(u !== undefined && u !== q.answer))
          return;
        if (paletteFilter === "unattempted" && u !== undefined) return;
      }
      let cls = isReviewMode
        ? getReviewPaletteClass(q)
        : questionState[q.id] || "notVisited";
      if (i === currentIndex) cls += " currentQuestion";
      btns += `<button class="${cls}" onclick="jumpQuestion(${i})">${i + 1}</button>`;
    });
    if (!btns) return;
    html += `<div class="palette-section"><div class="palette-sec-label">${sec}</div><div class="palette-grid">${btns}</div></div>`;
  });
  document.getElementById("palette").innerHTML = html;
}

// ── STATUS ───────────────────────────────────
function updateStatusCount() {
  let a = 0,
    r = 0,
    n = 0;
  questions.forEach((q) => {
    const s = questionState[q.id];
    if (s === "answered") a++;
    else if (s === "review") r++;
    else n++;
  });
  document.getElementById("answeredCount").textContent = a;
  document.getElementById("reviewCount").textContent = r;
  document.getElementById("notCount").textContent = n;
}

// ── SUBMIT ───────────────────────────────────
function submitTest() {
  clearInterval(timerInterval);
  closeConfirm();
  const pauseBtn = document.getElementById("pauseBtn");
  const backBtn = document.getElementById("backBtn");
  const submitBtn = document.getElementById("submitBtn");
  if (pauseBtn) pauseBtn.style.display = "none";
  if (backBtn) backBtn.style.display = "flex";
  if (submitBtn) submitBtn.style.display = "none";
  if (isPaused) {
    isPaused = false;
    document.getElementById("pauseOverlay").classList.remove("active");
  }

  // Hide section strip
  const strip = document.getElementById("sectionTimerStrip");
  if (strip) strip.classList.remove("visible");

  // Scoring from exam config
  const correctMark = getCfg().correctMark || 2;
  const wrongMark = getCfg().wrongMark || 0.5;

  let score = 0,
    attempted = 0,
    correct = 0,
    wrong = 0;
  questions.forEach((q) => {
    if (userAnswers[q.id] !== undefined) {
      attempted++;
      if (userAnswers[q.id] === q.answer) {
        score += correctMark;
        correct++;
      } else {
        score -= wrongMark;
        wrong++;
      }
    }
  });
  showResult(score, attempted, correct, wrong);
}

// ── SHOW RESULT ──────────────────────────────
function showResult(score, a, c, w) {
  const total = questions.length,
    skipped = total - a,
    maxScore = total * (getCfg().correctMark || 2);
  const pct = total ? (c / total) * 100 : 0;
  const grade = getGrade(pct);
  lastResult = { score, a, c, w, skipped, total, maxScore, pct };

  const attempts = saveAttempt(score, c, w, skipped, total);
  renderLeaderboard(attempts);
  saveToFirestoreAndRefresh(score, c, w, skipped, total, pct);

  document.querySelector(".container").style.display = "none";
  document.querySelector(".section-select").style.display = "none";
  document.getElementById("resultBox").style.display = "block";

  const fmt = (v) =>
    typeof v === "number" ? (v % 1 === 0 ? v : v.toFixed(1)) : v;
  setText("rScore", fmt(score));
  setText("rMax", maxScore);
  setText("rAttempted", a);
  setText("rCorrect", c);
  setText("rWrong", w);
  setText("rSkipped", skipped);
  setText("resultTrophy", grade.emoji);
  setText("resultTitle", "Exam Complete");
  setText("resultSubtitle", grade.msg);
  const badge = document.getElementById("gradeBadge");
  if (badge) {
    badge.textContent = grade.g;
    badge.className = `grade-badge grade-${grade.g}`;
  }

  setTimeout(() => {
    setBar("barAccuracy", pct.toFixed(1), "rAccuracy", pct.toFixed(1) + "%");
    setBar("barCorrect", pct.toFixed(1), "rCorrectPct", `${c}/${total}`);
    setBar(
      "barWrong",
      ((w / total) * 100).toFixed(1),
      "rWrongPct",
      `${w}/${total}`,
    );
    setBar(
      "barSkipped",
      ((skipped / total) * 100).toFixed(1),
      "rSkippedPct",
      `${skipped}/${total}`,
    );
  }, 150);

  buildSubjectCharts();
  if (pct >= 60) setTimeout(launchConfetti, 400);
  playSound(pct >= 60 ? "correct" : "wrong");
}
function setBar(barId, pct, labelId, labelText) {
  const bar = document.getElementById(barId),
    lbl = document.getElementById(labelId);
  if (bar) bar.style.width = Math.max(pct, 3) + "%";
  if (lbl) lbl.textContent = labelText;
}

// ── GRADE ────────────────────────────────────
function getGrade(pct) {
  if (pct >= 90)
    return { g: "S", msg: "🎉 Outstanding! You crushed it!", emoji: "🏆" };
  if (pct >= 75)
    return { g: "A", msg: "🌟 Excellent performance!", emoji: "🥇" };
  if (pct >= 60)
    return { g: "B", msg: "👍 Good job! Keep pushing.", emoji: "🎯" };
  if (pct >= 45)
    return { g: "C", msg: "📚 Decent. Room to improve.", emoji: "📈" };
  return { g: "D", msg: "💪 Keep practising, you'll get there!", emoji: "🔥" };
}

// ── LEADERBOARD SAVE ─────────────────────────
function saveAttempt(score, correct, wrong, skipped, total) {
  const attempts = getAttempts();
  const attemptId = "attempt_" + Date.now();
  const cfg = getCfg();

  // ── Compute subject-wise stats ──────────────
  const subjectStats = {};
  questions.forEach((q) => {
    const subj = q.subject || "Unknown";
    if (!subjectStats[subj])
      subjectStats[subj] = { correct: 0, wrong: 0, total: 0 };
    subjectStats[subj].total++;
    const u = userAnswers[q.id];
    if (u !== undefined) {
      if (u === q.answer) subjectStats[subj].correct++;
      else subjectStats[subj].wrong++;
    }
  });

  // ── Compute topic-wise stats ─────────────────
  const topicStats = {};
  questions.forEach((q) => {
    const topic = q.topic;
    if (!topic) return;
    if (!topicStats[topic])
      topicStats[topic] = {
        correct: 0,
        wrong: 0,
        total: 0,
        subject: q.subject || "",
      };
    topicStats[topic].total++;
    const u = userAnswers[q.id];
    if (u !== undefined) {
      if (u === q.answer) topicStats[topic].correct++;
      else topicStats[topic].wrong++;
    }
  });

  const maxScore = total * (cfg.correctMark || 2);

  const newAttempt = {
    id: attemptId,
    score,
    correct,
    wrong,
    skipped,
    total,
    maxScore,
    accuracy: total ? ((correct / total) * 100).toFixed(1) : 0,
    examType: EXAM_CONFIG[examType]?.label || examType,
    examTypeKey: examType,
    mockNumber: mockNumber || 0,
    examMode: examMode || "full",
    selectedSubject: selectedSubject || null,
    selectedChapter: selectedChapter || null,
    subjectStats,
    topicStats,
    date: new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
  attempts.unshift(newAttempt);
  try {
    localStorage.setItem("ssc-attempts", JSON.stringify(attempts.slice(0, 20)));
    const snapshot = {
      questions,
      userAnswers,
      examMode,
      examType,
      mockNumber,
      selectedSubject,
      selectedChapter,
    };
    localStorage.setItem("snapshot_" + attemptId, JSON.stringify(snapshot));
    const allKeys = Object.keys(localStorage).filter((k) =>
      k.startsWith("snapshot_"),
    );
    if (allKeys.length > 20) {
      allKeys.sort();
      allKeys
        .slice(0, allKeys.length - 20)
        .forEach((k) => localStorage.removeItem(k));
    }
  } catch (e) {}
  return attempts;
}
function getAttempts() {
  try {
    return JSON.parse(localStorage.getItem("ssc-attempts") || "[]");
  } catch (e) {
    return [];
  }
}

// ── RESTORE PAST ATTEMPT FOR ANALYSIS ────────
function restoreAttemptForReview(attemptId) {
  applyStoredTheme();
  showLoadingOverlay(false);

  const raw = localStorage.getItem("snapshot_" + attemptId);
  if (!raw) {
    const container = document.getElementById("mainContainer");
    if (container) {
      container.innerHTML = `
        <div style="text-align:center;padding:60px 20px">
          <div style="font-size:56px;margin-bottom:16px">📭</div>
          <h2 style="margin-bottom:8px">Snapshot Not Available</h2>
          <p style="color:var(--text2);margin-bottom:20px">This attempt was saved before the Analyse feature was added.<br>Take a new test to enable full analysis.</p>
          <button class="btn-secondary" style="padding:12px 32px;border-radius:12px" onclick="goToExams()">← Back to Exams</button>
        </div>`;
      container.style.display = "block";
    }
    const ss = document.querySelector(".section-select");
    if (ss) ss.style.display = "none";
    return;
  }

  try {
    const snap = JSON.parse(raw);
    questions = snap.questions;
    userAnswers = snap.userAnswers;
    examMode = snap.examMode || "full";
    examType = snap.examType || "cgl";
    mockNumber = snap.mockNumber || 0;
    selectedSubject = snap.selectedSubject || null;
    selectedChapter = snap.selectedChapter || null;

    questionState = {};
    questions.forEach((q) => {
      questionState[q.id] =
        userAnswers[q.id] !== undefined ? "answered" : "notAnswered";
    });

    const cMark = getCfg().correctMark || 2;
    const wMark = getCfg().wrongMark || 0.5;
    let correct = 0,
      wrong = 0,
      attempted = 0;
    questions.forEach((q) => {
      const u = userAnswers[q.id];
      if (u !== undefined) {
        attempted++;
        if (u === q.answer) correct++;
        else wrong++;
      }
    });
    const total = questions.length;
    const skipped = total - attempted;
    const score = correct * cMark - wrong * wMark;
    const maxScore = total * cMark;
    const pct = total ? (correct / total) * 100 : 0;
    const grade = getGrade(pct);

    lastResult = {
      score,
      a: attempted,
      c: correct,
      w: wrong,
      skipped,
      total,
      maxScore,
      pct,
    };
    isReviewMode = false;
    currentIndex = 0;

    const containerEl = document.querySelector(".container");
    const secSelect = document.querySelector(".section-select");
    const resultBox = document.getElementById("resultBox");
    if (containerEl) containerEl.style.display = "none";
    if (secSelect) secSelect.style.display = "none";
    if (resultBox) resultBox.style.display = "block";

    const backBtn = document.getElementById("backBtn");
    const pauseBtn = document.getElementById("pauseBtn");
    const submitBtn = document.getElementById("submitBtn");
    if (backBtn) backBtn.style.display = "flex";
    if (pauseBtn) pauseBtn.style.display = "none";
    if (submitBtn) submitBtn.style.display = "none";
    const _aTitleEl = document.getElementById("examTitle");
    if (_aTitleEl) {
      const _aCfg = EXAM_CONFIG[examType] || {};
      const _aMode =
        examMode === "subject"
          ? ` · ${selectedSubject || ""} Practice`
          : examMode === "chapter"
            ? ` · ${(selectedChapter || "").replace(/_/g, " ")}`
            : mockNumber
              ? ` — Mock ${mockNumber}`
              : "";
      _aTitleEl.textContent = `${_aCfg.label || examType}${_aMode}`;
    }
    const _aTimerBox = document.getElementById("timerBox");
    if (_aTimerBox) _aTimerBox.style.display = "none";

    if (resultBox) {
      let banner = document.getElementById("analyseBanner");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "analyseBanner";
        banner.style.cssText =
          "background:rgba(37,99,235,.08);border:1.5px solid rgba(37,99,235,.25);border-radius:12px;padding:10px 18px;margin-bottom:18px;font-size:13px;font-weight:600;color:var(--primary);text-align:center";
        resultBox.insertBefore(banner, resultBox.firstChild);
      }
      banner.textContent = "📊 Viewing past attempt — results are read-only";
    }

    const fmt = (v) =>
      typeof v === "number" ? (v % 1 === 0 ? v : v.toFixed(1)) : v;
    setText("rScore", fmt(score));
    setText("rMax", maxScore);
    setText("rAttempted", attempted);
    setText("rCorrect", correct);
    setText("rWrong", wrong);
    setText("rSkipped", skipped);
    setText("resultTrophy", grade.emoji);
    setText("resultTitle", "Attempt Analysis");
    setText("resultSubtitle", grade.msg);
    const badge = document.getElementById("gradeBadge");
    if (badge) {
      badge.textContent = grade.g;
      badge.className = `grade-badge grade-${grade.g}`;
    }

    setTimeout(() => {
      setBar("barAccuracy", pct.toFixed(1), "rAccuracy", pct.toFixed(1) + "%");
      setBar(
        "barCorrect",
        pct.toFixed(1),
        "rCorrectPct",
        `${correct}/${total}`,
      );
      setBar(
        "barWrong",
        ((wrong / total) * 100).toFixed(1),
        "rWrongPct",
        `${wrong}/${total}`,
      );
      setBar(
        "barSkipped",
        ((skipped / total) * 100).toFixed(1),
        "rSkippedPct",
        `${skipped}/${total}`,
      );
    }, 150);

    buildSubjectCharts();
    if (pct >= 60) setTimeout(launchConfetti, 400);
    playSound(pct >= 60 ? "correct" : "wrong");
  } catch (e) {
    console.error("restoreAttemptForReview error:", e);
    const container = document.getElementById("mainContainer");
    if (container) {
      container.innerHTML = `<div style="text-align:center;padding:60px 20px"><div style="font-size:56px">⚠️</div><h2>Could not restore attempt</h2><p style="color:var(--text2);margin-top:8px">${e.message}</p><button class="btn-secondary" style="margin-top:20px;padding:12px 32px;border-radius:12px" onclick="goToExams()">← Back</button></div>`;
      container.style.display = "block";
    }
  }
}

function retryAttempt(attemptId) {
  const raw = localStorage.getItem("snapshot_" + attemptId);
  if (!raw) {
    alert("Snapshot not available for this attempt.");
    return;
  }
  try {
    const snap = JSON.parse(raw);
    sessionStorage.setItem("examType", snap.examType || "cgl");
    sessionStorage.setItem("examMode", snap.examMode || "full");
    sessionStorage.setItem("mockNumber", String(snap.mockNumber || 0));
    if (snap.selectedSubject)
      sessionStorage.setItem("selectedSubject", snap.selectedSubject);
    if (snap.selectedChapter)
      sessionStorage.setItem("selectedChapter", snap.selectedChapter);
    sessionStorage.setItem("timerMode", "overall");
    sessionStorage.removeItem("sectionTimes");
    window.location.href = "exam.html";
  } catch (e) {
    alert("Could not retry this attempt.");
  }
}

function buildSubjectCharts() {
  const cfg = getCfg();
  // Build subject list — use configured sections that match; fall back to actual subjects present
  const presentSubjects = [...new Set(questions.map((q) => q.subject))];
  const configured = cfg.sections && cfg.sections.length ? cfg.sections : [];
  const matched = configured.filter((s) => presentSubjects.includes(s));
  const orderedSubjects = matched.length > 0 ? matched : presentSubjects;

  const icons = cfg.sectionIcons || {
    Reasoning: "🧩",
    GS: "🌍",
    Quant: "🔢",
    English: "📖",
  };
  const accentMap = {
    Reasoning: "reason-accent",
    GS: "gs-accent",
    Quant: "quant-accent",
    English: "english-accent",
  };
  const badgeMap = {
    Reasoning: "reason-badge",
    GS: "gs-badge",
    Quant: "quant-badge",
    English: "english-badge",
  };
  const allSubjects = orderedSubjects.map((name) => ({
    name,
    icon: icons[name] || "📋",
    accent: accentMap[name] || "reason-accent",
    badge: badgeMap[name] || "reason-badge",
  }));
  const subjects = allSubjects;
  let html = "";
  subjects.forEach(({ name, icon, accent, badge }) => {
    const subQs = questions.filter((q) => q.subject === name);
    if (!subQs.length) return;
    const total = subQs.length;
    let correct = 0,
      wrong = 0,
      attempted = 0;
    subQs.forEach((q) => {
      const u = userAnswers[q.id];
      if (u !== undefined) {
        attempted++;
        if (u === q.answer) correct++;
        else wrong++;
      }
    });
    const skipped = total - attempted;
    const accuracy = attempted ? ((correct / attempted) * 100).toFixed(0) : 0;
    const pC = ((correct / total) * 100).toFixed(1),
      pW = ((wrong / total) * 100).toFixed(1),
      pS = ((skipped / total) * 100).toFixed(1),
      pA = ((attempted / total) * 100).toFixed(1);
    html += `<div class="subject-block">
      <div class="subject-header"><span class="subject-name">${icon} ${name}</span><span class="subject-badge ${badge}">${accuracy}% accuracy</span></div>
      <div class="subject-mini-bars">
        <div class="mini-row"><span class="mini-label">Correct</span><div class="mini-track"><div class="mini-fill correct-bar sub-bar" data-pct="${pC}" style="width:0%"></div></div><span class="mini-pct">${correct}/${total}</span></div>
        <div class="mini-row"><span class="mini-label">Wrong</span><div class="mini-track"><div class="mini-fill wrong-bar sub-bar" data-pct="${pW}" style="width:0%"></div></div><span class="mini-pct">${wrong}/${total}</span></div>
        <div class="mini-row"><span class="mini-label">Skipped</span><div class="mini-track"><div class="mini-fill skip-bar sub-bar" data-pct="${pS}" style="width:0%"></div></div><span class="mini-pct">${skipped}/${total}</span></div>
        <div class="mini-row"><span class="mini-label">Attempted</span><div class="mini-track"><div class="mini-fill ${accent} sub-bar" data-pct="${pA}" style="width:0%"></div></div><span class="mini-pct">${attempted}/${total}</span></div>
      </div></div>`;
  });
  document.getElementById("subjectCharts").innerHTML = html;
  setTimeout(() => {
    document.querySelectorAll(".sub-bar").forEach((bar) => {
      bar.style.width = Math.max(parseFloat(bar.dataset.pct), 3) + "%";
    });
  }, 200);
}

// ── SHARE ────────────────────────────────────
function shareScore() {
  if (!lastResult) return;
  const { score, maxScore, c, w, skipped, total, pct } = lastResult;
  setText("shareScoreBig", `${score} / ${maxScore}`);
  setText(
    "shareStats",
    `✅ ${c} Correct  ❌ ${w} Wrong  ⏭ ${skipped} Skipped  |  ${pct.toFixed(1)}% accuracy`,
  );
  setText(
    "shareDate",
    new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }),
  );
  document.getElementById("shareModal").classList.add("open");
}
function closeShare() {
  document.getElementById("shareModal").classList.remove("open");
}
function copyShareText() {
  if (!lastResult) return;
  const { score, maxScore, c, w, skipped, pct } = lastResult;
  const text = `📋 ${EXAM_CONFIG[examType]?.label || "SSC Mock"} Result\n🏆 Score: ${score}/${maxScore}\n✅ ${c} Correct  ❌ ${w} Wrong  ⏭ ${skipped} Skipped\n📊 Accuracy: ${pct.toFixed(1)}%\n📅 ${new Date().toLocaleDateString()}`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = event.target;
    btn.textContent = "✅ Copied!";
    setTimeout(() => (btn.textContent = "📋 Copy Text"), 2000);
  });
}

// ── REVIEW MODE ──────────────────────────────
function showReview() {
  isReviewMode = true;
  currentIndex = 0;
  paletteFilter = "all";
  document.getElementById("resultBox").style.display = "none";
  document.querySelector(".container").style.display = "flex";
  document.getElementById("mockPanel").style.display = "none";
  document.getElementById("reviewLayout").style.display = "block";
  document.getElementById("statusBox").style.display = "none";
  document.getElementById("reviewFilters").style.display = "flex";
  document.querySelector(".section-select").style.display = "flex";
  showReviewQuestion(0);
  renderPalette();
}
function getExplanation(q) {
  if (q.explanation) return q.explanation;
  return `The correct answer is <strong>${q.options[q.answer]}</strong>. Review the relevant ${q.subject} concept.`;
}
function getPassageRange(q) {
  if (!q.passage_id) return "";
  const group = questions.filter((x) => x.passage_id === q.passage_id);
  if (group.length <= 1) return "";
  const indices = group.map((x) => questions.indexOf(x) + 1);
  return Math.min(...indices) + "–" + Math.max(...indices);
}
function showReviewQuestion(i) {
  currentIndex = i;
  const q = questions[i],
    u = userAnswers[q.id];
  const letters = ["A", "B", "C", "D"];
  const passageHtml =
    q.passage_id && q.passage_text
      ? `<div class="passage-box"><span class="passage-label">📄 Passage${getPassageRange(q) ? " (Q" + getPassageRange(q) + ")" : ""}</span><p>${q.passage_text}</p></div>`
      : "";
  const qnoTag = q.qno
    ? `<span class="q-orig-no">[Paper Q${q.qno}]</span>`
    : "";

  document.getElementById("reviewContent").innerHTML = `
    <div class="q-meta" style="margin-bottom:14px">
      <span class="q-number">Q${i + 1} / ${questions.length}</span>
      <span class="q-subject">${q.subject}</span>
    </div>
    ${passageHtml}
    <p>${qnoTag} ${q.question}</p>
    <div style="margin-top:14px">
    ${q.options
      .map((o, idx) => {
        let cls = "",
          icon = letters[idx];
        if (idx === q.answer) {
          cls = "correct";
          icon = "✅";
        } else if (idx === u) {
          cls = "wrong";
          icon = "❌";
        }
        return `<div class="review-option ${cls}"><span style="font-weight:700;flex-shrink:0">${icon}</span>${o}</div>`;
      })
      .join("")}
    </div>`;

  const expEl = document.getElementById("reviewExplanation");
  expEl.innerHTML = `<h4>💡 Explanation</h4><p>${getExplanation(q)}</p>`;
  expEl.classList.add("visible");
  if (u !== undefined) playSound(u === q.answer ? "correct" : "wrong");
  renderPalette();
}
function getReviewPaletteClass(q) {
  const u = userAnswers[q.id];
  if (u === undefined) return "notVisited";
  return u === q.answer ? "correctPalette" : "wrongPalette";
}
function reviewNext() {
  if (currentIndex < questions.length - 1) showReviewQuestion(++currentIndex);
}
function reviewPrev() {
  if (currentIndex > 0) showReviewQuestion(--currentIndex);
}
function backToResult() {
  isReviewMode = false;
  paletteFilter = "all";
  document.querySelector(".container").style.display = "none";
  document.getElementById("reviewLayout").style.display = "none";
  document.getElementById("reviewFilters").style.display = "none";
  document.getElementById("statusBox").style.display = "none";
  document.querySelector(".section-select").style.display = "none";
  document.getElementById("resultBox").style.display = "block";
}
function setFilter(type) {
  paletteFilter = type;
  document.querySelectorAll("#reviewFilters button").forEach((btn) => {
    btn.classList.toggle(
      "active",
      btn.textContent.toLowerCase().includes(type) ||
        (type === "all" && btn.textContent === "All"),
    );
  });
  renderPalette();
  const filtered = questions
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => {
      const u = userAnswers[q.id];
      if (type === "correct") return u !== undefined && u === q.answer;
      if (type === "wrong") return u !== undefined && u !== q.answer;
      if (type === "unattempted") return u === undefined;
      return true;
    });
  if (filtered.length > 0) showReviewQuestion(filtered[0].i);
}

// ── NAV / PAUSE ──────────────────────────────
function goToExams() {
  // Replace state so the popstate guard doesn't re-intercept on the way out
  history.replaceState(null, "", location.href);
  window.location.href = "exams.html";
}
function togglePause() {
  isPaused = !isPaused;
  const overlay = document.getElementById("pauseOverlay");
  const pauseBtn = document.getElementById("pauseBtn");
  if (isPaused) {
    clearInterval(timerInterval);
    overlay.classList.add("active");
    pauseBtn.textContent = "▶ Resume";
    pauseBtn.classList.add("resumed");
    const displayTime =
      timerMode === "section" && currentSection
        ? sectionTimes[currentSection]
        : timeLeft;
    const pt = document.getElementById("pauseTimer");
    if (pt) pt.textContent = fmtTime(displayTime);
  } else {
    overlay.classList.remove("active");
    pauseBtn.textContent = "⏸ Pause";
    pauseBtn.classList.remove("resumed");
    startTimer();
  }
}

// ── CONFIRM MODALS ───────────────────────────
function confirmSubmit() {
  const answered = Object.values(questionState).filter(
    (s) => s === "answered",
  ).length;
  const review = Object.values(questionState).filter(
    (s) => s === "review",
  ).length;
  const skipped = questions.length - answered - review;
  document.getElementById("confirmStats").innerHTML =
    `<strong>${answered}</strong> answered &nbsp;·&nbsp; <strong>${review}</strong> marked for review &nbsp;·&nbsp; <strong>${skipped}</strong> not attempted`;
  document.getElementById("confirmModal").classList.add("open");
}
function closeConfirm() {
  document.getElementById("confirmModal").classList.remove("open");
}
function confirmBack() {
  document.getElementById("backModal").classList.add("open");
}
function closeBackModal() {
  document.getElementById("backModal").classList.remove("open");
}

// ── HELPER ───────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── LEADERBOARD ──────────────────────────────
let lbExamFilter = "cgl",
  globalLbCache = {};

function renderLeaderboard(attempts) {
  lbExamFilter = examType || "cgl";
  const lbExamTabsEl = document.querySelector(".lb-exam-tabs");
  if (lbExamTabsEl) lbExamTabsEl.style.display = "none";
  renderLeaderboardRows(attempts);
  // fetchGlobalLeaderboard called AFTER Firestore write — not here
}
function renderLeaderboardRows(attempts) {
  const el = document.getElementById("leaderboard");
  if (!el) return;
  const filtered = attempts.filter(
    (a) =>
      (a.examTypeKey || "").toLowerCase() === (examType || "").toLowerCase() &&
      Number(a.mockNumber || 0) === Number(mockNumber || 0),
  );
  el.innerHTML = `
    <div class="lb-tabs">
      <button class="lb-tab active" onclick="switchLbTab('personal',this)">🙋 My Attempts</button>
      <button class="lb-tab"        onclick="switchLbTab('global',this)">🌍 Global Top 10</button>
    </div>
    <div id="lb-personal">${buildPersonalRows(filtered)}</div>
    <div id="lb-global" style="display:none"><div class="lb-empty lb-loading">⏳ Loading...</div></div>`;
}
function buildPersonalRows(attempts) {
  if (!attempts || !attempts.length)
    return '<div class="lb-empty">No attempts for this exam type yet.</div>';
  const sorted = [...attempts].sort((a, b) => b.score - a.score);
  return sorted
    .map((a, i) => {
      const rc =
        i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
      const sc =
        typeof a.score === "number"
          ? a.score % 1 === 0
            ? a.score
            : a.score.toFixed(1)
          : a.score;
      return `<div class="lb-row ${i === 0 ? "lb-current" : ""}">
      <div class="lb-rank ${rc}">${i + 1}</div>
      <div class="lb-info">
        <div class="lb-date">${a.examType || "Mock"} #${a.mockNumber || "—"} — ${a.date || ""} ${a.time || ""}</div>
        <div class="lb-meta">✅ ${a.correct}  ❌ ${a.wrong}  ⏭ ${a.skipped}  — ${a.accuracy}% accuracy</div>
      </div>
      <div class="lb-score">${sc}</div>
    </div>`;
    })
    .join("");
}
function switchLbTab(tab, btn) {
  document
    .querySelectorAll(".lb-tab")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("lb-personal").style.display =
    tab === "personal" ? "block" : "none";
  document.getElementById("lb-global").style.display =
    tab === "global" ? "block" : "none";
}
function switchLbExam(type, btn) {
  lbExamFilter = type;
  document
    .querySelectorAll(".lb-exam-tab")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderLeaderboardRows(getAttempts());
  if (globalLbCache[type]) renderGlobalRows(globalLbCache[type]);
  else fetchGlobalLeaderboard(type);
}
async function fetchGlobalLeaderboard(type) {
  type = type || lbExamFilter || examType || "cgl";
  try {
    if (typeof firebase === "undefined" || !firebase.apps.length) return;
    const db = firebase.firestore();
    const label =
      EXAM_CONFIG[type]?.label || EXAM_CONFIG[examType]?.label || examType;
    // Single equality where only — no orderBy = no composite index needed
    const snap = await db
      .collection("leaderboard")
      .where("examType", "==", label)
      .get();
    const thisMock = Number(mockNumber || 0);
    // Filter mock client-side, keep best score per user, sort client-side
    const best = {};
    snap.docs.forEach((doc) => {
      const d = doc.data();
      if (Number(d.mockNumber || 0) !== thisMock) return;
      const uid = d.userId || doc.id;
      if (!best[uid] || d.score > best[uid].score) best[uid] = d;
    });
    const ranked = Object.values(best).sort((a, b) => b.score - a.score);
    globalLbCache[type] = ranked;
    renderGlobalRows(ranked);
    updateRankStats(ranked);
  } catch (e) {
    console.error("Global LB error:", e);
    const el = document.getElementById("lb-global");
    if (el)
      el.innerHTML = '<div class="lb-empty">Could not load leaderboard.</div>';
  }
}
function renderGlobalRows(ranked) {
  const el = document.getElementById("lb-global");
  if (!el) return;
  if (!ranked.length) {
    el.innerHTML = '<div class="lb-empty">No scores yet. Be the first!</div>';
    return;
  }
  const myUid = currentUser?.uid;
  el.innerHTML = ranked
    .slice(0, 10)
    .map((a, i) => {
      const rc =
        i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
      const isMe = a.userId === myUid;
      const sc =
        typeof a.score === "number"
          ? a.score % 1 === 0
            ? a.score
            : a.score.toFixed(1)
          : a.score;
      const ts = a.createdAt?.toDate?.() || new Date();
      const dateStr = ts.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      return `<div class="lb-row ${isMe ? "lb-current" : ""}">
      <div class="lb-rank ${rc}">${i + 1}</div>
      <div class="lb-info">
        <div class="lb-date">${isMe ? "👤 You" : "🎓 " + (a.userName || "Anonymous")} — ${a.examType || "Mock"}</div>
        <div class="lb-meta">✅ ${a.correct}  ❌ ${a.wrong}  ⏭ ${a.skipped}  — ${a.accuracy}% acc  |  ${dateStr}</div>
      </div>
      <div class="lb-score">${sc}</div>
    </div>`;
    })
    .join("");
}
function updateRankStats(ranked) {
  if (!lastResult) return;
  const fmt = (v) =>
    typeof v === "number" ? (v % 1 === 0 ? v : v.toFixed(1)) : v;
  const myUid = currentUser?.uid;
  const myScore = lastResult.score;
  const maxScore = lastResult.maxScore || 200;
  const rankNum = document.getElementById("globalRankNum");
  const rankTotal = document.getElementById("rankTotal");
  const card = document.getElementById("comparisonCard");

  // Always ensure current user is in the pool — guards against Firestore consistency lag
  const myId = myUid || "__me__";
  let pool = ranked.filter((a) => a.userId !== myId && a.userId !== "__me__");
  pool.push({ score: myScore, userId: myId });
  pool.sort((a, b) => b.score - a.score);

  const total = pool.length;

  if (!total) {
    if (rankNum) rankNum.textContent = "#—";
    if (rankTotal) rankTotal.textContent = "";
    if (card) card.style.display = "none";
    return;
  }

  // Find my rank by userId (always found since we injected above)
  const myRankIdx = pool.findIndex((a) => a.userId === myId);
  const myRank = myRankIdx === -1 ? total : myRankIdx + 1;

  const topScore = pool[0].score || 0;
  const avgScore = pool.reduce((s, a) => s + (a.score || 0), 0) / total;
  // Percentile = % of OTHER users I scored strictly higher than
  const others = total - 1;
  const beaten = pool.filter(
    (a) => a.userId !== myId && (a.score || 0) < myScore,
  ).length;
  const percentile =
    others > 0 ? ((beaten / others) * 100).toFixed(1) : "100.0";

  if (rankNum) rankNum.textContent = `#${myRank}`;
  if (rankTotal) rankTotal.textContent = `/ ${total}`;

  const ringPct = Math.max(5, ((total - myRank + 1) / total) * 100);
  setTimeout(() => {
    const fill = document.getElementById("rankRingFill");
    if (fill) fill.style.strokeDashoffset = 314 - (ringPct / 100) * 314;
  }, 300);

  setText("topperScoreVal", fmt(topScore));
  setText("avgScoreVal", fmt(avgScore));
  setText("percentileVal", percentile + "%");
  if (card) card.style.display = "block";
  setTimeout(() => {
    setCompBar("cmpYouBar", "cmpYouLbl", myScore, maxScore, fmt(myScore));
    setCompBar("cmpTopBar", "cmpTopLbl", topScore, maxScore, fmt(topScore));
    setCompBar("cmpAvgBar", "cmpAvgLbl", avgScore, maxScore, fmt(avgScore));
  }, 400);
}
function setCompBar(barId, lblId, val, max, label) {
  const bar = document.getElementById(barId),
    lbl = document.getElementById(lblId);
  const pct = max > 0 ? Math.max(3, (val / max) * 100) : 3;
  if (bar) bar.style.width = pct + "%";
  if (lbl) lbl.textContent = label;
}

// ── FIRESTORE SAVE ───────────────────────────
async function saveToFirestoreAndRefresh(
  score,
  correct,
  wrong,
  skipped,
  total,
  pct,
) {
  try {
    if (typeof firebase === "undefined" || !firebase.apps.length) return;
    const user = currentUser;
    if (!user) return;
    const db = firebase.firestore(),
      examLabel = EXAM_CONFIG[examType]?.label || examType;
    await db
      .collection("users")
      .doc(user.uid)
      .collection("attempts")
      .add({
        score,
        correct,
        wrong,
        skipped,
        total,
        accuracy: pct.toFixed(1),
        examType: examLabel,
        examTypeKey: examType,
        mockNumber: mockNumber || 0,
        userId: user.uid,
        userName: user.displayName || user.email || "Anonymous",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    await db.collection("leaderboard").add({
      score,
      correct,
      wrong,
      skipped,
      total,
      accuracy: pct.toFixed(1),
      examType: examLabel,
      examTypeKey: examType,
      mockNumber: mockNumber || 0,
      userId: user.uid,
      userName: user.displayName || user.email || "Anonymous",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    // Inject current user's score directly into cache so rank is correct
    // even if Firestore's get() hasn't indexed the new doc yet
    const examLabel2 = EXAM_CONFIG[examType]?.label || examType;
    const cacheKey = lbExamFilter || examType;
    const myEntry = {
      score,
      correct,
      wrong,
      skipped,
      accuracy: pct.toFixed(1),
      examType: examLabel2,
      mockNumber: mockNumber || 0,
      userId: user.uid,
      userName: user.displayName || user.email || "Anonymous",
    };
    if (!globalLbCache[cacheKey]) globalLbCache[cacheKey] = [];
    globalLbCache[cacheKey] = globalLbCache[cacheKey].filter(
      (a) => a.userId !== user.uid,
    );
    globalLbCache[cacheKey].push(myEntry);
    globalLbCache[cacheKey].sort((a, b) => b.score - a.score);
    updateRankStats(globalLbCache[cacheKey]);
    await fetchGlobalLeaderboard(cacheKey);
    await renderFirestoreLeaderboard(user);
  } catch (e) {
    console.error("🔴 Firestore save failed:", e.code, e.message);
  }
}
async function renderFirestoreLeaderboard(user) {
  try {
    if (typeof firebase === "undefined" || !firebase.apps.length) return;
    const db = firebase.firestore();
    const snap = await db
      .collection("users")
      .doc(user.uid)
      .collection("attempts")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();
    if (snap.empty) return;
    const data = snap.docs.map((d) => {
      const a = d.data(),
        ts = a.createdAt?.toDate?.() || new Date();
      return {
        ...a,
        date: ts.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        time: ts.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        examTypeKey:
          a.examTypeKey || (a.examType?.includes("CGL") ? "cgl" : "chsl"),
      };
    });
    const personalEl = document.getElementById("lb-personal");
    if (personalEl) {
      const filtered = data.filter(
        (a) =>
          (a.examTypeKey || "").toLowerCase() ===
            (examType || "").toLowerCase() &&
          Number(a.mockNumber || 0) === Number(mockNumber || 0),
      );
      personalEl.innerHTML = buildPersonalRows(filtered);
    }
  } catch (e) {
    console.warn("renderFirestoreLeaderboard error:", e);
  }
}
