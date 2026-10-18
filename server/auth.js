'use strict';
// Авторизация администратора. Пароль хранится только на сервере (переменная ADMIN_PASSWORD / файл .env).
const crypto = require('crypto'), fs = require('fs'), path = require('path');

try { // мини-загрузчик .env (без зависимостей)
  for (const l of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env необязателен */ }

const ADMIN_NICK = (process.env.ADMIN_NICK || 'stleri').toLowerCase();
const PASS = process.env.ADMIN_PASSWORD || '';
const digest = s => crypto.createHash('sha256').update(String(s)).digest();
const fails = new Map(); // ip -> {n, until}

const isAdminNick = nick => String(nick).trim().toLowerCase() === ADMIN_NICK;
const hasPassword = () => PASS.length > 0;

// Ник — не секрет: права выдаются только при верном пароле. Защита от перебора по IP.
function authorize(password, ip) {
  if (!PASS) return { ok: false, error: 'На сервере не задан ADMIN_PASSWORD — вход администратора отключён' };
  const f = fails.get(ip) || { n: 0, until: 0 };
  if (Date.now() < f.until) return { ok: false, error: 'Слишком много попыток. Подождите минуту' };
  const ok = crypto.timingSafeEqual(digest(password || ''), digest(PASS));
  if (ok) { fails.delete(ip); return { ok: true }; }
  f.n++; if (f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; }
  fails.set(ip, f);
  return { ok: false, error: 'Неверный пароль администратора' };
}
module.exports = { isAdminNick, authorize, hasPassword, ADMIN_NICK };
