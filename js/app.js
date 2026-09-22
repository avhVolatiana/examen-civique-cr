let trainingAutoAdvanceTimer = null;
let questionRenderToken = 0;
let bank = null;
const SESSION_KEY = 'cr-active-session-v2';
const PROGRESS_KEY = 'cr-progress-v2';
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 min : plage recommandée par OWASP pour une application à faible risque.
const EXAM_DURATION = 45 * 60 * 1000;
const TRAINING_CORRECT_DELAY = 1800;

const app = document.querySelector('#app');
const info = document.querySelector('#info');
const modal = document.querySelector('#modal');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const shuffle = a => [...a].sort(() => Math.random() - 0.5);

function getProgress(){
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || { errors: [], attempts: 0, best: null }; }
  catch { return { errors: [], attempts: 0, best: null }; }
}
function saveProgress(value){ localStorage.setItem(PROGRESS_KEY, JSON.stringify(value)); }
function clearActiveSession(){ sessionStorage.removeItem(SESSION_KEY); }
function saveActiveSession(){
  if (!state.mode) return;
  state.lastActivity = Date.now();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
}
function loadActiveSession(){
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (!saved || !saved.mode) return null;
    if (Date.now() - saved.lastActivity > IDLE_TIMEOUT) {
      clearActiveSession();
      return null;
    }
    return saved;
  } catch {
    clearActiveSession();
    return null;
  }
}
function registerActivity(){
  if (state?.mode) saveActiveSession();
}

let state = { mode:null, qs:[], i:0, score:0, answered:false, deadline:0, order:[], selected:null, lastActivity:0, startedAt:0 };

async function init(){
  bank = await (await fetch('data/questions-cr.json')).json();
  const active = loadActiveSession();
  if (active) {
    state = active;
    render();
    showSessionNotice();
  } else home();
}

function home(){
  if (trainingAutoAdvanceTimer) {
    clearTimeout(trainingAutoAdvanceTimer);
    trainingAutoAdvanceTimer = null;
  }
  clearActiveSession();
  state = { mode:null, qs:[], i:0, score:0, answered:false, deadline:0, order:[], selected:null, lastActivity:0, startedAt:0 };
  info.textContent = '';
  app.innerHTML = `<div class="wrap">
    <section class="hero"><span class="badge">Carte de résident · CR</span><h1>Préparez votre examen civique</h1><p class="muted">Entraînement et simulation d'examen.</p></section>
    <div class="grid">
      <button class="card" id="training"><h2>🧠 Entraînement</h2><p>Correction immédiate et progression personnelle.</p></button>
      <button class="card" id="exam"><h2>🇫🇷 Examen blanc CR</h2><p>40 questions · 45 minutes · résultat à la fin.</p></button>
      <button class="card" id="errors"><h2>🔁 Mes erreurs</h2><p>Revoir les questions avec la bonne réponse et le correctif.</p></button>
      <button class="card" id="progress"><h2>📊 Ma progression</h2><p>Voir vos résultats.</p></button>
    </div>
  </div>`;
  training.onclick = () => start('training');
  exam.onclick = () => start('exam');
  errors.onclick = errorsView;
  progress.onclick = progressView;
}

function start(mode){
  let q = shuffle(bank.questions || []);
  if (mode === 'exam') {
    const knowledge = q.slice(0, 28);
    const situations = shuffle(bank.situations_entrainement || []).slice(0, 12);
    q = shuffle(knowledge.concat(situations));
  }
  state = { mode, qs:q, i:0, score:0, answered:false, deadline:mode==='exam' ? Date.now()+EXAM_DURATION : 0, order:[], lastActivity:Date.now(), startedAt:Date.now() };
  saveActiveSession();
  render();
}

function current(){ return state.qs[state.i]; }

function render(){
  const q = current();
  if (!q) return finish();
  const wasAnswered = Boolean(state.answered);
  state.order = state.order?.length ? state.order : shuffle(q.reponses.map((text,index)=>({text,index})));
  state.answered = wasAnswered;
  state.lastActivity = Date.now();
  saveActiveSession();
  info.textContent = `${state.i+1}/${state.qs.length}`;
  app.innerHTML = `<div class="wrap"><section class="hero">
    <span class="badge">${state.mode==='exam'?'Examen CR':'Entraînement'}</span>
    ${state.mode==='exam' ? '<p id="timer"></p>' : ''}
    <div class="progress"><div style="width:${state.i/state.qs.length*100}%"></div></div>
    <p class="muted">${esc(q.theme||q.id||'Question')}</p>
    <h2>${esc(q.enonce)}</h2>
    <div class="answers">${state.order.map((a,i)=>`<button class="answer" data-i="${i}">${esc(a.text)}</button>`).join('')}</div>
    <div id="feedback"></div>
    <button id="next" class="btn" disabled>${state.i===state.qs.length-1?'Terminer':'Question suivante →'}</button>
  </section></div>`;
  document.querySelectorAll('.answer').forEach(b => b.onclick = () => answer(+b.dataset.i));
  document.querySelector('#next').onclick = goNext;
  if (state.answered) restoreAnsweredView();
  if (state.mode === 'exam') timer();
}

function restoreAnsweredView(){
  const q=current();
  document.querySelectorAll('.answer').forEach((b,j)=>{
    if (state.order[j].index===q.bonne) b.classList.add('correct');
    if (j===state.selected && state.order[j].index!==q.bonne) b.classList.add('wrong');
  });
  const feedback=document.querySelector('#feedback');
  if (state.mode==='training' && state.selected !== null && state.selected !== undefined) {
    const correct=state.order[state.selected].index===q.bonne;
    feedback.innerHTML=correct
      ? `<p><b>✅ Bonne réponse</b></p><p class="muted">${esc(q.explication||'')}</p>`
      : `<div class="correction"><p><b>❌ Mauvaise réponse</b></p><p><b>Bonne réponse :</b> ${esc(q.reponses[q.bonne])}</p><p class="muted">${esc(q.explication||'')}</p><p class="small muted">Prenez le temps de lire le correctif avant de continuer.</p></div>`;
  }
  document.querySelector('#next').disabled=false;
}

function saveError(q, selectedText){
  const p = getProgress();
  p.errors = p.errors || [];
  const record = {
    id:q.id,
    theme:q.theme,
    enonce:q.enonce,
    selected:selectedText,
    correct:q.reponses[q.bonne],
    explication:q.explication || '',
    updatedAt:new Date().toISOString()
  };
  const index = p.errors.findIndex(x => x.id === q.id);
  if (index >= 0) p.errors[index] = record;
  else p.errors.push(record);
  saveProgress(p);
}

function answer(i){
  if (state.answered) return;
  registerActivity();
  state.answered = true;
  state.selected = i;
  const q = current();
  const selected = state.order[i];
  const correct = selected.index === q.bonne;
  if (correct) state.score++;

  document.querySelectorAll('.answer').forEach((b,j) => {
    if (state.order[j].index === q.bonne) b.classList.add('correct');
    if (j === i && !correct) b.classList.add('wrong');
  });

  const feedback = document.querySelector('#feedback');
  if (state.mode === 'training') {
    feedback.innerHTML = correct
      ? `<p><b>✅ Bonne réponse</b></p><p class="muted">${esc(q.explication||'')}</p>`
      : `<div class="correction"><p><b>❌ Mauvaise réponse</b></p><p><b>Bonne réponse :</b> ${esc(q.reponses[q.bonne])}</p><p class="muted">${esc(q.explication||'')}</p><p class="small muted">Prenez le temps de lire le correctif avant de continuer.</p></div>`;
  }

  if (!correct) saveError(q, selected.text);
  document.querySelector('#next').disabled = false;
  saveActiveSession();

  // Une erreur ne déclenche plus de passage automatique : l'utilisateur décide quand continuer.
  if (correct && state.mode === 'training') {
    if (trainingAutoAdvanceTimer) {
      clearTimeout(trainingAutoAdvanceTimer);
    }
    const questionIndex = state.i;
    const questionId = q.id;
    const selectedIndex = i;
    trainingAutoAdvanceTimer = setTimeout(() => {
      trainingAutoAdvanceTimer = null;
      if (
        state.mode === 'training' &&
        state.answered &&
        state.i === questionIndex &&
        state.qs[state.i]?.id === questionId &&
        state.selected === selectedIndex
      ) {
        goNext();
      }
    }, TRAINING_CORRECT_DELAY);
  }
}

function goNext(){
  
  if (trainingAutoAdvanceTimer) { clearTimeout(trainingAutoAdvanceTimer); trainingAutoAdvanceTimer = null; }
if (!state.answered) return;
  registerActivity();
  if (state.i === state.qs.length-1) return finish();
  state.i++;
  state.order = [];
  state.selected = null;
  state.answered = false;
  render();
}

function finish(){
  clearActiveSession();
  const p = getProgress();
  if (state.mode === 'exam') {
    p.attempts = (p.attempts||0)+1;
    p.best = p.best === null || p.best === undefined ? state.score : Math.max(p.best, state.score);
    saveProgress(p);
  }
  info.textContent = '';
  app.innerHTML = `<div class="wrap"><section class="result">
    <h1>${state.mode==='exam' ? (state.score>=32 ? 'Réussi ✅' : 'À revoir') : 'Session terminée'}</h1>
    <div class="score">${state.score} / ${state.qs.length}</div>
    ${state.mode==='exam' ? `<p>${state.qs.length-state.score} erreur(s) · Seuil : 32 / 40</p>` : ''}
    ${state.mode==='exam' ? `<button class="btn secondary" id="reviewErrors">Revoir mes erreurs</button>` : ''}
    <button class="btn" onclick="home()">Retour au menu</button>
  </section></div>`;
  if (document.querySelector('#reviewErrors')) document.querySelector('#reviewErrors').onclick = errorsView;
}

function errorsView(){
  clearActiveSession();
  const errors = getProgress().errors || [];
  app.innerHTML = `<div class="wrap"><section class="hero"><h1>🔁 Mes erreurs</h1>
    ${errors.length ? errors.map((e,i)=>`<article class="error-card"><p class="badge">${esc(e.id||'Question')}</p><h2>${esc(e.enonce)}</h2><p><b>Votre réponse :</b> ${esc(e.selected)}</p><p class="correct-text"><b>Bonne réponse :</b> ${esc(e.correct)}</p><p class="muted"><b>Correctif :</b> ${esc(e.explication)}</p></article>`).join('') : '<p class="muted">Aucune erreur enregistrée.</p>'}
    <button class="btn" onclick="home()">← Menu</button></section></div>`;
}

function progressView(){
  clearActiveSession();
  const p = getProgress();
  app.innerHTML = `<div class="wrap"><section class="hero"><h1>📊 Ma progression</h1><p>Examens réalisés : <b>${p.attempts||0}</b></p><p>Meilleur score : <b>${p.best===null||p.best===undefined?'—':p.best+' / 40'}</b></p><p>Questions à revoir : <b>${(p.errors||[]).length}</b></p><button class="btn" onclick="home()">← Menu</button></section></div>`;
}

function timer(){
  const e = document.querySelector('#timer');
  const tick = () => {
    if (!e || state.mode !== 'exam') return;
    const left = Math.max(0, state.deadline-Date.now());
    const m = Math.floor(left/60000), s = Math.floor(left/1000)%60;
    e.textContent = `⏱ ${m}:${String(s).padStart(2,'0')}`;
    if (left <= 0) { state.answered = true; finish(); }
    else setTimeout(tick,1000);
  };
  tick();
}

function showSessionNotice(){
  app.insertAdjacentHTML('afterbegin', `<div class="wrap"><div class="session-notice">↩️ Session reprise : votre entraînement était encore actif.</div></div>`);
}

function inactivityCheck(){
  if (!state.mode) return;
  if (Date.now()-state.lastActivity > IDLE_TIMEOUT) {
    clearActiveSession();
    modal.hidden = true;
    alert('Votre session a été réinitialisée après 30 minutes sans activité.');
    home();
  }
}

['click','keydown','touchstart','pointerdown'].forEach(evt => document.addEventListener(evt, () => {
  if (state.mode) { state.lastActivity = Date.now(); saveActiveSession(); }
}, {passive:true}));
setInterval(inactivityCheck, 30000);

document.querySelector('#menu').onclick = () => {
  if (state.mode) modal.hidden = false;
  else home();
};
document.querySelector('#stay').onclick = () => { modal.hidden = true; registerActivity(); };
document.querySelector('#leave').onclick = () => { modal.hidden = true; home(); };

init().catch(e => app.innerHTML = `<div class="wrap"><section class="hero"><h1>Erreur de chargement</h1><p>${esc(e.message)}</p></section></div>`);
