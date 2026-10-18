'use strict';
// Логика заезда на сервере: состояния, контрольные точки, круги, позиции, результаты.
const P = require('../client/physics.js');
const LAPS = Math.max(1, +process.env.LAPS || 3), NCP = 8, SEG = P.N / NCP;
const ST = { WAITING: 'waiting', PREPARING: 'preparing', COUNTDOWN: 'countdown', RACING: 'racing', FINISHING: 'finishing', RESULTS: 'results' };

class Race {
  constructor() { this.state = ST.WAITING; this.t0 = Date.now(); this.raceStart = 0; this.deadline = 0; this.log = []; this.results = []; }
  set(s, now) { this.state = s; this.t0 = now; }
  locked() { return this.state === ST.PREPARING || this.state === ST.COUNTDOWN; }
  active() { return this.state !== ST.WAITING && this.state !== ST.RESULTS; }
  initPlayer(p) { p.rc = { next: 1, cps: 0, lap: 0, lapStart: 0, best: 0, finish: 0, rr: 0, pos: 0, score: 0, in: false }; }
  place(p, g) { Object.assign(p.car, { x: g.x, y: g.y, a: g.a, vx: 0, vy: 0, w: 0, slip: 0, hit: 0 }); p.tp = (p.tp + 1) & 255; }
  toGrid(players) { for (const p of players) this.place(p, P.gridPos(p.slot)); }
  respawn(p) { // на последнюю пройденную контрольную точку
    if (this.locked()) return;
    const i = (P.START + (p.rc.next - 1) * SEG) % P.N;
    this.place(p, { x: P.X[i], y: P.Y[i], a: P.ANG[i] });
  }

  // ---- команды администратора (возвращают true при успехе) ----
  start(players, now) {
    if (this.state !== ST.WAITING && this.state !== ST.RESULTS) return false;
    if (!players.length) return false;
    this.log = []; this.results = [];
    for (const p of players) { this.initPlayer(p); p.rc.in = true; }
    this.toGrid(players); this.set(ST.PREPARING, now); return true;
  }
  restart(players, now) {
    this.log = []; this.results = [];
    for (const p of players) this.initPlayer(p);
    this.toGrid(players); this.set(ST.WAITING, now); return true;
  }
  grid(players) { if (this.active()) return false; this.toGrid(players); return true; }
  finish(players, now, force) {
    if (this.state === ST.RACING && !force) { this.set(ST.FINISHING, now); this.deadline = now + 15000; return true; }
    if (this.state === ST.RACING || this.state === ST.FINISHING) { this.toResults(players, now); return true; }
    if (force && this.locked()) return this.restart(players, now); // отмена до старта
    return false;
  }
  toResults(players, now) {
    const dnf = players.filter(p => p.rc.in && !p.rc.finish).sort((a, b) => b.rc.score - a.rc.score)
      .map(p => ({ id: p.id, nick: p.nick, time: 0, best: p.rc.best, laps: p.rc.lap, dnf: true }));
    this.results = [...this.log, ...dnf].map((r, i) => ({ ...r, pos: i + 1 }));
    this.set(ST.RESULTS, now);
  }

  // ---- прогресс по контрольным точкам (только в правильном порядке) ----
  progress(p, now) {
    const rc = p.rc; if (rc.finish) return;
    const n = P.nearest(p.car.x, p.car.y);
    const r = (((n.k - P.START) % P.N) + P.N) % P.N;
    const tgt = rc.next * SEG;
    let rr = r; if (rc.next === NCP && r < P.N / 4) rr += P.N;
    rc.rr = rr;
    if (rr >= tgt && rr < tgt + P.N / 4) {
      rc.cps++;
      if (rc.next === NCP) { // пересечение финиша после всех КП = круг
        const lt = now - rc.lapStart; rc.lap++; rc.lapStart = now; rc.next = 1;
        if (!rc.best || lt < rc.best) rc.best = lt;
        if (rc.lap >= LAPS) { rc.finish = now - this.raceStart; this.log.push({ id: p.id, nick: p.nick, time: rc.finish, best: rc.best, laps: rc.lap }); }
      } else rc.next++;
    }
  }
  rank(part) {
    for (const p of part) {
      const rc = p.rc;
      if (rc.finish) { rc.score = 1e6 - rc.finish; continue; }
      const d = rc.next * SEG - rc.rr;
      rc.score = rc.cps + ((d < -SEG || d > SEG) ? 0 : Math.min(1, Math.max(0, 1 - d / SEG)));
    }
    part.slice().sort((a, b) => b.rc.score - a.rc.score).forEach((p, i) => { p.rc.pos = i + 1; });
  }

  update(players, now) {
    if (this.state === ST.PREPARING && now - this.t0 > 1500) this.set(ST.COUNTDOWN, now);
    else if (this.state === ST.COUNTDOWN && now - this.t0 >= 3000) {
      this.set(ST.RACING, now); this.raceStart = now;
      for (const p of players) if (p.rc.in) p.rc.lapStart = now;
    }
    if (this.state === ST.RACING || this.state === ST.FINISHING) {
      const part = players.filter(p => p.rc.in);
      if (!part.length) { this.set(ST.WAITING, now); return; }
      for (const p of part) this.progress(p, now);
      this.rank(part);
      if (this.state === ST.RACING && part.some(p => p.rc.finish)) { this.state = ST.FINISHING; this.deadline = now + 20000; }
      if (part.every(p => p.rc.finish) || (this.state === ST.FINISHING && now > this.deadline)) this.toResults(players, now);
    }
  }
}
module.exports = { Race, ST, LAPS, NCP };
