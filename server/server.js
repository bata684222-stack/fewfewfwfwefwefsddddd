'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const auth = require('./auth');
const { Race, ST, LAPS } = require('./race');
const P = require('../client/physics.js');

const PORT = +process.env.PORT || 3000, MAX = 32, SKINS = 5, CLIENT = path.join(__dirname, '..', 'client');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const COLORS = ['#e63946', '#2a9df4', '#f4d35e', '#2ec4b6', '#ff9f1c', '#9b5de5', '#06d6a0', '#f15bb5', '#8ecae6', '#c0ca33', '#ff6b6b', '#ffffff', '#00b4d8', '#b5651d', '#7bd389', '#d0a2f7',
  '#f94144', '#f3722c', '#f8961e', '#f9c74f', '#90be6d', '#43aa8b', '#4d908e', '#277da1', '#6d597a', '#b5838d', '#e5989b', '#ffb4a2', '#c77dff', '#84a98c', '#52796f', '#ffd60a'];
const NONE = {};
const players = new Map(); let nextId = 1;
const race = new Race(), started = Date.now();

const list = () => [...players.values()].map(p => ({ id: p.id, nick: p.nick, color: p.color, admin: p.admin, skin: p.skin, spec: p.spec }));
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const bcast = o => { const s = JSON.stringify(o); for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s); };
const notice = (msg, except) => { const s = JSON.stringify({ t: 'notice', msg }); for (const p of players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s); };
const pushPlayers = () => bcast({ t: 'players', list: list(), up: Date.now() - started });

const server = http.createServer((req, res) => {
  let u; try { u = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (u === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, state: race.state, count: players.size, players: list().map(p => ({ nick: p.nick, color: p.color, spec: p.spec || false })) }));
  }
  if (u === '/') u = '/index.html';
  const f = path.join(CLIENT, u);
  if (!f.startsWith(CLIENT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(d);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });

function join(ws, m, ip) {
  const fail = msg => send(ws, { t: 'error', msg });
  if (ws.p) return;
  const nick = String(m.nick || '').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N}_\- ]{2,16}$/u.test(nick)) return fail('Ник: 2–16 символов (буквы, цифры, _ - пробел)');
  let admin = false;
  if (auth.isAdminNick(nick)) { // права — только после серверной проверки пароля
    const r = auth.authorize(m.password, ip);
    if (!r.ok) return fail(r.error);
    admin = true;
  }
  const old = [...players.values()].find(p => p.nick.toLowerCase() === nick.toLowerCase());
  if (old) {
    if (admin || (m.token && m.token === old.token)) { players.delete(old.id); old.ws.p = null; old.ws.close(4000, 'replaced'); }
    else return fail('Этот ник уже занят');
  }
  if (players.size >= MAX) return fail('Комната заполнена');
  const used = new Set([...players.values()].map(p => p.slot)), usedC = [...players.values()].map(p => p.color.toLowerCase());
  let slot = 0; while (used.has(slot)) slot++;
  const want = typeof m.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color.toLowerCase() : null;
  const color = want && !usedC.includes(want) ? want : COLORS.find(c => !usedC.includes(c)) || COLORS[slot % COLORS.length];
  const skin = Math.max(0, Math.min(SKINS - 1, Number.isInteger(m.skin) ? m.skin : 0));
  const spec = !!m.watch; // наблюдатель: не участвует в заезде, камера следует за лидером
  const p = { id: nextId++, nick, admin, ws, color, skin, slot, spec, token: crypto.randomBytes(12).toString('hex'), car: P.createCar(), input: NONE, inT: 0, tp: 0 };
  race.initPlayer(p); race.place(p, P.gridPos(slot));
  ws.p = p; players.set(p.id, p);
  send(ws, { t: 'welcome', id: p.id, token: p.token, admin, color, skin, spec, laps: LAPS,
    results: race.state === ST.RESULTS ? race.results : null, replay: race.state === ST.RESULTS ? lastReplay : null });
  notice(`${nick} подключился${spec ? ' (наблюдатель)' : ''}`, p);
  pushPlayers();
}

function adminCmd(p, cmd) {
  const arr = [...players.values()].filter(p => !p.spec), now = Date.now(); // наблюдатели не участвуют в заезде
  const r = {
    start: () => race.start(arr, now), restart: () => race.restart(arr, now), grid: () => race.grid(arr),
    finish: () => race.finish(arr, now, false), force: () => race.finish(arr, now, true),
  }[cmd];
  if (!r) return;
  const msgs = { start: 'Заезд начинается!', restart: 'Заезд перезапущен: все на старте', grid: 'Все возвращены на старт', finish: 'Администратор завершает заезд', force: 'Заезд принудительно завершён' };
  if (r()) bcast({ t: 'notice', msg: msgs[cmd] });
  else send(p.ws, { t: 'notice', msg: 'Команда недоступна в текущем состоянии заезда (' + race.state + ')' });
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || '?';
  ws.alive = true; ws.cnt = 0;
  ws.on('pong', () => { ws.alive = true; });
  const rl = setInterval(() => { ws.cnt = 0; }, 1000);
  ws.on('message', raw => {
    if (++ws.cnt > 120) return ws.close(1008, 'rate');
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'join') return join(ws, m, ip);
    if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c });
    const p = ws.p; if (!p) return;
    if (m.t === 'input') { if (!p.spec) { p.input = { up: !!m.up, down: !!m.down, left: !!m.left, right: !!m.right, hb: !!m.hb, st: typeof m.st === 'number' && isFinite(m.st) ? Math.max(-1, Math.min(1, m.st)) : undefined }; p.inT = Date.now(); } }
    else if (m.t === 'respawn') { if (!p.spec && (race.state === ST.RACING || race.state === ST.FINISHING)) race.respawn(p); }
    else if (m.t === 'admin') { if (p.admin) adminCmd(p, m.cmd); } // права проверяются на сервере при КАЖДОЙ команде
  });
  ws.on('close', () => {
    clearInterval(rl);
    const p = ws.p;
    if (p && players.get(p.id) === p) { players.delete(p.id); notice(`${p.nick} отключился`); pushPlayers(); }
  });
  ws.on('error', () => {});
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); } }, 10000);
setInterval(pushPlayers, 5000);

// ---- симуляция: фиксированный шаг 1/60, рассылка снимков 30 Гц ----
const STEP = 1 / 60; let acc = 0, last = Date.now(), lastState = race.state;
let rec = [], finishRec = null, lastReplay = null; // кольцевой буфер для повтора финиша (~10 с при 15 кадрах/с)
setInterval(() => {
  const now = Date.now(); acc += Math.min(0.1, (now - last) / 1000); last = now;
  const arr = [...players.values()], racers = arr.filter(p => !p.spec), ev = [], locked = race.locked(), act = race.active();
  const frozen = locked || race.state === ST.WAITING || race.state === ST.RESULTS; // до старта администратора никто не едет
  while (acc >= STEP) {
    acc -= STEP;
    for (const p of arr) {
      const inp = frozen || now - p.inT > 600 ? NONE : p.input;
      P.step(p.car, inp, STEP);
      if (p.car.hit > 40) ev.push([Math.round(p.car.x), Math.round(p.car.y), Math.min(1, p.car.hit / 500)]);
      p.car.hit = 0;
    }
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      if (a.spec || b.spec) continue; // наблюдатели — призраки
      if (act && !(a.rc.in && b.rc.in)) continue; // «призраки» (зашли во время заезда) не сталкиваются
      const imp = P.collide(a.car, b.car);
      if (imp > 40) ev.push([Math.round(a.car.x), Math.round(a.car.y), Math.min(1, imp / 500)]);
    }
  }
  if (!frozen) { // запись повтора: 15 кадров/с, хвост ~10 с
    if (!rec.length || now - rec[rec.length - 1][0] >= 66) {
      rec.push([now, racers.map(p => [p.id, Math.round(p.car.x), Math.round(p.car.y), Math.round(p.car.a * 100) / 100])]);
      if (rec.length > 150) rec.shift();
    }
  }
  race.update(arr, now);
  if (race.state !== lastState) {
    lastState = race.state;
    if (race.state === ST.FINISHING && !finishRec && rec.length) finishRec = rec.slice(); // повтор заканчивается моментом финиша
    if (race.state === ST.RESULTS) {
      if (!finishRec && rec.length > 2) finishRec = rec.slice(); // заезд завершился сразу (один игрок / принудительно)
      const w = race.results[0];
      lastReplay = finishRec && finishRec.length > 2 ? { winner: w ? w.id : 0, frames: finishRec } : null;
      bcast({ t: 'results', list: race.results, replay: lastReplay });
      finishRec = null;
    }
    if (race.state === ST.PREPARING || race.state === ST.WAITING) { rec = []; finishRec = null; lastReplay = null; }
  }
  if (!arr.length) return;
  const cars = racers.map(p => {
    const c = p.car, rc = p.rc, r1 = v => Math.round(v * 10) / 10;
    return { i: p.id, x: r1(c.x), y: r1(c.y), a: Math.round(c.a * 1000) / 1000, vx: r1(c.vx), vy: r1(c.vy), w: Math.round(c.w * 100) / 100, s: Math.round(c.slip * 100) / 100, ws: Math.round(c.spin * 100) / 100,
      cp: rc.cps, th: !frozen && now - p.inT <= 600 && p.input.up ? 1 : 0,
      tp: p.tp, l: rc.lap, p: rc.pos, b: rc.best, ls: rc.lapStart ? rc.lapStart - race.raceStart : 0, f: rc.finish, r: rc.in ? 1 : 0 };
  });
  const racing = race.state === ST.RACING || race.state === ST.FINISHING;
  bcast({ t: 'snap', st: now, state: race.state, laps: LAPS, cars, ev,
    cd: race.state === ST.COUNTDOWN ? Math.max(0, 3000 - (now - race.t0)) : 0,
    rt: racing || race.state === ST.RESULTS ? now - race.raceStart : 0,
    fd: race.state === ST.FINISHING ? Math.max(0, race.deadline - now) : 0 });
}, 33);

server.listen(PORT, () => {
  console.log(`TOP SPEED ONLINE: http://localhost:${PORT}`);
  if (!auth.hasPassword()) console.warn('ВНИМАНИЕ: ADMIN_PASSWORD не задан — вход администратора (ник ' + auth.ADMIN_NICK + ') отключён. См. README.');
});
