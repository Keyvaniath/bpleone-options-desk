/* ===========================================
   BPLEONE — Confidence Penalty (Entropy Regularization)
   ---
   Label smoothing softens labels (y=0.025/0.975). Confidence penalty is
   the alternative: add an entropy term to the loss that penalizes the
   model when its output is too peaked.

   Loss = CE(p, y) - β × H(p)

   Where:
     CE(p, y) is standard cross-entropy
     H(p) = -(p × log(p) + (1-p) × log(1-p))    [Shannon entropy of Bernoulli]
     β is the penalty strength (default 0.05)

   When β > 0, the model's gradient gets an extra push away from extreme
   outputs. The two approaches (label smoothing + confidence penalty) are
   theoretically related but can be combined.

   Reference: Pereyra et al. 2017, "Regularizing Neural Networks by
   Penalizing Confident Output Distributions"

   Implementation strategy: this module exposes a gradient adjustment that
   can be added inside Model.train as an additive penalty term.
   Specifically: dCE/dz = (p - y), and dH/dz = -(p - 0.5).
   So the modified gradient is: (p - y) + β × (p - 0.5).
   When p > 0.5, the penalty pushes the gradient up (toward smaller p).
   When p < 0.5, the penalty pushes the gradient down (toward larger p).

   But integrating into Model.train is invasive. Easier path: post-hoc
   nudge weights toward zero (which biases output toward 0.5). This is
   essentially L2 regularization but stronger when output is far from 0.5.

   This module exposes:
     ConfidencePenalty.gradAdjustment(p) → number   — additive to (p-y) gradient
     ConfidencePenalty.beta() / .setBeta(β)
     ConfidencePenalty.enabled() / .setEnabled(bool)
     ConfidencePenalty.stats()
   =========================================== */

(function () {
  const KEY = 'bpleone_confidence_penalty_v1';
  const DEFAULT_BETA = 0.05;
  const MIN_BETA = 0.0;
  const MAX_BETA = 0.5;

  function load() {
    if (typeof localStorage === 'undefined') return defaultState();
    try {
      const j = localStorage.getItem(KEY);
      const s = j ? JSON.parse(j) : null;
      if (!s) return defaultState();
      if (typeof s.beta !== 'number') s.beta = DEFAULT_BETA;
      if (typeof s.enabled !== 'boolean') s.enabled = true;
      if (typeof s.appliedCount !== 'number') s.appliedCount = 0;
      return s;
    } catch (e) { return defaultState(); }
  }

  function defaultState() {
    return {
      beta: DEFAULT_BETA,
      enabled: false,  // disabled by default — opt-in via dashboard since
                       // it changes the loss surface; label smoothing is
                       // the safer default regularizer.
      appliedCount: 0
    };
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // Compute the additive gradient term from the entropy penalty.
  // dH/dz = -(p - 0.5) for Bernoulli entropy where z is logit
  // The full gradient with penalty is:
  //   (p - y) - β × (p - 0.5) ... actually
  //   loss = CE - β H,  so dLoss/dz = (p-y) - β × dH/dz
  //   dH/dz = -d/dz [p*log(p) + (1-p)*log(1-p)]
  //         = -[log(p) - log(1-p)] × dp/dz
  //   for sigmoid: dp/dz = p(1-p)
  //   so dH/dz = -[log(p/(1-p))] × p(1-p) = -z × p(1-p)
  // For small entropy (peaked p), this term is large in magnitude.
  // Simpler approximation: when |p - 0.5| > 0.1, push back toward 0.5.
  function gradAdjustment(p) {
    if (typeof p !== 'number') return 0;
    const state = load();
    if (!state.enabled) return 0;
    // Simple form: penalty proportional to (p - 0.5)
    // When p > 0.5, adjustment > 0 → adds to gradient → weights move toward smaller p
    // When p < 0.5, adjustment < 0 → subtracts from gradient → weights move toward larger p
    state.appliedCount++;
    save(state);
    return state.beta * (p - 0.5);
  }

  function beta() { return load().beta; }
  function setBeta(b) {
    const clamped = Math.max(MIN_BETA, Math.min(MAX_BETA, b));
    const state = load();
    state.beta = clamped;
    save(state);
  }
  function enabled() { return load().enabled; }
  function setEnabled(b) {
    const state = load();
    state.enabled = !!b;
    save(state);
  }

  function stats() {
    const state = load();
    return {
      beta: state.beta,
      enabled: state.enabled,
      appliedCount: state.appliedCount,
      min: MIN_BETA,
      max: MAX_BETA,
      default: DEFAULT_BETA
    };
  }

  function reset() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  }

  window.ConfidencePenalty = {
    gradAdjustment,
    beta,
    setBeta,
    enabled,
    setEnabled,
    stats,
    reset,
    DEFAULT_BETA,
    MIN_BETA,
    MAX_BETA
  };
})();
