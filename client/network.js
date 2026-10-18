// Сетевой слой: WebSocket, статусы, автопереподключение, измерение пинга.
class Net {
  constructor(h) { this.h = h; this.ws = null; this.rtt = 0; this.retry = 0; this.want = false; this.joined = false; this.ever = false; this.token = null; this.info = null; this.pingT = null; }
  connect(info) { this.info = info; this.want = true; this.ever = false; this.retry = 0; this.open(); }
  open() {
    this.h.status(this.retry ? 'reconnecting' : 'connecting');
    let ws;
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host); }
    catch { this.want = false; this.h.status('unavailable'); return; }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', ...this.info, token: this.token }));
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') {
        this.token = m.token; this.joined = true; this.ever = true; this.retry = 0;
        this.h.status('connected'); this.pingT = setInterval(() => this.send({ t: 'ping', c: Date.now() }), 2000);
        this.send({ t: 'ping', c: Date.now() });
      } else if (m.t === 'pong') { this.rtt = Date.now() - m.c; return; }
      else if (m.t === 'error') { this.want = false; ws.close(); }
      this.h.msg(m);
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      this.joined = false; clearInterval(this.pingT);
      if (!this.want) return;
      if (!this.ever) { this.want = false; this.h.status('unavailable'); return; } // сервер так и не ответил
      this.h.status('lost');
      if (++this.retry > 12) { this.want = false; this.h.status('unavailable'); this.h.dropped(); return; }
      setTimeout(() => { if (this.want) this.open(); }, Math.min(5000, 500 * this.retry));
    };
    ws.onerror = () => {};
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  leave() { this.want = false; this.joined = false; clearInterval(this.pingT); if (this.ws) this.ws.close(); this.ws = null; this.token = null; }
}
