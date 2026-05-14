/* ===========================================
   BPLEONE TRADING - CHARTS (Chart.js helpers)
   =========================================== */

const CHART_COLORS = {
  accent: '#00d4ff',
  accentDim: 'rgba(0, 212, 255, 0.15)',
  green: '#10b981',
  greenDim: 'rgba(16, 185, 129, 0.15)',
  red: '#ef4444',
  redDim: 'rgba(239, 68, 68, 0.15)',
  yellow: '#f59e0b',
  purple: '#8b5cf6',
  grid: 'rgba(45, 55, 72, 0.5)',
  text: '#cbd5e1',
  textMuted: '#64748b'
};

// ----- Synthetic OHLC-ish price series -----
function generateSeries(start, n, vol = 0.012, drift = 0.0005) {
  const arr = [start];
  for (let i = 1; i < n; i++) {
    const r = (Math.random() - 0.5) * vol + drift;
    arr.push(+(arr[i - 1] * (1 + r)).toFixed(2));
  }
  return arr;
}

function timeLabels(n, intervalMin = 5) {
  const labels = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * intervalMin * 60000);
    labels.push(d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }));
  }
  return labels;
}

// ----- Base options -----
function baseOptions(showLegend = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: showLegend, labels: { color: CHART_COLORS.text, font: { family: 'Inter', size: 11 } } },
      tooltip: {
        backgroundColor: '#0a0e17',
        borderColor: '#2d3748',
        borderWidth: 1,
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        padding: 10,
        cornerRadius: 6,
        titleFont: { family: 'JetBrains Mono', size: 11 },
        bodyFont: { family: 'JetBrains Mono', size: 11 }
      }
    },
    scales: {
      x: {
        grid: { color: CHART_COLORS.grid, drawTicks: false },
        ticks: { color: CHART_COLORS.textMuted, font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 8 }
      },
      y: {
        grid: { color: CHART_COLORS.grid },
        ticks: { color: CHART_COLORS.textMuted, font: { family: 'JetBrains Mono', size: 10 } }
      }
    }
  };
}

// ----- Price line chart -----
function renderPriceChart(canvasId, basePrice = 100, n = 78) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const data = generateSeries(basePrice, n);
  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? CHART_COLORS.green : CHART_COLORS.red;
  const gradient = el.getContext('2d').createLinearGradient(0, 0, 0, 320);
  gradient.addColorStop(0, isUp ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  return new Chart(el, {
    type: 'line',
    data: {
      labels: timeLabels(n),
      datasets: [{
        label: 'Price',
        data,
        borderColor: color,
        backgroundColor: gradient,
        borderWidth: 2,
        tension: 0.35,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2
      }]
    },
    options: baseOptions()
  });
}

// ----- Multi-line chart (with MAs) -----
function renderPriceWithMAChart(canvasId, basePrice = 100, n = 100) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const data = generateSeries(basePrice, n, 0.015, 0.0008);
  const ma20 = data.map((_, i) => {
    const slice = data.slice(Math.max(0, i - 19), i + 1);
    return +(slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(2);
  });
  const ma50 = data.map((_, i) => {
    const slice = data.slice(Math.max(0, i - 49), i + 1);
    return +(slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(2);
  });
  return new Chart(el, {
    type: 'line',
    data: {
      labels: timeLabels(n, 60),
      datasets: [
        { label: 'Price', data, borderColor: CHART_COLORS.accent, borderWidth: 2.5, tension: 0.3, fill: false, pointRadius: 0 },
        { label: '20 MA', data: ma20, borderColor: CHART_COLORS.yellow, borderWidth: 1.5, borderDash: [4,4], tension: 0.3, fill: false, pointRadius: 0 },
        { label: '50 MA', data: ma50, borderColor: CHART_COLORS.purple, borderWidth: 1.5, borderDash: [6,3], tension: 0.3, fill: false, pointRadius: 0 }
      ]
    },
    options: baseOptions(true)
  });
}

// ----- RSI chart -----
function renderRSIChart(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const n = 60;
  const data = [];
  let rsi = 50;
  for (let i = 0; i < n; i++) {
    rsi += (Math.random() - 0.5) * 8;
    rsi = Math.max(20, Math.min(85, rsi));
    data.push(+rsi.toFixed(1));
  }
  return new Chart(el, {
    type: 'line',
    data: {
      labels: timeLabels(n, 60),
      datasets: [{
        label: 'RSI(14)',
        data,
        borderColor: CHART_COLORS.purple,
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        borderWidth: 2,
        tension: 0.3,
        fill: true,
        pointRadius: 0
      }]
    },
    options: {
      ...baseOptions(),
      scales: {
        ...baseOptions().scales,
        y: {
          ...baseOptions().scales.y,
          min: 0, max: 100,
          ticks: { ...baseOptions().scales.y.ticks, stepSize: 20 }
        }
      },
      plugins: {
        ...baseOptions().plugins,
        annotation: {}
      }
    }
  });
}

// ----- Volume / bar chart -----
function renderVolumeChart(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const n = 30;
  const data = Array.from({length: n}, () => Math.floor(Math.random() * 100) + 20);
  const colors = data.map(v => v > 70 ? CHART_COLORS.green : v > 40 ? CHART_COLORS.accent : CHART_COLORS.red);
  return new Chart(el, {
    type: 'bar',
    data: {
      labels: timeLabels(n, 60),
      datasets: [{ data, backgroundColor: colors, borderRadius: 2, borderSkipped: false }]
    },
    options: { ...baseOptions(), plugins: { ...baseOptions().plugins, legend: { display: false } } }
  });
}

// ----- Sector heatmap (horizontal bars) -----
function renderSectorChart(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const sectors = [
    { name: 'Technology', chg: 1.84 },
    { name: 'Comm Services', chg: 1.42 },
    { name: 'Consumer Disc', chg: 0.92 },
    { name: 'Financials', chg: 0.41 },
    { name: 'Healthcare', chg: 0.18 },
    { name: 'Industrials', chg: -0.08 },
    { name: 'Materials', chg: -0.34 },
    { name: 'Real Estate', chg: -0.61 },
    { name: 'Utilities', chg: -0.78 },
    { name: 'Consumer Stpl', chg: -0.92 },
    { name: 'Energy', chg: -1.24 }
  ];
  return new Chart(el, {
    type: 'bar',
    data: {
      labels: sectors.map(s => s.name),
      datasets: [{
        data: sectors.map(s => s.chg),
        backgroundColor: sectors.map(s => s.chg >= 0 ? CHART_COLORS.green : CHART_COLORS.red),
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: baseOptions().plugins.tooltip
      },
      scales: {
        x: { grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.textMuted, font: { family: 'JetBrains Mono', size: 10 }, callback: v => v + '%' }},
        y: { grid: { display: false }, ticks: { color: CHART_COLORS.text, font: { family: 'Inter', size: 11 } } }
      }
    }
  });
}

// ----- Options flow donut (call/put ratio) -----
function renderFlowDonut(canvasId, callPct = 62, putPct = 38) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  return new Chart(el, {
    type: 'doughnut',
    data: {
      labels: ['Calls', 'Puts'],
      datasets: [{
        data: [callPct, putPct],
        backgroundColor: [CHART_COLORS.green, CHART_COLORS.red],
        borderColor: '#0a0e17',
        borderWidth: 3,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: CHART_COLORS.text, font: { family: 'Inter', size: 11 }, padding: 12 } },
        tooltip: baseOptions().plugins.tooltip
      }
    }
  });
}

// ----- Performance comparison chart -----
function renderPerfChart(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const n = 60;
  return new Chart(el, {
    type: 'line',
    data: {
      labels: Array.from({length: n}, (_, i) => `D${i+1}`),
      datasets: [
        { label: 'bpleone Picks', data: generateSeries(100, n, 0.018, 0.0028), borderColor: CHART_COLORS.accent, borderWidth: 2.5, tension: 0.3, pointRadius: 0, fill: false },
        { label: 'SPY', data: generateSeries(100, n, 0.012, 0.0008), borderColor: CHART_COLORS.textMuted, borderWidth: 2, tension: 0.3, pointRadius: 0, fill: false, borderDash: [4,4] }
      ]
    },
    options: baseOptions(true)
  });
}

// ----- IV smile -----
function renderIVSmile(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const strikes = [80, 90, 100, 110, 120];
  const ivs = [42, 32, 28, 33, 44];
  return new Chart(el, {
    type: 'line',
    data: {
      labels: strikes.map(s => `${s}%`),
      datasets: [{
        label: 'IV %',
        data: ivs,
        borderColor: CHART_COLORS.accent,
        backgroundColor: CHART_COLORS.accentDim,
        borderWidth: 2.5,
        tension: 0.4,
        fill: true,
        pointRadius: 5,
        pointBackgroundColor: CHART_COLORS.accent
      }]
    },
    options: baseOptions()
  });
}

// ----- Options OI by strike -----
function renderOIByStrike(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const strikes = ['540','545','550','555','560','565','570','575','580'];
  const calls = [4200, 5100, 7300, 12400, 18900, 14200, 9800, 6300, 3100];
  const puts = [-3100, -5800, -8200, -11000, -9400, -6200, -4100, -2800, -1500];
  return new Chart(el, {
    type: 'bar',
    data: {
      labels: strikes,
      datasets: [
        { label: 'Calls OI', data: calls, backgroundColor: CHART_COLORS.green, borderRadius: 2 },
        { label: 'Puts OI', data: puts, backgroundColor: CHART_COLORS.red, borderRadius: 2 }
      ]
    },
    options: {
      ...baseOptions(true),
      scales: {
        x: { ...baseOptions().scales.x, stacked: false },
        y: { ...baseOptions().scales.y, ticks: { ...baseOptions().scales.y.ticks, callback: v => Math.abs(v) >= 1000 ? (Math.abs(v)/1000).toFixed(0)+'k' : Math.abs(v) }}
      }
    }
  });
}

// ----- MACD chart -----
function renderMACD(canvasId) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const n = 60;
  const macd = Array.from({length: n}, (_, i) => Math.sin(i / 8) * 1.8 + (Math.random() - 0.5) * 0.4);
  const signal = macd.map((_, i) => {
    const slice = macd.slice(Math.max(0, i - 8), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const hist = macd.map((m, i) => +(m - signal[i]).toFixed(3));
  return new Chart(el, {
    data: {
      labels: timeLabels(n, 60),
      datasets: [
        { type: 'bar', label: 'Histogram', data: hist, backgroundColor: hist.map(v => v >= 0 ? CHART_COLORS.green : CHART_COLORS.red) },
        { type: 'line', label: 'MACD', data: macd, borderColor: CHART_COLORS.accent, borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { type: 'line', label: 'Signal', data: signal, borderColor: CHART_COLORS.yellow, borderWidth: 1.5, pointRadius: 0, tension: 0.3, borderDash: [3,3] }
      ]
    },
    options: baseOptions(true)
  });
}
