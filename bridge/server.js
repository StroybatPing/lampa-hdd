'use strict';
/**
 * lampa-bridge — міст між Lampa і Transmission.
 *
 * Lampa вміє тільки TorrServer (стрім), постійного зберігання в ній немає.
 * Цей міст приймає магнет/торент від Lampa, віддає його Transmission у
 * «Торенти/Готові», а коли завантаження завершилось — переносить дані у
 * Медіатеку (torrent-set-location + move), звідки їх бачить Jellyfin.
 *
 * Перенос у межах тому exFAT миттєвий (rename), роздача не рветься.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CFG_FILE = process.env.LAMPA_BRIDGE_CONFIG || path.join(ROOT, 'config.json');
const CFG = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
const STATE_FILE = CFG.stateFile || path.join(ROOT, 'state.json');

// У Docker зручніше задавати ключі змінними оточення, ніж правити файл.
if (process.env.LAMPA_TOKEN) CFG.token = process.env.LAMPA_TOKEN;
if (process.env.JACKETT_API_KEY) CFG.jackett.apiKey = process.env.JACKETT_API_KEY;
if (process.env.JELLYFIN_API_KEY) CFG.jellyfin.apiKey = process.env.JELLYFIN_API_KEY;

let sessionId = '';
let state = {};

try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
} catch (e) {
  state = {};
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function log(...args) {
  console.log(new Date().toISOString().replace('T', ' ').slice(0, 19), ...args);
}

/** Виклик Transmission RPC з обробкою рукостискання 409 (X-Transmission-Session-Id). */
async function rpc(method, args, retry = true) {
  const res = await fetch(CFG.transmissionRpc, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Transmission-Session-Id': sessionId
    },
    body: JSON.stringify({ method, arguments: args || {} })
  });

  if (res.status === 409 && retry) {
    sessionId = res.headers.get('x-transmission-session-id') || '';
    return rpc(method, args, false);
  }
  if (!res.ok) throw new Error('Transmission HTTP ' + res.status);

  const body = await res.json();
  if (body.result !== 'success') throw new Error('Transmission: ' + body.result);
  return body.arguments;
}

/** Додати торент і взяти його під нагляд. */
async function save({ link, title, kind }) {
  if (!link) throw new Error('немає посилання (link)');
  const target = CFG.library[kind] ? kind : 'movie';

  const added = await rpc('torrent-add', {
    filename: link,
    'download-dir': CFG.downloadDir,
    paused: false
  });

  const t = added['torrent-added'] || added['torrent-duplicate'];
  if (!t) throw new Error('Transmission не повернув торент');

  const known = state[t.hashString];
  state[t.hashString] = {
    id: t.id,
    name: t.name,
    title: title || t.name,
    kind: target,
    published: known ? known.published : false,
    addedAt: known ? known.addedAt : new Date().toISOString()
  };
  saveState();

  log('додано:', t.name, '| тип:', target, '| дубль:', !!added['torrent-duplicate']);
  return {
    hash: t.hashString,
    id: t.id,
    name: t.name,
    kind: target,
    duplicate: !!added['torrent-duplicate']
  };
}

/**
 * Пошук роздач через власний Jackett.
 * Lampa вміє ходити в Jackett сама, але тут пошук потрібен серверний: плагін
 * дістає готовий відсортований список і одразу віддає обране на збереження.
 */
async function search({ title, year, kind }) {
  if (!title) throw new Error('немає назви (title)');

  const url =
    CFG.jackett.url +
    '/api/v2.0/indexers/all/results?apikey=' +
    encodeURIComponent(CFG.jackett.apiKey) +
    '&Query=' +
    encodeURIComponent(title);

  const res = await fetch(url);
  if (!res.ok) throw new Error('Jackett HTTP ' + res.status);
  const data = await res.json();

  const MIN = 300 * 1024 * 1024; // менше — це не фільм, а семпл чи субтитри
  const MAX = 120 * 1024 * 1024 * 1024;

  return (data.Results || [])
    .filter((r) => r.Size >= MIN && r.Size <= MAX && (r.Seeders || 0) > 0)
    .filter((r) => r.MagnetUri || r.Link)
    .map((r) => ({
      title: (r.Title || '').replace(/\s+/g, ' ').trim(),
      tracker: r.Tracker,
      size: r.Size,
      sizeGb: Math.round((r.Size / 1073741824) * 100) / 100,
      seeders: r.Seeders || 0,
      link: r.MagnetUri || r.Link,
      // рік у назві — не фільтр, а підйом у сортуванні: назви бувають без року
      hitsYear: year ? String(r.Title || '').includes(String(year)) : false,
      kind: kind || 'movie'
    }))
    .sort((a, b) => b.hitsYear - a.hitsYear || b.seeders - a.seeders)
    .slice(0, 40);
}

/** Стан наглядуваних торентів. */
async function status() {
  const { torrents } = await rpc('torrent-get', {
    fields: ['id', 'hashString', 'name', 'percentDone', 'status', 'rateDownload', 'downloadDir', 'eta']
  });

  return torrents
    .filter((t) => state[t.hashString])
    .map((t) => ({
      hash: t.hashString,
      name: t.name,
      title: state[t.hashString].title,
      kind: state[t.hashString].kind,
      percent: Math.round(t.percentDone * 1000) / 10,
      speed: t.rateDownload,
      eta: t.eta,
      dir: t.downloadDir,
      published: !!state[t.hashString].published
    }));
}

/** Попросити Jellyfin перечитати медіатеку (плановий скан — раз на 60 хв, це надто пізно). */
async function refreshJellyfin() {
  if (!CFG.jellyfin.apiKey) return false;
  try {
    const res = await fetch(CFG.jellyfin.url + '/Library/Refresh', {
      method: 'POST',
      headers: { 'X-Emby-Token': CFG.jellyfin.apiKey }
    });
    log('Jellyfin /Library/Refresh →', res.status);
    return res.ok;
  } catch (e) {
    log('Jellyfin недоступний:', e.message);
    return false;
  }
}

/** Готові торенти перенести в Медіатеку. Роздача при цьому не рветься. */
async function publishFinished() {
  const pending = Object.entries(state).filter(([, v]) => !v.published);
  if (!pending.length) return;

  const { torrents } = await rpc('torrent-get', {
    fields: ['id', 'hashString', 'name', 'percentDone', 'downloadDir']
  });

  let moved = 0;
  for (const t of torrents) {
    const rec = state[t.hashString];
    if (!rec || rec.published || t.percentDone < 1) continue;

    const dest = CFG.library[rec.kind];
    if (t.downloadDir !== dest) {
      await rpc('torrent-set-location', { ids: [t.id], location: dest, move: true });
      log('перенесено в медіатеку:', t.name, '→', dest);
    }
    rec.published = true;
    rec.publishedAt = new Date().toISOString();
    moved++;
  }

  if (moved) {
    saveState();
    await refreshJellyfin();
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

function send(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Lampa-Token',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    // Chrome (Private Network Access) блокує запит зі https-сторінки до
    // локальної мережі, доки сервер явно не дозволить його цим заголовком.
    'Access-Control-Allow-Private-Network': 'true',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error('тіло завелике'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('тіло не JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Міст доступний з будь-якої сторінки (CORS «*» потрібен, бо Lampa відкрита на
 * чужому домені). Тому без ключа будь-який сайт у браузері власника міг би
 * підкинути торент у його Transmission. Ключ вимикає цю можливість.
 */
function authorized(req, url) {
  if (!CFG.token) return true;
  const given = req.headers['x-lampa-token'] || url.searchParams.get('token') || '';
  return given === CFG.token;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') return send(res, 204, {});   // preflight: заголовки вище

  if (!authorized(req, url)) {
    log('відмова без ключа:', url.pathname);
    return send(res, 401, { ok: false, error: 'потрібен ключ доступу (token)' });
  }

  try {
    if (url.pathname === '/health') {
      const v = await rpc('session-get', { fields: ['version', 'download-dir'] });
      return send(res, 200, { ok: true, transmission: v.version, downloadDir: CFG.downloadDir });
    }

    if (url.pathname === '/search') {
      const q = Object.fromEntries(url.searchParams);
      return send(res, 200, { ok: true, results: await search(q) });
    }

    if (url.pathname === '/save') {
      // POST {link,title,kind} або GET /save?link=…&title=…&kind=movie — щоб
      // працювало і з плагіна, і з простого посилання в браузері.
      const body = req.method === 'POST' ? await readBody(req) : Object.fromEntries(url.searchParams);
      return send(res, 200, { ok: true, torrent: await save(body) });
    }

    if (url.pathname === '/status') {
      return send(res, 200, { ok: true, torrents: await status() });
    }

    if (url.pathname === '/publish') {
      await publishFinished();
      return send(res, 200, { ok: true, torrents: await status() });
    }

    return send(res, 404, { ok: false, error: 'невідомий маршрут' });
  } catch (e) {
    log('помилка', url.pathname + ':', e.message);
    return send(res, 500, { ok: false, error: e.message });
  }
});

server.listen(CFG.port, CFG.bind || '0.0.0.0', () => {
  log('lampa-bridge слухає ' + (CFG.bind || '0.0.0.0') + ':' + CFG.port,
      '→ Transmission', CFG.transmissionRpc);
  if (!CFG.token) {
    log('УВАГА: ключ не заданий — міст приймає команди від кого завгодно.',
        'Впишіть "token" у', CFG_FILE, 'і в Налаштуваннях Lampa.');
  }
});

setInterval(() => {
  publishFinished().catch((e) => log('нагляд:', e.message));
}, Math.max(15, CFG.pollSeconds) * 1000);
