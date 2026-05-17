"""
For every page that references window.MODULE but doesn't load js/MODULE.js
directly, insert the script tag right before the page's <script>buildNav(...)
line so it loads synchronously and render() never hangs on 'Loading'.
"""
import os, re

CRITICAL = {
    'MoneyTracker': 'money-tracker.js',
    'AutoTrade': 'auto-trade.js',
    'HighConvictionAlerts': 'high-conviction-alerts.js',
    'BrainVsSpy': 'brain-vs-spy.js',
    'ConfidenceKelly': 'confidence-kelly.js',
    'PortfolioAllocator': 'portfolio-allocator.js',
    'BrainBacktest': 'brain-backtest.js',
    'RiskMonteCarlo': 'risk-monte-carlo.js',
    'PatternRecall': 'pattern-recall.js',
    'StreakTracker': 'streak-tracker.js',
    'EarningsAwareness': 'earnings-awareness.js',
    'PositionCorrelation': 'position-correlation.js',
    'WebhookBridge': 'webhook-bridge.js',
    'PreTradeChecklist': 'pre-trade-checklist.js',
    'LossCooloff': 'loss-cooloff.js',
    'EquityProtector': 'equity-protector.js',
    'CalibrationView': 'calibration-view.js',
    'TradeQuality': 'trade-quality-scorer.js',
    'DemoData': 'demo-data.js',
    'SourcePreference': 'source-preference.js',
    'TradePlanGen': 'trade-plan-gen.js',
    'VoiceCoach': 'voice-coach.js',
    'SoundSynth': 'sound-synth.js',
    'CalibrationView': 'calibration-view.js',
    'SeedDetector': 'seed-detector.js'
}

html_files = [f for f in os.listdir('.') if f.endswith('.html')]
fixed = []
for f in html_files:
    if f.startswith('_'): continue
    src = open(f, encoding='utf-8', errors='ignore').read()
    # Find all referenced modules
    needed = []
    for mod, scriptname in CRITICAL.items():
        if re.search(r'window\.' + mod + r'\b', src):
            if 'js/' + scriptname not in src:
                needed.append(scriptname)
    if not needed:
        continue
    # Insert script tags right before the first <script>buildNav line
    # Strategy: find line with `<script src="js/live.js"></script>` and insert right after it
    # If not found, find `<script>buildNav` and insert right before
    new_src = src
    if 'js/live.js' in new_src:
        insert_block = '\n'.join(f'<script src="js/{s}"></script>' for s in needed)
        # Replace the line containing js/live.js followed by newline
        m = re.search(r'<script src=[\'"]js/live\.js[\'"]></script>', new_src)
        if m:
            new_src = new_src[:m.end()] + '\n<!-- Auto-added direct loads (audit pass 2) -->\n' + insert_block + new_src[m.end():]
    else:
        # No live.js — try inserting before buildNav script
        m = re.search(r'<script>buildNav\(', new_src)
        if m:
            insert_block = '\n'.join(f'<script src="js/{s}"></script>' for s in needed) + '\n'
            new_src = new_src[:m.start()] + insert_block + new_src[m.start():]
        else:
            continue
    open(f, 'w', encoding='utf-8').write(new_src)
    fixed.append((f, needed))

print(f'Fixed {len(fixed)} pages')
for f, mods in fixed:
    print(f'  {f}: added {len(mods)} script tags: {", ".join(mods)}')
