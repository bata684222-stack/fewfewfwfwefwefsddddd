// Общий модуль: трасса + физика машины. Работает и в браузере, и в Node (сервер авторитетен).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Physics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Контрольные точки сплайна (замкнутая трасса, по часовой стрелке). Старт — на прямой между CTRL[1] и CTRL[2].
  const CTRL = [[500, 2000], [1300, 2000], [2100, 2000], [2900, 2000], [3350, 1700], [3350, 1200], [3000, 850], [2500, 900],
    [2150, 1150], [1800, 1000], [1500, 650], [1000, 450], [500, 550], [250, 900], [250, 1500], [330, 1850]].map(p => [p[0] * 3, p[1] * 3]);
  const S = 24, NC = CTRL.length, N = NC * S, START = S;
  const ROAD_HW = 80, WALL = 130, CAR_R = 18;
  const X = new Float64Array(N), Y = new Float64Array(N), ANG = new Float64Array(N), L = new Float64Array(N + 1);

  for (let i = 0; i < NC; i++) {
    const p0 = CTRL[(i + NC - 1) % NC], p1 = CTRL[i], p2 = CTRL[(i + 1) % NC], p3 = CTRL[(i + 2) % NC];
    for (let j = 0; j < S; j++) {
      const t = j / S, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      X[i * S + j] = f(p0[0], p1[0], p2[0], p3[0]);
      Y[i * S + j] = f(p0[1], p1[1], p2[1], p3[1]);
    }
  }
  for (let k = 0; k < N; k++) {
    const a = (k + N - 1) % N, b = (k + 1) % N;
    ANG[k] = Math.atan2(Y[b] - Y[a], X[b] - X[a]);
    L[k + 1] = L[k] + Math.hypot(X[b] - X[k], Y[b] - Y[k]);
  }
  const TL = L[N];

  // Ближайшая точка осевой линии: индекс сегмента, расстояние, точка.
  function nearest(x, y) {
    let best = 1e18, bk = 0, bt = 0;
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N, ax = X[k], ay = Y[k], dx = X[k2] - ax, dy = Y[k2] - ay;
      let t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t - x, py = ay + dy * t - y, d2 = px * px + py * py;
      if (d2 < best) { best = d2; bk = k; bt = t; }
    }
    const k2 = (bk + 1) % N;
    return { k: bk, t: bt, d: Math.sqrt(best), cx: X[bk] + (X[k2] - X[bk]) * bt, cy: Y[bk] + (Y[k2] - Y[bk]) * bt };
  }

  // Точка на осевой линии на расстоянии arc (px) от стартовой линии (отрицательное — позади).
  function at(arc) {
    const s = (((L[START] + arc) % TL) + TL) % TL;
    let k = 0; while (k < N - 1 && L[k + 1] <= s) k++;
    const k2 = (k + 1) % N, t = (s - L[k]) / (L[k + 1] - L[k] || 1);
    return { x: X[k] + (X[k2] - X[k]) * t, y: Y[k] + (Y[k2] - Y[k]) * t, a: ANG[k] };
  }
  // Стартовая решётка: 2 машины в ряд, ряды позади линии.
  function gridPos(slot) {
    const row = slot >> 1, off = (slot & 1 ? 1 : -1) * 30, p = at(-(70 + row * 75));
    p.x += -Math.sin(p.a) * off; p.y += Math.cos(p.a) * off;
    return p;
  }

  const createCar = () => ({ x: 0, y: 0, a: 0, vx: 0, vy: 0, w: 0, st: 0, spin: 0, slip: 0, hit: 0 });

  // Один шаг физики. inp: {up,down,left,right,hb,st}. Угол растёт по часовой (ось Y вниз).
  function step(car, inp, dt) {
    const c = Math.cos(car.a), s = Math.sin(car.a);
    let vf = car.vx * c + car.vy * s, vl = -car.vx * s + car.vy * c; // продольная и боковая скорость
    const road = nearest(car.x, car.y).d <= ROAD_HW + 6;
    if (inp.up) vf += 900 * dt;                                              // газ
    if (inp.down) { if (vf > 20) vf = Math.max(0, vf - 1500 * dt); else if (vf > -170) vf -= 450 * dt; } // тормоз / задний ход
    if (inp.hb) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 150 * dt);     // ручник
    vf -= vf * (road ? 1.45 : 4.2) * dt;                                     // сопротивление (трава сильнее)
    if (Math.abs(vf) < 4 && !inp.up && !inp.down) vf = 0;
    let grip = road ? (Math.abs(vl) > 240 ? 3.6 : 7.2) : 3.2;                // сцепление падает при сильном скольжении
    if (inp.hb) grip = 1.0;                                                  // занос
    const nvl = vl * Math.exp(-grip * dt);
    vf -= Math.abs(vl - nvl) * 0.1 * Math.sign(vf);                          // потеря скорости в поворотах
    vl = nvl;
    const target = typeof inp.st === 'number' ? Math.max(-1, Math.min(1, inp.st)) : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    car.st = typeof inp.st === 'number' ? target : car.st + (target - car.st) * Math.min(1, 12 * dt); // плавный руль для клавиш
    car.spin = inp.up && Math.abs(vf) < 160 && vf > -5 ? Math.min(1, car.spin + 3 * dt) : Math.max(0, car.spin - 4 * dt); // пробуксовка
    const av = Math.abs(vf);
    const sf = Math.min(1, av / 160) * (1 - 0.35 * Math.min(1, av / 650));
    const slide = 1 + 0.2 * Math.min(1, Math.abs(vl) / 300);                 // в заносе руль острее
    const tw = car.st * 2.8 * sf * slide * (vf < 0 ? -1 : 1) * (inp.hb ? 1.4 : 1);
    car.w += (tw - car.w) * Math.min(1, 9 * dt);                             // угловая скорость с инерцией
    car.slip = Math.max(0, Math.min(1, (Math.abs(vl) - 80) / 200));
    car.vx = vf * c - vl * s; car.vy = vf * s + vl * c;
    car.a += car.w * dt; car.x += car.vx * dt; car.y += car.vy * dt;
    // отбойники
    const n = nearest(car.x, car.y), lim = WALL - CAR_R;
    if (n.d > lim && n.d > 0) {
      const nx = (car.x - n.cx) / n.d, ny = (car.y - n.cy) / n.d;
      car.x = n.cx + nx * lim; car.y = n.cy + ny * lim;
      const vn = car.vx * nx + car.vy * ny;
      if (vn > 0) {
        car.vx -= 1.35 * vn * nx; car.vy -= 1.35 * vn * ny;
        car.vx *= 0.93; car.vy *= 0.93; car.w *= 0.7; car.hit = Math.max(car.hit, vn);
      }
    }
  }

  // Столкновение двух машин (круги). Возвращает силу удара.
  function collide(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy, R = CAR_R * 2;
    if (d2 >= R * R || d2 < 1e-6) return 0;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = R - d;
    a.x -= nx * ov / 2; a.y -= ny * ov / 2; b.x += nx * ov / 2; b.y += ny * ov / 2;
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv >= 0) return 0;
    const j = -(1.45) * rv / 2;
    a.vx -= j * nx; a.vy -= j * ny; b.vx += j * nx; b.vy += j * ny;
    return -rv;
  }

  return { X, Y, ANG, N, S, START, ROAD_HW, WALL, CAR_R, nearest, at, gridPos, createCar, step, collide };
});
