"""Build a fresh deploy ZIP from the working tree.

Includes: HTML, CSS, JS, assets/, CNAME, manifest.json, favicon.svg, robots.txt,
sitemap.xml, and the docs (.md). Excludes: existing ZIPs, audit/build scripts,
__pycache__, the stray ziB1b0Mj file.
"""
import os, zipfile, fnmatch, sys

OUT = 'bpleone-trading-options.zip'
EXCLUDED_FILES = {OUT, 'ziB1b0Mj', '_balance.py', '_full_audit.py', '_build_zip.py'}
EXCLUDED_GLOBS = ['*.zip', '__pycache__/*']

if os.path.exists(OUT): os.remove(OUT)

total_files = 0
total_bytes = 0
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d != '__pycache__']
        for f in files:
            path = os.path.join(root, f)
            rel = os.path.relpath(path, '.').replace(os.sep, '/')
            if f in EXCLUDED_FILES: continue
            if any(fnmatch.fnmatch(rel, g) for g in EXCLUDED_GLOBS): continue
            zf.write(path, rel)
            total_files += 1
            total_bytes += os.path.getsize(path)

size = os.path.getsize(OUT)
print(f'Built {OUT}')
print(f'  Files included: {total_files}')
print(f'  Uncompressed:  {total_bytes/1024:.0f} KB')
print(f'  Compressed:    {size/1024:.0f} KB ({100*size/total_bytes:.0f}%)')

# Sanity-check expected entries
expect = ['index.html','settings.html','dark-pool.html','CNAME','robots.txt',
          'sitemap.xml','manifest.json','favicon.svg',
          'js/data-provider.js','js/ai-client.js','js/app.js','js/live.js','css/style.css']
with zipfile.ZipFile(OUT, 'r') as zf:
    names = set(zf.namelist())
print('  Sample entries:')
missing = []
for n in expect:
    ok = n in names
    print(f'    {"OK" if ok else "MISSING"}  {n}')
    if not ok: missing.append(n)
if missing: sys.exit(1)
