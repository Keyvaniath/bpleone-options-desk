"""One run of the two hypotheses in PREREG-2026-11-16-relative-brain.md. No parameter search.

Data: the desk's Worker (/brain/history = Yahoo daily closes, 1 year; /brain/earnings-history = SEC EDGAR 8-K Item 2.02
report dates and release timing). Writes RESULT-2026-11-16-relative-brain.md beside this file and a JSON cache of the
pulled data (so the run is reproducible without refetching).
"""
import json, math, os, statistics, sys, time, urllib.request, datetime
from zoneinfo import ZoneInfo

W = 'https://bpleone-brain-worker.brandonpleone.workers.dev'
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'data-2026-11-16.json')
ET = ZoneInfo('America/New_York')
UNIVERSE = ('AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO BRK-B JPM LLY V UNH XOM MA JNJ PG HD COST ABBV MRK CVX WMT BAC KO '
            'PEP NFLX ADBE CRM AMD ORCL TMO ACN MCD CSCO ABT LIN DHR WFC INTU TXN DIS VZ PM CMCSA NEE IBM AMGN QCOM CAT '
            'GE HON UNP SPGI AMAT LOW BA RTX GS ISRG NOW PFE BKNG T ELV MS INTC BLK DE SBUX MDT PLD GILD AXP LMT ADP SYK '
            'MDLZ TJX ADI C MMC CB VRTX AMT CI REGN SCHW MO SO ZTS BMY DUK LRCX MU PANW KLAC SNPS CDNS UBER PLTR').split()


def get(path):
    req = urllib.request.Request(W + path, headers={'User-Agent': 'desk-research'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode('utf-8'))


def pull():
    if os.path.exists(CACHE):
        return json.load(open(CACHE, encoding='utf-8'))
    data = {'pulled_at': datetime.datetime.now(ET).isoformat(), 'closes': {}, 'earnings': {}, 'failed': []}
    for sym in ['SPY'] + UNIVERSE:
        try:
            j = get('/brain/history?sym=' + sym)
            byday = {}
            for p in j.get('closes', []):
                if p.get('c') and p.get('t'):
                    byday[datetime.datetime.fromtimestamp(p['t'] / 1000, ET).strftime('%Y-%m-%d')] = p['c']
            if len(byday) >= 200:
                data['closes'][sym] = byday
            else:
                data['failed'].append(sym + ':closes')
        except Exception as e:
            data['failed'].append(sym + ':' + type(e).__name__)
        time.sleep(0.25)
        if sym == 'SPY':
            continue
        try:
            j = get('/brain/earnings-history?src=edgar&symbol=' + sym)
            data['earnings'][sym] = [{'date': e['date'], 'hour': e.get('hour')} for e in j.get('earnings', [])]
        except Exception as e:
            data['failed'].append(sym + ':earnings-' + type(e).__name__)
        time.sleep(0.25)
    json.dump(data, open(CACHE, 'w', encoding='utf-8'))
    return data


def tstat(xs):
    if len(xs) < 3:
        return float('nan')
    sd = statistics.stdev(xs)
    return statistics.mean(xs) / (sd / math.sqrt(len(xs))) if sd > 0 else float('nan')


def ranks(v):
    order = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2
        i = j + 1
    return r


def spearman(a, b):
    ra, rb = ranks(a), ranks(b)
    ma, mb = statistics.mean(ra), statistics.mean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return num / den if den else 0.0


def h1(data):
    spy = data['closes']['SPY']
    days = sorted(spy)
    names = [s for s in UNIVERSE if s in data['closes']]
    spreads, ics, weeks = [], [], []
    for i in range(5, len(days) - 5, 5):
        d0, dp, df = days[i], days[i - 5], days[i + 5]
        sp_past, sp_fwd = spy[d0] / spy[dp] - 1, spy[df] / spy[d0] - 1
        rows = []
        for s in names:
            c = data['closes'][s]
            if d0 in c and dp in c and df in c:
                rows.append((c[d0] / c[dp] - 1 - sp_past, c[df] / c[d0] - 1 - sp_fwd))
        if len(rows) < 40:
            continue
        rows.sort(key=lambda r: r[0])
        q = len(rows) // 5
        losers, winners = rows[:q], rows[-q:]
        spreads.append(statistics.mean(r[1] for r in losers) - statistics.mean(r[1] for r in winners))
        ics.append(-spearman([r[0] for r in rows], [r[1] for r in rows]))
        weeks.append(d0)
    net = [s - 0.004 for s in spreads]
    res = {'weeks': len(spreads), 'first': weeks[0] if weeks else None, 'last': weeks[-1] if weeks else None,
           'mean_spread_pct': statistics.mean(spreads) * 100, 't_spread': tstat(spreads),
           'mean_rev_ic': statistics.mean(ics), 't_ic': tstat(ics),
           'mean_net_spread_pct': statistics.mean(net) * 100, 'hit_weeks': sum(1 for s in spreads if s > 0)}
    res['PASS'] = bool(res['mean_spread_pct'] > 0 and res['t_spread'] >= 2.0 and res['t_ic'] >= 2.0 and res['mean_net_spread_pct'] > 0)
    return res


def h2(data):
    spy = data['closes']['SPY']
    days = sorted(spy)
    idx = {d: i for i, d in enumerate(days)}
    events = []
    for s, evs in data['earnings'].items():
        c = data['closes'].get(s)
        if not c:
            continue
        for e in evs:
            d = e['date']
            if d not in idx:
                continue
            i = idx[d]
            if e.get('hour') == 'amc':
                a, b = i, i + 1
            else:
                a, b = i - 1, i
            if a < 0 or b + 10 >= len(days):
                continue
            da, db, df = days[a], days[b], days[b + 10]
            if not (da in c and db in c and df in c):
                continue
            react = c[db] / c[da] - 1 - (spy[db] / spy[da] - 1)
            fwd = c[df] / c[db] - 1 - (spy[df] / spy[db] - 1)
            wk = datetime.date.fromisoformat(d).isocalendar()
            events.append({'sym': s, 'date': d, 'week': '%d-W%02d' % (wk[0], wk[1]), 'react': react, 'fwd': fwd})
    if len(events) < 25:
        return {'events': len(events), 'PASS': False, 'note': 'too few events'}
    rs = sorted(e['react'] for e in events)
    lo, hi = rs[len(rs) // 5], rs[-(len(rs) // 5) - 1]
    byweek = {}
    for e in events:
        if e['react'] >= hi:
            byweek.setdefault(e['week'], []).append(e['fwd'])
        elif e['react'] <= lo:
            byweek.setdefault(e['week'], []).append(-e['fwd'])
    obs = [statistics.mean(v) for v in byweek.values()]
    net = [o - 0.004 for o in obs]
    top = [e['fwd'] for e in events if e['react'] >= hi]
    bot = [e['fwd'] for e in events if e['react'] <= lo]
    res = {'events': len(events), 'extreme_events': len(top) + len(bot), 'weeks': len(obs),
           'mean_signed_fwd_pct': statistics.mean(obs) * 100, 't_weeks': tstat(obs),
           'mean_net_pct': statistics.mean(net) * 100,
           'top_quintile_fwd_pct': statistics.mean(top) * 100, 'bottom_quintile_fwd_pct': statistics.mean(bot) * 100,
           'react_breaks_pct': [lo * 100, hi * 100]}
    res['PASS'] = bool(res['mean_signed_fwd_pct'] > 0 and res['t_weeks'] >= 2.0 and res['weeks'] >= 20 and res['mean_net_pct'] > 0)
    return res


def main():
    data = pull()
    r1, r2 = h1(data), h2(data)
    out = {'pulled_at': data['pulled_at'], 'names_priced': len(data['closes']) - 1, 'failed': data['failed'], 'H1': r1, 'H2': r2}
    print(json.dumps(out, indent=1, default=str))
    with open(os.path.join(HERE, 'RESULT-2026-11-16-relative-brain.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, default=str)


if __name__ == '__main__':
    main()
