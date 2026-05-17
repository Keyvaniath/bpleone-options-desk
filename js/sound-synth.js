/* ===========================================
   BPLEONE — Sound Synthesizer
   ---
   Web Audio API beeps for high-conviction alerts. Different tones for
   LONG vs SHORT vs critical. No audio files needed — fully synthesized.

   Polls HighConvictionAlerts every 5s; when new alert arrives, plays
   a 2-note tone (rising for LONG, falling for SHORT, alarm for >85%
   conviction).

   Off by default (autoplay rules). Storage: bpleone_sound_synth_v1.

   Exposes:
     SoundSynth.enable() / disable() / isEnabled()
     SoundSynth.config(opts) / getConfig()
     SoundSynth.testLong() / testShort() / testCritical()
     SoundSynth.playBeep({freqs:[440,880], duration:0.15, gain:0.2})
   =========================================== */

(function () {
  const KEY = 'bpleone_sound_synth_v1';

  const DEFAULTS = {
    enabled: false,
    volume: 0.25,
    criticalThreshold: 0.85,
    rateLimitMs: 2000
  };

  function load() {
    if (typeof localStorage === 'undefined') return Object.assign({}, DEFAULTS);
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save(c) { if (typeof localStorage !== 'undefined') { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} } }

  function getConfig() { return load(); }
  function config(opts) { const c = Object.assign(load(), opts || {}); save(c); return c; }
  function isEnabled() { return load().enabled; }
  function enable() { const c = load(); c.enabled = true; save(c); return c; }
  function disable() { const c = load(); c.enabled = false; save(c); return c; }

  let actx = null;
  function getCtx() {
    if (actx) return actx;
    if (typeof window === 'undefined' || (!window.AudioContext && !window.webkitAudioContext)) return null;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); return actx; } catch (e) { return null; }
  }

  let lastPlayedAt = 0;
  function playBeep(opts) {
    const ctx = getCtx();
    if (!ctx) return false;
    const cfg = load();
    const freqs = opts.freqs || [440, 880];
    const duration = opts.duration || 0.15;
    const gainLevel = (opts.gain || 0.2) * (cfg.volume || 0.25);
    const now = ctx.currentTime;
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = opts.wave || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * duration);
      gain.gain.linearRampToValueAtTime(gainLevel, now + i * duration + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * duration + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * duration);
      osc.stop(now + i * duration + duration + 0.05);
    });
    return true;
  }

  function playLong() { return playBeep({ freqs: [523, 784], duration: 0.15, wave: 'sine' }); }   // C5 -> G5
  function playShort() { return playBeep({ freqs: [784, 523], duration: 0.15, wave: 'sine' }); }  // G5 -> C5
  function playCritical() { return playBeep({ freqs: [880, 880, 880, 880], duration: 0.10, gain: 0.3, wave: 'square' }); }

  function speakAlert(alert) {
    const cfg = load();
    if (!cfg.enabled) return false;
    if (Date.now() - lastPlayedAt < cfg.rateLimitMs) return false;
    lastPlayedAt = Date.now();
    const conv = alert.conviction || 0;
    if (conv >= cfg.criticalThreshold) {
      playCritical();
      // Follow with direction tone
      setTimeout(() => { if (alert.direction === 'LONG') playLong(); else playShort(); }, 600);
    } else if (alert.direction === 'LONG') {
      playLong();
    } else {
      playShort();
    }
    return true;
  }

  let lastSeenSig = null;
  function startHook() {
    if (typeof window === 'undefined') return;
    if (window._soundSynthHook) return;
    window._soundSynthHook = setInterval(() => {
      try {
        if (!load().enabled) return;
        if (!window.HighConvictionAlerts) return;
        const feed = window.HighConvictionAlerts.feed(3);
        const latest = feed[0];
        if (!latest) return;
        const age = Date.now() - latest.ts;
        if (age > 60 * 1000) return;
        const sig = latest.sourceJournalId || (latest.sym + '-' + latest.ts);
        if (lastSeenSig === sig) return;
        lastSeenSig = sig;
        speakAlert(latest);
      } catch (e) {}
    }, 5000);
  }

  window.SoundSynth = { enable, disable, isEnabled, config, getConfig, playBeep, playLong, playShort, playCritical, speakAlert };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') startHook();
    else document.addEventListener('DOMContentLoaded', startHook);
  }
})();
