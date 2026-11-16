"""One run of H3 in PREREG-2026-11-16-short-volume.md. No parameter search.

Closes: the cached Worker pull from relative_brain_test.py (data-2026-11-16.json). Short volume: FINRA Reg SHO daily
consolidated files (cdn.finra.org), only the universe's rows kept; parsed ratios cached in finra-ratios-2026-11-16.json.
"""
import datetime, json, math, os, statistics, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, 'data-2026-11-16.json'), encoding='utf-8'))
CACHE = os.path.join(HERE, 'finra-ratios-2026-11-16.json')
NAMES = sorted(s for s in DATA['closes'] if s != 'SPY')
WANT = set(n.replace('-', '.') for n in NAMES)   # FINRA writes BRK.B


def finra_day(d):
    url = 'https://cdn.finra.org/equity/regsho/daily/CNMSshvol' + d.replace('-', '') + '.txt'
    req = urllib.request.Request(url, headers={'User-Agent': 'desk-research'})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            text = r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return None if e.code in (403, 404) else 'retry'
    out = {}
    for line in text.splitlines()[1:]:
        p = line.split('|')
        if len(p) < 5 or p[1] not in WANT:
            continue
        try:
            sv, tv = float(p[2]), float(p[4])
        except ValueError:
            continue
        if tv > 0:
            out[p[1].replace('.', '-')] = sv / tv
    return out


def pull():
    if os.path.exists(CACHE):
        return json.load(open(CACHE, encoding='utf-8'))
    days = sorted(DATA['closes']['SPY'])
    first = datetime.date.fromisoformat(days[0])
    pre = []
    d = first - datetime.timedelta(days=1)
    while len(pre) < 70:                      # weekdays before the closes window, for the 60-session baseline
        if d.weekday() < 5:
            pre.append(d.isoformat())
        d -= datetime.timedelta(days=1)
    want_days = sorted(pre) + days
    ratios, missing = {}, []
    for d in want_days:
        got = finra_day(d)
        if got == 'retry':
            time.sleep(2); got = finra_day(d)
        if isinstance(got, dict) and got:
            ratios[d] = got
        else:
            missing.append(d)
        time.sleep(0.15)
    out = {'pulled_at': datetime.datetime.now().isoformat(), 'ratios': ratios, 'missing_days': missing}
    json.dump(out, open(CACHE, 'w', encoding='utf-8'))
    return out


def tstat(xs):
    if len(xs) < 3:
        return float('nan')
    sd = statistics.stdev(xs)
    return statistics.mean(xs) / (sd / math.sqrt(len(xs))) if sd > 0 else float('nan')


def ranks(v):
    order = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0] * len(v); i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2
        i = j + 1
    return r


def spearman(a, b):
    ra, rb = ranks(a), ranks(b); ma, mb = statistics.mean(ra), statistics.mean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return num / den if den else 0.0


def run(fin, abnormal=True):
    spy = DATA['closes']['SPY']; days = sorted(spy)
    fdays = sorted(fin['ratios'])
    spreads, ics, weeks = [], [], []
    for i in range(5, len(days) - 5, 5):
        d0, df = days[i], days[i + 5]
        k = max(j for j, x in enumerate(fdays) if x <= d0) if any(x <= d0 for x in fdays) else -1
        if k < 64:
            continue
        recent, base = fdays[k - 4:k + 1], fdays[k - 64:k - 4]
        sp_fwd = spy[df] / spy[d0] - 1
        rows = []
        for s in NAMES:
            c = DATA['closes'][s]
            if d0 not in c or df not in c:
                continue
            rv = [fin['ratios'][d][s] for d in recent if s in fin['ratios'][d]]
            bv = [fin['ratios'][d][s] for d in base if s in fin['ratios'][d]]
            if len(rv) < 4 or (abnormal and len(bv) < 50):
                continue
            sig = statistics.mean(rv) - (statistics.mean(bv) if abnormal else 0)
            rows.append((sig, c[df] / c[d0] - 1 - sp_fwd))
        if len(rows) < 40:
            continue
        rows.sort(key=lambda r: r[0]); q = len(rows) // 5
        spreads.append(statistics.mean(r[1] for r in rows[:q]) - statistics.mean(r[1] for r in rows[-q:]))
        ics.append(-spearman([r[0] for r in rows], [r[1] for r in rows]))
        weeks.append(d0)
    net = [s - 0.004 for s in spreads]
    res = {'weeks': len(spreads), 'first': weeks[0] if weeks else None, 'last': weeks[-1] if weeks else None,
           'mean_spread_pct': statistics.mean(spreads) * 100 if spreads else None, 't_spread': tstat(spreads),
           'mean_ic': statistics.mean(ics) if ics else None, 't_ic': tstat(ics),
           'mean_net_spread_pct': statistics.mean(net) * 100 if net else None,
           'hit_weeks': sum(1 for s in spreads if s > 0)}
    res['PASS'] = bool(spreads and res['mean_spread_pct'] > 0 and res['t_spread'] >= 2.0 and res['t_ic'] >= 2.0 and res['mean_net_spread_pct'] > 0)
    return res


def main():
    fin = pull()
    out = {'finra_days': len(fin['ratios']), 'missing_days': len(fin['missing_days']), 'names': len(NAMES),
           'H3_abnormal': run(fin, True), 'secondary_raw_ratio_not_for_pass': run(fin, False)}
    print(json.dumps(out, indent=1, default=str))
    json.dump(out, open(os.path.join(HERE, 'RESULT-2026-11-16-short-volume.json'), 'w', encoding='utf-8'), indent=1, default=str)


if __name__ == '__main__':
    main()
