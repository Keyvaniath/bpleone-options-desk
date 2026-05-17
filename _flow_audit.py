"""
End-to-end data flow audit.

Traces:
  1. data-provider.js Stooq fetch -> applyTrade -> QUOTES update
  2. QUOTES update -> Feed.publish -> page bindings update
  3. ContinuousLearner captureRound reads QUOTES -> writes journal
  4. journal -> resolveRound -> outcome
  5. journal -> MoneyTracker.summary -> render

For each step, verify the symbol/data flow is consistent.
"""
import os, re

def read(p):
    with open(p, encoding='utf-8', errors='ignore') as f:
        return f.read()

JS_DIR = 'js'

# Step 1: STOOQ_MAP coverage vs QUOTES seeds
data_provider = read(os.path.join(JS_DIR, 'data-provider.js'))
live_js = read(os.path.join(JS_DIR, 'live.js'))

stooq_map_match = re.search(r'const STOOQ_MAP = \{([^}]*)\}', data_provider, re.DOTALL)
stooq_syms = set()
if stooq_map_match:
    for m in re.finditer(r'(\w+)\s*:\s*[\'"]([^\'"]+)[\'"]', stooq_map_match.group(1)):
        stooq_syms.add(m.group(1))

# Extract QUOTES keys from live.js
quotes_match = re.search(r'const QUOTES = \{(.*?)\n\};', live_js, re.DOTALL)
quotes_syms = set()
if quotes_match:
    for m in re.finditer(r"^\s+(\w+):\s*\{\s*symbol:\s*['\"]\1['\"]", quotes_match.group(1), re.MULTILINE):
        quotes_syms.add(m.group(1))
    # Also catch shorter form
    for m in re.finditer(r"^\s+(\w+):\s*\{", quotes_match.group(1), re.MULTILINE):
        quotes_syms.add(m.group(1))

print('='*60)
print('DATA FLOW AUDIT')
print('='*60)
print()
print(f'STOOQ_MAP covers: {len(stooq_syms)} symbols')
print(f'QUOTES has:       {len(quotes_syms)} seeded symbols')
print()
missing_stooq = quotes_syms - stooq_syms
extra_stooq = stooq_syms - quotes_syms
print(f'In QUOTES but NOT in STOOQ_MAP ({len(missing_stooq)} symbols — will never get live updates):')
for s in sorted(missing_stooq):
    print(f'  - {s}')
print()
print(f'In STOOQ_MAP but NOT in QUOTES ({len(extra_stooq)} symbols — wasted Stooq quota):')
for s in sorted(extra_stooq):
    print(f'  - {s}')
print()

# Step 2: UNIVERSE in continuous-learner vs QUOTES
cl = read(os.path.join(JS_DIR, 'continuous-learner.js'))
universe_match = re.search(r'const UNIVERSE = \[([^\]]+)\]', cl)
universe_syms = set()
if universe_match:
    for m in re.finditer(r"['\"](\w+)['\"]", universe_match.group(1)):
        universe_syms.add(m.group(1))
print(f'ContinuousLearner UNIVERSE: {len(universe_syms)} symbols')
print(f'  Symbols brain tries to capture but not in QUOTES: {sorted(universe_syms - quotes_syms)}')
print(f'  Symbols in QUOTES but brain ignores: {sorted(quotes_syms - universe_syms)}')
print()

# Step 3: DataReliability per-symbol validation thresholds
dr = read(os.path.join(JS_DIR, 'data-reliability.js'))
jump_pat = re.search(r'MAX_PRICE_JUMP_PCT\s*=\s*([\d.]+)', dr)
stale_eq_pat = re.search(r'STALE_MS_EQUITY_RTH\s*=\s*([^;]+);', dr)
stale_cr_pat = re.search(r'STALE_MS_CRYPTO\s*=\s*([^;]+);', dr)
print('DataReliability thresholds:')
print(f'  Max price jump: {jump_pat.group(1) if jump_pat else "?"} (30% = 0.30)')
print(f'  Equity stale ms: {stale_eq_pat.group(1).strip() if stale_eq_pat else "?"}')
print(f'  Crypto stale ms: {stale_cr_pat.group(1).strip() if stale_cr_pat else "?"}')
print()

# Step 4: Journal write/read consistency
journal_writers = []
journal_readers = []
for f in os.listdir(JS_DIR):
    if not f.endswith('.js'): continue
    src = read(os.path.join(JS_DIR, f))
    if "localStorage.setItem('bpleone_pred_journal_v1'" in src or 'JOURNAL_KEY' in src and 'setItem' in src:
        journal_writers.append(f)
    if "localStorage.getItem('bpleone_pred_journal_v1'" in src or "'bpleone_pred_journal_v1'" in src:
        journal_readers.append(f)
print(f'Journal writers: {len(journal_writers)}')
for f in journal_writers: print(f'  - {f}')
print(f'Journal readers: {len(journal_readers)}')
for f in journal_readers: print(f'  - {f}')
print()

# Step 5: Find functions that should be called periodically but might not be
print('Auto-poll modules (setInterval/setTimeout):')
poll_pat = re.compile(r'setInterval\([^,]+,\s*(\d+)\s*\*\s*(\d+)')
for f in os.listdir(JS_DIR):
    if not f.endswith('.js'): continue
    src = read(os.path.join(JS_DIR, f))
    matches = poll_pat.findall(src)
    if matches:
        intervals = [int(a) * int(b) for a, b in matches]
        print(f'  {f}: intervals = {intervals} ms')
