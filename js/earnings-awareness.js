/* ===========================================
   BPLEONE — Earnings Awareness
   ---
   Brokers run on quarterly earnings cycles. If an open auto-trade
   crosses an earnings date during its hold window, the IV crush
   (or pump) on the announcement can swamp the brain's directional
   edge. This module flags those situations.

   Without a real earnings calendar API, we use:
     - Built-in static table of typical earnings WEEKS per ticker
       (calibrated from historical Q4 2024 / Q1 2025 patterns)
     - Looks ahead a configurable horizon (default 14 days)
     - Returns "in_window" + "estimated_date" per ticker

   Brandon can also manually override earnings dates by storing
   { 'NVDA': '2026-05-21' } in localStorage 'bpleone_manual_earnings_v1'.

   Exposes:
     EarningsAwareness.nextEarnings(sym) -> { date, daysOut, source }
     EarningsAwareness.checkOpenTrades() -> [{ trade, earnings, severity }]
     EarningsAwareness.warnings() -> array of strings
   =========================================== */

(function () {
  const MANUAL_KEY = 'bpleone_manual_earnings_v1';

  // Static typical-earnings-month patterns (Q1=Feb, Q2=May, Q3=Aug, Q4=Nov pattern)
  // For each ticker, list approximate week-of-month historically: { month: 'Feb', week: 3 }
  // Months are 1-indexed. Calibrated against the major reporting cycles.
  const PATTERNS = {
    NVDA: { months: [2, 5, 8, 11], week: 4 },   // ~late month
    AAPL: { months: [1, 4, 7, 10], week: 5 },   // last week of Jan/Apr/Jul/Oct
    MSFT: { months: [1, 4, 7, 10], week: 4 },
    GOOGL:{ months: [1, 4, 7, 10], week: 4 },
    META: { months: [1, 4, 7, 10], week: 5 },
    AMZN: { months: [1, 4, 7, 10], week: 5 },
    AMD:  { months: [1, 4, 7, 10], week: 5 },
    SMCI: { months: [2, 5, 8, 11], week: 1 },
    TSLA: { months: [1, 4, 7, 10], week: 4 },
    NFLX: { months: [1, 4, 7, 10], week: 3 },
    CRM:  { months: [2, 5, 8, 11], week: 4 },
    SHOP: { months: [2, 5, 8, 11], week: 2 },
    COIN: { months: [2, 5, 8, 11], week: 2 },
    BABA: { months: [2, 5, 8, 11], week: 3 },
    UBER: { months: [2, 5, 8, 11], week: 2 },
    PLTR: { months: [2, 5, 8, 11], week: 1 },
    // ETFs & crypto don't report earnings
    SPY: null, QQQ: null, IWM: null, DIA: null, XLE: null, GLD: null, SLV: null,
    BTC: null, ETH: null
  };

  function loadManual() {
    if (typeof localStorage === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(MANUAL_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveManual(m) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(MANUAL_KEY, JSON.stringify(m)); } catch (e) {}
  }
  function setManual(sym, dateStr) {
    const m = loadManual();
    if (dateStr) m[sym] = dateStr; else delete m[sym];
    saveManual(m);
  }

  function nextEarnings(sym) {
    const manual = loadManual();
    if (manual[sym]) {
      const d = new Date(manual[sym]);
      if (!isNaN(d.getTime())) {
        const daysOut = (d.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
        if (daysOut > -2) return { date: d, daysOut: +daysOut.toFixed(1), source: 'manual' };
      }
    }
    const p = PATTERNS[sym];
    if (!p) return null;
    // Find next month in cycle from today
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();
    let next = null;
    for (let yr of [curYear, curYear + 1]) {
      for (let mIdx of p.months) {
        // Estimate "week of month" by mapping week 1-5 to days 5/12/19/26/29
        const dayOfMonth = Math.min(28, Math.max(1, p.week * 7 - 3));
        const candidate = new Date(yr, mIdx - 1, dayOfMonth);
        if (candidate.getTime() > now.getTime() - 2 * 86400000) {
          if (!next || candidate.getTime() < next.getTime()) next = candidate;
        }
      }
      if (next) break;
    }
    if (!next) return null;
    const daysOut = (next.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    return { date: next, daysOut: +daysOut.toFixed(1), source: 'pattern' };
  }

  function checkOpenTrades() {
    if (typeof window === 'undefined' || !window.AutoTrade) return [];
    const open = window.AutoTrade.openTrades();
    const out = [];
    for (const t of open) {
      const e = nextEarnings(t.sym);
      if (!e) continue;
      // Does the earnings date fall before our timeStop?
      const earningsMs = e.date.getTime();
      const inWindow = earningsMs <= t.timeStop && earningsMs >= Date.now() - 86400000;
      if (!inWindow) continue;
      const severity = e.daysOut < 1 ? 'critical' : e.daysOut < 3 ? 'high' : 'medium';
      out.push({ trade: t, earnings: e, severity });
    }
    return out;
  }

  function warnings() {
    const checks = checkOpenTrades();
    return checks.map(c => {
      const sev = c.severity === 'critical' ? '🚨 CRITICAL' : c.severity === 'high' ? '⚠ HIGH' : '⚡ MEDIUM';
      // Audit pass 78 (fix #7): old code said "today (already!)" for every
      // daysOut < 0 — but that fires for events up to 2 days in the past
      // (the nextEarnings filter is `> now - 2 * 86400000`). Be honest about
      // what we actually mean: <0.5 days = imminent or today; otherwise we
      // give the actual signed days.
      const d = c.earnings.daysOut;
      let whenStr;
      if (d < -0.5)       whenStr = (-d).toFixed(1) + 'd ago (recent — IV crush already played out)';
      else if (d < 0.5)   whenStr = 'today / imminent';
      else                whenStr = 'in ~' + d.toFixed(1) + 'd';
      return sev + ' — ' + c.trade.sym + ' has earnings ' + whenStr + '. Position closes ' + new Date(c.trade.timeStop).toLocaleString() + '. Consider tightening stop, taking partial, or exiting pre-event.';
    });
  }

  window.EarningsAwareness = { nextEarnings, checkOpenTrades, warnings, setManual, PATTERNS };
})();
