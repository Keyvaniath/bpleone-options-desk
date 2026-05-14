"""Full audit using the proper char-by-char tokenizer in _balance.py."""
import os, re, sys
sys.path.insert(0, '.')
from _balance import balance as js_balance

ROOT = os.path.dirname(os.path.abspath(__file__))
problems = []

# JS modules
print('--- JS modules ---')
for f in sorted(os.listdir(os.path.join(ROOT, 'js'))):
    if not f.endswith('.js'): continue
    p = os.path.join(ROOT, 'js', f)
    with open(p, 'r', encoding='utf-8') as fh:
        src = fh.read()
    ok, msg = js_balance(src)
    print(f"  {'OK' if ok else 'FAIL':5s} {f}: {msg}")
    if not ok: problems.append(f'JS {f}: {msg}')

# Inline scripts in HTML
print()
print('--- Inline scripts ---')
inline_re = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>')
html_files = sorted([f for f in os.listdir(ROOT) if f.endswith('.html')])
fail = 0
for f in html_files:
    with open(os.path.join(ROOT, f), 'r', encoding='utf-8') as fh:
        html = fh.read()
    for i, m in enumerate(inline_re.finditer(html)):
        body = m.group(1)
        if not body.strip(): continue
        ok, msg = js_balance(body)
        if not ok:
            fail += 1
            print(f'  FAIL {f} #{i}: {msg}')
            problems.append(f'inline {f}#{i}: {msg}')
print(f'  Checked {sum(1 for _ in html_files)} pages, {fail} inline-script failures')

# HTML basics
print()
print('--- HTML basics ---')
all_files_lc = {n.lower() for n in os.listdir(ROOT)}
href_re = re.compile(r'href="([^"#]+\.html)(#[^"]*)?"')
id_re = re.compile(r'\bid="([^"]+)"')
for f in html_files:
    with open(os.path.join(ROOT, f), 'r', encoding='utf-8') as fh:
        html = fh.read()
    if '</html>' not in html[-200:]:
        problems.append(f'{f}: missing </html>')
    ids = id_re.findall(html)
    seen = set()
    for i in ids:
        if i in seen:
            problems.append(f'{f}: duplicate id "{i}"')
        seen.add(i)
    for href, _ in href_re.findall(html):
        h = href.lstrip('/').lower()
        if not h: continue
        if h not in all_files_lc:
            problems.append(f'{f}: broken href -> {href}')

# Sitemap coverage
print()
print('--- Sitemap ---')
with open(os.path.join(ROOT, 'sitemap.xml'), 'r', encoding='utf-8') as fh:
    sm = fh.read()
sm_pages = set()
for u in re.findall(r'<loc>https://[^<]+/([^<]*)</loc>', sm):
    pth = u if u else 'index.html'
    if pth.endswith('/'): pth = 'index.html'
    sm_pages.add(pth.lower())
for h in html_files:
    if h.lower() not in sm_pages and h != '404.html':
        problems.append(f'missing from sitemap: {h}')
print(f'  Sitemap has {len(sm_pages)} pages; {len(html_files)} HTML files on disk')

# Summary
print()
if problems:
    print(f'PROBLEMS ({len(problems)}):')
    for p in problems[:80]: print('  -', p)
    sys.exit(1)
print(f'AUDIT CLEAN — {len(html_files)} pages, all checks passed')
