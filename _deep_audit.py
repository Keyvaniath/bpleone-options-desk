"""
BPLEONE deep audit — finds bugs the basic balance-checker misses.

Checks:
  1. Every window.MODULE = { ... } export is matched by callers
  2. Every window.MODULE.method() call has a matching method defined
  3. Every localStorage key starting with 'bpleone_' is referenced consistently
  4. Every <script src="js/X.js"> in HTML refers to an existing file
  5. Every HTML link href="X.html" points to a real file
  6. Every getElementById('X') has a matching id="X" in the same file
  7. Every JS file is referenced somewhere
  8. Every HTML file is in the sitemap
"""
import os
import re
import json
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.abspath(__file__))
JS_DIR = os.path.join(ROOT, 'js')

def jsfiles():
    return sorted([f for f in os.listdir(JS_DIR) if f.endswith('.js') and not f.startswith('_')])

def htmlfiles():
    return sorted([f for f in os.listdir(ROOT) if f.endswith('.html') and not f.startswith('_')])

def read(p):
    try:
        with open(p, 'r', encoding='utf-8', errors='replace') as f:
            return f.read()
    except Exception as e:
        return ''

# ========== Audit 1: window.MODULE exports ==========
print('='*60)
print('AUDIT 1: window.MODULE exports')
print('='*60)
exports = {}   # module_name -> {file, methods}
export_pattern = re.compile(r'window\.(\w+)\s*=\s*\{([^}]*)\}', re.DOTALL)
method_pattern = re.compile(r'(\w+)\s*[,:]')

for f in jsfiles():
    src = read(os.path.join(JS_DIR, f))
    for m in export_pattern.finditer(src):
        name = m.group(1)
        body = m.group(2)
        # naive method extraction
        methods = set()
        for line in body.split(','):
            line = line.strip()
            if not line: continue
            m2 = re.match(r'(\w+)', line)
            if m2:
                methods.add(m2.group(1))
        exports[name] = {'file': f, 'methods': methods}

# Also look for `window.MODULE.X = function` style assignments
assign_pat = re.compile(r'window\.(\w+)\.(\w+)\s*=\s*(?:function|\()')
for f in jsfiles():
    src = read(os.path.join(JS_DIR, f))
    for m in assign_pat.finditer(src):
        name = m.group(1)
        meth = m.group(2)
        if name in exports:
            exports[name]['methods'].add(meth)

print(f'Found {len(exports)} modules:')
for name, info in sorted(exports.items()):
    print(f'  {name:30s} ({info["file"]}) — {len(info["methods"])} methods')

# ========== Audit 2: window.MODULE.method() callers vs definitions ==========
print()
print('='*60)
print('AUDIT 2: dead method calls (window.X.Y() where Y not defined)')
print('='*60)
caller_pat = re.compile(r'window\.(\w+)\.(\w+)\b')
issues = []
checked_pairs = set()
all_files = [(os.path.join(JS_DIR, f), f) for f in jsfiles()] + [(os.path.join(ROOT, f), f) for f in htmlfiles()]
for path, fname in all_files:
    src = read(path)
    for m in caller_pat.finditer(src):
        mod = m.group(1)
        meth = m.group(2)
        if meth in ('prototype', 'constructor', 'length', 'addEventListener', 'removeEventListener', 'apply', 'call'): continue
        if (mod, meth) in checked_pairs: continue
        checked_pairs.add((mod, meth))
        if mod in exports:
            if meth not in exports[mod]['methods']:
                # Could be a property access (state, config) — many modules expose constants
                # Mark as warning only
                issues.append((fname, mod, meth))
# Filter to known suspects only
print(f'{len(issues)} suspicious window.X.Y references (could be property access or aliased)')
# Show first 30
for f, m, mth in issues[:30]:
    print(f'  {f}: window.{m}.{mth}')
if len(issues) > 30: print(f'  ... and {len(issues)-30} more')

# ========== Audit 3: localStorage keys ==========
print()
print('='*60)
print('AUDIT 3: localStorage key consistency')
print('='*60)
key_pat = re.compile(r'[\'"]bpleone_(\w+)[\'"]')
key_uses = defaultdict(list)   # key -> [file, ...]
for f in jsfiles():
    src = read(os.path.join(JS_DIR, f))
    for m in key_pat.finditer(src):
        key_uses['bpleone_' + m.group(1)].append(f)
for f in htmlfiles():
    src = read(os.path.join(ROOT, f))
    for m in key_pat.finditer(src):
        key_uses['bpleone_' + m.group(1)].append(f)
print(f'{len(key_uses)} unique localStorage keys found')
# Show keys used in only one file (likely siloed state)
print()
print('Keys defined and used in only one file:')
for k in sorted(key_uses.keys()):
    files = set(key_uses[k])
    if len(files) == 1:
        print(f'  {k:45s} only in: {list(files)[0]}')
# Show keys spread across many files (shared state)
print()
print('Keys shared across 2+ files (potential coordination):')
for k in sorted(key_uses.keys()):
    files = set(key_uses[k])
    if len(files) >= 2:
        print(f'  {k:45s} in {len(files)} files: {", ".join(sorted(files)[:4])}{"..." if len(files) > 4 else ""}')

# ========== Audit 4: script src refs vs file existence ==========
print()
print('='*60)
print('AUDIT 4: <script src="js/X.js"> references vs file existence')
print('='*60)
script_pat = re.compile(r'<script[^>]*src=[\'"]js/(\w[\w\-]*)\.js[\'"]')
script_refs = defaultdict(list)   # filename -> [page, ...]
for f in htmlfiles():
    src = read(os.path.join(ROOT, f))
    for m in script_pat.finditer(src):
        script_refs[m.group(1) + '.js'].append(f)

js_actual = set(jsfiles())
print(f'JS files referenced via <script src>: {len(script_refs)}')
broken = []
for sref, pages in script_refs.items():
    if sref not in js_actual:
        broken.append((sref, pages))
if broken:
    print('BROKEN script src references:')
    for sref, pages in broken:
        print(f'  BADjs/{sref} NOT FOUND — referenced by: {", ".join(pages[:3])}')
else:
    print('  OKAll <script src> references resolve to real files')

# orphan JS files (defined but never loaded)
unreferenced = []
for f in js_actual:
    if f not in script_refs:
        # check if it's lazy-loaded via live.js / data-provider.js
        loaded_lazy = False
        for loader in ['live.js', 'data-provider.js', 'app.js']:
            try:
                lsrc = read(os.path.join(JS_DIR, loader))
                if f"js/{f}" in lsrc:
                    loaded_lazy = True
                    break
            except: pass
        if not loaded_lazy:
            unreferenced.append(f)
print()
print(f'JS files NEVER referenced (orphans, {len(unreferenced)} total):')
for f in unreferenced[:20]:
    print(f'  - {f}')
if len(unreferenced) > 20: print(f'  ... and {len(unreferenced)-20} more')

# ========== Audit 5: HTML internal href refs ==========
print()
print('='*60)
print('AUDIT 5: href="X.html" references vs file existence')
print('='*60)
href_pat = re.compile(r'href=[\'"]([\w\-]+\.html)[\'"]')
broken_links = defaultdict(list)
all_html = set(htmlfiles())
for f in htmlfiles():
    src = read(os.path.join(ROOT, f))
    for m in href_pat.finditer(src):
        target = m.group(1)
        if target not in all_html and target != f:
            broken_links[target].append(f)
# Also check for hrefs in app.js (footer + nav)
js_src = read(os.path.join(JS_DIR, 'app.js'))
for m in href_pat.finditer(js_src):
    target = m.group(1)
    if target not in all_html:
        broken_links[target].append('js/app.js')
print(f'Broken internal hrefs: {len(broken_links)}')
for tgt, sources in sorted(broken_links.items())[:30]:
    print(f'  BAD{tgt} ->referenced from {len(sources)} file(s): {", ".join(sources[:3])}')

# ========== Audit 6: getElementById vs id attributes (per HTML) ==========
print()
print('='*60)
print('AUDIT 6: getElementById refs in inline scripts (per page)')
print('='*60)
gebi_pat = re.compile(r"getElementById\s*\(\s*['\"](\w[\w\-]*)['\"]\s*\)")
id_pat = re.compile(r'\bid=[\'"](\w[\w\-]*)[\'"]')
script_block_pat = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', re.DOTALL)
bad_gebi = []
for f in htmlfiles():
    src = read(os.path.join(ROOT, f))
    ids = set(id_pat.findall(src))
    inline = ''.join(script_block_pat.findall(src))
    refs = set(gebi_pat.findall(inline))
    missing = refs - ids
    # Filter out IDs that are likely created dynamically (e.g., site-nav populated by buildNav)
    dynamic = {'site-nav', 'site-footer', 'market-clock', 'nav-pulse-text', 'nav-pulse-dot', 'nav-live-pulse',
               'dataStatusPill', 'home-money-tile', 'home-money-amount', 'home-money-meta'}
    real_missing = missing - dynamic
    if real_missing:
        bad_gebi.append((f, real_missing))
print(f'Inline scripts referencing non-existent IDs: {len(bad_gebi)}')
for f, missing in bad_gebi[:20]:
    print(f'  BAD{f}: refs {len(missing)} undefined IDs: {", ".join(sorted(missing)[:6])}')

# ========== Audit 7: every HTML file present in sitemap ==========
print()
print('='*60)
print('AUDIT 7: HTML files NOT in sitemap.xml')
print('='*60)
sitemap = read(os.path.join(ROOT, 'sitemap.xml'))
sitemap_urls = set(re.findall(r'/([\w\-]+\.html)', sitemap))
not_in_sitemap = []
for f in htmlfiles():
    if f not in sitemap_urls and f != 'index.html':
        # index.html is at root
        if f.lower() not in ['squarespace-tile.html']:
            not_in_sitemap.append(f)
print(f'{len(not_in_sitemap)} HTML files not in sitemap:')
for f in not_in_sitemap[:30]:
    print(f'  - {f}')

# ========== Summary ==========
print()
print('='*60)
print('SUMMARY')
print('='*60)
print(f'  Modules with exports:           {len(exports)}')
print(f'  Suspicious method calls:        {len(issues)}')
print(f'  Unique localStorage keys:       {len(key_uses)}')
print(f'  Broken <script src> refs:       {len(broken)}')
print(f'  Orphan JS files:                {len(unreferenced)}')
print(f'  Broken internal hrefs:          {len(broken_links)}')
print(f'  Inline scripts w/ bad getById:  {len(bad_gebi)}')
print(f'  HTML files not in sitemap:      {len(not_in_sitemap)}')
print()
print('Audit complete.')
