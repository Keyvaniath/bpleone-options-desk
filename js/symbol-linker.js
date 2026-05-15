/* ===========================================
   BPLEONE TRADING - SYMBOL AUTO-LINKER
   ---
   Scans text in marked containers for 3-5 letter
   uppercase tickers and wraps them in a clickable
   chip → trade-ticket?sym=X.
   Activates on any element with class "auto-link-symbols".
   =========================================== */

const SymbolLinker = (function () {
  // Conservative blocklist — common words that look like tickers but aren't
  const BLOCK = new Set([
    'A','I','THE','AND','OR','FOR','BUT','NOT','YOU','ARE','BE','TO','OF','IN','ON','AT',
    'IT','IS','AS','BY','IF','SO','WE','HE','SHE','HIS','HER','HIM','OUR','THEY','THEIR',
    'WHO','WHAT','WHEN','WHERE','WHY','HOW','THIS','THAT','THESE','THOSE','THAN','THEN',
    'WILL','CAN','HAS','HAVE','HAD','GET','GOT','MAY','SHOULD','WOULD','COULD','DO','DID',
    'API','CEO','CFO','CTO','COO','USD','EUR','GBP','JPY','GMT','EST','PST','PDT','UTC','PM','AM',
    'NEW','OLD','BIG','TOP','LOW','HIGH','OPEN','CLOSE','LIVE','PRO','PDF','HTML','JSON','URL',
    'YTD','MTD','WTD','EOD','EOM','EOY','TBD','TBA','LLC','INC','CORP','LTD','PLC','OK','OKAY',
    'P','E','EPS','PE','PEG','PB','PS','PCF','ROIC','ROCE','ROE','EBIT','EBITDA','DCF','GAAP',
    'SEC','FDA','DOJ','IRS','FBI','CIA','NSA','EPA','FTC','FCC','HHS','DOD','VA','SBA',
    'III','IV','VII','VIII','IX','MMXX','MMXXI','MMXXII','MMXXIII','MMXXIV','MMXXV',
    'BUY','SELL','HOLD','LONG','SHORT','BULL','BEAR','CALL','PUT','RISK','SIZE','STOP','TARGET'
  ]);

  // Known valid tickers in our universe (expanded match list)
  let KNOWN = null;
  function getKnown() {
    if (KNOWN) return KNOWN;
    if (typeof QUOTES === 'undefined') return new Set();
    KNOWN = new Set(Object.keys(QUOTES));
    // Append common tickers that may not be in QUOTES seed
    ['AAPL','MSFT','GOOGL','META','AMZN','NVDA','TSLA','AMD','SPY','QQQ','IWM','DIA',
     'BTC','ETH','SOL','BNB','XRP','ADA','DOGE',
     'JPM','BAC','GS','MS','C','WFC','BLK','SCHW',
     'XOM','CVX','COP','EOG','OXY','SLB',
     'PFE','JNJ','LLY','MRK','ABBV','UNH','GILD','BMY',
     'DIS','NFLX','CMCSA','T','VZ','TMUS',
     'COIN','MARA','RIOT','HOOD','SOFI','SQ','PYPL','AFRM',
     'WMT','TGT','COST','HD','LOW','BBY','KSS',
     'F','GM','RIVN','LCID','XPEV','LI','NIO',
     'BA','LMT','RTX','NOC','GD','HII',
     'GLD','SLV','USO','UNG','DBA','TLT','IEF','SHY','HYG','LQD',
     'VXX','UVXY','UUP','FXE','FXY','FXI','EWJ','EWG'].forEach(s => KNOWN.add(s));
    return KNOWN;
  }

  function shouldLink(token) {
    if (!token) return false;
    if (token.length < 1 || token.length > 6) return false;
    if (BLOCK.has(token)) return false;
    // Must be in our known universe to avoid false positives
    return getKnown().has(token);
  }

  function chip(sym) {
    return `<a href="trade-ticket.html?sym=${sym}" title="${sym} → Trade Ticket" style="display:inline-block;padding:1px 5px;margin:0 1px;border-radius:3px;background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.25);color:var(--accent);text-decoration:none;font-family:var(--font-mono);font-size:0.92em;">${sym}</a>`;
  }

  function linkifyText(text) {
    return text.replace(/\b([A-Z]{1,6})\b/g, (match) => {
      return shouldLink(match) ? chip(match) : match;
    });
  }

  function linkifyNode(node) {
    if (!node) return;
    // Skip if already inside an <a> or has a no-link attr
    if (node.closest && (node.closest('a') || node.closest('[data-no-symbol-link]'))) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: tn => {
        if (!tn.textContent || !/\b[A-Z]{1,6}\b/.test(tn.textContent)) return NodeFilter.FILTER_REJECT;
        if (tn.parentElement && tn.parentElement.closest && tn.parentElement.closest('a, code, pre, script, style, [data-no-symbol-link]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);
    targets.forEach(textNode => {
      const html = linkifyText(textNode.textContent);
      if (html === textNode.textContent) return;
      const span = document.createElement('span');
      span.innerHTML = html;
      textNode.parentNode.replaceChild(span, textNode);
    });
  }

  function autoActivate() {
    document.querySelectorAll('.auto-link-symbols').forEach(linkifyNode);
  }

  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(autoActivate, 300));
    } else {
      setTimeout(autoActivate, 300);
    }
    // Re-run when DOM changes (debounced)
    let timer = null;
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(autoActivate, 500);
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', () => obs.observe(document.body, { childList: true, subtree: true }));
  }

  return { linkifyText, linkifyNode, autoActivate };
})();
if (typeof window !== 'undefined') window.SymbolLinker = SymbolLinker;
