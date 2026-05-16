/* ===========================================
   BPLEONE — Unified prediction pipeline
   ---
   Brain has accumulated many specialized modules. This module composes
   them into one call:

     UnifiedPredictor.predict(symbol, features)
       → { final, components: {...}, sizing: {...} }

   Pipeline (in order):
     1. Run logistic regression model on features → rawProb
     2. Run multi-horizon ensemble → ensembleProb
     3. Run bootstrap ensemble → bootstrapProb
     4. Run k-NN recall → knnProb
     5. Blend (model + ensemble + k-NN) → blendedProb
     6. Apply Calibrator → calibratedProb
     7. Apply SymbolBias → biasedProb
     8. Compute OOD score; if high, pull toward 0.5 → finalProb
     9. Compute Bayesian uncertainty (MC dropout)
     10. Compute ensemble agreement across all sources
     11. Aggregate size multiplier from uncertainty + agreement + OOD

   Result is a single dict with all intermediate values exposed for
   transparency. Downstream pages (brain-bet, brain-conviction) call
   this instead of replicating the chain.

   Exposes:
     UnifiedPredictor.predict(symbol, features)
       → { finalProb, finalSizeMult, components, narrative }
   =========================================== */

(function () {
  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function predict(symbol, features) {
    if (!features || features.length === 0) return null;

    const components = {};

    // 1. Raw model prediction
    let model = null;
    const MS = (typeof window !== 'undefined' && window.ModelStore) || (typeof ModelStore !== 'undefined' ? ModelStore : null);
    if (MS) {
      try { model = MS.load(); } catch (e) {}
    }
    if (!model) return null;
    const baseResult = model.predict(features);
    components.rawProb = baseResult.prob;

    // 2. Multi-horizon ensemble
    let ensembleProb = null;
    if (typeof MultiHorizon !== 'undefined') {
      const ens = safe(() => MultiHorizon.predictEnsemble(features), null);
      if (ens) {
        ensembleProb = ens.prob;
        components.ensembleProb = ens.prob;
        components.ensembleRegime = ens.regime ? ens.regime.name : null;
        components.byHorizon = ens.byHorizon;
        components.horizonWeights = ens.weights;
      }
    }

    // 3. Bootstrap ensemble
    let bootstrapProb = null;
    let bootstrapStd = 0;
    if (typeof BootstrapEnsemble !== 'undefined') {
      const boot = safe(() => BootstrapEnsemble.predict(features), null);
      if (boot && boot.predictions.length > 0) {
        bootstrapProb = boot.mean;
        bootstrapStd = boot.std;
        components.bootstrapProb = boot.mean;
        components.bootstrapStd = boot.std;
      }
    }

    // 4. k-NN recall
    let knnProb = null;
    if (typeof KNNRecall !== 'undefined') {
      const knn = safe(() => KNNRecall.predict(features), null);
      if (knn && knn.prob != null) {
        knnProb = knn.prob;
        components.knnProb = knn.prob;
        components.knnNeighbors = knn.n;
      }
    }

    // 4b. SWA (Stochastic Weight Averaging) — averaged weights from late
    // training, generalizes better than sharp final weights.
    let swaProb = null;
    if (typeof SWA !== 'undefined') {
      const s = safe(() => SWA.predict(features), null);
      if (s && s.prob != null) {
        swaProb = s.prob;
        components.swaProb = s.prob;
        components.swaSnapshots = s.nSnapshots;
        const div = safe(() => SWA.divergence(model), null);
        if (div != null) components.swaDivergence = div;
      }
    }

    // 5. Blend — use MetaStacker if ready (learned weights), else fall
    // back to hard-coded weights. MetaStacker becomes ready after ~30
    // resolutions and from then on its weights replace the manual choice.
    let blendedProb = components.rawProb;
    let blendSource = 'hardcoded';
    {
      const basePreds = {
        model: components.rawProb,
        ensemble: ensembleProb,
        bootstrap: bootstrapProb,
        knn: knnProb,
        swa: swaProb
      };
      let stackedPred = null;
      if (typeof MetaStacker !== 'undefined') {
        stackedPred = safe(() => MetaStacker.predict(basePreds), null);
      }
      if (stackedPred && stackedPred.prob != null) {
        blendedProb = stackedPred.prob;
        blendSource = 'meta-stacker';
        components.stackedBlend = stackedPred.prob;
      } else {
        const sources = [
          { prob: components.rawProb, w: 0.35 },
          { prob: ensembleProb, w: 0.25 },
          { prob: bootstrapProb, w: 0.13 },
          { prob: knnProb, w: 0.13 },
          { prob: swaProb, w: 0.14 }
        ].filter(s => s.prob != null);
        const totalW = sources.reduce((s, x) => s + x.w, 0);
        if (totalW > 0) {
          blendedProb = sources.reduce((s, x) => s + x.prob * (x.w / totalW), 0);
        }
      }
      components.blendedProb = blendedProb;
      components.blendSource = blendSource;
    }

    // 6. Calibration — prefer regime-specific calibrator if available,
    // fall back to the global Platt scaler, then to identity.
    let calibratedProb = blendedProb;
    let calibrationActive = false;
    let calibrationKind = 'none';
    let currentRegime = null;
    if (typeof RegimeCalibrator !== 'undefined') {
      try {
        currentRegime = RegimeCalibrator.classifyRegime();
        const rcStats = RegimeCalibrator.stats();
        if (rcStats[currentRegime] && rcStats[currentRegime].fitted) {
          calibratedProb = RegimeCalibrator.calibrate(blendedProb, currentRegime);
          calibrationActive = true;
          calibrationKind = 'regime:' + currentRegime;
        }
      } catch (e) {}
    }
    if (!calibrationActive && typeof Calibrator !== 'undefined') {
      const params = safe(() => Calibrator._loadParams(), null);
      if (params) {
        calibratedProb = safe(() => Calibrator.calibrate(blendedProb), blendedProb);
        calibrationActive = true;
        calibrationKind = 'global';
      }
    }
    components.calibratedProb = calibratedProb;
    components.calibrationActive = calibrationActive;
    components.calibrationKind = calibrationKind;
    if (currentRegime) components.currentRegime = currentRegime;

    // 7. Symbol bias
    let biasedProb = calibratedProb;
    if (typeof SymbolBias !== 'undefined' && symbol) {
      biasedProb = safe(() => SymbolBias.applyToProb(symbol, calibratedProb), calibratedProb);
      components.symbolBias = safe(() => SymbolBias.bias(symbol), 0);
      components.biasedProb = biasedProb;
    }

    // 8. OOD pull
    let oodScore = 0;
    let finalProb = biasedProb;
    if (typeof OutlierDetector !== 'undefined') {
      const stats = safe(() => OutlierDetector.featureStats(), null);
      if (stats && stats.ready) {
        oodScore = safe(() => OutlierDetector.oodScore(features), 0);
        components.oodScore = oodScore;
        if (oodScore > 0.3) {
          finalProb = 0.5 + (biasedProb - 0.5) * (1 - oodScore);
        }
      }
    }
    components.finalProb = finalProb;

    // 9. Bayesian uncertainty
    let uncertainty = null;
    if (typeof BayesianDropout !== 'undefined') {
      uncertainty = safe(() => BayesianDropout.predict(model, features), null);
      if (uncertainty) {
        components.uncertaintyStd = uncertainty.std;
        components.uncertaintyP5 = uncertainty.p5;
        components.uncertaintyP95 = uncertainty.p95;
        components.uncertaintyCategory = BayesianDropout.categorize(uncertainty);
      }
    }

    // 10. Cross-method agreement
    let agreement = null;
    if (typeof EnsembleAgreement !== 'undefined') {
      agreement = safe(() => EnsembleAgreement.compute(features, model), null);
      if (agreement) {
        components.agreementScore = agreement.score;
        components.agreementTier = EnsembleAgreement.categorize(agreement.score);
      }
    }

    // 10b. Conformal prediction interval — distribution-free, rigorous
    // coverage. Complements MC dropout. If dropout interval is much tighter
    // than conformal, dropout is over-confident.
    let conformal = null;
    if (typeof Conformal !== 'undefined') {
      conformal = safe(() => Conformal.interval(finalProb, 0.10), null);
      if (conformal && conformal.ready) {
        components.conformalLo = conformal.lo;
        components.conformalHi = conformal.hi;
        components.conformalHalfwidth = conformal.halfwidth;
        components.conformalN = conformal.n;
      }
    }

    // 11. Final size multiplier (compound effect of all uncertainty sources)
    let sizeMult = 1.0;
    if (uncertainty) sizeMult *= BayesianDropout.sizeMultiplier(uncertainty);
    if (agreement) sizeMult *= EnsembleAgreement.sizeMultiplier(agreement.score);
    if (oodScore > 0.5) sizeMult *= 0.5;       // halve on OOD inputs
    if (bootstrapStd > 0.1) sizeMult *= 0.75;   // bootstrap divergence shrinks too
    // Hour-of-session multiplier: shrink size during historically bad hours,
    // grow slightly during historically strong hours.
    if (typeof HourlyPerf !== 'undefined') {
      const hpMult = safe(() => HourlyPerf.sizeMultiplier(), 1.0);
      if (hpMult != null && hpMult !== 1.0) {
        sizeMult *= hpMult;
        components.hourlyMult = hpMult;
        components.currentHourBucket = safe(() => HourlyPerf.currentBucket(), null);
      }
    }
    // Day-of-week multiplier: similar pattern but stratified by weekday.
    if (typeof DowPerf !== 'undefined') {
      const dowMult = safe(() => DowPerf.sizeMultiplier(), 1.0);
      if (dowMult != null && dowMult !== 1.0) {
        sizeMult *= dowMult;
        components.dowMult = dowMult;
        components.currentDow = safe(() => DowPerf.currentDay(), null);
      }
    }
    // Drawdown tilt protection: shrink size after recent losing streak
    // (or after long winning streak for anti-overconfidence).
    if (typeof DrawdownProtector !== 'undefined') {
      const ddMult = safe(() => DrawdownProtector.sizeMultiplier(), 1.0);
      if (ddMult != null && ddMult !== 1.0) {
        sizeMult *= ddMult;
        components.drawdownMult = ddMult;
        components.currentStreak = safe(() => DrawdownProtector.currentStreak(), 0);
      }
    }
    // Adversarial validator: if covariate shift detected, shrink size 40%
    // (the input no longer looks like the training distribution).
    if (typeof AdversarialValidator !== 'undefined') {
      const av = safe(() => AdversarialValidator.score(), null);
      if (av && av.lastAuc != null) {
        components.advValAuc = av.lastAuc;
        if (av.shifted) {
          sizeMult *= 0.6;
          components.covariateShift = true;
        }
      }
    }
    sizeMult = Math.max(0.1, Math.min(1.25, sizeMult));
    components.finalSizeMult = sizeMult;

    // Narrative — human-readable summary of the chain
    const narrative = [];
    narrative.push('Raw model: ' + (components.rawProb * 100).toFixed(0) + '%.');
    if (ensembleProb != null) narrative.push('Ensemble (3 horizons): ' + (ensembleProb * 100).toFixed(0) + '%.');
    if (knnProb != null) narrative.push('k-NN of similar past: ' + (knnProb * 100).toFixed(0) + '%.');
    if (swaProb != null) narrative.push('SWA averaged weights: ' + (swaProb * 100).toFixed(0) + '%.');
    narrative.push('Blended (' + blendSource + '): ' + (blendedProb * 100).toFixed(0) + '%.');
    if (components.calibrationActive) narrative.push('Calibrated (' + calibrationKind + '): ' + (calibratedProb * 100).toFixed(0) + '%.');
    if (Math.abs(components.symbolBias) > 0.05) narrative.push('Symbol bias ' + (components.symbolBias >= 0 ? '+' : '') + components.symbolBias.toFixed(2) + ' → ' + (biasedProb * 100).toFixed(0) + '%.');
    if (oodScore > 0.3) narrative.push('OOD ' + (oodScore * 100).toFixed(0) + '% → pulled toward 50%.');
    narrative.push('Final: ' + (finalProb * 100).toFixed(0) + '%' + (uncertainty ? ' ± ' + (uncertainty.std * 100).toFixed(0) + '%' : '') + '.');
    if (agreement) narrative.push('Cross-method ' + components.agreementTier + ' agreement.');
    if (conformal && conformal.ready) narrative.push('Conformal 90%: [' + (conformal.lo * 100).toFixed(0) + '%, ' + (conformal.hi * 100).toFixed(0) + '%].');
    narrative.push('Suggested size: ' + (sizeMult * 100).toFixed(0) + '% of base.');

    return {
      symbol,
      finalProb,
      finalSizeMult: sizeMult,
      components,
      narrative: narrative.join(' '),
      direction: finalProb >= 0.5 ? 'LONG' : 'SHORT',
      conviction: Math.abs(finalProb - 0.5)
    };
  }

  // Convenience: predict + return only the final number for legacy callers
  function quickPredict(symbol, features) {
    const r = predict(symbol, features);
    return r ? r.finalProb : null;
  }

  window.UnifiedPredictor = {
    predict,
    quickPredict
  };
})();
