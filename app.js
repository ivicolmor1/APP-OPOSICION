/* Oposición Test — lógica de la app (todo en local, sin backend) */

const STATS_KEY = 'opo_stats_v1';
const BOX_WEIGHT = { 1: 10, 2: 6, 3: 3, 4: 2, 5: 1 };
const MASTER_BOX = 4; // a partir de esta caja se considera "dominada"

// ---------------- Persistencia ----------------
function loadStats() {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function saveStats(stats) {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}
let STATS = loadStats();

function getStat(qid) {
  return STATS[qid] || { box: 1, aciertos: 0, fallos: 0, ultima: null, ts: 0 };
}
function setStat(qid, patch) {
  const cur = getStat(qid);
  STATS[qid] = Object.assign({}, cur, patch);
  saveStats(STATS);
}

// ---------------- Datos derivados ----------------
function allQuestionsFlat() {
  const out = [];
  for (const tema of TEMAS) {
    for (const q of tema.preguntas) {
      out.push(Object.assign({}, q, { temaId: tema.id, temaTitulo: tema.titulo }));
    }
  }
  return out;
}
const ALL_Q = allQuestionsFlat();

function temaQuestions(temaId) {
  return ALL_Q.filter(q => q.temaId === temaId);
}

function temaProgress(temaId) {
  const qs = temaQuestions(temaId);
  let mastered = 0, learning = 0, fail = 0, notStarted = 0;
  for (const q of qs) {
    const s = STATS[q.id];
    if (!s) { notStarted++; continue; }
    if (s.ultima === 'fail') { fail++; }
    else if (s.box >= MASTER_BOX) { mastered++; }
    else { learning++; }
  }
  return { total: qs.length, mastered, learning, fail, notStarted };
}

function globalProgress() {
  let mastered = 0, learning = 0, fail = 0, notStarted = 0, attempted = 0;
  for (const q of ALL_Q) {
    const s = STATS[q.id];
    if (!s) { notStarted++; continue; }
    attempted++;
    if (s.ultima === 'fail') fail++;
    else if (s.box >= MASTER_BOX) mastered++;
    else learning++;
  }
  return { total: ALL_Q.length, mastered, learning, fail, notStarted, attempted };
}

function failingQuestions(temaId) {
  const pool = temaId ? temaQuestions(temaId) : ALL_Q;
  return pool.filter(q => {
    const s = STATS[q.id];
    return s && s.fallos > 0 && s.ultima === 'fail';
  }).sort((a, b) => (STATS[a.id].box - STATS[b.id].box) || (STATS[b.id].ts - STATS[a.id].ts));
}

// ---------------- Selección ponderada ----------------
function weightedSample(pool, count) {
  const items = pool.map(q => {
    const s = STATS[q.id];
    const box = s ? s.box : 1;
    return { q, weight: BOX_WEIGHT[box] || 1 };
  });
  const result = [];
  const n = Math.min(count, items.length);
  for (let k = 0; k < n; k++) {
    const total = items.reduce((sum, it) => sum + it.weight, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < items.length; idx++) {
      r -= items[idx].weight;
      if (r <= 0) break;
    }
    idx = Math.min(idx, items.length - 1);
    result.push(items[idx].q);
    items.splice(idx, 1);
  }
  return result;
}

// ---------------- Router / estado ----------------
const viewStack = [{ name: 'home' }];
function currentView() { return viewStack[viewStack.length - 1]; }
function navigate(view) { viewStack.push(view); render(); window.scrollTo(0, 0); }
function replaceView(view) { viewStack[viewStack.length - 1] = view; render(); window.scrollTo(0, 0); }
function goBack() {
  if (viewStack.length > 1) { viewStack.pop(); render(); window.scrollTo(0, 0); }
}
function goHome() { viewStack.length = 1; viewStack[0] = { name: 'home' }; render(); window.scrollTo(0, 0); }

document.getElementById('btnBack').addEventListener('click', goBack);
document.getElementById('btnStats').addEventListener('click', () => navigate({ name: 'stats' }));

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 2200);
}

// ---------------- Render principal ----------------
function render() {
  const app = document.getElementById('app');
  const view = currentView();
  document.getElementById('btnBack').hidden = viewStack.length <= 1;

  let title = 'Oposición Test';
  let node;

  if (view.name === 'home') { title = 'Oposición Test'; node = renderHome(); }
  else if (view.name === 'temaDetail') { const t = TEMAS.find(x => x.id === view.temaId); title = 'Tema'; node = renderTemaDetail(t); }
  else if (view.name === 'quiz') { title = 'Pregunta'; node = renderQuiz(view); }
  else if (view.name === 'results') { title = 'Resultados'; node = renderResults(view); }
  else if (view.name === 'stats') { title = 'Tus estadísticas'; node = renderStats(); }

  document.getElementById('pageTitle').textContent = title;
  app.innerHTML = '';
  app.appendChild(node);
}

// ---------------- Home ----------------
function renderHome() {
  const wrap = el('<div></div>');
  const gp = globalProgress();

  wrap.appendChild(el(`
    <div class="hero">
      <h2>Tus temas</h2>
      <p>Elige un tema para practicar, o lanza un repaso general. Las preguntas que fallas vuelven a aparecer con más frecuencia hasta que las domines.</p>
    </div>
  `));

  if (!('standalone' in navigator) && !window.matchMedia('(display-mode: standalone)').matches) {
    wrap.appendChild(el(`
      <div class="install-banner">
        💡 Consejo: abre el menú de tu navegador y elige <strong>"Añadir a pantalla de inicio"</strong> para tener esta app como un icono más en tu móvil.
      </div>
    `));
  }

  const actions = el('<div class="global-actions"></div>');
  const cardGlobal = el(`
    <button class="action-card accent">
      <div class="big-num">${gp.total}</div>
      <div class="label">Repaso general<br>(todos los temas)</div>
    </button>
  `);
  cardGlobal.addEventListener('click', () => startQuiz('global', null, 15));
  const failCount = failingQuestions(null).length;
  const cardFails = el(`
    <button class="action-card ${failCount ? 'danger' : ''}">
      <div class="big-num">${failCount}</div>
      <div class="label">Repasar falladas<br>(de cualquier tema)</div>
    </button>
  `);
  cardFails.addEventListener('click', () => {
    if (!failCount) { showToast('Todavía no tienes preguntas falladas 🎉'); return; }
    startQuiz('fails', null, Math.min(20, failCount));
  });
  actions.appendChild(cardGlobal);
  actions.appendChild(cardFails);
  wrap.appendChild(actions);

  wrap.appendChild(el(`<div class="section-title">Temario</div>`));
  const list = el('<div class="tema-list"></div>');
  for (const tema of TEMAS) {
    const p = temaProgress(tema.id);
    const pctMastered = p.total ? (p.mastered / p.total * 100) : 0;
    const pctLearning = p.total ? (p.learning / p.total * 100) : 0;
    const pctFail = p.total ? (p.fail / p.total * 100) : 0;
    const card = el(`
      <div class="tema-card">
        <div class="tema-card-top">
          <h3>${esc(tema.titulo)}</h3>
          <span class="tema-badge">${p.total} preg.</span>
        </div>
        <div class="progress-bar">
          <div class="seg-mastered" style="width:${pctMastered}%"></div>
          <div class="seg-learning" style="width:${pctLearning}%"></div>
          <div class="seg-fail" style="width:${pctFail}%"></div>
        </div>
        <div class="tema-stats-row">
          <span><span class="dot dot-mastered"></span>${p.mastered} dominadas</span>
          <span><span class="dot dot-learning"></span>${p.learning} en curso</span>
          <span><span class="dot dot-fail"></span>${p.fail} falladas</span>
        </div>
      </div>
    `);
    card.addEventListener('click', () => navigate({ name: 'temaDetail', temaId: tema.id }));
    list.appendChild(card);
  }
  wrap.appendChild(list);
  return wrap;
}

// ---------------- Detalle de tema ----------------
function renderTemaDetail(tema) {
  const wrap = el('<div></div>');
  const p = temaProgress(tema.id);
  const failCount = failingQuestions(tema.id).length;

  wrap.appendChild(el(`
    <div class="tema-detail-header">
      <h2>${esc(tema.titulo)}</h2>
      <p>${p.total} preguntas en este tema.</p>
    </div>
  `));

  wrap.appendChild(el(`
    <div class="stat-grid">
      <div class="stat-box"><div class="num">${p.mastered}</div><div class="lbl">Dominadas</div></div>
      <div class="stat-box"><div class="num">${p.learning}</div><div class="lbl">En curso</div></div>
      <div class="stat-box"><div class="num">${p.fail}</div><div class="lbl">Falladas</div></div>
    </div>
  `));

  const btnPractice = el(`<button class="btn btn-primary">Practicar este tema (10 preguntas)</button>`);
  btnPractice.addEventListener('click', () => startQuiz('tema', tema.id, 10));
  wrap.appendChild(btnPractice);

  const btnPracticeAll = el(`<button class="btn btn-secondary">Practicar todas (${p.total})</button>`);
  btnPracticeAll.addEventListener('click', () => startQuiz('tema', tema.id, p.total));
  wrap.appendChild(btnPracticeAll);

  const btnFails = el(`<button class="btn ${failCount ? 'btn-outline-danger' : 'btn-secondary'}">Repasar solo falladas (${failCount})</button>`);
  btnFails.addEventListener('click', () => {
    if (!failCount) { showToast('Sin preguntas falladas en este tema 🎉'); return; }
    startQuiz('fails', tema.id, failCount);
  });
  wrap.appendChild(btnFails);

  return wrap;
}

// ---------------- Quiz ----------------
function startQuiz(mode, temaId, count) {
  let pool;
  if (mode === 'tema') pool = temaQuestions(temaId);
  else if (mode === 'fails') pool = failingQuestions(temaId);
  else pool = ALL_Q;

  if (!pool.length) { showToast('No hay preguntas disponibles.'); return; }

  const questions = mode === 'fails'
    ? pool.slice(0, count)
    : weightedSample(pool, count);

  navigate({
    name: 'quiz',
    mode, temaId,
    questions,
    index: 0,
    answers: [],
    answeredCurrent: false
  });
}

function renderQuiz(view) {
  const wrap = el('<div></div>');
  const q = view.questions[view.index];
  const total = view.questions.length;

  wrap.appendChild(el(`
    <div class="quiz-progress">
      <span>Pregunta ${view.index + 1} de ${total}</span>
      <span>✔ ${view.answers.filter(a => a.correct).length} · ✘ ${view.answers.filter(a => !a.correct).length}</span>
    </div>
  `));

  const card = el(`
    <div class="question-card">
      <div class="q-tema">${esc(q.temaTitulo)}</div>
      <div class="q-text">${esc(q.enunciado)}</div>
    </div>
  `);
  wrap.appendChild(card);

  const optsWrap = el('<div class="options"></div>');
  const letters = ['A', 'B', 'C', 'D'];
  const answered = view.answeredCurrent;
  const chosen = answered ? view.answers[view.answers.length - 1].chosenIndex : null;

  q.opciones.forEach((opt, i) => {
    const btn = el(`
      <button class="option${answered ? ' disabled' : ''}">
        <span class="letter">${letters[i]}</span><span>${esc(opt)}</span>
      </button>
    `);
    if (answered) {
      if (i === q.correcta) btn.classList.add('correct');
      else if (i === chosen) btn.classList.add('incorrect');
      else btn.classList.add('dim');
    }
    btn.addEventListener('click', () => {
      if (view.answeredCurrent) return;
      answerQuestion(view, q, i);
    });
    optsWrap.appendChild(btn);
  });
  wrap.appendChild(optsWrap);

  if (answered) {
    const lastCorrect = view.answers[view.answers.length - 1].correct;
    const expl = el(`
      <div class="explanation ${lastCorrect ? '' : 'wrong'}">
        <span class="result-tag ${lastCorrect ? 'ok' : 'ko'}">${lastCorrect ? '✔ ¡Correcto!' : '✘ Incorrecto'}</span>
        ${esc(q.explicacion || '')}
      </div>
    `);
    wrap.appendChild(expl);

    const nav = el('<div class="quiz-nav"></div>');
    const isLast = view.index >= total - 1;
    const nextBtn = el(`<button class="btn btn-primary">${isLast ? 'Ver resultados' : 'Siguiente pregunta'}</button>`);
    nextBtn.addEventListener('click', () => {
      if (isLast) {
        replaceView({ name: 'results', mode: view.mode, temaId: view.temaId, answers: view.answers, questions: view.questions });
      } else {
        view.index++;
        view.answeredCurrent = false;
        render();
        window.scrollTo(0, 0);
      }
    });
    nav.appendChild(nextBtn);
    wrap.appendChild(nav);
  }

  return wrap;
}

function answerQuestion(view, q, chosenIndex) {
  const correct = chosenIndex === q.correcta;
  const s = getStat(q.id);
  let newBox;
  if (correct) {
    newBox = Math.min(5, s.box + 1);
    setStat(q.id, { box: newBox, aciertos: s.aciertos + 1, ultima: 'ok', ts: Date.now() });
  } else {
    newBox = 1;
    setStat(q.id, { box: newBox, fallos: s.fallos + 1, ultima: 'fail', ts: Date.now() });
  }
  view.answers.push({ qid: q.id, correct, chosenIndex });
  view.answeredCurrent = true;
  render();
}

// ---------------- Resultados ----------------
function renderResults(view) {
  const wrap = el('<div></div>');
  const total = view.answers.length;
  const correctCount = view.answers.filter(a => a.correct).length;
  const pct = total ? Math.round((correctCount / total) * 100) : 0;
  const good = pct >= 60;

  wrap.appendChild(el(`
    <div class="result-hero">
      <div class="score ${good ? 'good' : 'bad'}">${correctCount}/${total}</div>
      <div class="score-lbl">${pct}% de aciertos en esta sesión</div>
    </div>
  `));

  const wrongOnes = view.answers
    .map((a, i) => Object.assign({}, a, { q: view.questions[i] }))
    .filter(a => !a.correct);

  if (wrongOnes.length) {
    wrap.appendChild(el(`<div class="section-title">Para repasar</div>`));
    const list = el('<div class="review-list"></div>');
    wrongOnes.forEach(a => {
      list.appendChild(el(`
        <div class="review-item ko">
          <div class="q">${esc(a.q.enunciado)}</div>
          <div class="a">Correcta: ${esc(a.q.opciones[a.q.correcta])}</div>
        </div>
      `));
    });
    wrap.appendChild(list);
  } else {
    wrap.appendChild(el(`
      <div class="empty-state">
        <div class="emoji">🎉</div>
        <div>¡Has acertado todas! Sigue así.</div>
      </div>
    `));
  }

  if (wrongOnes.length) {
    const btnRetry = el(`<button class="btn btn-outline-danger">Repasar los fallos de esta sesión</button>`);
    btnRetry.addEventListener('click', () => {
      const qs = wrongOnes.map(a => a.q);
      navigate({ name: 'quiz', mode: 'fails', temaId: view.temaId, questions: qs, index: 0, answers: [], answeredCurrent: false });
    });
    wrap.appendChild(btnRetry);
  }

  const btnHome = el(`<button class="btn btn-primary">Volver al inicio</button>`);
  btnHome.addEventListener('click', goHome);
  wrap.appendChild(btnHome);

  return wrap;
}

// ---------------- Estadísticas ----------------
function renderStats() {
  const wrap = el('<div></div>');
  const gp = globalProgress();

  wrap.appendChild(el(`
    <div class="big-stat-row">
      <div class="stat-box"><div class="num">${gp.mastered}</div><div class="lbl">Dominadas</div></div>
      <div class="stat-box"><div class="num">${gp.learning}</div><div class="lbl">En curso</div></div>
      <div class="stat-box"><div class="num">${gp.fail}</div><div class="lbl">Falladas</div></div>
    </div>
  `));
  wrap.appendChild(el(`<p style="color:var(--text-dim);font-size:0.85rem;margin:-8px 0 18px;">
    ${gp.attempted} de ${gp.total} preguntas practicadas al menos una vez.
  </p>`));

  const allFails = failingQuestions(null);
  wrap.appendChild(el(`<div class="section-title">Preguntas falladas (${allFails.length})</div>`));

  if (!allFails.length) {
    wrap.appendChild(el(`
      <div class="empty-state">
        <div class="emoji">✅</div>
        <div>No tienes preguntas pendientes de repasar.</div>
      </div>
    `));
  } else {
    const btnReview = el(`<button class="btn btn-outline-danger">Repasar todas las falladas</button>`);
    btnReview.addEventListener('click', () => startQuiz('fails', null, allFails.length));
    wrap.appendChild(btnReview);

    const list = el('<div class="fail-list"></div>');
    allFails.forEach(q => {
      list.appendChild(el(`
        <div class="fail-item">
          <div class="fail-tema">${esc(q.temaTitulo)}</div>
          <div>${esc(q.enunciado)}</div>
        </div>
      `));
    });
    wrap.appendChild(el(`<div class="section-title">Detalle</div>`));
    wrap.appendChild(list);
  }

  const btnReset = el(`<button class="btn btn-outline-danger" style="margin-top:24px;">Reiniciar todo el progreso</button>`);
  btnReset.addEventListener('click', () => {
    if (confirm('¿Seguro que quieres borrar todo tu progreso guardado en este dispositivo? Esta acción no se puede deshacer.')) {
      STATS = {};
      saveStats(STATS);
      showToast('Progreso reiniciado');
      render();
    }
  });
  wrap.appendChild(btnReset);

  return wrap;
}

// ---------------- Arranque ----------------
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
