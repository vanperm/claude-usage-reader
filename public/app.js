(() => {
  'use strict';

  const fmtMoney = (n) => (n == null ? '—' : `$${n.toFixed(2)}`);
  const fmtTokens = (n) => (n == null ? '—' : n.toLocaleString());
  const CAT_COLORS = ['--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5', '--cat-6', '--cat-7', '--cat-8'];

  const tooltip = document.getElementById('tooltip');
  function showTooltip(evt, text) {
    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.style.left = `${evt.clientX + 12}px`;
    tooltip.style.top = `${evt.clientY + 12}px`;
  }
  function hideTooltip() { tooltip.hidden = true; }

  // ---------- Tabs ----------
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', 'false'));
      btn.setAttribute('aria-selected', 'true');
      document.querySelectorAll('.panel').forEach((p) => { p.hidden = true; });
      document.getElementById(`panel-${btn.dataset.tab}`).hidden = false;
    });
  });

  // ---------- Bar chart ----------
  function renderBarChart(container, items, { valueKey, labelKey, colorVar, formatValue, formatTooltip }) {
    container.innerHTML = '';
    if (!items.length) {
      container.classList.add('empty');
      container.textContent = 'No data yet.';
      return;
    }
    container.classList.remove('empty');

    const max = Math.max(...items.map((d) => d[valueKey]), 0.0001);
    const rootStyle = getComputedStyle(document.documentElement);

    items.forEach((item, i) => {
      const col = document.createElement('div');
      col.className = 'bar-col';

      const bar = document.createElement('div');
      bar.className = 'bar';
      const heightPct = Math.max((item[valueKey] / max) * 100, 2);
      bar.style.height = `${heightPct}%`;
      const color = colorVar === 'sequential'
        ? rootStyle.getPropertyValue('--seq-blue-400')
        : rootStyle.getPropertyValue(CAT_COLORS[i % CAT_COLORS.length]);
      bar.style.background = color.trim();

      bar.addEventListener('mouseenter', (e) => showTooltip(e, formatTooltip(item)));
      bar.addEventListener('mousemove', (e) => showTooltip(e, formatTooltip(item)));
      bar.addEventListener('mouseleave', hideTooltip);

      const label = document.createElement('div');
      label.className = 'bar-label';
      label.textContent = item[labelKey];

      col.appendChild(bar);
      col.appendChild(label);
      container.appendChild(col);
    });
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
  async function loadUsage() {
    const res = await fetch('/api/usage');
    const data = await res.json();

    renderStats(document.getElementById('code-stats'), [
      { label: 'Total tokens', value: fmtTokens(data.overall.totalTokens) },
      { label: 'Total cost', value: fmtMoney(data.overall.cost), unpriced: data.overall.unpriced },
      { label: 'Messages', value: fmtTokens(data.overall.messages) },
      { label: 'Sessions', value: fmtTokens(data.sessions.length) },
    ]);

    renderBarChart(document.getElementById('code-day-chart'), data.byDay, {
      valueKey: 'cost',
      labelKey: 'day',
      colorVar: 'sequential',
      formatTooltip: (d) => `${d.day}: ${fmtMoney(d.cost)} (${fmtTokens(d.totalTokens)} tok)${d.unpriced ? ' *unpriced included' : ''}`,
    });

    renderBarChart(document.getElementById('code-model-chart'), data.byModel, {
      valueKey: 'cost',
      labelKey: 'model',
      colorVar: 'categorical',
      formatTooltip: (d) => `${d.model}: ${fmtMoney(d.cost)} (${fmtTokens(d.totalTokens)} tok)${d.unpriced ? ' — unpriced' : ''}`,
    });

    renderTable(
      document.getElementById('code-project-table'),
      [
        { header: 'Project', render: (r) => r.project },
        { header: 'Tokens', num: true, render: (r) => fmtTokens(r.totalTokens) },
        { header: 'Cost', num: true, render: (r) => (r.unpriced ? `${fmtMoney(r.cost)} *` : fmtMoney(r.cost)) },
      ],
      [...data.byProject].sort((a, b) => b.totalTokens - a.totalTokens)
    );

    renderTable(
      document.getElementById('code-session-table'),
      [
        { header: 'Last active', render: (r) => (r.lastTimestamp || '').replace('T', ' ').slice(0, 19) },
        { header: 'Project', render: (r) => r.project },
        { header: 'Model(s)', render: (r) => r.models.join(', ') },
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

  function renderWebchat(data) {
    if (!data) return;
    document.getElementById('webchat-results').hidden = false;

    renderStats(document.getElementById('webchat-stats'), [
      { label: 'Estimated tokens', value: fmtTokens(data.overall.inputTokens + data.overall.outputTokens) },
      { label: 'Estimated cost', value: fmtMoney(data.overall.cost), unpriced: data.overall.unpriced },
      { label: 'Conversations', value: fmtTokens(data.conversations.length) },
      { label: 'Priced against', value: data.model },
    ]);

    renderBarChart(document.getElementById('webchat-day-chart'), data.byDay, {
      valueKey: 'cost',
      labelKey: 'day',
      colorVar: 'sequential',
      formatTooltip: (d) => `${d.day}: ${fmtMoney(d.cost)} (~${fmtTokens(d.totalTokens)} tok)`,
    });

    renderTable(
      document.getElementById('webchat-conv-table'),
      [
        { header: 'Conversation', render: (r) => r.name },
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

  // ---------- Init ----------
  (async function init() {
    await loadPricing();
    await loadUsage();
    await loadSavedWebchat();
  })();
})();
