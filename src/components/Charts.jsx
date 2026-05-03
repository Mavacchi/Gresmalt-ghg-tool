/* GHG Tool — Charts.jsx
 *
 * Wrapper minimi attorno a Chart.js 4. Cleanup esplicito su unmount
 * per evitare memory leak. Empty state quando non ci sono dati.
 * Pattern texture per stampa B/N.
 */
;(function (root) {
  'use strict';
  const G = (root.GHG = root.GHG || {});
  const { createElement: h, useEffect, useRef } = root.React;
  const C = G.COLORS;

  function reducedMotion () {
    return root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function ChartEmpty ({ height = 260, label = 'Nessun dato disponibile' }) {
    return h('div', {
      role: 'img', 'aria-label': label,
      style: {
        height, background: C.bg, border: `1px dashed ${C.border}`,
        borderRadius: 8, display: 'grid', placeItems: 'center',
        color: C.textLow, fontSize: 13
      }
    }, label);
  }

  function useChart (refCanvas, makeConfig, deps) {
    const chartRef = useRef(null);
    useEffect(() => {
      if (!refCanvas.current || !root.Chart) return;
      if (chartRef.current) {
        try { chartRef.current.destroy(); } catch (_) {}
        chartRef.current = null;
      }
      const cfg = makeConfig();
      cfg.options = cfg.options || {};
      if (reducedMotion()) cfg.options.animation = false;
      cfg.options.responsive = true;
      cfg.options.maintainAspectRatio = false;
      chartRef.current = new root.Chart(refCanvas.current, cfg);
      return () => {
        if (chartRef.current) {
          try { chartRef.current.destroy(); } catch (_) {}
          chartRef.current = null;
        }
      };
    }, deps);
  }

  // ────────────────────────────────────────────────────────────────────
  function ChartBar ({ data, height = 280, horizontal = false, stacked = false, ariaLabel, unit }) {
    const ref = useRef(null);
    useChart(ref, () => ({
      type: 'bar',
      data,
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        plugins: {
          legend: { position: 'top', labels: { font: { size: 11 } } },
          tooltip: tooltipUnit(unit)
        },
        scales: {
          x: { stacked, grid: { color: '#EEF1F3' }, ticks: { font: { size: 11 } } },
          y: { stacked, grid: { color: '#EEF1F3' }, ticks: { font: { size: 11 } } }
        }
      }
    }), [JSON.stringify(data), horizontal, stacked, unit]);
    if (!data || !data.datasets || !data.datasets.length || !data.labels || !data.labels.length) {
      return h(ChartEmpty, { height });
    }
    return h('div', {
      role: 'img', 'aria-label': ariaLabel || 'Grafico a barre',
      style: { height, position: 'relative' }
    }, h('canvas', { ref }));
  }

  // Helper: tooltip callback che appende l'unità al valore.
  function tooltipUnit (unit) {
    if (!unit) return undefined;
    return {
      callbacks: {
        label: (ctx) => {
          const lbl = ctx.dataset && ctx.dataset.label;
          const val = ctx.parsed && ctx.parsed.y != null ? ctx.parsed.y
                    : (typeof ctx.parsed === 'number' ? ctx.parsed : ctx.raw);
          const v = Number(val).toLocaleString('it-IT',
            { maximumFractionDigits: 2, useGrouping: 'always' });
          const head = ctx.label || lbl || '';
          return head ? `${head}: ${v} ${unit}` : `${v} ${unit}`;
        }
      }
    };
  }

  function ChartDonut ({ data, height = 260, ariaLabel, unit }) {
    const ref = useRef(null);
    useChart(ref, () => ({
      type: 'doughnut',
      data,
      options: {
        cutout: '62%',
        plugins: {
          legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } },
          tooltip: tooltipUnit(unit)
        }
      }
    }), [JSON.stringify(data), unit]);
    if (!data || !data.datasets || !data.datasets[0] || !data.datasets[0].data) {
      return h(ChartEmpty, { height });
    }
    return h('div', {
      role: 'img', 'aria-label': ariaLabel || 'Grafico a ciambella',
      style: { height, position: 'relative' }
    }, h('canvas', { ref }));
  }

  function ChartLine ({ data, height = 260, ariaLabel, unit }) {
    const ref = useRef(null);
    useChart(ref, () => ({
      type: 'line',
      data,
      options: {
        plugins: {
          legend: { position: 'top', labels: { font: { size: 11 } } },
          tooltip: tooltipUnit(unit)
        },
        scales: {
          x: { grid: { color: '#EEF1F3' }, ticks: { font: { size: 11 } } },
          y: { grid: { color: '#EEF1F3' }, ticks: { font: { size: 11 } } }
        },
        elements: {
          point: { radius: 3, hoverRadius: 5 },
          line:  { tension: .35, borderWidth: 2 }
        }
      }
    }), [JSON.stringify(data), unit]);
    if (!data || !data.datasets || !data.datasets.length) {
      return h(ChartEmpty, { height });
    }
    return h('div', {
      role: 'img', 'aria-label': ariaLabel || 'Grafico a linee',
      style: { height, position: 'relative' }
    }, h('canvas', { ref }));
  }

  G.charts = { ChartBar, ChartDonut, ChartLine, ChartEmpty };
})(typeof window !== 'undefined' ? window : globalThis);
