/* ===========================================
   BPLEONE — Voice Trade Coach
   ---
   Speaks high-conviction signals aloud using the Web Speech API.
   Hooks into HighConvictionAlerts: every time a new alert is added
   to the feed, the coach reads a short headline aloud.

   Sample utterance: "NVDA long, 78 percent, suggested risk 400 dollars."

   User can:
     - Enable/disable speech
     - Pick voice (browser-provided list)
     - Adjust speech rate / pitch / volume
     - Mute during a window (e.g. 12am-7am ET)

   Falls back silently if SpeechSynthesis isn't supported.

   Exposes:
     VoiceCoach.enable() / disable() / isEnabled()
     VoiceCoach.config(opts) / getConfig()
     VoiceCoach.speak(text) - manual trigger
     VoiceCoach.test() - sample utterance
     VoiceCoach.voices() - list available voices
   =========================================== */

(function () {
  const KEY = 'bpleone_voice_coach_v1';

  const DEFAULTS = {
    enabled: false,        // user must opt-in (autoplay rules)
    rate: 1.05,
    pitch: 1.0,
    volume: 0.85,
    voiceName: '',         // empty = browser default
    quietStart: 22,        // 10pm
    quietEnd: 7,           // 7am
    quietEnabled: false,
    speakRegime: false     // include regime in utterance
  };

  function load() {
    if (typeof localStorage === 'undefined') return Object.assign({}, DEFAULTS);
    try {
      const j = localStorage.getItem(KEY);
      if (!j) return Object.assign({}, DEFAULTS);
      return Object.assign({}, DEFAULTS, JSON.parse(j));
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save(c) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
  }

  function supported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }
  function isEnabled() { return load().enabled && supported(); }
  function enable() { const c = load(); c.enabled = true; save(c); return c; }
  function disable() { const c = load(); c.enabled = false; save(c); try { window.speechSynthesis.cancel(); } catch (e) {} return c; }
  function getConfig() { return load(); }
  function config(opts) { const c = Object.assign(load(), opts || {}); save(c); return c; }

  function voices() {
    if (!supported()) return [];
    try {
      const list = window.speechSynthesis.getVoices() || [];
      return list.map(v => ({ name: v.name, lang: v.lang, default: v.default, localService: v.localService }));
    } catch (e) { return []; }
  }

  function inQuiet(c) {
    if (!c.quietEnabled) return false;
    const h = new Date().getHours();
    if (c.quietStart === c.quietEnd) return false;
    if (c.quietStart < c.quietEnd) {
      return h >= c.quietStart && h < c.quietEnd;
    }
    // Wrap (e.g., 22 -> 7)
    return h >= c.quietStart || h < c.quietEnd;
  }

  function speak(text, opts) {
    if (!supported()) return false;
    const c = load();
    if (!c.enabled) return false;
    if (inQuiet(c)) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = (opts && opts.rate) || c.rate;
      u.pitch = (opts && opts.pitch) || c.pitch;
      u.volume = (opts && typeof opts.volume === 'number') ? opts.volume : c.volume;
      if (c.voiceName) {
        const list = window.speechSynthesis.getVoices() || [];
        const v = list.find(v => v.name === c.voiceName);
        if (v) u.voice = v;
      }
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  function speakAlert(alert) {
    if (!alert) return;
    const c = load();
    const conf = Math.round((alert.conviction || 0) * 100);
    const sym = (alert.sym || '').split('').join(' ');  // letter-by-letter so SPY -> "S P Y"
    let txt = sym + ', ' + (alert.direction || '') + ', ' + conf + ' percent';
    if (alert.riskDollars) txt += ', suggested risk ' + alert.riskDollars + ' dollars';
    if (c.speakRegime && alert.regime) txt += ', regime ' + alert.regime;
    speak(txt);
  }

  function test() {
    speak('Voice coach ready. N V D A long, 80 percent, suggested risk 200 dollars.');
  }

  // Hook: poll HighConvictionAlerts feed; when totalAlerts grows, speak the newest.
  let lastSeenTotal = 0;
  function startHook() {
    if (typeof window === 'undefined') return;
    if (window._voiceCoachHook) return;
    window._voiceCoachHook = setInterval(() => {
      try {
        if (!window.HighConvictionAlerts) return;
        if (!isEnabled()) return;
        // Compare total alerts to detect new ones
        const feed = window.HighConvictionAlerts.feed(5);
        if (!feed || feed.length === 0) return;
        const newest = feed[0];
        if (!newest || !newest.ts) return;
        // Use timestamp gating: only speak alerts from last 60s and not already spoken
        const age = Date.now() - newest.ts;
        if (age > 60 * 1000) return;
        const sig = newest.sourceJournalId || (newest.sym + '-' + newest.ts);
        if (window._voiceCoachLastSpoke === sig) return;
        window._voiceCoachLastSpoke = sig;
        speakAlert(newest);
      } catch (e) {}
    }, 5000);
  }

  // Force voice list to populate (some browsers lazy-init)
  function _primeVoices() {
    if (!supported()) return;
    try {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {};
    } catch (e) {}
  }

  window.VoiceCoach = {
    supported, isEnabled, enable, disable, config, getConfig,
    speak, speakAlert, test, voices
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      _primeVoices(); startHook();
    } else {
      document.addEventListener('DOMContentLoaded', () => { _primeVoices(); startHook(); });
    }
  }
})();
