/* ===========================================
   BPLEONE TRADING - DISCORD WEBHOOK ALERTS
   ---
   Pushes high-conviction signals to a Discord
   webhook configured in account.html.
   ---
   Public API:
     DiscordAlerts.url()                -> stored webhook URL or ''
     DiscordAlerts.fire(message, opts?) -> POST a plain message
     DiscordAlerts.signal({ sym, setup, score, last, bias, reason })
     DiscordAlerts.tradeOpened(trade)
     DiscordAlerts.tradeClosed(trade)
     DiscordAlerts.shouldFire('signal'|'trade')  -> respect mute / dedup
   =========================================== */

const DiscordAlerts = (function () {
  const RATE_KEY = 'bpleone_discord_dedup_v1';

  function url() {
    try {
      const raw = localStorage.getItem('bpleone_account_v1');
      if (!raw) return '';
      const obj = JSON.parse(raw);
      return obj.discord || '';
    } catch (e) { return ''; }
  }

  function dedupOk(key, ttlMs) {
    try {
      const raw = localStorage.getItem(RATE_KEY);
      const db = raw ? JSON.parse(raw) : {};
      const now = Date.now();
      // expire old
      Object.keys(db).forEach(k => { if (db[k] < now) delete db[k]; });
      if (db[key]) return false;
      db[key] = now + (ttlMs || 60 * 60 * 1000); // 1h default
      localStorage.setItem(RATE_KEY, JSON.stringify(db));
      return true;
    } catch (e) { return true; }
  }

  async function fire(content, opts) {
    opts = opts || {};
    const u = url();
    if (!u) return { ok: false, reason: 'no-webhook' };
    if (opts.dedupKey && !dedupOk(opts.dedupKey, opts.dedupTtl)) return { ok: false, reason: 'deduped' };
    try {
      const body = opts.embed ? JSON.stringify({ embeds: [opts.embed] }) : JSON.stringify({ content });
      const res = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, reason: 'network', error: e.message };
    }
  }

  function signal(s) {
    if (!s || !s.sym) return;
    const dedupKey = 'sig:' + s.sym + ':' + (s.setup || 'tag');
    const reasons = Array.isArray(s.reasons) ? s.reasons.join(' · ') : (s.reason || '');
    const embed = {
      title: '⚡ Signal · ' + s.sym + ' · ' + (s.bias === 'bull' ? '▲ LONG' : s.bias === 'bear' ? '▼ SHORT' : '•'),
      description: '**' + (s.setup || 'signal') + '** · adj-score ' + (s.score != null ? s.score.toFixed(2) : '?') + '\n' + reasons,
      color: s.bias === 'bull' ? 0x10b981 : s.bias === 'bear' ? 0xef4444 : 0x00d4ff,
      fields: [
        { name: 'Last', value: '$' + (s.last != null ? s.last.toFixed(2) : '?'), inline: true },
        { name: 'Stop', value: s.stop != null ? '$' + s.stop.toFixed(2) : '—', inline: true },
        { name: 'Target', value: s.target != null ? '$' + s.target.toFixed(2) : '—', inline: true }
      ],
      footer: { text: 'options.bpleone.com · self-learning desk' },
      timestamp: new Date().toISOString()
    };
    return fire('', { embed, dedupKey, dedupTtl: 60 * 60 * 1000 });
  }

  function tradeOpened(t) {
    if (!t) return;
    const embed = {
      title: '🟢 Trade opened · ' + t.symbol,
      description: '**' + (t.setup || 'unknown setup') + '** · ' + (t.bias === 'bull' ? 'LONG' : 'SHORT'),
      color: 0x10b981,
      fields: [
        { name: 'Entry', value: '$' + (+t.entry).toFixed(2), inline: true },
        { name: 'Stop', value: '$' + (+t.stop).toFixed(2), inline: true },
        { name: 'Risk', value: (Math.abs((+t.entry - +t.stop) / +t.entry) * 100).toFixed(2) + '%', inline: true }
      ],
      timestamp: new Date().toISOString()
    };
    return fire('', { embed });
  }

  function tradeClosed(t) {
    if (!t || t.R == null) return;
    const win = t.R >= 0;
    const embed = {
      title: (win ? '✅' : '🔻') + ' Trade closed · ' + t.symbol + ' · ' + (t.R >= 0 ? '+' : '') + t.R.toFixed(2) + 'R',
      description: '**' + (t.setup || 'unknown') + '** · ' + (t.closeReason || 'manual'),
      color: win ? 0x10b981 : 0xef4444,
      fields: [
        { name: 'Entry → Exit', value: '$' + (+t.entry).toFixed(2) + ' → $' + (+t.exit).toFixed(2), inline: true },
        { name: 'Hold', value: t.holdDays != null ? (t.holdDays < 1 ? (t.holdDays * 24).toFixed(1) + 'h' : t.holdDays.toFixed(1) + 'd') : '—', inline: true },
        { name: 'MFE / Eff', value: (t.mfeR != null ? '+' + t.mfeR.toFixed(2) + 'R' : '—') + (t.efficiency != null ? ' · ' + (t.efficiency * 100).toFixed(0) + '%' : ''), inline: true }
      ],
      timestamp: new Date().toISOString()
    };
    return fire('', { embed });
  }

  return { url, fire, signal, tradeOpened, tradeClosed, dedupOk };
})();

if (typeof window !== 'undefined') window.DiscordAlerts = DiscordAlerts;
