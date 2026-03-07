// =============================================
// STATE
// =============================================
let questions = [];
let currentIndex = 0;
let userAnswers = {};
let questionState = {};
let timerInterval;
let timeLeft = 3600;
let isReviewMode = false;
let paletteFilter = "all";
let lastResult = null;
let examType = sessionStorage.getItem("examType") || "cgl";
let examMode = sessionStorage.getItem("examMode") || "full";
let selectedSubject = sessionStorage.getItem("selectedSubject") || null;

// Auth state — set by onAuthStateChanged so currentUser is always ready
let currentUser = null;
try {
  firebase.auth().onAuthStateChanged((user) => {
    currentUser = user;
    console.log(
      "Auth state:",
      user
        ? "✅ Logged in as " + (user.displayName || user.email || user.uid)
        : "❌ Not logged in",
    );
  });
} catch (e) {}

// Per-exam configs (questions per subject, time in seconds)
const EXAM_CONFIG = {
  cgl: { perSubject: 25, timeSeconds: 3600, label: "SSC CGL Tier 1" },
  chsl: { perSubject: 25, timeSeconds: 3600, label: "SSC CHSL Tier 1" },
  subject: { perSubject: 25, timeSeconds: 1500, label: "Subject Practice" },
};

// =============================================
// AUDIO
// =============================================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}
function playSound(type) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
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

// =============================================
// CONFETTI
// =============================================
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

// =============================================
// DARK MODE
// =============================================
function toggleDark() {
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  html.setAttribute("data-theme", isDark ? "light" : "dark");
  document.querySelector(".dark-toggle").textContent = isDark ? "🌙" : "☀️";
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

// =============================================
// DIFFICULTY
// =============================================
function getDifficulty(q) {
  if (q.difficulty) return q.difficulty;
  const n = parseInt(q.id) || 0;
  if (n % 3 === 0) return "Hard";
  if (n % 2 === 0) return "Easy";
  return "Medium";
}
function diffClass(d) {
  if (d === "Easy") return "diff-easy";
  if (d === "Hard") return "diff-hard";
  return "diff-medium";
}

// =============================================
// PROGRESS BAR
// =============================================
function updateProgressBar() {
  const answered = Object.values(questionState).filter(
    (s) => s === "answered",
  ).length;
  const pct = questions.length ? (answered / questions.length) * 100 : 0;
  const el = document.getElementById("topProgressFill");
  if (el) el.style.width = pct + "%";
}

// =============================================
// SECTION TABS
// =============================================
function updateSectionTabs() {
  const q = questions[currentIndex];
  if (!q) return;
  document.querySelectorAll(".section-select button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.sec === q.subject);
  });
}

// =============================================
// LOAD DATA — picks random questions per config
// =============================================
function loadFullMock() {
  applyStoredTheme();
  const cfg = EXAM_CONFIG[examType] || EXAM_CONFIG.cgl;
  timeLeft = cfg.timeSeconds;

  // Update header exam label
  const labelEl = document.getElementById("examTitle");
  if (labelEl) labelEl.textContent = cfg.label;

  if (examMode === "subject" && selectedSubject) {
    // Subject-only mode: load just that subject
    fetch(`data/${subjectFile(selectedSubject)}.json`)
      .then((r) => r.json())
      .then((arr) => {
        questions = smartPick(arr, cfg.perSubject);
        initMock();
      });
  } else {
    // Full mock: smartPick 25 from each subject (passage-aware)
    Promise.all([
      fetch("data/quant.json").then((r) => r.json()),
      fetch("data/reasoning.json").then((r) => r.json()),
      fetch("data/gs.json").then((r) => r.json()),
      fetch("data/english.json").then((r) => r.json()),
    ]).then(([q, r, g, e]) => {
      const n = cfg.perSubject;
      questions = [
        ...smartPick(q, n),
        ...smartPick(r, n),
        ...smartPick(g, n),
        ...smartPick(e, n),
      ];
      initMock();
    });
  }
}

function subjectFile(s) {
  const map = {
    Quant: "quant",
    Reasoning: "reasoning",
    GS: "gs",
    English: "english",
  };
  return map[s] || s.toLowerCase();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// =============================================
// SMART PASSAGE-AWARE SELECTION
// Picks passage groups atomically — never
// splits a passage across questions.
//
// Algorithm:
//  1. Separate pool into standalone Qs and passage groups
//  2. Shuffle both independently
//  3. Greedily fill slots: try passage groups first (whole group or skip),
//     then fill remaining slots with standalones
//  4. Sort final selection by passage_position so group Qs stay consecutive
// =============================================
function smartPick(pool, target) {
  // Separate standalones from passage groups
  const standalones = pool.filter((q) => !q.passage_id);
  const passageMap = {};
  pool
    .filter((q) => q.passage_id)
    .forEach((q) => {
      if (!passageMap[q.passage_id]) passageMap[q.passage_id] = [];
      passageMap[q.passage_id].push(q);
    });

  // Sort each passage group by passage_position
  Object.values(passageMap).forEach((g) =>
    g.sort((a, b) => (a.passage_position || 0) - (b.passage_position || 0)),
  );

  const passageGroups = shuffle(Object.values(passageMap));
  const shuffledAlone = shuffle(standalones);
  const selected = [];
  let slots = target;

  // Fill with whole passage groups where they fit
  for (const group of passageGroups) {
    if (slots <= 0) break;
    if (group.length <= slots) {
      selected.push(...group);
      slots -= group.length;
    }
    // If group doesn't fit, skip it entirely (never split)
  }

  // Fill remaining slots with standalones
  for (const q of shuffledAlone) {
    if (slots <= 0) break;
    selected.push(q);
    slots--;
  }

  // Re-sort: keep passage groups consecutive, standalones randomly interspersed
  // Build ordered output: interleave passage blocks and standalones
  const passageBlocks = {};
  const aloneSelected = [];
  selected.forEach((q) => {
    if (q.passage_id) {
      if (!passageBlocks[q.passage_id]) passageBlocks[q.passage_id] = [];
      passageBlocks[q.passage_id].push(q);
    } else {
      aloneSelected.push(q);
    }
  });

  // Interleave: randomly place passage blocks among standalones
  const blocks = [
    ...Object.values(passageBlocks),
    ...aloneSelected.map((q) => [q]),
  ];
  const shuffledBlocks = shuffle(blocks);
  return shuffledBlocks.flat();
}

function initMock() {
  questions.forEach((q) => (questionState[q.id] = "notVisited"));
  currentIndex = 0;
  // Exam mode UI: hide back, show pause
  const backBtn = document.getElementById("backBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  if (backBtn) backBtn.style.display = "none";
  if (pauseBtn) pauseBtn.style.display = "flex";
  loadQuestion();
  renderPalette();
  startTimer();
}

// =============================================
// QUESTION LOAD
// =============================================
function loadQuestion() {
  if (isReviewMode) return;
  const q = questions[currentIndex];
  if (questionState[q.id] === "notVisited") questionState[q.id] = "notAnswered";

  document.getElementById("qNumber").textContent =
    `Q${currentIndex + 1} / ${questions.length}`;
  document.getElementById("qSubject").textContent = q.subject;
  const diff = getDifficulty(q);
  const diffEl = document.getElementById("qDifficulty");
  diffEl.textContent = diff;
  diffEl.className = "q-difficulty " + diffClass(diff);

  document.getElementById("question").innerHTML =
    (q.passage_id && q.passage_text
      ? `<div class="passage-box"><span class="passage-label">📄 Read the Passage (Q${getPassageRange(q)})</span><p>${q.passage_text}</p></div>`
      : "") + `<p class="q-text">${q.question}</p>`;

  const letters = ["A", "B", "C", "D"];
  document.getElementById("options").innerHTML = q.options
    .map(
      (o, i) => `
    <div class="option-label ${userAnswers[q.id] === i ? "selected" : ""}"
         onclick="selectAnswer(${i})">
      <span class="option-letter">${letters[i]}</span>
      <span>${o}</span>
    </div>`,
    )
    .join("");

  updateStatusCount();
  updateProgressBar();
  updateSectionTabs();
  renderPalette();
}

// =============================================
// TIMER
// =============================================
function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      submitTest();
    }
  }, 1000);
}
function updateTimerDisplay() {
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  const el = document.getElementById("timer");
  if (el) el.textContent = `${m}:${String(s).padStart(2, "0")}`;
  const box = document.getElementById("timerBox");
  if (box) {
    box.classList.remove("timer-warning", "timer-danger");
    if (timeLeft < 300) box.classList.add("timer-danger");
    else if (timeLeft < 600) box.classList.add("timer-warning");
  }
}

// =============================================
// ANSWERS
// =============================================
function selectAnswer(ans) {
  const q = questions[currentIndex];
  userAnswers[q.id] = ans;
  questionState[q.id] = "answered";
  playSound("select");
  document.querySelectorAll(".option-label").forEach((el, i) => {
    el.classList.toggle("selected", i === ans);
  });
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

// =============================================
// NAVIGATION
// =============================================
function saveNext() {
  playSound("navigate");
  if (currentIndex < questions.length - 1) {
    currentIndex++;
    loadQuestion();
  }
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

// =============================================
// PALETTE
// =============================================
function jumpQuestion(i) {
  currentIndex = i;
  isReviewMode ? showReviewQuestion(i) : loadQuestion();
}
function jumpSection(sec) {
  const i = questions.findIndex((q) => q.subject === sec);
  if (i === -1) return;
  currentIndex = i;
  isReviewMode ? showReviewQuestion(i) : loadQuestion();
}
function renderPalette() {
  const sections =
    examMode === "subject"
      ? [selectedSubject]
      : ["Quant", "Reasoning", "GS", "English"];

  let html = "";
  sections.forEach((sec) => {
    // Collect buttons for this section first
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
    // Wrap in a section block: label ABOVE its own grid
    html += `
      <div class="palette-section">
        <div class="palette-sec-label">${sec}</div>
        <div class="palette-grid">${btns}</div>
      </div>`;
  });
  document.getElementById("palette").innerHTML = html;
}

// =============================================
// STATUS
// =============================================
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

// =============================================
// SUBMIT
// =============================================
function submitTest() {
  clearInterval(timerInterval);
  closeConfirm();
  // After submit: hide pause btn, show back btn, hide submit btn
  const pauseBtn = document.getElementById("pauseBtn");
  const backBtn = document.getElementById("backBtn");
  const submitBtn = document.getElementById("submitBtn");
  if (pauseBtn) pauseBtn.style.display = "none";
  if (backBtn) backBtn.style.display = "flex";
  if (submitBtn) submitBtn.style.display = "none";
  // If paused, unpause first
  if (isPaused) {
    isPaused = false;
    document.getElementById("pauseOverlay").classList.remove("active");
  }

  let score = 0,
    attempted = 0,
    correct = 0,
    wrong = 0;
  questions.forEach((q) => {
    if (userAnswers[q.id] !== undefined) {
      attempted++;
      if (userAnswers[q.id] === q.answer) {
        score += 2;
        correct++;
      } else {
        score -= 0.5;
        wrong++;
      }
    }
  });

  showResult(score, attempted, correct, wrong);
}

// =============================================
// SHOW RESULT
// =============================================
function showResult(score, a, c, w) {
  const total = questions.length;
  const skipped = total - a;
  const maxScore = total * 2;
  const pct = total ? (c / total) * 100 : 0;
  const grade = getGrade(pct);

  lastResult = { score, a, c, w, skipped, total, maxScore, pct };

  // Save attempt locally
  const attempts = saveAttempt(score, c, w, skipped, total);
  // Render local leaderboard first (instant)
  renderLeaderboard(attempts);
  // Then try Firestore (async, will override if successful)
  saveToFirestoreAndRefresh(score, c, w, skipped, total, pct);

  document.querySelector(".container").style.display = "none";
  document.querySelector(".section-select").style.display = "none";
  document.getElementById("resultBox").style.display = "block";

  document.getElementById("rScore").textContent =
    score % 1 === 0 ? score : score.toFixed(1);
  document.getElementById("rMax").textContent = maxScore;
  document.getElementById("rAttempted").textContent = a;
  document.getElementById("rCorrect").textContent = c;
  document.getElementById("rWrong").textContent = w;
  document.getElementById("rSkipped").textContent = skipped;

  document.getElementById("resultTrophy").textContent = grade.emoji;
  document.getElementById("resultTitle").textContent = "Exam Complete";
  document.getElementById("resultSubtitle").textContent = grade.msg;
  const badge = document.getElementById("gradeBadge");
  badge.textContent = grade.g;
  badge.className = `grade-badge grade-${grade.g}`;

  const accuracyPct = pct.toFixed(1);
  setTimeout(() => {
    setBar("barAccuracy", accuracyPct, "rAccuracy", accuracyPct + "%");
    setBar("barCorrect", pct.toFixed(1), "rCorrectPct", `${c} / ${total}`);
    setBar(
      "barWrong",
      ((w / total) * 100).toFixed(1),
      "rWrongPct",
      `${w} / ${total}`,
    );
    setBar(
      "barSkipped",
      ((skipped / total) * 100).toFixed(1),
      "rSkippedPct",
      `${skipped} / ${total}`,
    );
  }, 150);

  buildSubjectCharts();

  if (pct >= 60) setTimeout(launchConfetti, 400);
  playSound(pct >= 60 ? "correct" : "wrong");
}

function setBar(barId, pct, labelId, labelText) {
  const bar = document.getElementById(barId);
  const lbl = document.getElementById(labelId);
  if (bar) bar.style.width = Math.max(pct, 3) + "%";
  if (lbl) lbl.textContent = labelText;
}

// =============================================
// GRADE
// =============================================
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

// =============================================
// LEADERBOARD
// =============================================
function saveAttempt(score, correct, wrong, skipped, total) {
  const attempts = getAttempts();
  attempts.unshift({
    score,
    correct,
    wrong,
    skipped,
    total,
    accuracy: total ? ((correct / total) * 100).toFixed(1) : 0,
    examType: EXAM_CONFIG[examType]?.label || examType,
    date: new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  });
  try {
    localStorage.setItem("ssc-attempts", JSON.stringify(attempts.slice(0, 10)));
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
function renderLeaderboard(attempts) {
  const el = document.getElementById("leaderboard");
  // Build tab UI
  el.innerHTML = `
    <div class="lb-tabs">
      <button class="lb-tab active" onclick="switchLbTab('personal', this)">🙋 My Attempts</button>
      <button class="lb-tab"        onclick="switchLbTab('global',   this)">🌍 Global Top 10</button>
    </div>
    <div id="lb-personal">${buildPersonalRows(attempts)}</div>
    <div id="lb-global"   style="display:none"><div class="lb-empty lb-loading">⏳ Loading global scores...</div></div>
  `;
  // Kick off global fetch
  fetchGlobalLeaderboard();
}

function buildPersonalRows(attempts) {
  if (!attempts || !attempts.length)
    return '<div class="lb-empty">No past attempts yet. Complete a mock test to see your history.</div>';
  const sorted = [...attempts].sort((a, b) => b.score - a.score);
  return sorted
    .map((a, i) => {
      const rc =
        i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
      return `<div class="lb-row ${i === 0 ? "lb-current" : ""}">
      <div class="lb-rank ${rc}">${i + 1}</div>
      <div class="lb-info">
        <div class="lb-date">${a.examType || "Mock"} — ${a.date || ""} ${a.time || ""}</div>
        <div class="lb-meta">✅ ${a.correct}  ❌ ${a.wrong}  ⏭ ${a.skipped}  — ${a.accuracy}% accuracy</div>
      </div>
      <div class="lb-score">${typeof a.score === "number" ? (a.score % 1 === 0 ? a.score : a.score.toFixed(1)) : a.score}</div>
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

async function fetchGlobalLeaderboard() {
  try {
    if (typeof firebase === "undefined" || !firebase.apps.length) return;
    const db = firebase.firestore();
    const snap = await db
      .collection("leaderboard")
      .orderBy("score", "desc")
      .limit(10)
      .get();

    const el = document.getElementById("lb-global");
    if (!el) return;
    if (snap.empty) {
      el.innerHTML =
        '<div class="lb-empty">No global scores yet. Be the first!</div>';
      return;
    }

    // Get current user id to highlight their row
    const myUid = currentUser?.uid;

    el.innerHTML = snap.docs
      .map((doc, i) => {
        const a = doc.data();
        const rc =
          i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
        const isMe = a.userId === myUid;
        const ts = a.createdAt?.toDate?.() || new Date();
        const dateStr = ts.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
        const name = a.userName || "Anonymous";
        return `<div class="lb-row ${isMe ? "lb-current" : ""}">
        <div class="lb-rank ${rc}">${i + 1}</div>
        <div class="lb-info">
          <div class="lb-date">${isMe ? "👤 You" : "🎓 " + name} — ${a.examType || "Mock"}</div>
          <div class="lb-meta">✅ ${a.correct}  ❌ ${a.wrong}  ⏭ ${a.skipped}  — ${a.accuracy}% acc  |  ${dateStr}</div>
        </div>
        <div class="lb-score">${typeof a.score === "number" ? (a.score % 1 === 0 ? a.score : a.score.toFixed(1)) : a.score}</div>
      </div>`;
      })
      .join("");
  } catch (e) {
    const el = document.getElementById("lb-global");
    if (el)
      el.innerHTML =
        '<div class="lb-empty">Global leaderboard needs Firebase setup.</div>';
  }
}

// Firestore functions moved to bottom of file

// =============================================
// SUBJECT CHARTS
// =============================================
function buildSubjectCharts() {
  const subjects = [
    { name: "Quant", icon: "🔢", accent: "quant-accent", badge: "quant-badge" },
    {
      name: "Reasoning",
      icon: "🧩",
      accent: "reason-accent",
      badge: "reason-badge",
    },
    { name: "GS", icon: "🌍", accent: "gs-accent", badge: "gs-badge" },
    {
      name: "English",
      icon: "📖",
      accent: "english-accent",
      badge: "english-badge",
    },
  ];
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
    const pC = ((correct / total) * 100).toFixed(1);
    const pW = ((wrong / total) * 100).toFixed(1);
    const pS = ((skipped / total) * 100).toFixed(1);
    const pA = ((attempted / total) * 100).toFixed(1);
    html += `
      <div class="subject-block">
        <div class="subject-header">
          <span class="subject-name">${icon} ${name}</span>
          <span class="subject-badge ${badge}">${accuracy}% accuracy</span>
        </div>
        <div class="subject-mini-bars">
          <div class="mini-row"><span class="mini-label">Correct</span><div class="mini-track"><div class="mini-fill correct-bar sub-bar" data-pct="${pC}" style="width:0%"></div></div><span class="mini-pct">${correct}/${total}</span></div>
          <div class="mini-row"><span class="mini-label">Wrong</span><div class="mini-track"><div class="mini-fill wrong-bar sub-bar" data-pct="${pW}" style="width:0%"></div></div><span class="mini-pct">${wrong}/${total}</span></div>
          <div class="mini-row"><span class="mini-label">Skipped</span><div class="mini-track"><div class="mini-fill skip-bar sub-bar" data-pct="${pS}" style="width:0%"></div></div><span class="mini-pct">${skipped}/${total}</span></div>
          <div class="mini-row"><span class="mini-label">Attempted</span><div class="mini-track"><div class="mini-fill ${accent} sub-bar" data-pct="${pA}" style="width:0%"></div></div><span class="mini-pct">${attempted}/${total}</span></div>
        </div>
      </div>`;
  });
  document.getElementById("subjectCharts").innerHTML = html;
  setTimeout(() => {
    document.querySelectorAll(".sub-bar").forEach((bar) => {
      bar.style.width = Math.max(parseFloat(bar.dataset.pct), 3) + "%";
    });
  }, 200);
}

// =============================================
// SHARE
// =============================================
function shareScore() {
  if (!lastResult) return;
  const { score, maxScore, c, w, skipped, total, pct } = lastResult;
  document.getElementById("shareScoreBig").textContent =
    `${score} / ${maxScore}`;
  document.getElementById("shareStats").textContent =
    `✅ ${c} Correct  ❌ ${w} Wrong  ⏭ ${skipped} Skipped  |  ${pct.toFixed(1)}% accuracy`;
  document.getElementById("shareDate").textContent =
    new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
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

// =============================================
// REVIEW MODE
// =============================================
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
  return `The correct answer is <strong>${q.options[q.answer]}</strong>. Review the relevant ${q.subject} concept to strengthen your understanding.`;
}

// Returns "Q3–Q7" range label for a passage group
function getPassageRange(q) {
  if (!q.passage_id) return "";
  const group = questions.filter((x) => x.passage_id === q.passage_id);
  if (group.length <= 1) return "";
  const indices = group.map((x) => questions.indexOf(x) + 1);
  return Math.min(...indices) + "\u2013" + Math.max(...indices);
}

function showReviewQuestion(i) {
  currentIndex = i;
  const q = questions[i];
  const u = userAnswers[q.id];
  const letters = ["A", "B", "C", "D"];
  const diff = getDifficulty(q);
  const passageHtml =
    q.passage_id && q.passage_text
      ? `<div class="passage-box"><span class="passage-label">📄 Passage (Q${getPassageRange(q)})</span><p>${q.passage_text}</p></div>`
      : "";

  document.getElementById("reviewContent").innerHTML = `
    <div class="q-meta" style="margin-bottom:14px">
      <span class="q-number">Q${i + 1} / ${questions.length}</span>
      <span class="q-subject">${q.subject}</span>
      <span class="q-difficulty ${diffClass(diff)}">${diff}</span>
    </div>
    ${passageHtml}
    <p>${q.question}</p>
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

// =============================================
// BACK TO EXAMS
// =============================================
function goToExams() {
  window.location.href = "exams.html";
}

// =============================================
// PAUSE / RESUME
// =============================================
let isPaused = false;

function togglePause() {
  isPaused = !isPaused;
  const overlay = document.getElementById("pauseOverlay");
  const pauseBtn = document.getElementById("pauseBtn");

  if (isPaused) {
    clearInterval(timerInterval);
    overlay.classList.add("active");
    pauseBtn.textContent = "▶ Resume";
    pauseBtn.classList.add("resumed");
    // Show current time on pause card
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    const pt = document.getElementById("pauseTimer");
    if (pt) pt.textContent = `${m}:${String(s).padStart(2, "0")}`;
  } else {
    overlay.classList.remove("active");
    pauseBtn.textContent = "⏸ Pause";
    pauseBtn.classList.remove("resumed");
    startTimer();
  }
}

// =============================================
// CONFIRM SUBMIT (show modal with stats)
// =============================================
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

// =============================================
// CONFIRM BACK
// =============================================
function confirmBack() {
  document.getElementById("backModal").classList.add("open");
}
function closeBackModal() {
  document.getElementById("backModal").classList.remove("open");
}

// =============================================
// FIRESTORE LEADERBOARD — save & fetch
// =============================================
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
    const user = currentUser; // set by onAuthStateChanged — always reliable
    if (!user) {
      console.log("Firestore skip: no logged-in user (guest mode)");
      return;
    }
    console.log("Saving to Firestore for:", user.displayName || user.email);

    const db = firebase.firestore();
    const examLabel = EXAM_CONFIG[examType]?.label || examType;

    // Save to user's own attempts sub-collection
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
        userId: user.uid,
        userName: user.displayName || user.email || "Anonymous",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

    // Also write to global leaderboard collection (top scores)
    await db.collection("leaderboard").add({
      score,
      correct,
      wrong,
      skipped,
      total,
      accuracy: pct.toFixed(1),
      examType: examLabel,
      userId: user.uid,
      userName: user.displayName || user.email || "Anonymous",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    // Now fetch and render personal history from Firestore
    await renderFirestoreLeaderboard(user);
  } catch (e) {
    console.error("🔴 Firestore save failed:", e.code, e.message);
  }
}

async function renderFirestoreLeaderboard(user) {
  try {
    if (typeof firebase === "undefined" || !firebase.apps.length) return false;
    const resolvedUser = user || currentUser;
    if (!resolvedUser) return false;
    // Re-assign so rest of function works
    user = resolvedUser;

    const db = firebase.firestore();
    const snap = await db
      .collection("users")
      .doc(user.uid)
      .collection("attempts")
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();

    if (snap.empty) return false;

    const attempts = snap.docs.map((d) => d.data());
    const el = document.getElementById("leaderboard");
    const sorted = [...attempts].sort((a, b) => b.score - a.score);
    el.innerHTML = sorted
      .map((a, i) => {
        const rankClass =
          i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
        const ts = a.createdAt?.toDate?.() || new Date();
        const dateStr = ts.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
        const timeStr = ts.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        });
        return `
        <div class="lb-row ${i === 0 ? "lb-current" : ""}">
          <div class="lb-rank ${rankClass}">${i + 1}</div>
          <div class="lb-info">
            <div class="lb-date">${a.examType || "Mock"} — ${dateStr} ${timeStr}</div>
            <div class="lb-meta">✅ ${a.correct}  ❌ ${a.wrong}  ⏭ ${a.skipped}  — ${a.accuracy}% accuracy</div>
          </div>
          <div class="lb-score">${typeof a.score === "number" ? (a.score % 1 === 0 ? a.score : a.score.toFixed(1)) : a.score}</div>
        </div>`;
      })
      .join("");
    return true;
  } catch (e) {
    return false;
  }
}
