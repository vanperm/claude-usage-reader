(() => {
  'use strict';

  const fmtMoney = (n) => (n == null ? '—' : `$${n.toFixed(2)}`);
  const fmtTokens = (n) => {
    if (n == null) return '—';
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    return n.toLocaleString();
  };
  const CAT_COLORS = ['--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5', '--cat-6', '--cat-7', '--cat-8'];

  let lastUsage = null;
  let lastWebchat = null;

  const escapeHtml = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function shortPath(p) {
    const parts = String(p).split('/').filter(Boolean);
    const short = parts.length <= 2 ? p : `…/${parts.slice(-2).join('/')}`;
    return `<span title="${escapeHtml(p)}">${escapeHtml(short)}</span>`;
  }

  const tooltip = document.getElementById('tooltip');
  function showTooltip(evt, text) {
    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.style.left = `${evt.clientX + 12}px`;
    tooltip.style.top = `${evt.clientY + 12}px`;
  }
  function hideTooltip() { tooltip.hidden = true; }

  // ---------- Tabs ----------
  const tabsEl = document.querySelector('.tabs');
  const tabIndicator = document.createElement('div');
  tabIndicator.className = 'tab-indicator';
  tabsEl.prepend(tabIndicator);

  function moveIndicatorTo(btn) {
    tabIndicator.style.width = `${btn.offsetWidth}px`;
    tabIndicator.style.transform = `translateX(${btn.offsetLeft}px)`;
  }

  function rerenderVisibleCharts(tabName) {
    if (tabName === 'code' && lastUsage) renderUsageCharts(lastUsage);
    if (tabName === 'webchat' && lastWebchat) renderWebchatChart(lastWebchat);
  }

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', 'false'));
      btn.setAttribute('aria-selected', 'true');
      document.querySelectorAll('.panel').forEach((p) => { p.hidden = true; });
      document.getElementById(`panel-${btn.dataset.tab}`).hidden = false;
      moveIndicatorTo(btn);
      requestAnimationFrame(() => rerenderVisibleCharts(btn.dataset.tab));
    });
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const active = document.querySelector('.tab[aria-selected="true"]');
      if (active) rerenderVisibleCharts(active.dataset.tab);
    }, 150);
  });

  window.addEventListener('load', () => {
    const active = document.querySelector('.tab[aria-selected="true"]');
    if (active) moveIndicatorTo(active);
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      const active = document.querySelector('.tab[aria-selected="true"]');
      if (active) moveIndicatorTo(active);
    });
  }

  // ---------- Charts (SVG, shared scale/grid) ----------
  const CHART_H = 220;
  const CHART_MARGIN = { top: 16, right: 14, bottom: 30, left: 50 };

  function niceMax(v) {
    if (v <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const norm = v / mag;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  function fmtTick(v) {
    if (v === 0) return '$0';
    if (v < 10) return `$${v.toFixed(1)}`;
    return `$${Math.round(v)}`;
  }

  // 1 viewBox unit == 1 real CSS pixel (viewBox width == measured container width),
  // so SVG text never gets non-uniformly scaled/stretched by preserveAspectRatio.
  function buildScale(items, valueKey, W) {
    const plotW = W - CHART_MARGIN.left - CHART_MARGIN.right;
    const plotH = CHART_H - CHART_MARGIN.top - CHART_MARGIN.bottom;
    const max = niceMax(Math.max(...items.map((d) => d[valueKey]), 0.0001) * 1.08);
    const n = items.length;
    const x = (i) => CHART_MARGIN.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const bandX = (i) => CHART_MARGIN.left + (i + 0.5) * (plotW / n);
    const y = (v) => CHART_MARGIN.top + plotH - (v / max) * plotH;
    const baseline = y(0);
    return { W, plotW, plotH, max, x, bandX, y, baseline, n };
  }

  function gridMarkup(scale) {
    const ticks = [0, scale.max * 0.5, scale.max];
    return ticks
      .map((v) => {
        const yy = scale.y(v);
        return `<line x1="${CHART_MARGIN.left}" y1="${yy}" x2="${scale.W - CHART_MARGIN.right}" y2="${yy}" class="grid-line" />
<text x="${CHART_MARGIN.left - 8}" y="${yy + 4}" class="grid-label" text-anchor="end">${fmtTick(v)}</text>`;
      })
      .join('');
  }

  function truncateLabel(s, max) {
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }

  function xLabelsMarkup(items, labelKey, scale, xFn) {
    const fn = xFn || scale.x;
    const step = Math.max(1, Math.ceil(items.length / 7));
    const maxLen = Math.max(6, Math.floor((scale.plotW / items.length) / 6));
    return items
      .map((item, i) => {
        if (i % step !== 0 && i !== items.length - 1) return '';
        return `<text x="${fn(i)}" y="${CHART_H - 8}" class="grid-x-label" text-anchor="middle">${escapeHtml(truncateLabel(String(item[labelKey]), maxLen))}</text>`;
      })
      .join('');
  }

  function wireChartHover(svg, items, scale, formatTooltip, hitSelector) {
    svg.querySelectorAll(hitSelector).forEach((el) => {
      const i = Number(el.dataset.i);
      const item = items[i];
      el.addEventListener('mouseenter', (e) => showTooltip(e, formatTooltip(item)));
      el.addEventListener('mousemove', (e) => showTooltip(e, formatTooltip(item)));
      el.addEventListener('mouseleave', hideTooltip);
    });
  }

  function renderLineChart(container, items, { valueKey, labelKey, formatTooltip }) {
    container.innerHTML = '';
    if (!items.length) {
      container.classList.add('empty');
      container.textContent = 'No data yet.';
      return;
    }
    container.classList.remove('empty');
    const W = container.clientWidth || 640;
    const scale = buildScale(items, valueKey, W);

    const points = items.map((item, i) => ({ x: scale.x(i), y: scale.y(item[valueKey]) }));
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)},${scale.baseline} L ${points[0].x.toFixed(1)},${scale.baseline} Z`;

    const dots = points
      .map((p, i) => {
        const isLast = i === points.length - 1;
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isLast ? 5 : 3.5}" class="lc-dot${isLast ? ' lc-dot-last' : ''}" />
<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="12" class="lc-hit" data-i="${i}" fill="transparent" />`;
      })
      .join('');

    container.innerHTML = `<svg viewBox="0 0 ${W} ${CHART_H}" class="line-chart">
<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="var(--gold)" stop-opacity="0.32" />
<stop offset="100%" stop-color="var(--gold)" stop-opacity="0" />
</linearGradient></defs>
${gridMarkup(scale)}
<path d="${areaPath}" fill="url(#areaGrad)" stroke="none" />
<path d="${linePath}" fill="none" class="lc-line" />
${dots}
${xLabelsMarkup(items, labelKey, scale)}
</svg>`;

    wireChartHover(container, items, scale, formatTooltip, '.lc-hit');
  }

  function roundedTopBarPath(x, w, yTop, yBase, r) {
    const rr = Math.max(0, Math.min(r, w / 2, Math.max(0, yBase - yTop)));
    return `M ${x},${yBase} L ${x},${yTop + rr} Q ${x},${yTop} ${x + rr},${yTop} L ${x + w - rr},${yTop} Q ${x + w},${yTop} ${x + w},${yTop + rr} L ${x + w},${yBase} Z`;
  }

  function renderCatBarChart(container, items, { valueKey, labelKey, formatTooltip }) {
    container.innerHTML = '';
    if (!items.length) {
      container.classList.add('empty');
      container.textContent = 'No data yet.';
      return;
    }
    container.classList.remove('empty');
    const W = container.clientWidth || 640;
    const scale = buildScale(items, valueKey, W);
    const slot = scale.plotW / items.length;
    const barW = Math.min(slot * 0.5, 46);

    const bars = items
      .map((item, i) => {
        const cx = scale.bandX(i);
        const yTop = scale.y(item[valueKey]);
        const path = roundedTopBarPath(cx - barW / 2, barW, Math.min(yTop, scale.baseline - 2), scale.baseline, 4);
        const color = `var(${CAT_COLORS[i % CAT_COLORS.length]})`;
        return `<path d="${path}" fill="${color}" class="bar-shape" data-i="${i}" />`;
      })
      .join('');

    container.innerHTML = `<svg viewBox="0 0 ${W} ${CHART_H}" class="line-chart">
${gridMarkup(scale)}
${bars}
${xLabelsMarkup(items, labelKey, scale, scale.bandX)}
</svg>`;

    wireChartHover(container, items, scale, formatTooltip, '.bar-shape');
  }

  // ---------- Stat tiles ----------
  function renderStats(container, tiles) {
    container.innerHTML = '';
    tiles.forEach(({ label, value, unpriced }) => {
      const tile = document.createElement('div');
      tile.className = 'stat-tile';
      tile.innerHTML = `<div class="label">${label}</div><div class="value${unpriced ? ' unpriced' : ''}">${value}</div>`;
      container.appendChild(tile);
    });
  }

  // ---------- Tables ----------
  function renderTable(el, columns, rows) {
    if (!rows.length) {
      el.innerHTML = '<tbody><tr><td class="muted">No data yet.</td></tr></tbody>';
      return;
    }
    const thead = `<thead><tr>${columns.map((c) => `<th class="${c.num ? 'num' : ''}">${c.header}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${rows.map((row) => `<tr>${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render(row)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    el.innerHTML = thead + tbody;
  }

  // ---------- Claude Code tab ----------
  function renderUsageCharts(data) {
    renderLineChart(document.getElementById('code-day-chart'), data.byDay, {
      valueKey: 'cost',
      labelKey: 'day',
      formatTooltip: (d) => `${d.day}: ${fmtMoney(d.cost)} (${fmtTokens(d.totalTokens)} tok)${d.unpriced ? ' *unpriced included' : ''}`,
    });

    renderCatBarChart(document.getElementById('code-model-chart'), data.byModel, {
      valueKey: 'cost',
      labelKey: 'model',
      formatTooltip: (d) => `${d.model}: ${fmtMoney(d.cost)} (${fmtTokens(d.totalTokens)} tok)${d.unpriced ? ' — unpriced' : ''}`,
    });
  }

  async function loadUsage() {
    const res = await fetch('/api/usage');
    const data = await res.json();
    lastUsage = data;

    renderStats(document.getElementById('code-stats'), [
      { label: 'Total tokens', value: fmtTokens(data.overall.totalTokens) },
      { label: 'Total cost', value: fmtMoney(data.overall.cost), unpriced: data.overall.unpriced },
      { label: 'Messages', value: fmtTokens(data.overall.messages) },
      { label: 'Sessions', value: fmtTokens(data.sessions.length) },
    ]);

    const noteEl = document.getElementById('code-unpriced-note');
    noteEl.hidden = !data.overall.unpriced;

    renderUsageCharts(data);

    const stamp = document.getElementById('last-scanned');
    if (stamp) stamp.textContent = new Date().toLocaleTimeString();

    renderTable(
      document.getElementById('code-project-table'),
      [
        { header: 'Project', render: (r) => shortPath(r.project) },
        { header: 'Tokens', num: true, render: (r) => fmtTokens(r.totalTokens) },
        { header: 'Cost', num: true, render: (r) => (r.unpriced ? `${fmtMoney(r.cost)} *` : fmtMoney(r.cost)) },
      ],
      [...data.byProject].sort((a, b) => b.totalTokens - a.totalTokens)
    );

    renderTable(
      document.getElementById('code-session-table'),
      [
        { header: 'Last active', render: (r) => (r.lastTimestamp || '').replace('T', ' ').slice(0, 19) },
        { header: 'Project', render: (r) => shortPath(r.project) },
        { header: 'Model(s)', render: (r) => escapeHtml(r.models.join(', ')) },
        { header: 'Tokens', num: true, render: (r) => fmtTokens(r.totalTokens) },
        { header: 'Cost', num: true, render: (r) => (r.unpriced ? `${fmtMoney(r.cost)} *` : fmtMoney(r.cost)) },
      ],
      data.sessions.slice(0, 50)
    );
  }

  // ---------- Pricing tab ----------
  async function loadPricing() {
    const res = await fetch('/api/pricing');
    const pricing = await res.json();

    const rows = Object.entries(pricing.models).map(([model, rate]) => ({ model, ...rate }));
    renderTable(
      document.getElementById('pricing-table'),
      [
        { header: 'Model', render: (r) => r.model },
        { header: 'Input $/MTok', num: true, render: (r) => r.input.toFixed(2) },
        { header: 'Output $/MTok', num: true, render: (r) => r.output.toFixed(2) },
      ],
      rows.sort((a, b) => (a.model > b.model ? 1 : -1))
    );

    const select = document.getElementById('webchat-model');
    select.innerHTML = rows
      .sort((a, b) => (a.model > b.model ? 1 : -1))
      .map((r) => `<option value="${r.model}" ${r.model === 'claude-sonnet-5' ? 'selected' : ''}>${r.model}</option>`)
      .join('');

    return pricing;
  }

  document.getElementById('pricing-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const model = document.getElementById('pf-model').value.trim();
    const input = parseFloat(document.getElementById('pf-input').value);
    const output = parseFloat(document.getElementById('pf-output').value);
    if (!model || Number.isNaN(input) || Number.isNaN(output)) return;

    await fetch('/api/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, output }),
    });

    e.target.reset();
    await loadPricing();
    await loadUsage();
  });

  // ---------- Web chat import ----------
  function extractText(msg) {
    if (typeof msg.text === 'string') return msg.text;
    if (Array.isArray(msg.content)) {
      return msg.content.map((block) => (typeof block.text === 'string' ? block.text : '')).join(' ');
    }
    return '';
  }

  function normalizeSender(msg) {
    const s = (msg.sender || msg.role || '').toLowerCase();
    return s === 'human' || s === 'user' ? 'human' : 'assistant';
  }

  function parseExport(raw) {
    const root = JSON.parse(raw);
    const conversations = Array.isArray(root) ? root : root.conversations || [];
    return conversations.map((conv) => ({
      name: conv.name || conv.title || '(untitled)',
      createdAt: conv.created_at || conv.createdAt || conv.create_time || null,
      messages: (conv.chat_messages || conv.messages || []).map((msg) => ({
        sender: normalizeSender(msg),
        text: extractText(msg),
      })),
    }));
  }

  let pendingConversations = null;
  const fileInput = document.getElementById('webchat-file');
  const importBtn = document.getElementById('webchat-import-btn');
  const statusEl = document.getElementById('webchat-status');

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const raw = await file.text();
      pendingConversations = parseExport(raw);
      statusEl.textContent = `Parsed ${pendingConversations.length} conversation(s). Ready to import.`;
      importBtn.disabled = false;
    } catch (err) {
      statusEl.textContent = `Could not parse file: ${err.message}`;
      pendingConversations = null;
      importBtn.disabled = true;
    }
  });

  importBtn.addEventListener('click', async () => {
    if (!pendingConversations) return;
    const model = document.getElementById('webchat-model').value;
    statusEl.textContent = 'Importing…';
    const res = await fetch('/api/import-webchat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, conversations: pendingConversations }),
    });
    const data = await res.json();
    statusEl.textContent = `Imported ${data.conversations.length} conversation(s) at ${new Date(data.importedAt).toLocaleString()}.`;
    renderWebchat(data);
  });

  function renderWebchatChart(data) {
    renderLineChart(document.getElementById('webchat-day-chart'), data.byDay, {
      valueKey: 'cost',
      labelKey: 'day',
      formatTooltip: (d) => `${d.day}: ${fmtMoney(d.cost)} (~${fmtTokens(d.totalTokens)} tok)`,
    });
  }

  function renderWebchat(data) {
    if (!data) return;
    lastWebchat = data;
    document.getElementById('webchat-results').hidden = false;

    renderStats(document.getElementById('webchat-stats'), [
      { label: 'Estimated tokens', value: fmtTokens(data.overall.inputTokens + data.overall.outputTokens) },
      { label: 'Estimated cost', value: fmtMoney(data.overall.cost), unpriced: data.overall.unpriced },
      { label: 'Conversations', value: fmtTokens(data.conversations.length) },
      { label: 'Priced against', value: data.model },
    ]);

    renderWebchatChart(data);

    renderTable(
      document.getElementById('webchat-conv-table'),
      [
        { header: 'Conversation', render: (r) => escapeHtml(r.name) },
        { header: 'Date', render: (r) => (r.createdAt || '').slice(0, 10) || '—' },
        { header: 'Est. tokens', num: true, render: (r) => fmtTokens(r.totalTokens) },
        { header: 'Est. cost', num: true, render: (r) => fmtMoney(r.cost) },
      ],
      data.conversations
    );
  }

  async function loadSavedWebchat() {
    const res = await fetch('/api/webchat');
    const data = await res.json();
    if (data) renderWebchat(data);
  }

  // ---------- Refresh ----------
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.classList.add('spinning');
      try {
        await loadUsage();
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('spinning');
      }
    });
  }

  // ---------- Init ----------
  (async function init() {
    await loadPricing();
    await loadUsage();
    await loadSavedWebchat();
  })();
})();
