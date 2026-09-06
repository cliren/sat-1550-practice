(async function () {
  let DATA = window.SAT_BANK;
  if (!DATA || !DATA.questions) {
    try {
      const res = await fetch("content/bank.json");
      if (res.ok) DATA = await res.json();
    } catch (e) {}
  }
  if (!DATA || !DATA.questions) {
    document.getElementById("main").innerHTML = "<h1>Could not load practice content</h1><p class=\"sub\">Re-download the fixed Lite zip and open SAT1550 Practice Lite.app again.</p>";
    return;
  }
  const main = document.getElementById("main");
  const topMeta = document.getElementById("topMeta");
  const exitBtn = document.getElementById("exitBtn");
  const LEAVE_TEST_MSG = "Leave test? Progress on this attempt will be lost unless submitted.";

  function confirmLeaveTest() {
    return confirm(LEAVE_TEST_MSG);
  }

  function leaveTestToSafe() {
    if (!confirmLeaveTest()) return;
    clearTimer();
    if (state.dayId) route("day", { dayId: state.dayId });
    else route("home");
  }

  function goHomeSafe() {
    if (state.view === "test") {
      leaveTestToSafe();
      return;
    }
    route("home");
  }

  document.getElementById("brandBtn").onclick = () => goHomeSafe();

  window.addEventListener("beforeunload", (e) => {
    if (state && state.view === "test") {
      e.preventDefault();
      e.returnValue = LEAVE_TEST_MSG;
      return LEAVE_TEST_MSG;
    }
  });

  const storeKey = "sat1550-progress-v1";

  const LEVELS = [
    { id: "start", name: "Warm-up Lane", xp: 0, score: 1000 },
    { id: "1100", name: "1100 Rising", xp: 80, score: 1100 },
    { id: "1200", name: "1200 Club", xp: 200, score: 1200 },
    { id: "1300", name: "1300 Path", xp: 400, score: 1300 },
    { id: "1400", name: "1400 Climb", xp: 700, score: 1400 },
    { id: "1500", name: "1500 Zone", xp: 1100, score: 1500 },
    { id: "1550", name: "1550 Orbit", xp: 1600, score: 1550 }
  ];

  const BADGE_DEFS = [
    { id: "first-submit", name: "First Submit", desc: "Submit your first test" },
    { id: "m1-warrior", name: "Module 1 Warrior", desc: "Finish any timed Module 1" },
    { id: "hard-mode", name: "Hard Mode", desc: "Finish a hard module" },
    { id: "review-scholar", name: "Review Scholar", desc: "Review a full test" },
    { id: "streak-3", name: "Streak 3", desc: "Practice 3 days in a row" },
    { id: "accuracy-ace", name: "Accuracy Ace", desc: "≥90% on a test with ≥10 Q" }
  ];

  const loadStore = () => {
    try { return JSON.parse(localStorage.getItem(storeKey) || "{}"); }
    catch { return {}; }
  };
  const saveStore = (s) => localStorage.setItem(storeKey, JSON.stringify(s));

  function ensureProgress(store) {
    if (typeof store.xp !== "number") store.xp = 0;
    if (!Array.isArray(store.badges)) store.badges = [];
    if (!store.badgeMeta) store.badgeMeta = {};
    if (!store.lastPracticeDate) store.lastPracticeDate = null;
    if (typeof store.streak !== "number") store.streak = 0;
    if (!store.reviewedTests) store.reviewedTests = {};
    if (!store.dayCompleteAwarded) store.dayCompleteAwarded = {};
    store.attempts = store.attempts || [];
    store.lastByTest = store.lastByTest || {};
    return store;
  }

  function levelForXp(xp) {
    let lvl = LEVELS[0];
    for (let i = 0; i < LEVELS.length; i++) {
      if (xp >= LEVELS[i].xp) lvl = LEVELS[i];
      else break;
    }
    return lvl;
  }

  function nextLevel(xp) {
    const cur = levelForXp(xp);
    const idx = LEVELS.findIndex((l) => l.id === cur.id);
    return LEVELS[Math.min(idx + 1, LEVELS.length - 1)];
  }

  function levelProgress(xp) {
    const cur = levelForXp(xp);
    const nxt = nextLevel(xp);
    if (cur.id === nxt.id) return { cur, nxt, pct: 100, into: 0, need: 0 };
    const span = nxt.xp - cur.xp;
    const into = xp - cur.xp;
    return { cur, nxt, pct: Math.min(100, Math.round((into / span) * 100)), into, need: span };
  }

  function todayKey(d) {
    const x = d || new Date();
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const day = String(x.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function dateOffset(key, days) {
    const parts = key.split("-").map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + days);
    return todayKey(d);
  }

  function updateStreak(store) {
    const today = todayKey();
    const last = store.lastPracticeDate;
    if (last === today) return store;
    if (last && last === dateOffset(today, -1)) {
      store.streak = (store.streak || 0) + 1;
    } else {
      store.streak = 1;
    }
    store.lastPracticeDate = today;
    return store;
  }

  function unlockBadge(store, id, newly) {
    if (!store.badges.includes(id)) {
      store.badges.push(id);
      store.badgeMeta[id] = Date.now();
      newly.push(id);
    }
  }

  function isTimedM1(t) {
    if (!t) return false;
    const s = ((t.id || "") + " " + (t.title || "")).toLowerCase();
    const timed = true;
    const m1 = /module\s*1|mod\s*1|\bm1\b|timed-module1/.test(s);
    return timed && m1;
  }

  function isHardModule(t) {
    if (!t) return false;
    const s = ((t.id || "") + " " + (t.title || "")).toLowerCase();
    return /hard/.test(s) && !!(t.minutes || /module|m2|m1/.test(s));
  }

  function dayFullyComplete(store, dayId) {
    const d = (DATA.days || []).find((x) => x.id === dayId);
    if (!d || !(d.tests || []).length) return false;
    return d.tests.every((tid) => store.lastByTest && store.lastByTest[tid]);
  }

  let pendingCelebration = null;

  function showToast(text, kind) {
    if (state && (state.view === "test" || state.view === "review")) return;
    let host = document.getElementById("toastHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "toastHost";
      host.className = "toast-host";
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = "toast " + (kind || "");
    el.textContent = text;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 350);
    }, 3200);
  }

  function burstConfetti(root) {
    const layer = document.createElement("div");
    layer.className = "confetti-layer";
    const colors = ["#5b9fd4", "#6bcb8a", "#e6b35a", "#c9a0ff", "#e07070", "#7dd3fc"];
    for (let i = 0; i < 28; i++) {
      const p = document.createElement("span");
      p.className = "confetti-bit";
      p.style.left = (8 + Math.random() * 84) + "%";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.35) + "s";
      p.style.setProperty("--dx", ((Math.random() - 0.5) * 120) + "px");
      p.style.setProperty("--rot", (Math.random() * 720 - 360) + "deg");
      layer.appendChild(p);
    }
    (root || document.body).appendChild(layer);
    setTimeout(() => layer.remove(), 1600);
  }

  function awardOnSubmit(result, dayId) {
    const store = ensureProgress(loadStore());
    const t = testObj(result.testId);
    const prevXp = store.xp || 0;
    const prevLevel = levelForXp(prevXp);
    const newly = [];

    const answered = result.details.filter((d) => String(d.got || "").trim() !== "").length;
    let gained = 0;
    gained += result.correct * 10;
    gained += answered * 3;
    gained += 25;
    const perfect = result.correct === result.total && result.total > 0;
    if (perfect) gained += 50;

    updateStreak(store);

    let dayBonus = 0;
    if (dayId && dayFullyComplete(store, dayId) && !store.dayCompleteAwarded[dayId]) {
      dayBonus = 40;
      gained += 40;
      store.dayCompleteAwarded[dayId] = true;
    }

    store.xp = prevXp + gained;

    unlockBadge(store, "first-submit", newly);
    if (isTimedM1(t)) unlockBadge(store, "m1-warrior", newly);
    if (isHardModule(t)) unlockBadge(store, "hard-mode", newly);
    if (result.total >= 10 && (result.correct / result.total) >= 0.9) {
      unlockBadge(store, "accuracy-ace", newly);
    }
    if ((store.streak || 0) >= 3) unlockBadge(store, "streak-3", newly);

    saveStore(store);

    const newLevel = levelForXp(store.xp);
    const leveled = newLevel.id !== prevLevel.id;

    pendingCelebration = {
      gained,
      breakdown: {
        correct: result.correct * 10,
        attempts: answered * 3,
        complete: 25,
        perfect: perfect ? 50 : 0,
        day: dayBonus
      },
      leveled,
      fromLevel: prevLevel,
      toLevel: newLevel,
      badges: newly.slice(),
      xp: store.xp,
      streak: store.streak
    };

    newly.forEach((id) => {
      const def = BADGE_DEFS.find((b) => b.id === id);
      showToast("Badge unlocked · " + (def ? def.name : id), "badge");
    });

    return pendingCelebration;
  }

  function awardReviewScholar(testId) {
    const store = ensureProgress(loadStore());
    const newly = [];
    store.reviewedTests[testId] = true;
    unlockBadge(store, "review-scholar", newly);
    saveStore(store);
    newly.forEach((id) => {
      const def = BADGE_DEFS.find((b) => b.id === id);
      showToast("Badge unlocked · " + (def ? def.name : id), "badge");
    });
  }

  function markReviewVisit(testId, detailIndex, total) {
    if (!state.reviewVisited) state.reviewVisited = {};
    if (!state.reviewVisited[testId]) state.reviewVisited[testId] = {};
    state.reviewVisited[testId][detailIndex] = true;
    const seen = Object.keys(state.reviewVisited[testId]).length;
    if (seen >= total) {
      const store = ensureProgress(loadStore());
      if (!store.reviewedTests[testId]) awardReviewScholar(testId);
    }
  }

  function hudHtml() {
    const store = ensureProgress(loadStore());
    const prog = levelProgress(store.xp || 0);
    const badgeCount = (store.badges || []).length;
    const streak = store.streak || 0;
    return (
      '<div class="hud">' +
      '<div class="hud-row">' +
      '<div class="hud-level">' +
      '<span class="hud-level-name">' + escapeHtml(prog.cur.name) + "</span>" +
      '<span class="hud-score-tag">→ ' + prog.cur.score + "</span>" +
      "</div>" +
      '<div class="hud-stats">' +
      '<span class="hud-chip xp" title="Experience">✦ ' + store.xp + " XP</span>" +
      '<span class="hud-chip streak" title="Day streak">' +
      '<span class="flame">🔥</span> ' + streak + "</span>" +
      '<span class="hud-chip badges" title="Badges">🏅 ' + badgeCount + "/" + BADGE_DEFS.length + "</span>" +
      "</div></div>" +
      '<div class="xp-track" aria-label="Level progress">' +
      '<div class="xp-fill" style="width:' + prog.pct + '%"></div>' +
      "</div>" +
      '<div class="xp-labels"><span>' + escapeHtml(prog.cur.name) + "</span>" +
      (prog.cur.id !== prog.nxt.id
        ? "<span>" + prog.into + "/" + prog.need + " → " + escapeHtml(prog.nxt.name) + "</span>"
        : "<span>Max orbit reached</span>") +
      "</div></div>"
    );
  }

  function sep12SectionHtml() {
    const hasDays = Array.isArray(DATA.days) && DATA.days.length;
    const forecast = DATA.forecastDay;
    if (!hasDays && !forecast) return "";

    const exam = (DATA.meta && DATA.meta.exam) || (DATA.strategy && DATA.strategy.examDate) || "2026-09-12";
    let body = "";
    if (forecast) {
      const title = forecast.title || "Sep 12 Likely";
      body += "<h3>" + escapeHtml(title) + "</h3>";
      if (forecast.summary || forecast.note || forecast.theme) {
        body += "<p>" + escapeHtml(forecast.summary || forecast.note || forecast.theme) + "</p>";
      }
      if (Array.isArray(forecast.bullets) && forecast.bullets.length) {
        body += "<ul>" + forecast.bullets.map((b) => "<li>" + escapeHtml(b) + "</li>").join("") + "</ul>";
      }
      if (forecast.estMin) {
        body += '<span class="badge">~' + escapeHtml(String(forecast.estMin)) + " min</span>";
      }
    } else {
      body += "<h3>Sep 12 Likely</h3>";
      body += "<p>Exam target <strong>" + escapeHtml(exam) +
        "</strong>. Stay on the 6-day path — Module 1 accuracy first, then hard M2 unlocks. Bluebook fulls stay official.</p>";
      const card = DATA.strategy && DATA.strategy.examDayCard;
      if (card && Array.isArray(card.bullets) && card.bullets.length) {
        body += "<ul>" + card.bullets.slice(0, 4).map((b) => "<li>" + escapeHtml(b) + "</li>").join("") + "</ul>";
      }
      body += '<span class="badge">Goal ' + escapeHtml((DATA.meta && DATA.meta.goal) || "1550+") + "</span>";
    }
    return '<div class="forecast-card panel">' + body + "</div>";
  }

  function badgesStripHtml() {
    const store = ensureProgress(loadStore());
    const owned = store.badges || [];
    if (!owned.length) {
      return '<p class="badges-compact">No badges yet — finish a module to unlock.</p>';
    }
    const names = owned.map((id) => {
      const def = BADGE_DEFS.find((b) => b.id === id);
      return def ? def.name : id;
    });
    return '<p class="badges-compact">🏅 ' + escapeHtml(names.join(" · ")) + "</p>";
  }

  function calendarDayIdForToday() {
    // Sprint is Sep 6–12 2026 (PT). Prefer explicit hint, else map local date.
    const hint = (DATA.meta && DATA.meta.todayHint) || null;
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
    const map = {
      "2026-9-6": "sun-sep6",
      "2026-9-7": "mon-sep7",
      "2026-9-8": "tue-sep8",
      "2026-9-9": "wed-sep9",
      "2026-9-10": "thu-sep10",
      "2026-9-11": "fri-sep11",
      "2026-9-12": "sep12-likely"
    };
    const key = y + "-" + m + "-" + d;
    return map[key] || hint || "sun-sep6";
  }

  function findContinueDay(store) {
    const days = DATA.days || [];
    if (!days.length) return null;
    const preferId = calendarDayIdForToday();
    const prefer = days.find((d) => d.id === preferId);
    // Prefer today's card if any of its tests are still open
    if (prefer) {
      const tests = prefer.tests || [];
      const done = tests.length && tests.every((tid) => store.lastByTest && store.lastByTest[tid]);
      if (!done) return prefer;
    }
    // Otherwise next incomplete calendar day (skip high-prob optional until rest done)
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (d.id === "sep12-likely") continue;
      const tests = d.tests || [];
      if (!tests.length) continue;
      const done = tests.every((tid) => store.lastByTest && store.lastByTest[tid]);
      if (!done) return d;
    }
    // Fallback: high-prob pack or first day
    const hp = days.find((d) => d.id === "sep12-likely");
    if (hp) {
      const tests = hp.tests || [];
      const done = tests.length && tests.every((tid) => store.lastByTest && store.lastByTest[tid]);
      if (!done) return hp;
    }
    return prefer || days[0] || null;
  }

  function celebrationHtml(c) {
    if (!c) return "";
    const bits = [];
    if (c.breakdown.correct) bits.push("+" + c.breakdown.correct + " correct");
    if (c.breakdown.attempts) bits.push("+" + c.breakdown.attempts + " attempts");
    if (c.breakdown.complete) bits.push("+" + c.breakdown.complete + " complete");
    if (c.breakdown.perfect) bits.push("+" + c.breakdown.perfect + " perfect");
    if (c.breakdown.day) bits.push("+" + c.breakdown.day + " day complete");
    return (
      '<div class="celebration' + (c.leveled ? " leveled" : "") + '" id="celebration">' +
      '<div class="cel-xp">+' + c.gained + " XP</div>" +
      '<p class="cel-break muted">' + escapeHtml(bits.join(" · ")) + "</p>" +
      (c.leveled
        ? '<div class="level-up-flash">Level up → <strong>' + escapeHtml(c.toLevel.name) + "</strong></div>"
        : '<p class="muted">Now ' + escapeHtml(c.toLevel.name) + " · " + c.xp + " XP</p>") +
      (c.badges.length
        ? '<div class="cel-badges">' + c.badges.map((id) => {
            const def = BADGE_DEFS.find((b) => b.id === id);
            return '<span class="badge-pill earned">🏅 ' + escapeHtml(def ? def.name : id) + "</span>";
          }).join("") + "</div>"
        : "") +
      "</div>"
    );
  }

  let state = {
    view: "home", dayId: null, testId: null, idx: 0,
    answers: {}, marked: {}, startedAt: 0, endsAt: 0,
    timerId: null, reviewMode: false, result: null, reviewFilter: "all",
    reviewVisited: {}
  };

  function clearTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  }

  function route(view, payload = {}) {
    clearTimer();
    const keepResult = view === "results" || view === "review";
    state = {
      ...state,
      view,
      reviewMode: view === "review",
      result: keepResult ? (payload.result !== undefined ? payload.result : state.result) : (payload.result || null),
      ...payload
    };
    if (!keepResult && payload.result === undefined) state.result = null;
    render();
  }

  function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60), r = s % 60;
    return m + ":" + String(r).padStart(2, "0");
  }

  function testObj(id) { return DATA.tests[id]; }
  function question(id) { return DATA.questions[id]; }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function startTest(testId) {
    const t = testObj(testId);
    if (!t) return;
    const mins = Math.max(1, t.minutes || 15);
    const now = Date.now();
    clearTimer();
    pendingCelebration = null;
    state = {
      ...state,
      view: "test", testId, dayId: state.dayId, idx: 0,
      answers: {}, marked: {},
      startedAt: now, endsAt: now + mins * 60 * 1000,
      reviewMode: false, result: null, timerId: null
    };
    if (mins) {
      state.timerId = setInterval(() => {
        if (Date.now() >= state.endsAt) submitTest();
        else {
          const el = document.getElementById("timer");
          if (el) el.textContent = fmt(state.endsAt - Date.now());
        }
      }, 250);
    }
    render();
  }

  function normalizeAns(v) {
    return String(v == null ? "" : v).trim().toLowerCase().replace(/,/g, "");
  }

  function grade() {
    const t = testObj(state.testId);
    let correct = 0;
    const details = [];
    t.questionIds.forEach((qid) => {
      const q = question(qid);
      const got = (state.answers[qid] || "").toString().trim();
      const ans = (q.answer || "").toString().trim();
      const ok = normalizeAns(got) === normalizeAns(ans);
      if (ok) correct++;
      details.push({ qid, ok, got, ans });
    });
    return {
      correct, total: t.questionIds.length, details,
      testId: state.testId, at: Date.now(),
      marked: { ...state.marked }, answers: { ...state.answers }
    };
  }

  function submitTest() {
    clearTimer();
    const result = grade();
    const store = ensureProgress(loadStore());
    store.attempts = store.attempts || [];
    store.attempts.push({
      testId: result.testId, correct: result.correct, total: result.total, at: result.at
    });
    store.lastByTest = store.lastByTest || {};
    store.lastByTest[state.testId] = result;
    saveStore(store);
    // Switch to results BEFORE award UI so XP/badge toasts are not blocked by test quarantine
    state.view = "results";
    state.result = result;
    awardOnSubmit(result, state.dayId);
    render();
  }

  function renderHome() {
    const store = ensureProgress(loadStore());
    const prog = levelProgress(store.xp || 0);
    topMeta.textContent = prog.cur.name + " · " + store.xp + " XP · 🔥" + (store.streak || 0);
    const cont = findContinueDay(store);
    const days = (DATA.days || []).map((d) => {
      const done = (d.tests || []).filter((tid) => store.lastByTest && store.lastByTest[tid]).length;
      const total = (d.tests || []).length;
      const complete = total && done === total;
      const isPrimary = cont && d.id === cont.id && !complete;
      return (
        '<div class="card' + (complete ? " done" : "") + (isPrimary ? " primary-day" : "") + '" data-day="' + escapeHtml(d.id) + '">' +
        "<h3>" + escapeHtml(d.title) + "</h3>" +
        "<p>" + escapeHtml(d.theme || "") + "</p>" +
        '<span class="badge">~' + (d.estMin || "?") + " min · " + total + " sessions" +
        (done ? " · " + done + "/" + total : "") + "</span>" +
        (complete ? '<span class="badge earned-tag">Day complete</span>' : "") +
        "</div>"
      );
    }).join("");
    let continueHtml = "";
    if (cont) {
      const doneN = (cont.tests || []).filter((tid) => store.lastByTest && store.lastByTest[tid]).length;
      const totalN = (cont.tests || []).length;
      const label = doneN === 0
        ? ("Continue · " + cont.title)
        : (doneN >= totalN ? ("Review · " + cont.title) : ("Continue · " + cont.title + " (" + doneN + "/" + totalN + ")"));
      continueHtml =
        '<div class="home-primary-cta">' +
        '<button class="btn" id="btnContinue">' + escapeHtml(label) + "</button></div>";
    }
    main.innerHTML =
      hudHtml() +
      "<h1>6-day path toward 1550+</h1>" +
      '<p class="sub">Baseline 600/600 · Exam Sep 12. Timed modules first — Bluebook fulls stay official.</p>' +
      continueHtml +
      sep12SectionHtml() +
      badgesStripHtml() +
      '<div class="grid">' + days + "</div>" +
      '<p class="home-secondary">' +
      '<a id="btnAllTests">All tests</a> · <a id="btnStrategy">Speed strategy</a>' +
      "</p>";
    main.querySelectorAll("[data-day]").forEach((el) => {
      el.onclick = () => route("day", { dayId: el.dataset.day });
    });
    const btnC = document.getElementById("btnContinue");
    if (btnC && cont) btnC.onclick = () => route("day", { dayId: cont.id });
    document.getElementById("btnStrategy").onclick = (e) => { e.preventDefault(); route("strategy"); };
    document.getElementById("btnAllTests").onclick = (e) => { e.preventDefault(); route("library"); };
    const fill = main.querySelector(".xp-fill");
    if (fill) {
      const w = fill.style.width;
      fill.style.width = "0%";
      requestAnimationFrame(() => { fill.style.width = w; });
    }
  }

  function renderDay() {
    const d = DATA.days.find((x) => x.id === state.dayId);
    if (!d) { route("home"); return; }
    const store = ensureProgress(loadStore());
    topMeta.textContent = d.title;
    const list = (d.tests || []).map((tid) => {
      const t = testObj(tid);
      if (!t) return "";
      const last = (store.lastByTest || {})[tid];
      const score = last ? ("Last: " + last.correct + "/" + last.total) : "Not taken";
      return (
        '<button class="btn secondary" data-test="' + escapeHtml(tid) + '" style="width:100%;margin-bottom:8px;text-align:left">' +
        "<strong>" + escapeHtml(t.title) + "</strong><br/>" +
        '<span class="muted">' + (Math.max(1, t.minutes || 15) + " min timed") +
        " · " + t.questionIds.length + " Q · " + score + "</span></button>"
      );
    }).join("");
    main.innerHTML =
      '<button class="btn secondary" id="back">← Home</button>' +
      "<h1>" + escapeHtml(d.title) + "</h1>" +
      '<p class="sub">' + escapeHtml(d.theme || "") + "</p>" +
      (d.note ? '<div class="note">' + escapeHtml(d.note) + "</div>" : "") +
      '<div class="list">' + (list || '<p class="muted">No sessions.</p>') + "</div>";
    document.getElementById("back").onclick = () => route("home");
    main.querySelectorAll("[data-test]").forEach((el) => {
      el.onclick = () => startTest(el.dataset.test);
    });
  }

  function renderLibrary() {
    topMeta.textContent = "All tests";
    const store = ensureProgress(loadStore());
    const list = Object.values(DATA.tests).map((t) => {
      const last = (store.lastByTest || {})[t.id];
      const score = last ? ("Last: " + last.correct + "/" + last.total) : "Not taken";
      return (
        '<button class="btn secondary" data-test="' + escapeHtml(t.id) + '" style="width:100%;margin-bottom:8px;text-align:left">' +
        "<strong>" + escapeHtml(t.title) + "</strong><br/>" +
        '<span class="muted">' + (t.section || "") + " · " +
        (Math.max(1, t.minutes || 15) + " min timed") +
        " · " + t.questionIds.length + " Q · " + score + "</span></button>"
      );
    }).join("");
    main.innerHTML =
      '<button class="btn secondary" id="back">← Home</button>' +
      "<h1>All tests</h1>" +
      '<p class="sub">Pick any drill or timed module.</p>' +
      list;
    document.getElementById("back").onclick = () => route("home");
    main.querySelectorAll("[data-test]").forEach((el) => {
      el.onclick = () => startTest(el.dataset.test);
    });
  }

  function renderStrategy() {
    const S = DATA.strategy;
    if (!S) {
      main.innerHTML = '<button class="btn secondary" id="back">← Home</button><p class="muted">No strategy data.</p>';
      document.getElementById("back").onclick = () => route("home");
      return;
    }
    topMeta.textContent = "Speed strategy";

    function bullets(arr) {
      if (!arr || !arr.length) return "";
      return "<ul>" + arr.map((x) => "<li>" + escapeHtml(typeof x === "string" ? x : JSON.stringify(x)) + "</li>").join("") + "</ul>";
    }

    function section(title, bodyHtml) {
      return '<div class="panel"><h4>' + escapeHtml(title) + "</h4>" + bodyHtml + "</div>";
    }

    let html = '<button class="btn secondary" id="back">← Home</button>';
    html += "<h1>Speed strategy</h1>";
    html += '<p class="sub">Goal: ' + escapeHtml(S.goal || "") + " · Exam " + escapeHtml(S.examDate || "") +
      " · Baseline " + escapeHtml(S.baselineAssumed || "") + "</p>";
    html += section("North star", "<p>" + escapeHtml(S.northStar || "") + "</p>");

    if (S.module1Protocol) {
      const m = S.module1Protocol;
      let body = "<p>" + escapeHtml(m.purpose || "") + "</p>";
      ["rw", "math"].forEach((side) => {
        const sideObj = m[side];
        if (!sideObj) return;
        body += "<h4 style='margin-top:12px'>" + side.toUpperCase() + " Module 1</h4>";
        body += "<p><strong>Timing:</strong> " + escapeHtml(sideObj.timing || "") + "</p>";
        body += "<p><strong>Accuracy gate:</strong> " + escapeHtml(sideObj.accuracyGate || "") + "</p>";
        if (sideObj.paceCheckpoints) body += "<p><strong>Pace:</strong></p>" + bullets(sideObj.paceCheckpoints);
        if (sideObj.orderOfAttack) body += "<p><strong>Order of attack:</strong></p>" + bullets(sideObj.orderOfAttack);
        if (sideObj.never) body += "<p><strong>Never:</strong></p>" + bullets(sideObj.never);
      });
      if (m.hardM2UnlockRule) body += '<div class="note">' + escapeHtml(m.hardM2UnlockRule) + "</div>";
      html += section("Module 1 protocol", body);
    }

    if (S.markAndMove) {
      const m = S.markAndMove;
      let body = "<p><strong>Rule:</strong> " + escapeHtml(m.rule || "") + "</p>";
      if (m.triggers) body += "<p><strong>Triggers:</strong></p>" + bullets(m.triggers);
      if (m.howToMark) body += "<p><strong>How to mark:</strong></p>" + bullets(m.howToMark);
      if (m.returnPass) body += "<p><strong>Return pass:</strong></p>" + bullets(m.returnPass);
      if (m.banList) body += "<p><strong>Ban list:</strong></p>" + bullets(m.banList);
      html += section("Mark & move", body);
    }

    if (S.desmosHeuristics) {
      const d = S.desmosHeuristics;
      let body = "";
      Object.keys(d).forEach((k) => {
        const v = d[k];
        if (Array.isArray(v)) body += "<p><strong>" + escapeHtml(k) + ":</strong></p>" + bullets(v);
        else body += "<p><strong>" + escapeHtml(k) + ":</strong> " + escapeHtml(v) + "</p>";
      });
      html += section("Desmos heuristics", body);
    }

    if (S.perDaySpeedCards) {
      let body = "";
      Object.keys(S.perDaySpeedCards).forEach((k) => {
        const card = S.perDaySpeedCards[k];
        body += "<h4 style='margin-top:10px'>" + escapeHtml(card.day || k) + "</h4>";
        if (card.speedTip) body += "<p>" + escapeHtml(card.speedTip) + "</p>";
        if (card.bullets) body += bullets(card.bullets);
      });
      html += section("Per-day speed cards", body);
    }

    if (S.reviewScript) {
      const r = S.reviewScript;
      let body = "<p><strong>When:</strong> " + escapeHtml(r.when || "") + "</p>";
      if (r.steps) {
        body += "<ol>" + r.steps.map((st) =>
          "<li><strong>" + escapeHtml(st.name || ("Step " + st.step)) + ":</strong> " + escapeHtml(st.do || "") + "</li>"
        ).join("") + "</ol>";
      }
      if (r.stopRules) body += "<p><strong>Stop rules:</strong></p>" + bullets(r.stopRules);
      if (r.examEveException) body += '<div class="note">' + escapeHtml(r.examEveException) + "</div>";
      html += section("Review script", body);
    }

    if (S.examDayCard) {
      const e = S.examDayCard;
      html += section("Exam day — " + (e.day || ""), bullets(e.bullets || []));
    }

    main.innerHTML = html;
    document.getElementById("back").onclick = () => route("home");
  }

  function currentQids() {
    const t = testObj(state.testId);
    return t ? t.questionIds : [];
  }

  function renderTest() {
    const t = testObj(state.testId);
    if (!t) { route("home"); return; }
    const qids = t.questionIds;
    if (state.idx < 0) state.idx = 0;
    if (state.idx >= qids.length) state.idx = qids.length - 1;
    const qid = qids[state.idx];
    const q = question(qid);
    if (!q) { main.innerHTML = "<p>Missing question</p>"; return; }

    topMeta.textContent = "Q " + (state.idx + 1) + " / " + qids.length;

    const pct = ((state.idx + 1) / qids.length) * 100;
    const isSpr = (q.type || "").toLowerCase() === "spr" || !q.choices;
    const marked = !!state.marked[qid];
    const ans = state.answers[qid] || "";

    let choicesHtml = "";
    if (isSpr) {
      choicesHtml =
        '<label class="muted" for="sprInput">Student-produced response</label><br/>' +
        '<input class="spr" id="sprInput" type="text" value="' + escapeHtml(ans) + '" autocomplete="off" placeholder="Enter answer"/>';
    } else {
      const keys = Object.keys(q.choices || {});
      choicesHtml = '<div class="choices">' + keys.map((k) => {
        const sel = ans === k ? " selected" : "";
        return '<button class="choice' + sel + '" data-choice="' + escapeHtml(k) + '"><strong>' +
          escapeHtml(k) + ".</strong> " + escapeHtml(q.choices[k]) + "</button>";
      }).join("") + "</div>";
    }

    const timerHtml = '<span class="timer" id="timer">' + fmt(Math.max(0, (state.endsAt || Date.now()) - Date.now())) + "</span>";

    main.innerHTML =
      '<div class="focus-bar">' +
      '<span class="qprog">Q ' + (state.idx + 1) + " / " + qids.length +
      (marked ? " · Marked" : "") + "</span>" +
      timerHtml + "</div>" +
      '<div class="progress"><div style="width:' + pct + '%"></div></div>' +
      '<p class="qnum">' + escapeHtml(q.section || "") +
      (q.skill ? " · " + escapeHtml(q.skill) : "") +
      (q.difficulty ? " · " + escapeHtml(q.difficulty) : "") + "</p>" +
      '<div class="stem">' + escapeHtml(q.stem) + "</div>" +
      choicesHtml +
      '<div class="row" style="margin-top:18px">' +
      '<button class="btn secondary" id="btnPrev"' + (state.idx === 0 ? " disabled" : "") + ">← Prev</button>" +
      '<button class="btn secondary" id="btnMark">' + (marked ? "Unmark" : "Mark") + "</button>" +
      '<button class="btn secondary" id="btnNext"' + (state.idx >= qids.length - 1 ? " disabled" : "") + ">Next →</button>" +
      '<button class="btn" id="btnSubmit">End module</button>' +
      "</div>";

    if (isSpr) {
      const input = document.getElementById("sprInput");
      input.focus();
      input.oninput = () => { state.answers[qid] = input.value; };
    } else {
      main.querySelectorAll("[data-choice]").forEach((el) => {
        el.onclick = () => {
          state.answers[qid] = el.dataset.choice;
          render();
        };
      });
    }

    document.getElementById("btnPrev").onclick = () => { state.idx--; render(); };
    document.getElementById("btnNext").onclick = () => { state.idx++; render(); };
    document.getElementById("btnMark").onclick = () => {
      if (state.marked[qid]) delete state.marked[qid];
      else state.marked[qid] = true;
      render();
    };
    document.getElementById("btnSubmit").onclick = () => {
      if (confirm("Submit this test?")) submitTest();
    };
  }

  function renderResults() {
    const result = state.result;
    const t = testObj(result && result.testId);
    if (!result || !t) { route("home"); return; }
    const store = ensureProgress(loadStore());
    const prog = levelProgress(store.xp || 0);
    topMeta.textContent = "Results";
    const pct = Math.round((result.correct / result.total) * 100);
    const wrong = result.details.filter((d) => !d.ok).length;
    const cel = pendingCelebration;
    main.innerHTML =
      "<h1>Results</h1>" +
      '<p class="sub">' + escapeHtml(t.title) + "</p>" +
      '<div class="score">' + result.correct + "/" + result.total + "</div>" +
      '<p class="muted">' + pct + "% · " + wrong + " missed</p>" +
      '<div class="row">' +
      '<button class="btn" id="btnReview">Review with tips</button>' +
      '<button class="btn secondary" id="btnRetake">Retake</button>' +
      (state.dayId ? '<button class="btn secondary" id="btnDay">Back to day</button>' : "") +
      '<button class="btn secondary" id="btnHome">Home</button>' +
      "</div>" +
      celebrationHtml(cel) +
      '<div class="panel" style="margin-top:16px"><h4>Question grid</h4><div class="row">' +
      result.details.map((d, i) =>
        '<button class="btn secondary" data-ri="' + i + '" style="min-width:44px;padding:8px;border-color:' +
        (d.ok ? "var(--good)" : "var(--bad)") + '">' + (i + 1) + "</button>"
      ).join("") +
      "</div></div>";

    if (cel && cel.leveled) {
      const root = document.getElementById("celebration");
      burstConfetti(root || main);
    }

    document.getElementById("btnReview").onclick = () => {
      pendingCelebration = null;
      route("review", { result, idx: 0, reviewFilter: "all" });
    };
    document.getElementById("btnRetake").onclick = () => {
      pendingCelebration = null;
      startTest(result.testId);
    };
    document.getElementById("btnHome").onclick = () => {
      pendingCelebration = null;
      route("home");
    };
    const btnDay = document.getElementById("btnDay");
    if (btnDay) btnDay.onclick = () => {
      pendingCelebration = null;
      route("day", { dayId: state.dayId });
    };
    main.querySelectorAll("[data-ri]").forEach((el) => {
      el.onclick = () => {
        pendingCelebration = null;
        route("review", { result, idx: +el.dataset.ri, reviewFilter: "all" });
      };
    });
  }

  function renderReview() {
    const result = state.result;
    const t = testObj(result && result.testId);
    if (!result || !t) { route("home"); return; }

    let indices = result.details.map((_, i) => i);
    if (state.reviewFilter === "missed") {
      indices = indices.filter((i) => !result.details[i].ok);
    }
    if (!indices.length) {
      main.innerHTML =
        '<button class="btn secondary" id="back">← Results</button>' +
        '<p class="muted">No missed questions.</p>';
      document.getElementById("back").onclick = () => route("results", { result });
      return;
    }

    if (state.idx < 0) state.idx = 0;
    if (state.idx >= indices.length) state.idx = indices.length - 1;
    const di = indices[state.idx];
    const detail = result.details[di];
    const q = question(detail.qid);
    if (state.reviewFilter === "all") {
      markReviewVisit(result.testId, di, result.total);
    }

    const isSpr = (q.type || "").toLowerCase() === "spr" || !q.choices;
    let choicesHtml = "";
    if (isSpr) {
      choicesHtml =
        '<p><strong>Your answer:</strong> ' + escapeHtml(detail.got || "(blank)") + "</p>" +
        "<p><strong>Correct:</strong> " + escapeHtml(detail.ans) + "</p>";
    } else {
      const keys = Object.keys(q.choices || {});
      choicesHtml = '<div class="choices">' + keys.map((k) => {
        let cls = "choice";
        if (k === detail.ans) cls += " correct";
        if (k === detail.got && k !== detail.ans) cls += " wrong";
        if (k === detail.got) cls += " selected";
        return '<div class="' + cls + '"><strong>' + escapeHtml(k) + ".</strong> " +
          escapeHtml(q.choices[k]) + "</div>";
      }).join("") + "</div>";
    }

    topMeta.textContent = "Review · Q " + (di + 1) + "/" + result.total;
    main.innerHTML =
      '<div class="review-top">' +
      '<button class="btn secondary" id="back">← Results</button>' +
      '<button class="btn secondary" id="btnReviewHome">Home</button>' +
      '<button class="btn secondary" id="filtAll">All</button>' +
      '<button class="btn secondary" id="filtMiss">Missed only</button>' +
      "</div>" +
      '<p class="qnum">' + escapeHtml(q.section || "") + " · " + escapeHtml(q.skill || "") +
      " · " + (detail.ok ? '<span style="color:var(--good)">Correct</span>' : '<span style="color:var(--bad)">Missed</span>') +
      "</p>" +
      '<div class="stem">' + escapeHtml(q.stem) + "</div>" +
      choicesHtml +
      '<div class="panel"><h4>Explanation</h4><p>' + escapeHtml(q.explanation || "") + "</p></div>" +
      '<div class="panel"><h4>Method</h4><p>' + escapeHtml(q.method || "") + "</p></div>" +
      (q.speedTip ? '<div class="panel"><h4>Speed tip</h4><p>' + escapeHtml(q.speedTip) + "</p></div>" : "") +
      (q.commonTrap ? '<div class="note">Common trap: ' + escapeHtml(q.commonTrap) + "</div>" : "") +
      '<div class="row">' +
      '<button class="btn secondary" id="btnPrev"' + (state.idx === 0 ? " disabled" : "") + ">← Prev</button>" +
      '<span class="muted">' + (state.idx + 1) + " / " + indices.length + "</span>" +
      '<button class="btn secondary" id="btnNext"' + (state.idx >= indices.length - 1 ? " disabled" : "") + ">Next →</button>" +
      '<button class="btn" id="btnRetake">Retake</button>' +
      "</div>";

    document.getElementById("back").onclick = () => route("results", { result });
    const rh = document.getElementById("btnReviewHome");
    if (rh) rh.onclick = () => route("home");
    document.getElementById("filtAll").onclick = () => { state.reviewFilter = "all"; state.idx = 0; render(); };
    document.getElementById("filtMiss").onclick = () => { state.reviewFilter = "missed"; state.idx = 0; render(); };
    document.getElementById("btnPrev").onclick = () => { state.idx--; render(); };
    document.getElementById("btnNext").onclick = () => { state.idx++; render(); };
    document.getElementById("btnRetake").onclick = () => startTest(result.testId);
  }

  function updateChrome() {
    const isTest = state.view === "test";
    const isReview = state.view === "review";
    document.body.classList.toggle("focus-mode", isTest);
    document.body.classList.toggle("review-mode", isReview);
    document.body.classList.toggle("assessment", isTest);

    if (exitBtn) {
      if (isTest) {
        exitBtn.hidden = false;
        exitBtn.textContent = "Exit";
        exitBtn.onclick = () => leaveTestToSafe();
      } else if (isReview) {
        exitBtn.hidden = false;
        exitBtn.textContent = "Exit";
        exitBtn.onclick = () => {
          if (state.result) route("results", { result: state.result });
          else route("home");
        };
      } else {
        exitBtn.hidden = true;
        exitBtn.onclick = null;
      }
    }

    // Hard quarantine: kill any stray reward toasts mid-focus
    if (isTest || isReview) {
      const host = document.getElementById("toastHost");
      if (host) host.innerHTML = "";
    }
  }

  function render() {
    updateChrome();
    const v = state.view;
    if (v === "home") renderHome();
    else if (v === "day") renderDay();
    else if (v === "library") renderLibrary();
    else if (v === "strategy") renderStrategy();
    else if (v === "test") renderTest();
    else if (v === "results") renderResults();
    else if (v === "review") renderReview();
    else renderHome();
  }

  document.addEventListener("keydown", (e) => {
    if (state.view !== "test") {
      if (state.view === "review") {
        if (e.key === "ArrowLeft") { e.preventDefault(); state.idx--; render(); }
        if (e.key === "ArrowRight") { e.preventDefault(); state.idx++; render(); }
      }
      return;
    }
    const t = testObj(state.testId);
    if (!t) return;
    const qid = t.questionIds[state.idx];
    const q = question(qid);
    const isSpr = (q.type || "").toLowerCase() === "spr" || !q.choices;
    const tag = (e.target && e.target.tagName) || "";
    if (isSpr && (tag === "INPUT" || tag === "TEXTAREA")) {
      if (e.key === "Enter") { e.preventDefault(); if (state.idx < t.questionIds.length - 1) { state.idx++; render(); } }
      return;
    }
    const k = e.key.toUpperCase();
    if (!isSpr && ["A", "B", "C", "D"].includes(k) && q.choices && q.choices[k] !== undefined) {
      e.preventDefault();
      state.answers[qid] = k;
      render();
      return;
    }
    if (e.key === "ArrowLeft") { e.preventDefault(); if (state.idx > 0) { state.idx--; render(); } }
    if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      if (state.idx < t.questionIds.length - 1) { state.idx++; render(); }
    }
    if (k === "M") {
      e.preventDefault();
      if (state.marked[qid]) delete state.marked[qid];
      else state.marked[qid] = true;
      render();
    }
  });

  ensureProgress(loadStore());
  saveStore(ensureProgress(loadStore()));
  render();
})().catch((err) => {
  document.getElementById("main").innerHTML =
    "<h1>Failed to load bank.json</h1><pre>" + String(err) + "</pre>";
});
