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

// ---------------- Preguntas descartadas ----------------
const DISCARD_KEY = 'opo_discard_v1';
function loadDiscarded() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISCARD_KEY)) || []);
  } catch (e) {
    return new Set();
  }
}
function saveDiscarded() {
  localStorage.setItem(DISCARD_KEY, JSON.stringify(Array.from(DISCARDED)));
}
let DISCARDED = loadDiscarded();
function discardQuestion(qid) {
  DISCARDED.add(qid);
  saveDiscarded();
}
function restoreQuestion(qid) {
  DISCARDED.delete(qid);
  saveDiscarded();
}

// ---------------- Preguntas editadas por el usuario (overrides) ----------------
// Permite corregir el texto de una pregunta ya existente (enunciado, opciones,
// correcta, explicación) sin perder su id ni su progreso de repaso (misma caja Leitner).
const OVERRIDE_KEY = 'opo_overrides_v1';
function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDE_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function saveOverrides() {
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(OVERRIDES));
}
let OVERRIDES = loadOverrides();

// ---------------- Preguntas propias del usuario ----------------
// Preguntas creadas desde la app, asignadas a cualquier tema (y, si ese tema
// tiene apartados, a cualquiera de ellos). Viven solo en este dispositivo.
const CUSTOM_KEY = 'opo_custom_v1';
function loadCustom() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || [];
  } catch (e) {
    return [];
  }
}
function saveCustom() {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(CUSTOM));
}
let CUSTOM = loadCustom();
function newCustomId() {
  return 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

// ---------------- Copia de seguridad / sincronización manual entre dispositivos ----------------
// Exporta e importa un archivo .json con tus preguntas propias, ediciones y progreso,
// para llevarlos de un dispositivo a otro. No hay backend: esto es la forma manual de
// "sincronizar" sin montar un servicio externo.
function exportUserDataObject() {
  return {
    app: 'oposicion-test',
    type: 'backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    overrides: OVERRIDES,
    custom: CUSTOM,
    stats: STATS,
    discarded: Array.from(DISCARDED),
  };
}

function downloadUserDataBackup() {
  const data = exportUserDataObject();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fecha = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `oposicion-test-backup-${fecha}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Fusiona (nunca borra) los datos importados sobre los locales:
// - overrides/custom: el archivo importado gana en caso de conflicto por id.
// - stats: gana el registro con fecha de última respuesta (ts) más reciente.
// - discarded: unión de ambos conjuntos.
function importUserDataObject(data) {
  if (!data || typeof data !== 'object') throw new Error('Archivo no válido.');
  const hasAny = data.overrides || data.custom || data.stats || data.discarded;
  if (!hasAny) throw new Error('El archivo no contiene datos reconocibles de Oposición Test.');

  let nOverrides = 0, nCustomNew = 0, nCustomUpd = 0, nStatsNew = 0, nStatsUpd = 0, nDiscarded = 0;

  if (data.overrides && typeof data.overrides === 'object') {
    for (const qid in data.overrides) {
      OVERRIDES[qid] = data.overrides[qid];
      nOverrides++;
    }
    saveOverrides();
  }

  if (Array.isArray(data.custom)) {
    const byId = {};
    CUSTOM.forEach(q => { byId[q.id] = q; });
    data.custom.forEach(q => {
      if (!q || !q.id) return;
      if (byId[q.id]) nCustomUpd++; else nCustomNew++;
      byId[q.id] = q;
    });
    CUSTOM = Object.values(byId);
    saveCustom();
  }

  if (data.stats && typeof data.stats === 'object') {
    for (const qid in data.stats) {
      const incoming = data.stats[qid];
      const local = STATS[qid];
      if (!local) { STATS[qid] = incoming; nStatsNew++; }
      else if ((incoming.ts || 0) > (local.ts || 0)) { STATS[qid] = incoming; nStatsUpd++; }
    }
    saveStats(STATS);
  }

  if (Array.isArray(data.discarded)) {
    data.discarded.forEach(qid => {
      if (!DISCARDED.has(qid)) { DISCARDED.add(qid); nDiscarded++; }
    });
    saveDiscarded();
  }

  rebuildAllQ(); // reconstruye ALL_Q/QUESTIONS_BY_ID y reaplica los overrides importados

  return { nOverrides, nCustomNew, nCustomUpd, nStatsNew, nStatsUpd, nDiscarded };
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

function customQuestionsFlat() {
  const out = [];
  for (const q of CUSTOM) {
    const tema = TEMAS.find(t => t.id === q.temaId);
    out.push(Object.assign({}, q, {
      temaTitulo: tema ? tema.titulo : 'Pregunta propia',
      custom: true
    }));
  }
  return out;
}

let ALL_Q = allQuestionsFlat().concat(customQuestionsFlat());

function allSimQuestionsFlat() {
  const out = [];
  if (typeof SIMULACROS === 'undefined') return out;
  for (const sim of SIMULACROS) {
    for (const q of sim.preguntas) {
      out.push(Object.assign({}, q, {
        temaId: sim.id,
        temaTitulo: 'Simulacro: ' + sim.titulo,
        esSimulacro: true
      }));
    }
  }
  return out;
}
const ALL_SIM_Q = allSimQuestionsFlat();

// Índice por id (incluye descartadas) — sirve para poder mostrarlas/restaurarlas en Estadísticas,
// y para aplicar las ediciones del usuario (overrides) sobre la pregunta base correspondiente.
let QUESTIONS_BY_ID = {};
function applyOverrides() {
  for (const qid in OVERRIDES) {
    const q = QUESTIONS_BY_ID[qid];
    if (q) Object.assign(q, OVERRIDES[qid]);
  }
}
function rebuildIndex() {
  QUESTIONS_BY_ID = {};
  for (const q of ALL_Q.concat(ALL_SIM_Q)) QUESTIONS_BY_ID[q.id] = q;
  applyOverrides();
}
function rebuildAllQ() {
  ALL_Q = allQuestionsFlat().concat(customQuestionsFlat());
  rebuildIndex();
}
rebuildIndex();

// Busca el contenido ORIGINAL (de fábrica) de una pregunta base, buscando en TEMAS/SIMULACROS.
// Las preguntas propias (custom) no tienen "original" al que volver.
function getOriginalQuestionData(qid) {
  for (const tema of TEMAS) {
    const q = tema.preguntas.find(x => x.id === qid);
    if (q) return { enunciado: q.enunciado, opciones: q.opciones.slice(), correcta: q.correcta, explicacion: q.explicacion };
  }
  if (typeof SIMULACROS !== 'undefined') {
    for (const sim of SIMULACROS) {
      const q = sim.preguntas.find(x => x.id === qid);
      if (q) return { enunciado: q.enunciado, opciones: q.opciones.slice(), correcta: q.correcta, explicacion: q.explicacion };
    }
  }
  return null;
}
function saveOverride(qid, patch) {
  OVERRIDES[qid] = patch;
  saveOverrides();
  const q = QUESTIONS_BY_ID[qid];
  if (q) Object.assign(q, patch);
}
function restoreOriginalQuestion(qid) {
  delete OVERRIDES[qid];
  saveOverrides();
  const orig = getOriginalQuestionData(qid);
  const q = QUESTIONS_BY_ID[qid];
  if (q && orig) Object.assign(q, orig);
}

function addCustomQuestion(data) {
  CUSTOM.push(data);
  saveCustom();
  rebuildAllQ();
}
function updateCustomQuestion(id, data) {
  const idx = CUSTOM.findIndex(q => q.id === id);
  if (idx === -1) return;
  CUSTOM[idx] = Object.assign({ id }, data);
  saveCustom();
  rebuildAllQ();
}
function deleteCustomQuestion(id) {
  CUSTOM = CUSTOM.filter(q => q.id !== id);
  saveCustom();
  delete STATS[id];
  saveStats(STATS);
  DISCARDED.delete(id);
  saveDiscarded();
  rebuildAllQ();
}

// Apartados disponibles para asignar una pregunta propia dentro de un tema dado.
function availableApartados(temaId) {
  const opts = [{ value: 'general', label: 'General (cualquier práctica de este tema)' }];
  if (parteQuestions(temaId, 1).length) opts.push({ value: 'parte1', label: 'Parte 1' });
  if (parteQuestions(temaId, 2).length) opts.push({ value: 'parte2', label: 'Parte 2' });
  if (advancedQuestions(temaId).length) opts.push({ value: 'avanzado', label: 'Examen final / Nivel avanzado' });
  if (repasoQuestions(temaId).length) opts.push({ value: 'repaso', label: 'Repaso general' });
  return opts;
}
function temaHasPartes(temaId) {
  return parteQuestions(temaId, 1).length > 0 && parteQuestions(temaId, 2).length > 0;
}

function temaQuestions(temaId) {
  return ALL_Q.filter(q => q.temaId === temaId && !DISCARDED.has(q.id));
}

function simulacroQuestions(simId) {
  return ALL_SIM_Q.filter(q => q.temaId === simId && !DISCARDED.has(q.id));
}

function advancedQuestions(temaId) {
  return temaQuestions(temaId).filter(q => q.nivel === 'avanzado');
}

function repasoQuestions(temaId) {
  return temaQuestions(temaId).filter(q => q.nivel === 'repaso');
}

function parteQuestions(temaId, parteNum) {
  return temaQuestions(temaId).filter(q => q.parte === parteNum);
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

function globalProgress(pool) {
  pool = (pool || ALL_Q).filter(q => !DISCARDED.has(q.id));
  let mastered = 0, learning = 0, fail = 0, notStarted = 0, attempted = 0;
  for (const q of pool) {
    const s = STATS[q.id];
    if (!s) { notStarted++; continue; }
    attempted++;
    if (s.ultima === 'fail') fail++;
    else if (s.box >= MASTER_BOX) mastered++;
    else learning++;
  }
  return { total: pool.length, mastered, learning, fail, notStarted, attempted };
}

function failingQuestions(temaId) {
  let pool;
  if (!temaId) pool = ALL_Q.concat(ALL_SIM_Q).filter(q => !DISCARDED.has(q.id));
  else pool = temaQuestions(temaId).length ? temaQuestions(temaId) : simulacroQuestions(temaId);
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
  else if (view.name === 'addEditQuestion') {
    title = view.kind === 'custom-new' ? 'Nueva pregunta' : (view.kind === 'custom-edit' ? 'Editar mi pregunta' : 'Editar pregunta');
    node = renderAddEditQuestion(view);
  }

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

  if (typeof SIMULACROS !== 'undefined' && SIMULACROS.length) {
    const SIM_GROUPS = [
      { categoria: 'general', titulo: 'Simulacros de examen' },
      { categoria: 'constitucional', titulo: 'Simulacros de Constitucional' },
      { categoria: 'administrativo', titulo: 'Simulacros de Administrativo' },
    ];
    for (const group of SIM_GROUPS) {
      const sims = SIMULACROS.filter(s => (s.categoria || 'general') === group.categoria);
      if (!sims.length) continue;
      wrap.appendChild(el(`<div class="section-title">${esc(group.titulo)}</div>`));
      const simList = el('<div class="tema-list"></div>');
      for (const sim of sims) {
        const simQs = simulacroQuestions(sim.id);
        const answered = simQs.filter(q => STATS[q.id]).length;
        const correct = simQs.filter(q => STATS[q.id] && STATS[q.id].ultima === 'ok').length;
        const statusLabel = answered
          ? `Última vez: ${correct}/${answered} correctas`
          : 'Sin realizar todavía';
        const card = el(`
          <div class="tema-card">
            <div class="tema-card-top">
              <h3>📝 ${esc(sim.titulo)}</h3>
              <span class="tema-badge">${simQs.length} preg.</span>
            </div>
            <div class="tema-stats-row">
              <span>${esc(statusLabel)}</span>
            </div>
          </div>
        `);
        card.addEventListener('click', () => startQuiz('simulacro', sim.id, simQs.length));
        simList.appendChild(card);
      }
      wrap.appendChild(simList);
    }
  }

  const bloques = [];
  for (const tema of TEMAS) {
    const key = tema.bloque || 'Temario';
    let b = bloques.find(x => x.nombre === key);
    if (!b) { b = { nombre: key, temas: [] }; bloques.push(b); }
    b.temas.push(tema);
  }

  for (const bloque of bloques) {
    wrap.appendChild(el(`<div class="section-title">${esc(bloque.nombre)}</div>`));
    const list = el('<div class="tema-list"></div>');
    for (const tema of bloque.temas) {
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
  }
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

  const parte1Count = parteQuestions(tema.id, 1).length;
  const parte2Count = parteQuestions(tema.id, 2).length;
  const tienePartes = parte1Count > 0 && parte2Count > 0;

  if (tienePartes) {
    wrap.appendChild(el(`<div class="section-title">Partes del tema</div>`));
    const btnParte1 = el(`<button class="btn btn-primary">📘 Parte 1 (${parte1Count} preguntas)</button>`);
    btnParte1.addEventListener('click', () => startQuiz('parte1', tema.id, parte1Count));
    wrap.appendChild(btnParte1);

    const btnParte2 = el(`<button class="btn btn-primary">📗 Parte 2 (${parte2Count} preguntas)</button>`);
    btnParte2.addEventListener('click', () => startQuiz('parte2', tema.id, parte2Count));
    wrap.appendChild(btnParte2);
  } else {
    const btnPractice = el(`<button class="btn btn-primary">Practicar este tema (10 preguntas)</button>`);
    btnPractice.addEventListener('click', () => startQuiz('tema', tema.id, 10));
    wrap.appendChild(btnPractice);

    const btnPracticeAll = el(`<button class="btn btn-secondary">Practicar todas (${p.total})</button>`);
    btnPracticeAll.addEventListener('click', () => startQuiz('tema', tema.id, p.total));
    wrap.appendChild(btnPracticeAll);
  }

  const advCount = advancedQuestions(tema.id).length;
  if (advCount) {
    wrap.appendChild(el(`<div class="section-title">${tienePartes ? 'Examen final' : 'Miniapartado'}</div>`));
    const advLabel = tienePartes ? `📝 Examen final (${advCount} preguntas, nivel avanzado)` : `🎓 Nivel avanzado (${advCount} preguntas)`;
    const btnAdvanced = el(`<button class="btn btn-advanced">${advLabel}</button>`);
    btnAdvanced.addEventListener('click', () => startQuiz('avanzado', tema.id, advCount));
    wrap.appendChild(btnAdvanced);
  }

  const repasoCount = repasoQuestions(tema.id).length;
  if (repasoCount) {
    wrap.appendChild(el(`<div class="section-title">Repaso general</div>`));
    const btnRepaso = el(`<button class="btn btn-repaso">🔄 Repaso general (${repasoCount} preguntas de todo el tema)</button>`);
    btnRepaso.addEventListener('click', () => startQuiz('repaso', tema.id, repasoCount));
    wrap.appendChild(btnRepaso);
  }

  const btnFails = el(`<button class="btn ${failCount ? 'btn-outline-danger' : 'btn-secondary'}">Repasar solo falladas (${failCount})</button>`);
  btnFails.addEventListener('click', () => {
    if (!failCount) { showToast('Sin preguntas falladas en este tema 🎉'); return; }
    startQuiz('fails', tema.id, failCount);
  });
  wrap.appendChild(btnFails);

  const customInTema = temaQuestions(tema.id).filter(q => q.custom);
  wrap.appendChild(el(`<div class="section-title">Tus preguntas</div>`));
  if (customInTema.length) {
    const btnMyQ = el(`<button class="btn btn-secondary">✏️ Tus preguntas de este tema (${customInTema.length})</button>`);
    btnMyQ.addEventListener('click', () => startQuiz('custom', tema.id, customInTema.length));
    wrap.appendChild(btnMyQ);
  }
  const btnAddQ = el(`<button class="btn btn-secondary">➕ Añadir pregunta a este tema</button>`);
  btnAddQ.addEventListener('click', () => navigate({ name: 'addEditQuestion', kind: 'custom-new', presetTemaId: tema.id }));
  wrap.appendChild(btnAddQ);

  return wrap;
}

// ---------------- Quiz ----------------
function startQuiz(mode, temaId, count) {
  let pool;
  if (mode === 'tema') pool = temaQuestions(temaId);
  else if (mode === 'parte1') pool = parteQuestions(temaId, 1);
  else if (mode === 'parte2') pool = parteQuestions(temaId, 2);
  else if (mode === 'avanzado') pool = advancedQuestions(temaId);
  else if (mode === 'repaso') pool = repasoQuestions(temaId);
  else if (mode === 'custom') pool = temaQuestions(temaId).filter(q => q.custom);
  else if (mode === 'simulacro') pool = simulacroQuestions(temaId);
  else if (mode === 'fails') pool = failingQuestions(temaId);
  else pool = ALL_Q.filter(q => !DISCARDED.has(q.id));

  if (!pool.length) { showToast('No hay preguntas disponibles.'); return; }

  // Los simulacros y los repasos de falladas se presentan en orden fijo
  // (el simulacro respeta el orden real del examen; las falladas ya vienen
  // ordenadas por prioridad). El resto usa muestreo ponderado (Leitner).
  const questions = (mode === 'fails' || mode === 'simulacro')
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
      <div class="q-tema-row">
        <div class="q-tema">${esc(q.temaTitulo)}</div>
        <button class="discard-btn" type="button">🗑 Descartar</button>
      </div>
      <div class="q-text">${esc(q.enunciado)}</div>
    </div>
  `);
  card.querySelector('.discard-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    discardCurrentQuestion(view, q);
  });
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

    const btnEditQ = el(`<button class="btn btn-secondary" style="margin-top:6px;">✏️ Editar esta pregunta</button>`);
    btnEditQ.addEventListener('click', () => {
      navigate({ name: 'addEditQuestion', kind: q.custom ? 'custom-edit' : 'override', qid: q.id });
    });
    wrap.appendChild(btnEditQ);

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
  view.answers.push({ qid: q.id, correct, chosenIndex, q });
  view.answeredCurrent = true;
  render();
}

// ---------------- Descartar pregunta ----------------
function discardCurrentQuestion(view, q) {
  const ok = confirm('¿Descartar esta pregunta? No se te volverá a preguntar. Podrás recuperarla luego desde "Tus estadísticas" si cambias de opinión.');
  if (!ok) return;

  discardQuestion(q.id);

  // Si ya la habías respondido en esta sesión, no debe contar en el resultado.
  if (view.answeredCurrent && view.answers.length && view.answers[view.answers.length - 1].qid === q.id) {
    view.answers.pop();
  }

  showToast('Pregunta descartada. No volverá a aparecer.');

  const isLast = view.index >= view.questions.length - 1;
  if (isLast) {
    replaceView({ name: 'results', mode: view.mode, temaId: view.temaId, answers: view.answers, questions: view.questions });
  } else {
    view.index++;
    view.answeredCurrent = false;
    render();
    window.scrollTo(0, 0);
  }
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

  // Nota: usamos a.q (guardado al responder) en vez de view.questions[i], porque
  // las preguntas descartadas a mitad de quiz rompen la correspondencia por índice.
  const wrongOnes = view.answers.filter(a => !a.correct);

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
  const gp = globalProgress(ALL_Q.concat(ALL_SIM_Q));

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

  const discardedList = Array.from(DISCARDED).map(id => QUESTIONS_BY_ID[id]).filter(Boolean);
  wrap.appendChild(el(`<div class="section-title">Preguntas descartadas (${discardedList.length})</div>`));
  if (!discardedList.length) {
    wrap.appendChild(el(`
      <div class="empty-state">
        <div class="emoji">🗑️</div>
        <div>No has descartado ninguna pregunta todavía.</div>
      </div>
    `));
  } else {
    const discList = el('<div class="fail-list"></div>');
    discardedList.forEach(q => {
      const item = el(`
        <div class="fail-item discarded-item">
          <div class="fail-tema">${esc(q.temaTitulo)}</div>
          <div>${esc(q.enunciado)}</div>
        </div>
      `);
      const btnRestore = el(`<button class="btn-restore" type="button">↺ Restaurar</button>`);
      btnRestore.addEventListener('click', () => {
        restoreQuestion(q.id);
        showToast('Pregunta restaurada.');
        render();
      });
      item.appendChild(btnRestore);
      discList.appendChild(item);
    });
    wrap.appendChild(discList);
  }

  wrap.appendChild(el(`<div class="section-title">Tus preguntas propias (${CUSTOM.length})</div>`));
  const btnAddCustom = el(`<button class="btn btn-secondary">➕ Añadir pregunta propia</button>`);
  btnAddCustom.addEventListener('click', () => navigate({ name: 'addEditQuestion', kind: 'custom-new' }));
  wrap.appendChild(btnAddCustom);
  if (CUSTOM.length) {
    const customList = el('<div class="fail-list"></div>');
    CUSTOM.forEach(q => {
      const tema = TEMAS.find(t => t.id === q.temaId);
      const item = el(`
        <div class="fail-item discarded-item">
          <div class="fail-tema">${esc(tema ? tema.titulo : '')}</div>
          <div>${esc(q.enunciado)}</div>
        </div>
      `);
      const btnEditCustom = el(`<button class="btn-restore" type="button">✏️ Editar</button>`);
      btnEditCustom.addEventListener('click', () => navigate({ name: 'addEditQuestion', kind: 'custom-edit', qid: q.id }));
      item.appendChild(btnEditCustom);
      customList.appendChild(item);
    });
    wrap.appendChild(customList);
  }

  const overriddenIds = Object.keys(OVERRIDES).filter(id => QUESTIONS_BY_ID[id]);
  wrap.appendChild(el(`<div class="section-title">Preguntas que has editado (${overriddenIds.length})</div>`));
  if (overriddenIds.length) {
    const editedList = el('<div class="fail-list"></div>');
    overriddenIds.forEach(id => {
      const q = QUESTIONS_BY_ID[id];
      const item = el(`
        <div class="fail-item discarded-item">
          <div class="fail-tema">${esc(q.temaTitulo || '')}</div>
          <div>${esc(q.enunciado)}</div>
        </div>
      `);
      const btnRestoreOrig = el(`<button class="btn-restore" type="button">↺ Restaurar</button>`);
      btnRestoreOrig.addEventListener('click', () => {
        if (confirm('¿Deshacer tu edición y volver al texto original de esta pregunta?')) {
          restoreOriginalQuestion(id);
          showToast('Restaurada al texto original.');
          render();
        }
      });
      item.appendChild(btnRestoreOrig);
      editedList.appendChild(item);
    });
    wrap.appendChild(editedList);
  }

  wrap.appendChild(el(`<div class="section-title">📦 Copia de seguridad entre dispositivos</div>`));
  wrap.appendChild(el(`
    <p style="color:var(--text-dim);font-size:0.85rem;margin:-6px 0 12px;">
      Tus preguntas propias, tus ediciones y tu progreso se guardan solo en este dispositivo. Exporta un archivo aquí y luego impórtalo en tu otro móvil u ordenador para llevarlos contigo. Importar nunca borra nada, solo añade o actualiza.
    </p>
  `));
  const backupRow = el('<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px;"></div>');
  const btnExport = el(`<button class="btn btn-secondary" type="button">⬇️ Exportar mis datos</button>`);
  btnExport.addEventListener('click', () => {
    downloadUserDataBackup();
    showToast('Archivo de copia de seguridad descargado.');
  });
  const fileInput = el(`<input type="file" accept="application/json,.json" style="display:none;">`);
  const btnImport = el(`<button class="btn btn-secondary" type="button">⬆️ Importar datos</button>`);
  btnImport.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const res = importUserDataObject(data);
        showToast(`Importado: ${res.nOverrides} ediciones, ${res.nCustomNew + res.nCustomUpd} preguntas propias, progreso de ${res.nStatsNew + res.nStatsUpd} preguntas.`);
        render();
      } catch (e) {
        alert('No se pudo importar el archivo: ' + e.message);
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });
  backupRow.appendChild(btnExport);
  backupRow.appendChild(btnImport);
  backupRow.appendChild(fileInput);
  wrap.appendChild(backupRow);

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

// ---------------- Añadir / editar pregunta ----------------
function populateApartadoSelect(selectEl, temaId, selected) {
  const opts = availableApartados(temaId);
  selectEl.innerHTML = opts.map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join('');
  selectEl.value = (selected && opts.some(o => o.value === selected)) ? selected : opts[0].value;
}

function renderAddEditQuestion(view) {
  const wrap = el('<div class="qform"></div>');
  const isOverride = view.kind === 'override';
  const isCustomEdit = view.kind === 'custom-edit';
  const isCustomNew = view.kind === 'custom-new';

  let existing = null;
  let presetTemaId = view.presetTemaId || null;
  let presetApartado = null;

  if (isOverride) {
    existing = QUESTIONS_BY_ID[view.qid];
  } else if (isCustomEdit) {
    existing = CUSTOM.find(q => q.id === view.qid);
    if (existing) {
      presetTemaId = existing.temaId;
      if (existing.parte === 1) presetApartado = 'parte1';
      else if (existing.parte === 2) presetApartado = 'parte2';
      else if (existing.nivel === 'avanzado') presetApartado = 'avanzado';
      else if (existing.nivel === 'repaso') presetApartado = 'repaso';
      else presetApartado = 'general';
    }
  }

  if (isOverride && existing) {
    const tema = TEMAS.find(t => t.id === existing.temaId);
    const labelTxt = tema ? tema.titulo : (existing.esSimulacro ? existing.temaTitulo : '');
    wrap.appendChild(el(`<p style="color:var(--text-dim);font-size:0.85rem;">${esc(labelTxt)}</p>`));
  }

  let temaSelect = null, apartadoGroup = null, apartadoSelect = null;
  if (!isOverride) {
    const temaOptions = TEMAS.map(t => `<option value="${esc(t.id)}">${esc(t.titulo)}</option>`).join('');
    const temaFormGroup = el(`
      <div class="form-group">
        <label class="form-label">Tema</label>
        <select class="form-select">${temaOptions}</select>
      </div>
    `);
    temaSelect = temaFormGroup.querySelector('select');
    wrap.appendChild(temaFormGroup);

    apartadoGroup = el(`
      <div class="form-group">
        <label class="form-label">Apartado</label>
        <select class="form-select"></select>
        <p style="color:var(--text-dim);font-size:0.78rem;margin:6px 2px 0;">Si eliges "General", la pregunta se practicará desde "Tus preguntas de este tema" y desde el repaso general de inicio, aunque no aparezca en Parte 1/2, Examen final o Repaso general específico.</p>
      </div>
    `);
    apartadoSelect = apartadoGroup.querySelector('select');
    wrap.appendChild(apartadoGroup);

    const initialTemaId = presetTemaId || (TEMAS[0] && TEMAS[0].id);
    if (initialTemaId) temaSelect.value = initialTemaId;
    populateApartadoSelect(apartadoSelect, temaSelect.value, presetApartado);

    temaSelect.addEventListener('change', () => {
      populateApartadoSelect(apartadoSelect, temaSelect.value, null);
    });
  }

  const enunciadoGroup = el(`
    <div class="form-group">
      <label class="form-label">Enunciado</label>
      <textarea class="form-textarea" rows="3" placeholder="Escribe la pregunta..."></textarea>
    </div>
  `);
  const enunciadoInput = enunciadoGroup.querySelector('textarea');
  enunciadoInput.value = existing ? existing.enunciado : '';
  wrap.appendChild(enunciadoGroup);

  wrap.appendChild(el(`<div class="form-label" style="margin-top:4px;">Opciones (marca cuál es la correcta)</div>`));
  const optionInputs = [];
  const letters = ['A', 'B', 'C', 'D'];
  const optsCol = el('<div class="form-options"></div>');
  for (let i = 0; i < 4; i++) {
    const row = el(`
      <div class="form-option-row">
        <label class="form-radio"><input type="radio" name="qformCorrecta" value="${i}"><span>${letters[i]}</span></label>
        <input type="text" class="form-input" placeholder="Opción ${letters[i]}">
      </div>
    `);
    const radio = row.querySelector('input[type="radio"]');
    const textInput = row.querySelector('input[type="text"]');
    if (existing) {
      textInput.value = existing.opciones[i] || '';
      if (existing.correcta === i) radio.checked = true;
    }
    optionInputs.push({ radio, textInput });
    optsCol.appendChild(row);
  }
  wrap.appendChild(optsCol);

  const explGroup = el(`
    <div class="form-group">
      <label class="form-label">Explicación (opcional)</label>
      <textarea class="form-textarea" rows="3" placeholder="¿Por qué es correcta esta opción?"></textarea>
    </div>
  `);
  const explInput = explGroup.querySelector('textarea');
  explInput.value = existing ? (existing.explicacion || '') : '';
  wrap.appendChild(explGroup);

  const btnSave = el(`<button class="btn btn-primary">${isCustomNew ? 'Añadir pregunta' : 'Guardar cambios'}</button>`);
  btnSave.addEventListener('click', () => {
    const enunciado = enunciadoInput.value.trim();
    const opciones = optionInputs.map(o => o.textInput.value.trim());
    const checked = optionInputs.find(o => o.radio.checked);
    const explicacion = explInput.value.trim();

    if (!enunciado) { showToast('Falta el enunciado.'); return; }
    if (opciones.some(o => !o)) { showToast('Rellena las 4 opciones.'); return; }
    if (new Set(opciones).size !== 4) { showToast('Las 4 opciones deben ser distintas.'); return; }
    if (!checked) { showToast('Marca cuál es la opción correcta.'); return; }
    const correcta = optionInputs.indexOf(checked);

    if (isOverride) {
      saveOverride(view.qid, { enunciado, opciones, correcta, explicacion });
      showToast('Pregunta actualizada.');
      goBack();
      return;
    }

    const temaId = temaSelect.value;
    const apartado = apartadoSelect.value;
    const extra = {};
    if (apartado === 'parte1') extra.parte = 1;
    else if (apartado === 'parte2') extra.parte = 2;
    else if (apartado === 'avanzado') extra.nivel = 'avanzado';
    else if (apartado === 'repaso') extra.nivel = 'repaso';

    if (isCustomEdit) {
      updateCustomQuestion(view.qid, Object.assign({ temaId, enunciado, opciones, correcta, explicacion }, extra));
      showToast('Pregunta actualizada.');
    } else {
      addCustomQuestion(Object.assign({ id: newCustomId(), temaId, enunciado, opciones, correcta, explicacion }, extra));
      showToast('Pregunta añadida. Ya forma parte de tu repaso.');
    }
    goBack();
  });
  wrap.appendChild(btnSave);

  if (isCustomEdit) {
    const btnDeleteCustom = el(`<button class="btn btn-outline-danger">🗑 Borrar esta pregunta</button>`);
    btnDeleteCustom.addEventListener('click', () => {
      if (confirm('¿Borrar esta pregunta que añadiste? No se puede deshacer.')) {
        deleteCustomQuestion(view.qid);
        showToast('Pregunta borrada.');
        goBack();
      }
    });
    wrap.appendChild(btnDeleteCustom);
  }

  if (isOverride) {
    const btnRestoreInline = el(`<button class="btn btn-secondary">↺ Restaurar texto original</button>`);
    btnRestoreInline.addEventListener('click', () => {
      if (confirm('¿Deshacer tu edición y volver al texto original de esta pregunta?')) {
        restoreOriginalQuestion(view.qid);
        showToast('Restaurada al texto original.');
        goBack();
      }
    });
    wrap.appendChild(btnRestoreInline);
  }

  return wrap;
}

// ---------------- Arranque ----------------
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      // Comprueba si hay una versión nueva cada vez que se abre/reactiva la app
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  });

  // Cuando el nuevo Service Worker toma el control, recargamos una vez
  // para que se vean los cambios sin tener que reinstalar nada.
  let swRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing) return;
    swRefreshing = true;
    window.location.reload();
  });
}
