(() => {
'use strict';
const P = window.Physics, $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d'), mm = $('mm'), mctx = mm.getContext('2d');
const rpCv = $('rpCv'), rctx = rpCv.getContext('2d');
const NONE = {}, keys = {};
const STATUS = { connecting: ['Подключение...', 'warn'], connected: ['Подключено', 'ok'], reconnecting: ['Переподключение...', 'warn'], lost: ['Соединение потеряно', 'bad'], unavailable: ['Сервер недоступен', 'bad'], reachable: ['Сервер доступен', 'ok'] };
const G = { id: 0, admin: false, spec: false, state: 'waiting', cd: 0, rt: 0, rtAt: 0, fd: 0, laps: 3, off: 0, haveOff: false, players: [], snaps: new Map(), me: P.createCar(), hist: [], tp: -1, cars: [], myC: null, results: null, up: 0, upAt: 0, hideRes: false, winner: null, skin: 0, watchId: 0 };
let W = 1, H = 1, DPR = 1, inGame = false, lastT = performance.now(), lastHud = 0, acc = 0, lastN = 0, menuIdx = 0, shake = 0;
const SKINS = 5, SKIN_NAMES = ['Классика', 'Формула', 'Маскл', 'Пикап', 'Карт'];
let skinSel = +(localStorage.getItem('skin') || 0); if (!(skinSel >= 0 && skinSel < SKINS)) skinSel = 0;
const skinBtns = [];
const cam = { x: 2000, y: 1200, z: 1 };

// ---------- сеть ----------
const net = new Net({
  status: setStatus,
  dropped: () => leaveToMenu('Соединение потеряно. Нажмите ИГРАТЬ, чтобы подключиться снова.'),
  msg(m) {
    switch (m.t) {
      case 'welcome':
        Object.assign(G, { id: m.id, admin: m.admin, spec: !!m.spec, skin: m.skin || 0, laps: m.laps, tp: -1, haveOff: false, results: m.results, hideRes: false, winner: null, watchId: 0 });
        G.snaps.clear(); G.hist.length = 0; enterGame();
        if (m.results && m.results.length) showWinner(m.results, m.replay);
        break;
      case 'error': leaveToMenu(m.msg); break;
      case 'players': G.players = m.list; G.up = m.up; G.upAt = performance.now(); renderPlayers($('admList'), m.list); break;
      case 'notice': toast(m.msg); break;
      case 'results': G.results = m.list; G.hideRes = false; renderResults(); showWinner(m.list, m.replay); break;
      case 'pong': break;
      case 'snap': onSnap(m); break;
    }
  },
});

function onSnap(m) {
  const off = m.st - Date.now(); G.off = G.haveOff ? G.off + (off - G.off) * 0.1 : off; G.haveOff = true;
  if (G.state !== m.state) {
    if (m.state !== 'results') { G.results = null; replay = null; $('winShow').classList.add('hidden'); }
    if (m.state === 'waiting' || m.state === 'preparing' || m.state === 'countdown') G.winner = null;
  }
  Object.assign(G, { state: m.state, cd: m.cd, rt: m.rt, rtAt: performance.now(), fd: m.fd, laps: m.laps, cars: m.cars });
  const ids = new Set();
  for (const c of m.cars) {
    ids.add(c.i);
    if (c.i === G.id) {
      const pv = G.myC;
      if (pv && !pv.f && c.f) flash(c.p === 1 ? 'ПОБЕДИТЕЛЬ!' : 'ФИНИШ · место ' + c.p, '#3ddc5f');
      else if (pv && c.l > pv.l && !c.f) flash('КРУГ ' + Math.min(c.l + 1, G.laps) + '/' + G.laps, '#ffe066');
      G.myC = c; reconcile(c); continue;
    }
    let b = G.snaps.get(c.i); if (!b) G.snaps.set(c.i, b = []);
    b.push({ t: m.st, x: c.x, y: c.y, a: c.a, s: c.s, ws: c.ws, th: c.th, vx: c.vx, vy: c.vy, r: c.r }); if (b.length > 12) b.shift();
  }
  for (const id of [...G.snaps.keys()]) if (!ids.has(id)) G.snaps.delete(id);
  if (!G.winner) {
    const fin = m.cars.find(c => c.f);
    if (fin) {
      const p = G.players.find(x => x.id === fin.i);
      G.winner = (p && p.nick) || '#' + fin.i;
      flash('ПОБЕДИТЕЛЬ: ' + G.winner, '#ffe066'); beep(660, .35);
    }
  }
  for (const e of m.ev) { boom(e[0], e[1], e[2]); if (Math.hypot(e[0] - G.me.x, e[1] - G.me.y) < 90) shake = Math.max(shake, e[2] * 9); }
  centerText();
}

// Предсказание своей машины + мягкая сверка с сервером (с поправкой на RTT)
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
function histAt(t) { for (let i = G.hist.length - 1; i >= 0; i--) if (G.hist[i].t <= t) return G.hist[i]; return G.hist[0]; }
function reconcile(c) {
  const me = G.me;
  const hardSnap = () => { Object.assign(me, { x: c.x, y: c.y, a: c.a, vx: c.vx, vy: c.vy, w: c.w }); G.hist.length = 0; };
  if (c.tp !== G.tp) { G.tp = c.tp; hardSnap(); return; }
  const ref = histAt(performance.now() - net.rtt); if (!ref) return;
  const ex = c.x - ref.x, ey = c.y - ref.y;
  if (Math.hypot(ex, ey) > 160) return hardSnap();
  const k = 0.15;
  me.x += ex * k; me.y += ey * k; me.a += wrapA(c.a - ref.a) * k;
  me.vx += (c.vx - ref.vx) * k; me.vy += (c.vy - ref.vy) * k; me.w += (c.w - ref.w) * k;
  for (const h of G.hist) { h.x += ex * k; h.y += ey * k; }
}

// ---------- ввод ----------
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'hb' };
const locked = () => G.state !== 'racing' && G.state !== 'finishing'; // ехать можно только в заезде
const IS_TOUCH = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window || matchMedia('(pointer:coarse)').matches;
const NCP = 8;
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255); };
let smokeCol = hexRgb(localStorage.getItem('smoke') || '#e6e6e6');
let exhaustCol = hexRgb(localStorage.getItem('exhaust') || '#ffb02e');
let prevThr = false;
const mouse = { x: 0, y: 0, has: false };
const stick = { on: false, x0: 0, id: -1 };
let mouseCtl = false, mouseGas = false, mouseSt = 0, stickSt = 0;

function axis() { // аналоговый руль: клавиши > джойстик > мышь
  if (keys.left) return -1;
  if (keys.right) return 1;
  if (stick.on) return stickSt;
  if (mouseCtl && mouse.has) return mouseSt;
  return undefined;
}
function mkInput() { return { up: !!keys.up || mouseGas, down: !!keys.down, left: !!keys.left, right: !!keys.right, hb: !!keys.hb, st: axis() }; }
const sendInput = () => { const i = mkInput(); net.send({ t: 'input', up: i.up, down: i.down, left: i.left, right: i.right, hb: i.hb, st: i.st }); };
addEventListener('keydown', e => {
  if (!inGame || e.target.tagName === 'INPUT') return;
  if (G.spec) { // наблюдатель: стрелки — переключение между гонщиками
    if (e.code === 'ArrowLeft') return cycleWatch(-1);
    if (e.code === 'ArrowRight') return cycleWatch(1);
    if (e.code === 'KeyL') return watchLeader();
    if (e.code === 'KeyE') return watchLast();
    return;
  }
  const k = KEYMAP[e.code];
  if (k) { e.preventDefault(); if (!keys[k]) { keys[k] = true; sendInput(); } }
  else if (e.code === 'KeyR' && !e.repeat && !locked()) net.send({ t: 'respawn' });
});
addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k && keys[k]) { keys[k] = false; sendInput(); } });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseGas = false; stick.on = false; stickSt = 0; sendInput(); });
setInterval(() => { if (inGame && net.joined && !G.spec) sendInput(); }, 33);

// мышь: ЛКМ — газ, курсор задаёт направление (включается в настройках)
addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true; });
addEventListener('mousedown', e => { if (e.button === 0 && inGame && !G.spec && mouseCtl && !(e.target && e.target.closest && e.target.closest('button'))) mouseGas = true; });
addEventListener('mouseup', e => { if (e.button === 0) mouseGas = false; });

// сенсор: джойстик слева — руль, кнопки справа — газ/тормоз/ручник/сброс
if (IS_TOUCH) {
  document.body.classList.add('touch');
  const stickEl = $('stick'), knob = $('stickKnob');
  const setKey = (k, v) => { if (!!keys[k] !== v) { keys[k] = v; sendInput(); } };
  const bindHold = (id, k) => {
    const el = $(id);
    el.addEventListener('pointerdown', e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch {} el.classList.add('act'); setKey(k, true); });
    const end = () => { el.classList.remove('act'); setKey(k, false); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  };
  bindHold('tGas', 'up'); bindHold('tBrk', 'down'); bindHold('tHb', 'hb');
  $('tR').addEventListener('pointerdown', e => { e.preventDefault(); if (inGame && !G.spec && !locked()) net.send({ t: 'respawn' }); });
  stickEl.addEventListener('pointerdown', e => {
    e.preventDefault(); try { stickEl.setPointerCapture(e.pointerId); } catch {}
    stick.on = true; stick.id = e.pointerId; stick.x0 = e.clientX; stickSt = 0;
    knob.style.transform = 'translate(-50%,-50%)';
  });
  stickEl.addEventListener('pointermove', e => {
    if (!stick.on || e.pointerId !== stick.id) return;
    stickSt = Math.abs(e.clientX - stick.x0) < 9 ? 0 : Math.max(-1, Math.min(1, (e.clientX - stick.x0) / 54));
    knob.style.transform = `translate(calc(-50% + ${Math.round(stickSt * 54)}px),-50%)`;
  });
  const endStick = e => { if (e.pointerId !== stick.id) return; stick.on = false; stickSt = 0; knob.style.transform = 'translate(-50%,-50%)'; };
  stickEl.addEventListener('pointerup', endStick); stickEl.addEventListener('pointercancel', endStick);
  document.addEventListener('contextmenu', e => { if (inGame) e.preventDefault(); });
}

// ---------- меню / UI ----------
function setStatus(s) {
  const [txt, cls] = STATUS[s] || STATUS.unavailable;
  $('st').className = 'status ' + cls; $('stTxt').textContent = txt;
  $('conn').textContent = txt; $('conn').className = cls;
}
function renderPlayers(ul, list) {
  ul.textContent = '';
  for (const p of list) {
    const li = document.createElement('li'), i = document.createElement('i'), s = document.createElement('span');
    i.style.background = p.color; s.textContent = p.nick + (p.admin ? ' ★' : '') + (p.spec ? ' · наблюдает' : '') + (p.id === G.id ? ' (вы)' : '');
    li.append(i, s); ul.append(li);
  }
}
function err(t) { $('menuErr').textContent = t || ''; }
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; $('toasts').append(d); setTimeout(() => d.remove(), 4500); if ($('toasts').children.length > 5) $('toasts').firstChild.remove(); }
let flashT = 0;
function flash(text, col) {
  const el = $('lapMsg'); el.textContent = text; el.style.color = col || '#fff';
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(flashT); flashT = setTimeout(() => el.classList.remove('show'), 2000);
}
function enterGame() {
  inGame = true; $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
  $('admin').classList.toggle('hidden', !G.admin); $('touch').classList.toggle('hidden', !IS_TOUCH || G.spec);
  $('info').classList.toggle('hidden', G.spec); $('speedo').classList.toggle('hidden', G.spec);
  $('spec').classList.toggle('hidden', !G.spec);
  err('');
}
function leaveToMenu(msg) {
  net.leave(); inGame = false; G.myC = null; for (const k in keys) keys[k] = false;
  mouseGas = false; stick.on = false; stickSt = 0; mouseSt = 0;
  $('touch').classList.add('hidden'); $('info').classList.remove('hidden'); $('speedo').classList.remove('hidden'); $('spec').classList.add('hidden');
  $('winShow').classList.add('hidden'); replay = null;
  $('hud').classList.add('hidden'); $('menu').classList.remove('hidden'); err(msg || ''); engine(0, false); poll();
}
$('nick').value = localStorage.getItem('nick') || '';
const passVis = () => $('pass').classList.toggle('hidden', $('nick').value.trim().toLowerCase() !== 'stleri'); // только подсказка UI; права проверяет сервер
$('nick').addEventListener('input', passVis); passVis();
function play(watch) {
  initAudio();
  const nick = $('nick').value.trim();
  if (nick.length < 2) return err('Введите ник (минимум 2 символа)');
  if (location.protocol === 'file:') return err('Откройте игру через сервер: http://localhost:3000');
  err(''); localStorage.setItem('nick', nick);
  net.connect({ nick, password: $('pass').value, skin: skinSel, color: colorSel || undefined, watch: watch || undefined });
}
$('play').onclick = () => play(false);
$('watch').onclick = () => play(true);
for (const id of ['nick', 'pass']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') play(false); });
$('exit').onclick = () => leaveToMenu('');
$('resClose').onclick = () => { G.hideRes = true; $('results').classList.add('hidden'); };
$('winClose').onclick = () => closeWin();
addEventListener('keydown', e => { if (e.code === 'Escape' && !$('winShow').classList.contains('hidden')) closeWin(); });
$('spPrev').onclick = () => cycleWatch(-1);
$('spNext').onclick = () => cycleWatch(1);
$('spLead').onclick = () => watchLeader();
$('spLast').onclick = () => watchLast();
document.querySelectorAll('[data-cmd]').forEach(b => b.onclick = () => {
  const cmd = b.dataset.cmd;
  if (cmd === 'force' && !confirm('Принудительно завершить текущий заезд для всех игроков?')) return;
  net.send({ t: 'admin', cmd });
});
$('vol').oninput = () => { snd.vol = $('vol').value / 100; };
$('sndOn').onchange = () => { snd.on = $('sndOn').checked; };
$('smokeCol').value = localStorage.getItem('smoke') || '#e6e6e6';
$('exhaustCol').value = localStorage.getItem('exhaust') || '#ffb02e';
$('smokeCol').oninput = () => { smokeCol = hexRgb($('smokeCol').value); localStorage.setItem('smoke', $('smokeCol').value); };
$('exhaustCol').oninput = () => { exhaustCol = hexRgb($('exhaustCol').value); localStorage.setItem('exhaust', $('exhaustCol').value); };
$('mouseCtl').checked = localStorage.getItem('mouse') === '1';
mouseCtl = $('mouseCtl').checked;
$('mouseCtl').onchange = () => { mouseCtl = $('mouseCtl').checked; localStorage.setItem('mouse', mouseCtl ? '1' : '0'); };

// ---------- выбор цвета (занятый цвет сервер не выдаст) ----------
const COLORS = ['#e63946', '#2a9df4', '#f4d35e', '#2ec4b6', '#ff9f1c', '#9b5de5', '#06d6a0', '#f15bb5', '#8ecae6', '#c0ca33', '#ff6b6b', '#ffffff', '#00b4d8', '#b5651d', '#7bd389', '#d0a2f7',
  '#f94144', '#f3722c', '#f8961e', '#f9c74f', '#90be6d', '#43aa8b', '#4d908e', '#277da1', '#6d597a', '#b5838d', '#e5989b', '#ffb4a2', '#c77dff', '#84a98c', '#52796f', '#ffd60a'];
let colorSel = localStorage.getItem('color') || '';
const colorBtns = [];
function selectColor(c) {
  colorSel = c || ''; localStorage.setItem('color', colorSel);
  $('colName').textContent = colorSel || 'Авто';
  $('colName').style.color = colorSel || '#ffc83d';
  colorBtns.forEach(b => b.classList.toggle('sel', (b.dataset.c || '') === colorSel));
}
function initColors() {
  const box = $('colors');
  const mk = (c, title) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sw' + (c ? '' : ' auto'); b.dataset.c = c; b.title = title;
    if (c) b.style.background = c; else b.textContent = 'А';
    b.onclick = () => selectColor(c); box.append(b); colorBtns.push(b);
  };
  mk('', 'Авто: сервер подберёт свободный цвет');
  for (const c of COLORS) mk(c, c);
  selectColor(COLORS.includes(colorSel) ? colorSel : '');
}

// ---------- выбор машины (скины: разный кузов, одна физика) ----------
function selectSkin(i) {
  skinSel = i; localStorage.setItem('skin', i);
  $('skinName').textContent = SKIN_NAMES[i];
  skinBtns.forEach((b, j) => b.classList.toggle('sel', j === i));
}
function initSkins() {
  const box = $('skins');
  for (let i = 0; i < SKINS; i++) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'skinBtn'; b.title = SKIN_NAMES[i];
    const c = document.createElement('canvas'); c.width = 96; c.height = 48;
    const g = c.getContext('2d'); g.translate(48, 24); g.scale(1.3, 1.3); drawCar(g, 0, 0, 0, '#e63946', 1, false, i);
    b.append(c); b.onclick = () => selectSkin(i); box.append(b); skinBtns.push(b);
  }
  selectSkin(skinSel);
}

async function poll() { // реальный опрос сервера (список игроков в меню)
  if (inGame || net.want) return;
  try {
    const j = await (await fetch('/api/status', { cache: 'no-store' })).json();
    setStatus('reachable'); renderPlayers($('plist'), j.players); $('cnt').textContent = j.count;
  } catch { setStatus('unavailable'); $('plist').textContent = ''; $('cnt').textContent = '0'; }
}
setInterval(poll, 3000); poll();

const fmt = ms => ms > 0 ? Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0') + '.' + String(Math.floor(ms % 1000)).padStart(3, '0') : '--:--.---';
function renderResults() {
  const tb = $('resBody'); tb.textContent = '';
  const first = (G.results || [])[0];
  $('resWin').textContent = first ? 'ПОБЕДИТЕЛЬ: ' + first.nick : '';
  for (const r of G.results || []) {
    const tr = document.createElement('tr');
    [r.pos, r.nick, r.dnf ? 'не финишировал' : fmt(r.time), fmt(r.best)].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.append(td); });
    tb.append(tr);
  }
}
// ---------- победитель: анимация + повтор финиша ----------
let replay = null, rpPos = 0, rpWinner = 0;
function showWinner(list, rp) {
  const w = (list || [])[0];
  replay = rp && rp.frames && rp.frames.length > 2 && w ? rp : null;
  if (!replay) { $('winShow').classList.add('hidden'); return; }
  rpWinner = rp.winner; rpPos = 0; G.hideRes = true;
  $('winNick').textContent = w.nick;
  const pl = G.players.find(x => x.id === w.id);
  $('winNick').style.color = pl ? pl.color : '#ffe066';
  $('winShow').classList.remove('hidden');
  beep(880, .3); setTimeout(() => beep(1170, .3), 200); setTimeout(() => beep(1560, .45), 400);
}
function closeWin() { $('winShow').classList.add('hidden'); replay = null; G.hideRes = false; renderResults(); }
function centerText() {
  const c = $('center'), L = $('lights'), L3 = L.children, st = G.state;
  let txt = '', ban = '', lights = false;
  const rt = G.rt;
  if (st === 'preparing') { txt = ''; ban = 'ПОДГОТОВКА К ЗАЕЗДУ'; lights = true; for (const l of L3) l.className = ''; }
  else if (st === 'countdown') {
    const n = Math.ceil(G.cd / 1000); lights = true; txt = String(n);
    for (let i = 0; i < 3; i++) L3[i].className = i < 4 - n ? 'red' : '';
  } else if (st === 'racing' && rt < 1000) { txt = 'GO!'; lights = true; for (const l of L3) l.className = 'green'; }
  else if (st === 'waiting') ban = 'Ожидание старта — заезд запускает администратор (stleri)';
  else if (st === 'results') ban = 'Заезд завершён';
  else if (st === 'finishing') ban = 'Заезд завершается через ' + Math.ceil(G.fd / 1000) + ' с';
  if (st === 'racing' && G.myC && !G.myC.r) ban = 'Вы наблюдаете: заезд начался до вашего входа';
  if (c.textContent !== txt) { c.textContent = txt; if (txt) { c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); if (txt === 'GO!') beep(880, .5); else beep(440, .2); } }
  $('banner').textContent = ban; L.classList.toggle('hidden', !lights);
  const showRes = st === 'results' && G.results && !G.hideRes;
  $('results').classList.toggle('hidden', !showRes); if (showRes) renderResults();
}

// ---------- звук ----------
const snd = { ctx: null, osc: null, gain: null, on: true, vol: .4 };
function initAudio() {
  if (snd.ctx) return;
  try {
    const A = new (window.AudioContext || window.webkitAudioContext)(), o = A.createOscillator(), f = A.createBiquadFilter(), g = A.createGain();
    o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 500; g.gain.value = 0; o.connect(f); f.connect(g); g.connect(A.destination); o.start();
    Object.assign(snd, { ctx: A, osc: o, gain: g });
  } catch { /* звук недоступен */ }
}
function beep(freq, dur) {
  if (!snd.ctx || !snd.on) return;
  const o = snd.ctx.createOscillator(), g = snd.ctx.createGain(); o.frequency.value = freq; g.gain.value = .15 * snd.vol;
  o.connect(g); g.connect(snd.ctx.destination); o.start(); o.stop(snd.ctx.currentTime + dur);
}
function engine(sp, thr) {
  if (!snd.ctx) return; const t = snd.ctx.currentTime;
  snd.osc.frequency.setTargetAtTime(55 + sp * .22, t, .05);
  snd.gain.gain.setTargetAtTime(snd.on && inGame ? snd.vol * (.05 + (thr ? .07 : 0)) : 0, t, .08);
}

// ---------- эффекты ----------
const parts = [], skids = [], lastSk = {};
function addPart(x, y, vx, vy, life, r, col, a) { if (parts.length < 500) parts.push({ x, y, vx, vy, l: life, m: life, r, c: col, a: a == null ? .5 : a }); }
function flameFx(x, y, a, kick) { // огонь из выхлопных труб
  const c = Math.cos(a), sn = Math.sin(a), off = (Math.random() < .5 ? -1 : 1) * 6, spd = 70 + Math.random() * 100 + kick * 140;
  addPart(x - c * 25 + sn * off, y - sn * 25 - c * off, -c * spd + (Math.random() - .5) * 36, -sn * spd + (Math.random() - .5) * 36, .12 + Math.random() * .2, 2.5 + Math.random() * 2.5, exhaustCol, .85);
}
function boom(x, y, pw) { // искры + дым + обломки при ударе
  for (let i = 0, n = 10 + pw * 26; i < n; i++) { const a = Math.random() * 6.28, v = 90 + Math.random() * 320 * (0.4 + pw); addPart(x, y, Math.cos(a) * v, Math.sin(a) * v, .35 + Math.random() * .4, 2 + Math.random() * 2, '255,' + (140 + Math.random() * 100 | 0) + ',40'); }
  for (let i = 0, n = 5 + pw * 8; i < n; i++) { const a = Math.random() * 6.28, v = 30 + Math.random() * 100 * pw; addPart(x, y, Math.cos(a) * v, Math.sin(a) * v, .5 + Math.random() * .5, 5 + Math.random() * 6, smokeCol); }
  for (let i = 0, n = 3 + pw * 5; i < n; i++) { const a = Math.random() * 6.28, v = 60 + Math.random() * 190; addPart(x, y, Math.cos(a) * v, Math.sin(a) * v, .45 + Math.random() * .3, 3, '35,35,40'); }
}
function tireFx(id, x, y, a, s, spin) {
  if (s < .25 && !(spin > .5)) { delete lastSk[id]; return; }
  const c = Math.cos(a), sn = Math.sin(a), lx = x - c * 14 + sn * 9, ly = y - sn * 14 - c * 9, rx = x - c * 14 - sn * 9, ry = y - sn * 14 + c * 9, L = lastSk[id];
  if (L && Math.hypot(lx - L[0], ly - L[1]) < 60) skids.push(L[0], L[1], lx, ly, L[2], L[3], rx, ry);
  lastSk[id] = [lx, ly, rx, ry];
  const k = Math.max(s, spin || 0);
  if (k > .3) for (let i = 0, n = k > .7 ? 2 : 1; i < n; i++) if (Math.random() < .45 + k * .45) {
    const side = Math.random() < .5 ? 1 : -1;
    addPart(x - c * 14 + sn * 9 * side, y - sn * 14 - c * 9 * side, (Math.random() - .5) * 40, (Math.random() - .5) * 40, .6 + Math.random() * .6, 6 + k * 8, smokeCol);
  }
  if (skids.length > 20000) skids.splice(0, 5000);
}

// ---------- камера / цикл ----------
function resize() { DPR = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
addEventListener('resize', resize); resize();

const wrapLerp = (a, b, k) => a + wrapA(b - a) * k;
function interp(id, rts) {
  const b = G.snaps.get(id); if (!b || !b.length) return null;
  let a = null, c = null;
  for (const s of b) { if (s.t <= rts) a = s; else { c = s; break; } }
  if (!a) return b[0]; if (!c) return a;
  if (Math.hypot(c.x - a.x, c.y - a.y) > 300) return rts - a.t < (c.t - a.t) / 2 ? a : c; // телепорт
  const k = (rts - a.t) / (c.t - a.t);
  return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, a: wrapLerp(a.a, c.a, k), s: c.s, ws: c.ws, th: c.th, spd: Math.hypot(c.vx, c.vy), r: c.r };
}

// ---------- наблюдатель: выбор машины для слежки ----------
function specOrder() { return G.cars.filter(c => c.r).sort((a, b) => a.p - b.p); } // по позиции: 1-й..последний
function specTarget() { // выбранный игрок, иначе лидер (ТОП-1)
  const ord = specOrder();
  const t = ord.find(c => c.i === G.watchId);
  if (!t && G.watchId) G.watchId = 0;
  return t || ord[0] || G.cars.find(c => c.r) || null;
}
function cycleWatch(d) {
  const ord = specOrder(); if (!ord.length) return;
  let i = ord.findIndex(c => c.i === G.watchId);
  if (i < 0) i = d > 0 ? -1 : 0;
  G.watchId = ord[((i + d) % ord.length + ord.length) % ord.length].i;
}
const watchLeader = () => { const o = specOrder(); if (o.length) G.watchId = o[0].i; };
const watchLast = () => { const o = specOrder(); if (o.length) G.watchId = o[o.length - 1].i; };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.1, (now - lastT) / 1000); lastT = now;
  if (inGame && net.joined && G.spec) { // наблюдатель: камера за выбранным игроком (по умолчанию — лидер)
    const t = specTarget();
    const s = t ? interp(t.i, Date.now() + G.off - 100) : null;
    if (s) {
      const k = 1 - Math.exp(-6 * dt), tz = Math.max(.45, Math.min(W / 1100, H / 700));
      cam.x += (s.x - cam.x) * k; cam.y += (s.y - cam.y) * k; cam.z += (tz - cam.z) * k;
    } else {
      menuIdx = (menuIdx + dt * 18) % P.N; const i = menuIdx | 0; cam.x = P.X[i]; cam.y = P.Y[i]; cam.z = Math.max(.45, Math.min(W / 1100, H / 700));
    }
  } else if (inGame && net.joined && G.tp !== -1) {
    if (mouseCtl && mouse.has) {
      const wx = cam.x + (mouse.x - W / 2) / cam.z, wy = cam.y + (mouse.y - H / 2) / cam.z;
      const dx = wx - G.me.x, dy = wy - G.me.y;
      const t = Math.hypot(dx, dy) < 30 ? 0 : Math.max(-1, Math.min(1, wrapA(Math.atan2(dy, dx) - G.me.a) / 1.1));
      mouseSt += (t - mouseSt) * Math.min(1, 14 * dt);
    }
    acc += dt; const inp = locked() ? NONE : mkInput();
    while (acc >= 1 / 60) { acc -= 1 / 60; P.step(G.me, inp, 1 / 60); G.hist.push({ t: now, x: G.me.x, y: G.me.y, a: G.me.a, vx: G.me.vx, vy: G.me.vy, w: G.me.w }); }
    while (G.hist.length && G.hist[0].t < now - 1500) G.hist.shift();
    const sp = Math.hypot(G.me.vx, G.me.vy);
    if (G.me.slip > .25 || G.me.spin > .5) tireFx(G.id, G.me.x, G.me.y, G.me.a, G.me.slip, G.me.spin); else delete lastSk[G.id];
    const thr = (keys.up || mouseGas) && !locked();
    if (thr && sp > 10 && Math.random() < .75) flameFx(G.me.x, G.me.y, G.me.a, Math.min(1, sp / 620));
    if (!thr && prevThr && sp > 200) for (let i = 0; i < 7; i++) flameFx(G.me.x, G.me.y, G.me.a, 1); // хлопок при сбросе газа
    prevThr = thr;
    shake *= Math.max(0, 1 - 7 * dt);
    const k = 1 - Math.exp(-6 * dt), tz = Math.max(.45, Math.min(W / 1100, H / 700)) * (1 - .2 * Math.min(1, sp / 620));
    cam.x += (G.me.x + G.me.vx * .25 - cam.x) * k; cam.y += (G.me.y + G.me.vy * .25 - cam.y) * k; cam.z += (tz - cam.z) * k;
    engine(sp, (keys.up || mouseGas) && !locked());
  } else if (!inGame) { // фон меню: просто облёт трассы камерой (не игроки)
    menuIdx = (menuIdx + dt * 18) % P.N; const i = menuIdx | 0; cam.x = P.X[i]; cam.y = P.Y[i]; cam.z = Math.max(.45, Math.min(W / 1100, H / 700));
  }
  render(dt);
  if (replay && !$('winShow').classList.contains('hidden')) drawReplay(dt);
  if (inGame && now - lastHud > 100) { lastHud = now; hud(now); }
}

// ---------- рендер ----------
let tpath = null;
function strokeP(w, col, dash) { ctx.lineWidth = w; ctx.strokeStyle = col; ctx.setLineDash(dash || []); ctx.stroke(tpath); }
function carShape(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); }
function drawCar(g, x, y, a, col, alpha, braking, sk) {
  g.save(); g.translate(x, y); g.rotate(a); g.globalAlpha = alpha;
  g.fillStyle = 'rgba(0,0,0,.3)'; carShape(g, -22, -9, 48, 28, 8);
  g.fillStyle = '#111';
  for (const [wx, wy] of sk === 1 || sk === 4 ? [[-16, -18], [8, -18], [-16, 12], [8, 12]] : [[-16, -14], [8, -14], [-16, 10], [8, 10]]) g.fillRect(wx, wy, 10, 4);
  if (sk === 1) { // формула
    g.fillStyle = '#15151a'; g.fillRect(-25, -11, 7, 22); g.fillRect(15, -12, 6, 24); g.fillRect(-14, -1, 28, 4);
    g.fillStyle = col; carShape(g, -16, -6, 26, 12, 5);
    g.beginPath(); g.moveTo(10, -4); g.lineTo(20, 0); g.lineTo(10, 4); g.closePath(); g.fill();
    g.fillStyle = '#1b2733'; carShape(g, -6, -3, 8, 6, 2);
  } else if (sk === 2) { // маскл
    g.fillStyle = col; carShape(g, -23, -11, 46, 22, 4);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-23, -4, 46, 3); g.fillRect(-23, 1, 46, 3);
    g.fillStyle = 'rgba(0,0,0,.3)'; carShape(g, 1, -6, 9, 12, 3);
    g.fillStyle = '#12202c'; carShape(g, -9, -8, 13, 16, 3);
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(-25, -12, 4, 24);
  } else if (sk === 3) { // пикап
    g.fillStyle = col; carShape(g, -23, -9, 21, 18, 3); carShape(g, 1, -9, 17, 18, 4);
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(-21, -7, 18, 14);
    g.fillStyle = '#12202c'; carShape(g, 4, -7, 7, 14, 3);
    g.fillStyle = '#333'; g.fillRect(-7, -9, 3, 18);
  } else if (sk === 4) { // карт
    g.fillStyle = col; carShape(g, -13, -8, 27, 16, 5);
    g.fillStyle = '#222'; carShape(g, -21, -5, 9, 10, 3);
    g.fillStyle = '#111'; g.fillRect(-3, -6, 8, 12);
    g.fillStyle = '#666'; g.fillRect(15, -9, 3, 18);
  } else { // классика
    g.fillStyle = col; carShape(g, -23, -11, 46, 22, 7);
    g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(-23, -2, 46, 4);
    g.fillStyle = '#1b2733'; carShape(g, -5, -8, 17, 16, 4);
    g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(8, -7, 3, 14);
    g.fillStyle = '#fff7b0'; g.fillRect(20, -9, 3, 4); g.fillRect(20, 5, 3, 4);
  }
  g.fillStyle = braking ? '#ff2020' : '#8a1a1a'; g.fillRect(-25, -9, 2, 4); g.fillRect(-25, 5, 2, 4);
  g.restore();
}
function drawReplay(dt) { // повтор финиша в оверлее победителя
  const F = replay.frames, w = rpCv.width, h = rpCv.height;
  rpPos += dt * 1000;
  const t0 = F[0][0], t1 = F[F.length - 1][0];
  if (rpPos > t1 - t0 + 900) rpPos = 0;
  const tt = t0 + rpPos;
  let i = 0; while (i < F.length - 1 && F[i + 1][0] <= tt) i++;
  const a = F[i], b = F[Math.min(i + 1, F.length - 1)];
  const k = b[0] > a[0] ? Math.min(1, Math.max(0, (tt - a[0]) / (b[0] - a[0]))) : 0;
  const prev = new Map(a[1].map(c => [c[0], c])), cars = [];
  for (const c of b[1]) { const q = prev.get(c[0]); if (!q) continue; cars.push([c[0], q[1] + (c[1] - q[1]) * k, q[2] + (c[2] - q[2]) * k, q[3] + wrapA(c[3] - q[3]) * k]); }
  const wc = cars.find(c => c[0] === rpWinner) || cars[0];
  rctx.setTransform(1, 0, 0, 1, 0, 0); rctx.fillStyle = '#24582a'; rctx.fillRect(0, 0, w, h);
  const z = Math.min(w / 1000, h / 580);
  if (wc) rctx.setTransform(z, 0, 0, z, w / 2 - wc[1] * z, h / 2 - wc[2] * z);
  else rctx.setTransform(z, 0, 0, z, w / 2 - P.X[P.START] * z, h / 2 - P.Y[P.START] * z);
  if (tpath) {
    rctx.lineJoin = 'round';
    rctx.lineWidth = 2 * P.WALL + 18; rctx.strokeStyle = '#f2f2f2'; rctx.stroke(tpath);
    rctx.lineWidth = 2 * P.ROAD_HW + 14; rctx.strokeStyle = '#f2f2f2'; rctx.stroke(tpath);
    rctx.lineWidth = 2 * P.ROAD_HW; rctx.strokeStyle = '#3a3d44'; rctx.stroke(tpath);
    rctx.lineWidth = 3; rctx.strokeStyle = 'rgba(255,255,255,.3)'; rctx.setLineDash([28, 34]); rctx.stroke(tpath); rctx.setLineDash([]);
  }
  rctx.save(); rctx.translate(P.X[P.START], P.Y[P.START]); rctx.rotate(P.ANG[P.START]);
  for (let yi = 0; yi < 8; yi++) for (let xj = 0; xj < 2; xj++) { rctx.fillStyle = (yi + xj) % 2 ? '#fff' : '#111'; rctx.fillRect(-20 + xj * 20, -80 + yi * 20, 20, 20); }
  rctx.restore();
  const pm = new Map(G.players.map(p => [p.id, p]));
  for (const c of cars) {
    const pl = pm.get(c[0]);
    if (c[0] === rpWinner) { rctx.save(); rctx.globalAlpha = .3; rctx.fillStyle = '#ffe066'; rctx.beginPath(); rctx.arc(c[1], c[2], 34 + 6 * Math.sin(rpPos / 130), 0, 6.3); rctx.fill(); rctx.restore(); }
    drawCar(rctx, c[1], c[2], c[3], pl ? pl.color : '#fff', 1, false, (pl && pl.skin) || 0);
  }
  rctx.setTransform(1, 0, 0, 1, 0, 0);
  rctx.font = 'bold 15px "Segoe UI",Arial'; rctx.textAlign = 'left'; rctx.fillStyle = 'rgba(255,255,255,.7)';
  rctx.fillText('ПОВТОР', 12, 24);
}
function render(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#24582a'; ctx.fillRect(0, 0, cv.width, cv.height);
  if (!tpath) { tpath = new Path2D(); tpath.moveTo(P.X[0], P.Y[0]); for (let k = 1; k < P.N; k++) tpath.lineTo(P.X[k], P.Y[k]); tpath.closePath(); }
  const z = cam.z * DPR, shx = (Math.random() - .5) * shake, shy = (Math.random() - .5) * shake;
  ctx.setTransform(z, 0, 0, z, (W / 2 - cam.x * cam.z + shx) * DPR, (H / 2 - cam.y * cam.z + shy) * DPR);
  ctx.lineJoin = 'round';
  strokeP(2 * P.WALL + 18, '#f2f2f2'); strokeP(2 * P.WALL + 18, '#d33', [34, 34]); // отбойники
  strokeP(2 * P.WALL - 4, '#2f7a35');                                               // трава
  strokeP(2 * P.ROAD_HW + 14, '#f2f2f2'); strokeP(2 * P.ROAD_HW + 14, '#d33', [26, 26]); // бордюр
  strokeP(2 * P.ROAD_HW, '#3a3d44'); strokeP(3, 'rgba(255,255,255,.3)', [28, 34]); ctx.setLineDash([]);
  // стартовая решётка и линия
  ctx.save(); ctx.globalAlpha = .3; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  for (let s = 0; s < 32; s++) { const g = P.gridPos(s); ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.a); ctx.strokeRect(-24, -12, 40, 24); ctx.restore(); }
  ctx.restore();
  ctx.save(); ctx.translate(P.X[P.START], P.Y[P.START]); ctx.rotate(P.ANG[P.START]);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#fff' : '#111'; ctx.fillRect(-20 + j * 20, -80 + i * 20, 20, 20); }
  ctx.restore();
  // следы шин
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath();
  for (let i = 0; i < skids.length; i += 4) { ctx.moveTo(skids[i], skids[i + 1]); ctx.lineTo(skids[i + 2], skids[i + 3]); }
  ctx.stroke(); ctx.lineCap = 'butt';
  if (!inGame) return;

  // машины
  const rts = Date.now() + G.off - 100, list = [], pm = new Map(G.players.map(p => [p.id, p]));
  const active = G.state !== 'waiting' && G.state !== 'results';
  for (const c of G.cars) {
    const p = pm.get(c.i); if (!p) continue;
    if (c.i === G.id) { list.push({ x: G.me.x, y: G.me.y, a: G.me.a, p, br: keys.down, gh: active && !c.r }); continue; }
    const s = interp(c.i, rts); if (!s) continue;
    if (s.s > .25 || s.ws > .5) tireFx(c.i, s.x, s.y, s.a, s.s, s.ws); else delete lastSk[c.i];
    if (s.th && s.spd > 10 && Math.random() < .6) flameFx(s.x, s.y, s.a, Math.min(1, s.spd / 620));
    list.push({ x: s.x, y: s.y, a: s.a, p, gh: active && !s.r });
  }
  for (const q of list) drawCar(ctx, q.x, q.y, q.a, q.p.color, q.gh ? .4 : 1, q.br, q.p.skin || 0);
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i]; q.l -= dt; if (q.l <= 0) { parts.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= .96; q.vy *= .96;
    ctx.fillStyle = `rgba(${q.c},${(q.l / q.m * q.a).toFixed(2)})`; ctx.beginPath(); ctx.arc(q.x, q.y, q.r * (1 + (1 - q.l / q.m) * 2), 0, 6.3); ctx.fill();
  }
  // экранный слой: ники (по целым пикселям — без дрожания) и эффект скорости
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.font = `bold ${13 * DPR}px "Segoe UI",Arial`; ctx.textAlign = 'center';
  for (const q of list) {
    const sx = Math.round(((q.x - cam.x) * cam.z + W / 2) * DPR), sy = Math.round(((q.y - cam.y) * cam.z + H / 2) * DPR - 34 * cam.z * DPR), tw = ctx.measureText(q.p.nick).width;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(sx - tw / 2 - 5 * DPR, sy - 13 * DPR, tw + 10 * DPR, 18 * DPR);
    ctx.fillStyle = q.p.id === G.id ? '#ffe066' : '#fff'; ctx.fillText(q.p.nick, sx, sy);
  }
  const sp = Math.hypot(G.me.vx, G.me.vy);
  if (sp > 430) {
    ctx.strokeStyle = `rgba(255,255,255,${Math.min(.35, (sp - 430) / 500)})`; ctx.lineWidth = 2 * DPR; ctx.beginPath();
    for (let i = 0; i < 14; i++) { const an = Math.random() * 6.28, r0 = Math.min(W, H) * (.38 + Math.random() * .12) * DPR, r1 = r0 + 60 * DPR; ctx.moveTo(cv.width / 2 + Math.cos(an) * r0, cv.height / 2 + Math.sin(an) * r0); ctx.lineTo(cv.width / 2 + Math.cos(an) * r1, cv.height / 2 + Math.sin(an) * r1); }
    ctx.stroke();
  }
  drawMini(list);
}

// ---------- мини-карта ----------
let bb = null;
function drawMini(list) {
  if (!bb) { bb = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }; for (let k = 0; k < P.N; k++) { bb.x0 = Math.min(bb.x0, P.X[k]); bb.x1 = Math.max(bb.x1, P.X[k]); bb.y0 = Math.min(bb.y0, P.Y[k]); bb.y1 = Math.max(bb.y1, P.Y[k]); } }
  const w = mm.width, h = mm.height, sc = Math.min((w - 20) / (bb.x1 - bb.x0), (h - 20) / (bb.y1 - bb.y0)), ox = (w - (bb.x1 - bb.x0) * sc) / 2, oy = (h - (bb.y1 - bb.y0) * sc) / 2;
  const mx = x => ox + (x - bb.x0) * sc, my = y => oy + (y - bb.y0) * sc;
  mctx.clearRect(0, 0, w, h); mctx.beginPath(); mctx.moveTo(mx(P.X[0]), my(P.Y[0]));
  for (let k = 1; k < P.N; k++) mctx.lineTo(mx(P.X[k]), my(P.Y[k]));
  mctx.closePath(); mctx.strokeStyle = 'rgba(255,255,255,.55)'; mctx.lineWidth = Math.max(3, 150 * sc); mctx.lineJoin = 'round'; mctx.stroke();
  mctx.fillStyle = '#fff'; mctx.fillRect(mx(P.X[P.START]) - 1, my(P.Y[P.START]) - 6, 3, 12);
  for (const q of list) {
    const hi = q.p.id === G.id || (G.spec && q.p.id === G.watchId);
    mctx.beginPath(); mctx.arc(mx(q.x), my(q.y), hi ? 5 : 4, 0, 6.3); mctx.fillStyle = q.p.color; mctx.fill();
    if (hi) { mctx.strokeStyle = '#fff'; mctx.lineWidth = 2; mctx.stroke(); }
  }
}

// ---------- HUD ----------
function hud(now) {
  const me = G.me, c = G.myC, racing = G.state === 'racing' || G.state === 'finishing';
  const rt = racing ? G.rt + (now - G.rtAt) : G.state === 'results' ? G.rt : 0;
  $('spd').textContent = Math.round(Math.hypot(me.vx, me.vy) * .36);
  $('png').textContent = net.rtt;
  const part = G.cars.filter(x => x.r).length;
  if (c) {
    $('lap').textContent = Math.min(c.l + 1, G.laps) + '/' + G.laps;
    $('cp').textContent = (c.cp || 0) % NCP + '/' + NCP;
    $('pos').textContent = c.r && (G.state !== 'waiting') ? c.p + '/' + part : '-';
    $('best').textContent = fmt(c.b);
    $('lt').textContent = racing && c.r && !c.f ? fmt(rt - c.ls) : '0:00.000';
  }
  $('tim').textContent = fmt(rt) === '--:--.---' ? '0:00.000' : fmt(rt);
  const pm = new Map(G.players.map(p => [p.id, p])), ol = $('standings'); ol.textContent = '';
  for (const x of [...G.cars].sort((a, b) => (a.r ? a.p : 99) - (b.r ? b.p : 99))) {
    const p = pm.get(x.i); if (!p) continue;
    const li = document.createElement('li'); li.textContent = (G.spec && x.i === G.watchId ? '» ' : '') + p.nick + (x.f ? ' · финиш' : x.r ? '  · круг ' + Math.min(x.l + 1, G.laps) : '');
    li.style.color = p.color;
    if (G.spec) { li.style.cursor = 'pointer'; li.onclick = () => { G.watchId = x.i; }; } // клик — следить за этим игроком
    ol.append(li);
  }
  if (G.spec) {
    const t = specTarget(), tp = t ? pm.get(t.i) : null, nm = $('spName');
    nm.textContent = tp ? tp.nick : '—'; nm.style.color = tp ? tp.color : '';
    $('spLap').textContent = t ? (t.f ? 'финишировал' : t.r ? 'круг ' + Math.min(t.l + 1, G.laps) + '/' + G.laps + ' · место ' + t.p : 'ждёт старта') : 'нет участников';
    $('spTime').textContent = racing || G.state === 'results' ? (fmt(rt) === '--:--.---' ? '0:00.000' : fmt(rt)) : '';
  }
  const lead = G.cars.filter(x => x.p > 0).sort((a, b) => a.p - b.p)[0], lp = lead ? pm.get(lead.i) : null;
  $('leader').classList.toggle('hidden', !lp);
  if (lp) { const ln = $('leadNick'); ln.textContent = lp.nick; ln.style.color = lp.color; $('leadLap').textContent = lead.f ? 'финиш' : 'круг ' + Math.min(lead.l + 1, G.laps) + '/' + G.laps; }
  if (G.admin) $('admInfo').textContent = `Участников: ${G.players.length}/32 · Сервер: онлайн · аптайм ${Math.floor((G.up + now - G.upAt) / 1000)} с · состояние: ${G.state} · пинг ${net.rtt} мс`;
  if (G.state === 'finishing') centerText();
}
initSkins();
initColors();
requestAnimationFrame(frame);
})();
