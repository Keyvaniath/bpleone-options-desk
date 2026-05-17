/* ===========================================
   BPLEONE — Self-Distillation Regularizer
   ---
   Knowledge distillation (Hinton et al. 2015) uses a strong "teacher"
   model to provide soft targets that the student model trains toward.
   The soft targets carry more information than hard labels (a teacher
   that's 80% confident says "lean strongly long but it's not certain"
   while a hard label of 1 only says "long won").

   For our brain, we don't have an external teacher — so we self-distill
   by using the SWA-averaged weights as the teacher. SWA sits in a
   flatter loss minimum, so its predictions are typically smoother and
   better-calibrated than the live model.

   Algorithm: after each main training step on hard label y, do ONE extra
   training step on:
       soft_target = α × teacher_prediction(features) + (1 - α) × y

   With α=0.3, the model is gently pulled toward SWA's view in addition
   to learning the hard label. This regularizes against drifting too far
   from the stable averaged version.

   Disabled by default — opt-in to avoid surprising the brain. When
   enabled it doubles training compute on the live model (one main step
   + one distill step per resolution).

   Exposes:
     SelfDistillation.distillStep(model, features, hardLabel, alpha?)
     SelfDistillation.enabled() / .setEnabled(bool)
     SelfDistillation.alpha() / .setAlpha(α)
     SelfDistillation.stats() → { stepCount, lastTs, enabled, alpha }
   =========================================== */

(function () {
  const KEY = 'bpleone_self_distill_v1';
  const DEFAULT_ALPHA = 0.30;
  const MIN_ALPHA = 0.0;
  const MAX_ALPHA = 0.7;

  function load() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(KEY);
      const s = j ? JSON.parse(j) : null;
      if (!s) return defaultState();
      if (typeof s.alpha !== 'number') s.alpha = DEFAULT_ALPHA;
      if (typeof s.enabled !== 'boolean') s.enabled = false;
      if (typeof s.stepCount !== 'number') s.stepCount = 0;
      return s;
    } catch (e) { return defaultState(); }
  }

  function defaultState() {
    return {
      alpha: DEFAULT_ALPHA,
      enabled: false, // opt-in
      stepCount: 0,
      lastTs: 0
    };
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function distillStep(model, features, hardLabel, alphaOverride) {
    if (!model || typeof model.train !== 'function') return null;
    if (!Array.isArray(features) || (hardLabel !== 0 && hardLabel !== 1)) return null;
    const state = load();
    if (!state.enabled) return null;

    const SWA = (typeof window !== 'undefined') ? window.SWA : null;
    if (!SWA || typeof SWA.predict !== 'function') return null;
    const teacher = SWA.predict(features);
    if (!teacher || teacher.prob == null) return null; // SWA not ready

    const alpha = (typeof alphaOverride === 'number') ? alphaOverride : state.alpha;
    const softTarget = alpha * teacher.prob + (1 - alpha) * hardLabel;
    try {
      model.train(features, softTarget);
    } catch (e) { return null; }

    state.stepCount++;
    state.lastTs = Date.now();
    save(state);
    return { teacherProb: teacher.prob, hardLabel, softTarget, alpha };
  }

  function enabled() { return load().enabled; }
  function setEnabled(b) {
    const state = load();
    state.enabled = !!b;
    save(state);
  }
  function alpha() { return load().alpha; }
  function setAlpha(a) {
    const clamped = Math.max(MIN_ALPHA, Math.min(MAX_ALPHA, a));
    const state = load();
    state.alpha = clamped;
    save(state);
  }

  function stats() {
    const state = load();
    return {
      enabled: state.enabled,
      alpha: state.alpha,
      stepCount: state.stepCount,
      lastTs: state.lastTs,
      min: MIN_ALPHA,
      max: MAX_ALPHA,
      defaultAlpha: DEFAULT_ALPHA
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.SelfDistillation = {
    distillStep,
    enabled,
    setEnabled,
    alpha,
    setAlpha,
    stats,
    reset,
    DEFAULT_ALPHA,
    MIN_ALPHA,
    MAX_ALPHA
  };
})();
