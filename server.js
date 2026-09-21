'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const readline = require('readline');

const PORT = process.env.PORT || 4317;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PRICING_FILE = path.join(ROOT, 'pricing.json');
const DATA_DIR = path.join(ROOT, 'data');
const WEBCHAT_FILE = path.join(DATA_DIR, 'webchat-import.json');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const DEFAULT_PRICING = { cacheMultipliers: { read: 0.1, write5m: 1.25, write1h: 2 }, models: {} };

function readPricing() {
  try {
    return JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
  } catch {
    return DEFAULT_PRICING;
  }
}

function writePricing(pricing) {
  fs.writeFileSync(PRICING_FILE, JSON.stringify(pricing, null, 2) + '\n');
}

function costFor(model, usage, pricing) {
  const rate = pricing.models[model];
  if (!rate) return null;
  const mult = Object.assign({}, pricing.cacheMultipliers, rate.cacheMultipliers || {});
  const inputTok = usage.input_tokens || 0;
  const outputTok = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const write5m = (usage.cache_creation && usage.cache_creation.ephemeral_5m_input_tokens) || 0;
  const write1h = (usage.cache_creation && usage.cache_creation.ephemeral_1h_input_tokens) || 0;

  return (
    (inputTok * rate.input) / 1e6 +
    (outputTok * rate.output) / 1e6 +
    (cacheRead * rate.input * mult.read) / 1e6 +
    (write5m * rate.input * mult.write5m) / 1e6 +
    (write1h * rate.input * mult.write1h) / 1e6
  );
}

function emptyBucket() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    cost: 0,
    unpriced: false,
    messages: 0,
  };
}

function addToBucket(bucket, usage, cost) {
  const inputTok = usage.input_tokens || 0;
  const outputTok = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const write5m = (usage.cache_creation && usage.cache_creation.ephemeral_5m_input_tokens) || 0;
  const write1h = (usage.cache_creation && usage.cache_creation.ephemeral_1h_input_tokens) || 0;
  const cacheWrite = write5m + write1h;

  bucket.inputTokens += inputTok;
  bucket.outputTokens += outputTok;
  bucket.cacheReadTokens += cacheRead;
  bucket.cacheWriteTokens += cacheWrite;
  bucket.totalTokens += inputTok + outputTok + cacheRead + cacheWrite;
  bucket.messages += 1;
  if (cost === null) {
    bucket.unpriced = true;
  } else {
    bucket.cost += cost;
  }
}

function mapToSortedArray(map, keyName) {
  return Array.from(map.entries())
    .map(([key, bucket]) => Object.assign({ [keyName]: key }, bucket))
    .sort((a, b) => (a[keyName] > b[keyName] ? 1 : -1));
}

async function findJsonlFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findJsonlFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(full);
    }
  }
  return results;
}

async function scanUsage(pricing) {
  const files = await findJsonlFiles(CLAUDE_PROJECTS_DIR);

  const overall = emptyBucket();
  const byDay = new Map();
  const byModel = new Map();
  const byProject = new Map();
  const bySession = new Map();

  for (const file of files) {
    const rl = readline.createInterface({
      input: fs.createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const message = entry.message;
      if (!message || message.role !== 'assistant' || !message.usage) continue;

      const usage = message.usage;
      const model = message.model || 'unknown';
      const cost = costFor(model, usage, pricing);
      const day = (entry.timestamp || '').slice(0, 10) || 'unknown';
      const project = entry.cwd || 'unknown';
      const sessionId = entry.sessionId || 'unknown';

      addToBucket(overall, usage, cost);

      if (!byDay.has(day)) byDay.set(day, emptyBucket());
      addToBucket(byDay.get(day), usage, cost);

      if (!byModel.has(model)) byModel.set(model, emptyBucket());
      addToBucket(byModel.get(model), usage, cost);

      if (!byProject.has(project)) byProject.set(project, emptyBucket());
      addToBucket(byProject.get(project), usage, cost);

      if (!bySession.has(sessionId)) {
        const session = emptyBucket();
        session.project = project;
        session.models = new Set();
        session.lastTimestamp = entry.timestamp || null;
        bySession.set(sessionId, session);
      }
      const session = bySession.get(sessionId);
      addToBucket(session, usage, cost);
      session.models.add(model);
      if (entry.timestamp && (!session.lastTimestamp || entry.timestamp > session.lastTimestamp)) {
        session.lastTimestamp = entry.timestamp;
      }
    }
  }

  const sessions = Array.from(bySession.entries())
    .map(([sessionId, bucket]) => ({
      sessionId,
      project: bucket.project,
      models: Array.from(bucket.models),
      lastTimestamp: bucket.lastTimestamp,
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      cacheReadTokens: bucket.cacheReadTokens,
      cacheWriteTokens: bucket.cacheWriteTokens,
      totalTokens: bucket.totalTokens,
      cost: bucket.cost,
      unpriced: bucket.unpriced,
      messages: bucket.messages,
    }))
    .sort((a, b) => (b.lastTimestamp || '').localeCompare(a.lastTimestamp || ''));

  return {
    overall,
    byDay: mapToSortedArray(byDay, 'day'),
    byModel: mapToSortedArray(byModel, 'model'),
    byProject: mapToSortedArray(byProject, 'project'),
    sessions,
  };
}

function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

function aggregateWebchat(payload, pricing) {
  const model = payload.model;
  const rate = pricing.models[model] || null;
  const byDay = new Map();
  const conversations = [];
  const overall = { inputTokens: 0, outputTokens: 0, cost: 0, unpriced: !rate };

  for (const conv of payload.conversations || []) {
    let convInput = 0;
    let convOutput = 0;
    const day = (conv.createdAt || '').slice(0, 10) || 'unknown';

    for (const msg of conv.messages || []) {
      const tokens = estimateTokens(msg.text);
      if (msg.sender === 'human') {
        convInput += tokens;
      } else {
        convOutput += tokens;
      }
    }

    const cost = rate ? (convInput * rate.input) / 1e6 + (convOutput * rate.output) / 1e6 : null;

    conversations.push({
      name: conv.name || '(untitled)',
      createdAt: conv.createdAt || null,
      inputTokens: convInput,
      outputTokens: convOutput,
      totalTokens: convInput + convOutput,
      cost,
    });

    overall.inputTokens += convInput;
    overall.outputTokens += convOutput;
    if (cost !== null) overall.cost += cost;

    if (!byDay.has(day)) byDay.set(day, { day, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 });
    const bucket = byDay.get(day);
    bucket.inputTokens += convInput;
    bucket.outputTokens += convOutput;
    bucket.totalTokens += convInput + convOutput;
    if (cost !== null) bucket.cost += cost;
  }

  return {
    model,
    importedAt: new Date().toISOString(),
    overall,
    byDay: Array.from(byDay.values()).sort((a, b) => (a.day > b.day ? 1 : -1)),
    conversations: conversations.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
  };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (chunk) => {
      chunks += chunk;
      if (chunks.length > 50 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(chunks));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname;

  try {
    if (pathname === '/api/usage' && req.method === 'GET') {
      const pricing = readPricing();
      const usage = await scanUsage(pricing);
      sendJson(res, 200, usage);
      return;
    }

    if (pathname === '/api/pricing' && req.method === 'GET') {
      sendJson(res, 200, readPricing());
      return;
    }

    if (pathname === '/api/pricing' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const { model, input, output, cacheMultipliers } = body;
      if (!model || typeof input !== 'number' || typeof output !== 'number' || input < 0 || output < 0) {
        sendJson(res, 400, { error: 'model, input, and output (non-negative numbers) are required' });
        return;
      }
      const pricing = readPricing();
      pricing.models[model] = cacheMultipliers ? { input, output, cacheMultipliers } : { input, output };
      writePricing(pricing);
      sendJson(res, 200, pricing);
      return;
    }

    if (pathname === '/api/import-webchat' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!body.model || !Array.isArray(body.conversations)) {
        sendJson(res, 400, { error: 'model and conversations[] are required' });
        return;
      }
      const pricing = readPricing();
      const result = aggregateWebchat(body, pricing);
      await fsp.mkdir(DATA_DIR, { recursive: true });
      await fsp.writeFile(WEBCHAT_FILE, JSON.stringify(result, null, 2));
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/webchat' && req.method === 'GET') {
      try {
        const raw = await fsp.readFile(WEBCHAT_FILE, 'utf8');
        sendJson(res, 200, JSON.parse(raw));
      } catch {
        sendJson(res, 200, null);
      }
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    serveStatic(req, res, pathname);
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Claude usage dashboard running at http://localhost:${PORT}`);
});
