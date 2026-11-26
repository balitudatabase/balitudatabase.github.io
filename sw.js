// Balitu Database · modo nuvem
// Faz o papel do servidor quando o PC está desligado: entrega a "foto" do site
// guardada no Google Drive (privado) e toca os audiolivros direto do Drive.
'use strict';
const BASE = ''; // o site da nuvem fica na raiz de balitudatabase.github.io (mesmos caminhos do site do PC)
const MSG = 'O servidor não está ativo no momento! :( Volte mais tarde';
const DRIVE = 'https://www.googleapis.com/drive/v3/files/';
const STATE_URL = '/__balitu_estado__';
// Arquivos do próprio site da nuvem (servidos pelo GitHub, nunca pelo service worker).
const PROPRIOS = new Set(['/sw.js', '/offline.js', '/entrar', '/entrar.html', '/404.html', '/favicon.ico', '/robots.txt', '/teste-video', '/teste-video.html']);
let state = null; // {token, tokenExp, user, entries, blobs, books, fb}
const FB_KEY = 'AIzaSyAOB_pyCITzJGAX_ScV4-QE2tb5YAP_rxo';
const FS = 'https://firestore.googleapis.com/v1/projects/balitu-database/databases/(default)/documents';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('message', e => {
  if (e.data?.type === 'estado') {
    state = e.data.state;
    e.waitUntil(caches.open('balitu-nuvem').then(c => c.put(STATE_URL, new Response(JSON.stringify(state)))).then(() => e.source?.postMessage({type: 'ok'})));
  }
  if (e.data?.type === 'token' && state) { state.token = e.data.token; state.tokenExp = e.data.tokenExp; if (e.data.fb) state.fb = e.data.fb; saveState(); }
  if (e.data?.type === 'sair') { state = null; caches.delete('balitu-nuvem'); caches.delete('balitu-arquivos'); caches.delete(AUDIO_CACHE); }
});
function saveState() { return caches.open('balitu-nuvem').then(c => c.put(STATE_URL, new Response(JSON.stringify(state)))).catch(() => {}); }
async function loadState() {
  if (state) return state;
  const r = await (await caches.open('balitu-nuvem')).match(STATE_URL);
  state = r ? await r.json() : null;
  return state;
}

// ---------- Reescrita: endereços "/x" do site passam a ficar dentro de /googlefotos/nuvem/app ----------
const ROOT_IN_QUOTES = /(["'`])\/(?=[A-Za-z0-9_.~%?#-])(?!googlefotos\/)/g;
const ROOT_IN_CSS = /(url\(\s*["']?)\/(?=[A-Za-z0-9_.~%?#-])(?!googlefotos\/)/g;
function rewrite(text, type) {
  if (BASE && /css/.test(type)) return text.replace(ROOT_IN_CSS, '$1' + BASE + '/');
  if (BASE && /html|javascript|json/.test(type)) text = text.replace(ROOT_IN_QUOTES, '$1' + BASE + '/');
  if (/html/.test(type)) {
    const inject = '<script src="/offline.js"></script>';
    text = /<head[^>]*>/i.test(text) ? text.replace(/<head[^>]*>/i, m => m + inject) : inject + text;
  }
  return text;
}

// ---------- Respostas prontas ----------
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json; charset=utf-8', ...extra}});
const offline = (status = 503) => json({error: MSG}, status, {'X-Balitu-Nuvem': 'offline'});
const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 680"><rect width="480" height="680" fill="#1b2140"/><text x="240" y="350" fill="#6f7aa8" font-family="sans-serif" font-size="28" text-anchor="middle">Balitu</text></svg>';
function offlinePage(path) {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Servidor desligado · Balitu Database</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(145deg,#0c1125,#191238);color:#fff;font:16px system-ui,sans-serif;text-align:center;padding:20px}.b{max-width:420px;background:#ffffff0f;border:1px solid #ffffff1f;border-radius:22px;padding:32px 24px}h1{font-size:23px;margin:10px 0}p{color:#c5c1dc}a{display:inline-block;margin-top:14px;color:#fff;background:linear-gradient(135deg,#ff4b62,#9c4dff);padding:11px 22px;border-radius:99px;text-decoration:none;font-weight:700}</style></head><body><div class="b"><div style="font-size:46px">😴</div><h1>${MSG}</h1><p>Esta parte do Balitu Database precisa do PC ligado.</p><p id="pc" style="font-size:13px">Conferindo se o servidor já voltou…</p><a href="${BASE || ''}/">Voltar ao início</a></div><script src="/offline.js"></script><script>window.BalituNuvem&&BalituNuvem.pcOnline().then(function(b){if(!b)document.getElementById('pc').textContent='O servidor ainda não respondeu.'})</script></body></html>`, {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}});
}

// ---------- Arquivos guardados no Drive ----------
const driveSizes = new Map();
async function driveSize(id, token) {
  if (driveSizes.has(id)) return driveSizes.get(id);
  try {
    const r = await fetch(DRIVE + id + '?fields=size&supportsAllDrives=true', {headers: {Authorization: 'Bearer ' + token}});
    const n = r.ok ? Number((await r.json()).size) : 0;
    if (n > 0) { driveSizes.set(id, n); return n; }
  } catch {}
  return 0;
}
async function driveFile(id, request, type) {
  const s = await loadState();
  if (!s || !s.token || Date.now() > s.tokenExp) return json({error: 'Sessão expirada'}, 401, {'X-Balitu-Nuvem': 'token'});
  const headers = {Authorization: 'Bearer ' + s.token};
  const range = request.headers.get('Range');
  if (range) headers.Range = range;
  else if (!/audio/.test(type || '')) { const hit = await (await caches.open('balitu-arquivos')).match(id); if (hit) return hit; }
  const r = await fetch(DRIVE + id + '?alt=media&supportsAllDrives=true', {headers});
  if (r.status === 401) return json({error: 'Sessão expirada'}, 401, {'X-Balitu-Nuvem': 'token'});
  if (!r.ok && r.status !== 206) return null;
  const h = new Headers({'Content-Type': type || r.headers.get('Content-Type') || 'application/octet-stream', 'Accept-Ranges': 'bytes'});
  for (const k of ['Content-Length', 'Content-Range']) if (r.headers.get(k)) h.set(k, r.headers.get(k));
  // O player de áudio só aceita uma resposta parcial (206) com Content-Range. Quando o Drive
  // não deixa o navegador ler esse cabeçalho, ele é refeito a partir do pedido e do tamanho do arquivo.
  if (r.status === 206 && !h.has('Content-Range')) {
    const m = /bytes=(\d+)-(\d*)/.exec(range || ''), len = Number(r.headers.get('Content-Length') || 0);
    if (m) {
      const start = Number(m[1]), total = m[2] === '' && len ? start + len : await driveSize(id, s.token);
      if (total) {
        const end = len ? start + len - 1 : (m[2] !== '' ? Math.min(Number(m[2]), total - 1) : total - 1);
        h.set('Content-Range', `bytes ${start}-${end}/${total}`);
        if (!len) h.set('Content-Length', String(end - start + 1));
      }
    }
  }
  const resp = new Response(r.body, {status: r.status, headers: h});
  if (!range && !/audio|video/.test(type || '') && r.status === 200) { const copy = resp.clone(); caches.open('balitu-arquivos').then(c => c.put(id, copy)).catch(() => {}); }
  return resp;
}

// ---------- Audiolivros (catálogo vindo do PC) ----------
function readerBook(s, id) {
  const lib = s.entries['/balito-leitor/api/library'];
  if (lib?.x) { try { const it = JSON.parse(lib.x).items.find(b => b.id === id); if (it) return it; } catch {} }
  const b = s.books?.find(x => x.id === id);
  if (!b) return null;
  return {id: b.id, title: b.title, author: b.author, synopsis: b.synopsis || '', series: b.series || '', coverUrl: '/balito-leitor/api/cover/' + b.id, shared: true, status: 'ready', readyPercent: Math.round(100 * b.parts.length / b.totalParts), preparing: b.parts.length < b.totalParts, message: 'Audiolivro · modo nuvem', parts: b.parts.map(p => ({index: p.index, status: 'ready', duration: p.duration, played: []}))};
}

// ---------- Dados ao vivo (Firebase Firestore) ----------
async function fbToken() {
  const s = await loadState();
  if (!s?.fb?.refreshToken) return null;
  if (s.fb.idToken && Date.now() < s.fb.exp) return s.fb.idToken;
  const r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + FB_KEY, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(s.fb.refreshToken)});
  if (!r.ok) return null;
  const j = await r.json();
  s.fb.idToken = j.id_token; s.fb.refreshToken = j.refresh_token || s.fb.refreshToken; s.fb.exp = Date.now() + (Number(j.expires_in || 3600) - 120) * 1000;
  saveState();
  return s.fb.idToken;
}
async function fsCall(method, path, body) {
  const t = await fbToken();
  if (!t) throw new Error('sem sessão');
  const r = await fetch(FS + path, {method, headers: {Authorization: 'Bearer ' + t, 'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Firestore ' + r.status);
  return r.json();
}
const docJson = d => { try { return JSON.parse(d?.fields?.json?.stringValue || 'null'); } catch { return null; } };
async function fsList(col) {
  const out = []; let page = '';
  do { const j = await fsCall('GET', '/' + col + '?pageSize=300&mask.fieldPaths=json&mask.fieldPaths=atualizado' + (page ? '&pageToken=' + page : '')); for (const d of j?.documents || []) out.push({id: decodeURIComponent(d.name.split('/').pop()), data: docJson(d), at: Number(d.fields?.atualizado?.integerValue || 0)}); page = j?.nextPageToken || ''; } while (page);
  return out;
}
const fsPut = (path, data) => fsCall('PATCH', path, {fields: {json: {stringValue: JSON.stringify(data)}, atualizado: {integerValue: String(Date.now())}}});

let liveBooks = null, liveBooksAt = 0, liveProgress = null, liveProgressAt = 0;
async function booksLive() {
  if (liveBooks && Date.now() - liveBooksAt < 60000) return liveBooks;
  liveBooks = new Map((await fsList('audiolivros')).filter(d => d.data?.id).map(d => [d.id, d.data])); liveBooksAt = Date.now();
  return liveBooks;
}
const progCol = s => '/progresso/' + encodeURIComponent(s.fb.user) + '/livros';
async function progressLive(s) {
  if (liveProgress && Date.now() - liveProgressAt < 15000) return liveProgress;
  liveProgress = new Map((await fsList(progCol(s).slice(1)).catch(() => [])).map(d => [d.id, d.data || {}])); liveProgressAt = Date.now();
  return liveProgress;
}
const hex = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
// Mesmo formato do Reader no PC (balito-leitor/web/shared.mjs).
async function liveItem(s, b, prog = {}) {
  const n = b.parts.length; let ready = 0;
  for (const p of b.parts) { if (p.status === 'ready' && p.file) ready++; else break; }
  const preparing = ready < n;
  const item = {nextPart: preparing ? {part: ready + 1, state: 'calculating'} : null, id: b.id, title: b.title, author: b.author, synopsis: b.synopsis || '', series: b.series || '',
    coverUrl: BASE + '/balito-leitor/api/cover/' + b.id, ambient: b.ambient === true, cinematic: b.cinematic === true, premium: b.premium === true, created: b.created, provisional: b.provisional === true, reviewCount: b.reviewCount || 0, reviewNotice: b.reviewNotice || '',
    shared: true, status: 'ready', readyPercent: Math.round(100 * ready / n), preparing,
    message: preparing ? ready + ' de ' + n + ' partes disponíveis · em produção' : 'Audiolivro completo · biblioteca de todos',
    position: prog.position,
    parts: b.parts.map((p, i) => ({index: i, status: i < ready ? 'ready' : 'pending', duration: i < ready ? p.duration : 0, reviewCount: p.reviewCount || 0, endPercent: 100 * (i + 1) / n, played: prog.played?.[i] || []}))};
  const second = b.secondVolumeStartsAt;
  if (Number.isInteger(second) && second >= 2 && second <= n) {
    const positions = [prog.position, ...Object.values(prog.volumePositions || {})];
    item.volumes = [[0, second - 2], [second - 1, n - 1]].map(([firstIndex, lastIndex], i) => ({number: i + 1, firstIndex, lastIndex,
      position: positions.find(p => p && Number.isInteger(p.part) && p.part >= firstIndex && p.part <= lastIndex && item.parts[p.part].status === 'ready' && Number.isFinite(p.time) && p.time >= 0)}));
    item.bookmarkKey = (await hex((await hex(s.fb.user)) + '/' + b.id)).slice(0, 32);
  }
  return item;
}
function mergeRanges(list, max) {
  const r = list.filter(x => Array.isArray(x) && x.length === 2 && Number.isFinite(x[0]) && Number.isFinite(x[1])).map(([a, b]) => [Math.max(0, a), Math.min(max, b)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]), out = [];
  for (const x of r) { const l = out[out.length - 1]; if (l && x[0] <= l[1] + 0.25) l[1] = Math.max(l[1], x[1]); else out.push(x); }
  return out;
}
// ---------- Áudio guardado no aparelho (continua tocando mesmo depois que o acesso ao Drive vence) ----------
const AUDIO_CACHE = 'balitu-audio', AUDIO_KEEP = 4, downloading = new Map();
const audioKey = id => '/__balitu_audio__/' + id;
async function cachedAudio(id, request) {
  const hit = await (await caches.open(AUDIO_CACHE)).match(audioKey(id));
  if (!hit) return null;
  const blob = await hit.blob(), size = blob.size, m = /bytes=(\d*)-(\d*)/.exec(request.headers.get('Range') || '');
  if (!m) return new Response(blob, {headers: {'Content-Type': 'audio/mpeg', 'Content-Length': String(size), 'Accept-Ranges': 'bytes'}});
  let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]), end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
  start = Math.max(0, start); end = Math.min(size - 1, end);
  if (start > end) return new Response(null, {status: 416, headers: {'Content-Range': 'bytes */' + size}});
  return new Response(blob.slice(start, end + 1), {status: 206, headers: {'Content-Type': 'audio/mpeg', 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes'}});
}
function downloadAudio(id) {
  if (downloading.has(id)) return downloading.get(id);
  const job = (async () => {
    const s = await loadState();
    if (!s?.token || Date.now() > s.tokenExp) return;
    const cache = await caches.open(AUDIO_CACHE);
    if (await cache.match(audioKey(id))) return;
    const r = await fetch(DRIVE + id + '?alt=media&supportsAllDrives=true', {headers: {Authorization: 'Bearer ' + s.token}});
    if (!r.ok) return;
    await cache.put(audioKey(id), new Response(r.body, {headers: {'Content-Type': 'audio/mpeg', 'X-Saved': String(Date.now())}}));
    const keys = await cache.keys();
    if (keys.length > AUDIO_KEEP) {
      const dated = await Promise.all(keys.map(async k => [k, Number((await cache.match(k)).headers.get('X-Saved') || 0)]));
      dated.sort((a, b) => a[1] - b[1]);
      for (const [k] of dated.slice(0, keys.length - AUDIO_KEEP)) await cache.delete(k);
    }
  })().catch(() => {}).finally(() => downloading.delete(id));
  downloading.set(id, job);
  return job;
}
async function playAudio(book, index, request) {
  const part = book.parts[index];
  if (!part?.file) return null;
  const local = await cachedAudio(part.file, request);
  // Baixa esta parte e a próxima em segundo plano enquanto o acesso ao Drive é válido.
  if (!local) downloadAudio(part.file);
  const next = book.parts[index + 1]; if (next?.file) downloading.get(part.file)?.then(() => downloadAudio(next.file)) || downloadAudio(next.file);
  return local || (await driveFile(part.file, request, 'audio/mpeg'));
}

async function readerLive(s, path, url, request) {
  if (!s.fb?.user) return null;
  try {
    if (path === '/balito-leitor/api/library' && request.method === 'GET') {
      const [books, prog] = await Promise.all([booksLive(), progressLive(s)]);
      if (!books.size) return null; // catálogo ainda não chegou: usa a cópia do PC
      const shared = await Promise.all([...books.values()].map(b => liveItem(s, b, prog.get(b.id) || {})));
      shared.sort((a, b) => b.created - a.created);
      // Leituras pessoais (texto em áudio) continuam vindo do PC.
      let mine = []; const rec = s.entries['/balito-leitor/api/library'];
      if (rec?.x) try { mine = JSON.parse(rec.x).items.filter(i => !i.shared); } catch {}
      return json({items: [...shared, ...mine]});
    }
    const book = /^\/balito-leitor\/api\/book\/([a-f0-9-]{36})$/.exec(path);
    if (book && request.method === 'GET') {
      const b = (await booksLive()).get(book[1]); if (!b) return null;
      return json(await liveItem(s, b, (await progressLive(s)).get(b.id) || {}));
    }
    const prog = /^\/balito-leitor\/api\/progress\/([a-f0-9-]{36})$/.exec(path);
    if (prog && request.method === 'POST') {
      const b = (await booksLive()).get(prog[1]); if (!b) return null;
      const input = await request.clone().json().catch(() => ({}));
      const all = await progressLive(s), cur = all.get(b.id) || {}, i = input.part;
      const item0 = await liveItem(s, b, cur);
      if (!Number.isInteger(i) || item0.parts[i]?.status !== 'ready' || !Array.isArray(input.played) || input.played.length > 2000) return json({error: 'Progresso inválido.'}, 400);
      const played = item0.parts.map(p => p.played);
      played[i] = mergeRanges([...played[i], ...input.played], item0.parts[i].duration);
      const saved = {played, position: cur.position, volumePositions: cur.volumePositions || {}, updatedAt: Date.now()};
      if (Number.isFinite(input.position)) {
        saved.position = {part: i, time: Math.max(0, Math.min(input.position, item0.parts[i].duration)), updatedAt: Date.now()};
        const v = item0.volumes?.find(v => i >= v.firstIndex && i <= v.lastIndex); if (v) saved.volumePositions[v.number] = saved.position;
      }
      all.set(b.id, saved);
      fsPut(progCol(s) + '/' + b.id, saved).catch(() => {});
      return json(await liveItem(s, b, saved));
    }
    const cover = /^\/balito-leitor\/api\/cover\/([a-f0-9-]{36})$/.exec(path);
    if (cover) {
      const b = (await booksLive()).get(cover[1]);
      if (b?.cover) { const r = await driveFile(b.cover, request, 'image/jpeg'); if (r && r.status < 300) return r; }
      return null;
    }
    const audio = /^\/balito-leitor\/api\/audio\/([a-f0-9-]{36})$/.exec(path);
    if (audio) {
      const b = (await booksLive()).get(audio[1]);
      if (!b) return null;
      return (await playAudio(b, Number(url.searchParams.get('part') || 0), request)) || offline();
    }
  } catch (e) { return null; }
  return null;
}

// ---------- Status ao vivo (bonequinhos e progresso na nuvem via Firestore) ----------
let liveStatus = null, liveStatusAt = 0;
async function statusLive(s, path, url, request) {
  if (path !== '/api/status' || request.method !== 'GET') return null;
  if (!s.fb?.user) return null;
  if (s.fb.role !== 'master') return json({error: 'Somente o administrador pode abrir o status.'}, 403);
  try {
    if (!liveStatus || Date.now() - liveStatusAt > 15000) {
      const doc = docJson(await fsCall('GET', '/audiolivros/_status'));
      if (doc) { liveStatus = doc; liveStatusAt = Date.now(); }
    }
    if (!liveStatus) return null;
    if (url.searchParams.get('graficos') === '1') return json(liveStatus.graficos || {tarefas: []});
    return liveStatus.status ? json({...liveStatus.status, nuvem: true, statusNuvemAt: liveStatus.updatedAt}) : null;
  } catch { return null; }
}

// ---------- Painel de gestão (usuários e permissões) ao vivo ----------
const AREAS = ['photos', 'files', 'streaming', 'balituflix', 'games'];
function applyChange(L, c) {
  const user = String(c.user || '').trim(), find = u => L.users.find(x => x.user === u);
  const setGoogle = (u, v) => { if (typeof v !== 'string') return; const e = v.trim().toLowerCase(); for (const x of L.users) x.google = x.user === u ? (e ? [e] : []) : (x.google || []).filter(g => g !== e); };
  if (c.type === 'save') { const t = find(user); if (t) { t.permissions = c.permissions; if (typeof c.google === 'string') setGoogle(user, c.google); } }
  else if (c.type === 'create') { L.users.push({user, permissions: c.permissions, fixed: false, google: c.google ? [c.google.trim().toLowerCase()] : [], created: c.at}); }
  else if (c.type === 'delete') L.users = L.users.filter(x => x.user !== user);
  else if (c.type === 'approve') { const p = L.pending.find(x => x.user === user); if (p) { L.pending = L.pending.filter(x => x.user !== user); L.users.push({user: c.newUser || user, permissions: c.permissions, fixed: false, google: p.email ? [p.email] : [], created: c.at}); } }
  else if (c.type === 'reject') L.pending = L.pending.filter(x => x.user !== user);
  else if (c.type === 'dismiss-reset') L.resets = (L.resets || []).filter(x => x.user !== user);
  else if (c.type === 'master-email-remove') L.masterEmails = (L.masterEmails || []).filter(e => e !== String(c.email || '').toLowerCase());
}
async function adminListing(s) {
  const docs = await fsList('usuarios');
  const painelDoc = docs.find(d => d.id === '_painel'), painel = painelDoc?.data || {areas: AREAS, master: 'jucabalitu', masterEmails: [], resets: []};
  const L = {areas: painel.areas || AREAS, master: painel.master, masterEmails: painel.masterEmails || [], resets: painel.resets || [], nuvem: true,
    users: docs.filter(d => d.data && !d.data.pending && !d.id.startsWith('_') && d.data.user !== painel.master).map(d => ({user: d.data.user, permissions: d.data.permissions || [], fixed: !!d.data.fixed, google: d.data.emails || [], created: d.data.created || null})),
    pending: docs.filter(d => d.data?.pending).map(d => { const {pending, ...item} = d.data; return item; })};
  // Mudanças feitas aqui que o PC ainda não aplicou.
  s.adminPending = (s.adminPending || []).filter(c => c.at > (painelDoc?.at || 0));
  for (const c of s.adminPending) applyChange(L, c);
  return L;
}
async function adminLive(s, path, request) {
  if (!path.startsWith('/api/master/users') && path !== '/api/master/permissions') return null;
  if (!s.fb?.user) return null;
  if (s.fb.role !== 'master') return json({error: 'Somente o administrador pode abrir o painel de gestão.'}, 403);
  try {
    if (request.method === 'GET') {
      const L = await adminListing(s);
      return json(path === '/api/master/permissions' ? {users: L.users.map(u => ({user: u.user, permissions: u.permissions}))} : L);
    }
    if (request.method !== 'POST') return json({error: 'Método não permitido.'}, 405);
    const data = await request.clone().json().catch(() => ({}));
    const action = path === '/api/master/permissions' ? 'save' : path.split('/').pop();
    if (typeof data.password === 'string' && data.password) return json({error: 'Trocar ou criar senha precisa do PC ligado. As outras mudanças funcionam na nuvem.'}, 400);
    const user = String(data.user || '').trim(), permissions = (Array.isArray(data.permissions) ? data.permissions : []).filter(a => AREAS.includes(a));
    if (!['save', 'create', 'delete', 'approve', 'reject', 'dismiss-reset', 'master-email-remove'].includes(action)) return json({error: 'Ação desconhecida.'}, 404);
    if (action === 'create') {
      if (!/^[A-Za-z0-9._-]{3,30}$/.test(user)) return json({error: 'Usuário de 3 a 30 letras ou números, sem espaços.'}, 400);
      if (!data.google) return json({error: 'Informe o e-mail Google da pessoa.'}, 400);
    }
    if (typeof data.google === 'string' && data.google.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.google.trim())) return json({error: 'E-mail Google inválido.'}, 400);
    const change = {type: action, user, permissions, at: Date.now()};
    if (typeof data.google === 'string') change.google = data.google;
    if (data.newUser) change.newUser = String(data.newUser).trim();
    if (data.email) change.email = String(data.email);
    await fsCall('POST', '/alteracoes', {fields: {json: {stringValue: JSON.stringify(change)}}});
    s.adminPending = [...(s.adminPending || []), change]; saveState();
    const L = await adminListing(s);
    return json(path === '/api/master/permissions' ? {ok: true, user, permissions, passwordChanged: false} : L);
  } catch (e) { return json({error: 'Não consegui salvar na nuvem agora. Tente de novo.'}, 503); }
}

// Capas (BalituFlix e audiolivros): o endereço traz versão e largura (?v=...&w=...), que mudam
// com o tempo. Se a combinação exata não está na cópia, serve a mesma capa em outra versão.
// ---------- Jogos ao vivo: catálogo, capas e ROMs vêm do Google Drive ----------
let nuvemCfg = null, nuvemCfgAt = 0, gamesCat = null, gamesCatId = '';
async function nuvemConfig() {
  if (nuvemCfg && Date.now() - nuvemCfgAt < 300000) return nuvemCfg;
  try { nuvemCfg = docJson(await fsCall('GET', '/audiolivros/_nuvem')) || {}; nuvemCfgAt = Date.now(); } catch { nuvemCfg = nuvemCfg || {}; }
  return nuvemCfg;
}
async function driveJson(id) {
  const c = await caches.open('balitu-arquivos'), key = '/__drive_json__/' + id;
  const hit = await c.match(key);
  if (hit) return hit.json();
  const s = await loadState();
  if (!s?.token || Date.now() > s.tokenExp) throw new Error('sessão');
  const r = await fetch(DRIVE + id + '?alt=media&supportsAllDrives=true', {headers: {Authorization: 'Bearer ' + s.token}});
  if (!r.ok) throw new Error('drive ' + r.status);
  const txt = await r.text();
  c.put(key, new Response(txt, {headers: {'Content-Type': 'application/json'}})).catch(() => {});
  return JSON.parse(txt);
}
async function gamesLive() {
  const cfg = await nuvemConfig();
  if (!cfg.jogos) return null;
  if (gamesCat && gamesCatId === cfg.jogos) return gamesCat;
  const list = await driveJson(cfg.jogos);
  for (const g of list) g.s = (g.n + ' ' + g.c).toLocaleLowerCase('pt-BR');
  gamesCat = {list, byId: new Map(list.map(g => [g.i, g]))}; gamesCatId = cfg.jogos;
  return gamesCat;
}
// Jogo salvo: fica na conta (Firestore, em pedaços) e com uma cópia no aparelho para abrir rápido.
// O PC sincroniza com a pasta game-saves (vale o mais recente).
const SAVE_CHUNK = 600 * 1024;
async function saveKey(id) {
  let p = '';
  try { const b = atob(id.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((id.length + 3) % 4)); p = new TextDecoder().decode(Uint8Array.from(b, c => c.charCodeAt(0))); } catch { p = id; }
  return hex(p.toLowerCase());
}
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
async function gameSave(s, path, url, request) {
  const id = url.searchParams.get('id') || '';
  const key = await saveKey(id), doc = progCol(s) + '/jogo~' + key;
  const c = await caches.open('balitu-jogos-saves'), local = '/__save__/' + key;
  const meta = async () => { try { return docJson(await fsCall('GET', doc)); } catch { return undefined; } };
  if (path === '/api/games/state-info') {
    const m = await meta(), h = await c.match(local), localAt = h ? Number(h.headers.get('X-At')) || 0 : 0;
    const at = Math.max(m?.updatedAt || 0, localAt);
    return json(at ? {exists: true, updatedAt: at} : {exists: false});
  }
  if (request.method === 'POST') {
    const data = new Uint8Array(await request.arrayBuffer()), at = Date.now();
    if (!data.length) return json({error: 'Vazio'}, 400);
    await c.put(local, new Response(data, {headers: {'Content-Type': 'application/octet-stream', 'X-At': String(at)}}));
    try {
      const parts = Math.ceil(data.length / SAVE_CHUNK);
      for (let i = 0; i < parts; i++) await fsCall('PATCH', doc + '~' + i, {fields: {d: {stringValue: b64(data.subarray(i * SAVE_CHUNK, (i + 1) * SAVE_CHUNK))}}});
      const g = gamesCat?.byId.get(id);
      await fsPut(doc, {tipo: 'jogo', id, name: g?.n || '', console: g?.c || '', parts, size: data.length, updatedAt: at});
    } catch { return json({ok: true, soNoAparelho: true}); }
    return json({ok: true, updatedAt: at});
  }
  // Abrir o jogo salvo: usa a cópia do aparelho se for a mais nova; senão baixa da conta.
  const m = await meta(), h = await c.match(local), localAt = h ? Number(h.headers.get('X-At')) || 0 : 0;
  if (h && localAt >= (m?.updatedAt || 0)) return new Response(await h.arrayBuffer(), {headers: {'Content-Type': 'application/octet-stream'}});
  if (!m?.parts) return json({error: 'Sem jogo salvo'}, 404);
  const out = new Uint8Array(m.size); let pos = 0;
  for (let i = 0; i < m.parts; i++) { const d = await fsCall('GET', doc + '~' + i); const u = unb64(d?.fields?.d?.stringValue || ''); out.set(u, pos); pos += u.length; }
  await c.put(local, new Response(out, {headers: {'Content-Type': 'application/octet-stream', 'X-At': String(m.updatedAt)}}));
  return new Response(out, {headers: {'Content-Type': 'application/octet-stream'}});
}
const gameSort = new Intl.Collator('pt-BR', {numeric: true, sensitivity: 'base'});
async function gamesApi(s, path, url, request) {
  if (!path.startsWith('/api/games') || path.startsWith('/api/games/trap')) return null;
  if (path === '/api/games/state' || path === '/api/games/state-info') return s.fb?.user ? gameSave(s, path, url, request) : json({exists: false});
  const cat = await gamesLive().catch(() => null);
  if (!cat) return null; // catálogo ainda não está na nuvem: usa a cópia das páginas
  const pub = g => ({id: g.i, name: g.n, format: g.f, console: g.c, core: g.k, cover: ''});
  const lc = t => String(t || '').trim().toLocaleLowerCase('pt-BR');
  const P = url.searchParams;
  if (path === '/api/games/consoles') {
    const m = new Map(); for (const g of cat.list) m.set(g.c, (m.get(g.c) || 0) + 1);
    return json({consoles: [...m].map(([name, count]) => ({name, count})).sort((a, b) => gameSort.compare(a.name, b.name))});
  }
  if (path === '/api/games') {
    const q = lc(P.get('q')), want = lc(P.get('console')), off = Math.max(0, Number(P.get('offset') || 0));
    const all = cat.list.filter(g => (!want || lc(g.c) === want) && (!q || g.s.includes(q)));
    return json({games: all.slice(off, off + 120).map(pub), total: all.length, partial: off + 120 < all.length});
  }
  if (path === '/api/games/boxart' || path === '/api/games/cover') {
    const g = cat.byId.get(P.get('id') || '');
    if (g?.a) { const r = await driveFile(g.a, request, 'image/png'); if (r && r.ok) return r; }
    return json({error: 'Sem capa'}, 404);
  }
  if (path === '/api/games/collage') {
    const want = lc(P.get('console')), list = cat.list.filter(g => lc(g.c) === want && g.a), picks = [];
    for (let i = 0; i < Math.min(5, list.length); i++) { const g = list[Math.floor(i * list.length / Math.min(5, list.length))]; picks.push({id: g.i, cover: ''}); }
    return json({games: picks});
  }
  if (path === '/api/games/info') return json({});
  if (path === '/api/games/art-status') return json({running: false, done: cat.list.length, total: cat.list.length});
  if (path === '/api/games/file') {
    const g = cat.byId.get(P.get('id') || '');
    if (!g) return json({error: 'Jogo não encontrado'}, 404);
    return (await driveFile(g.r, request, 'application/zip')) || offline();
  }
  return null;
}

// ---------- BalituFlix ao vivo: catálogo e vídeos vêm do Drive da Ulbra ----------
let flixCat = null, flixCatId = '';
async function flixLive() {
  const cfg = await nuvemConfig();
  if (!cfg.filmes) return null;
  if (flixCat && flixCatId === cfg.filmes) return flixCat;
  const data = await driveJson(cfg.filmes);
  const eps = new Map();
  for (const sh of data.shows || []) for (const e of sh.episodes || []) eps.set(e.id, e);
  flixCat = {data, eps}; flixCatId = cfg.filmes;
  return flixCat;
}
const srtToVtt = t => 'WEBVTT\n\n' + t.replace(/^\uFEFF/, '').replace(/\r/g, '').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');
async function flixApi(s, path, url, request) {
  if (!path.startsWith('/balituflix/')) return null;
  const cat = await flixLive().catch(() => null);
  if (!cat) return null; // ainda nada na nuvem: usa a cópia das páginas
  if (path === '/balituflix/api/catalog') {
    let token = '';
    try { token = JSON.parse(s.entries['/balituflix/api/catalog']?.x || '{}').token || ''; } catch {}
    return json({shows: cat.data.shows, token, root: ''});
  }
  const m = /^\/balituflix\/(media|api\/tracks|api\/subtitle)\/([a-f0-9]{16})$/.exec(path);
  if (!m) return null;
  const e = cat.eps.get(m[2]);
  if (!e) return json({error: 'Este vídeo ainda não foi enviado para a nuvem.'}, 404);
  if (m[1] === 'media') return (await driveFile(e.v, request, 'video/mp4')) || offline();
  if (m[1] === 'api/tracks') return json({audio: [], subtitles: e.s ? [{index: 0, label: 'Português (BR)', language: 'por'}] : []});
  if (!e.s) return json({}, 404);
  const r = await driveFile(e.s, new Request(request.url), 'text/plain');
  if (!r || !r.ok) return json({}, 503);
  const txt = await r.text();
  return new Response(e.st === 'vtt' ? txt : srtToVtt(txt), {headers: {'Content-Type': 'text/vtt; charset=utf-8'}});
}

const COVER_PATH = /^\/(balituflix\/covers\/|balito-leitor\/api\/cover\/)/;
let coverIndex = null, coverIndexOf = null;
function coverEntry(s, path) {
  if (!COVER_PATH.test(path)) return null;
  if (coverIndexOf !== s.entries) {
    coverIndex = new Map(); coverIndexOf = s.entries;
    for (const k of Object.keys(s.entries)) { const p = k.split('?')[0]; if (COVER_PATH.test(p) && !coverIndex.has(p)) coverIndex.set(p, k); }
  }
  const k = coverIndex.get(path);
  return k ? s.entries[k] : null;
}

async function handle(request) {
  const url = new URL(request.url);
  if (url.origin !== location.origin) return fetch(request);
  let path = url.pathname;
  if (PROPRIOS.has(path) || path.startsWith('/consoles/')) return fetch(request);
  const s = await loadState();
  const isNav = request.mode === 'navigate';
  if (!s) return isNav ? Response.redirect('/entrar?volta=' + encodeURIComponent(path + url.search), 302) : json({error: 'Entre de novo para continuar.'}, 401, {'X-Balitu-Nuvem': 'entrar'});

  // Endereços que o site monta como "/api" + "/x" ficam com o prefixo da nuvem repetido no meio.
  if (BASE && path.includes(BASE)) path = path.split(BASE).join('');
  // Chamadas internas que só fazem sentido no PC: respondem em silêncio (sem aviso na tela).
  if (path === '/api/database-activity') return new Response(null, {status: 204});
  if (path === '/balito-leitor/api/drama/jobs' && request.method === 'GET') return json({items: []});
  if (path === '/balito-leitor/api/voices' && request.method === 'GET' && !s.entries[path]) return json({voices: []});
  // Painel de gestão e Status ao vivo (Firebase).
  { const live = await statusLive(s, path, url, request); if (live) return live; }
  { const live = await adminLive(s, path, request); if (live) return live; }
  // Reader ao vivo: biblioteca, capas, progresso e áudio vêm do Firebase + Drive.
  if (path.startsWith('/balito-leitor/api/')) { const live = await readerLive(s, path, url, request); if (live) return live; }
  // Audiolivros: tocam direto do Drive.
  const audio = /^\/balito-leitor\/api\/audio\/([a-f0-9-]{36})$/.exec(path);
  if (audio) {
    const b = s.books?.find(x => x.id === audio[1]), part = b?.parts.find(p => p.index === Number(url.searchParams.get('part') || 0));
    if (part) return (await driveFile(part.file, request, 'audio/mpeg')) || offline();
    return offline();
  }
  // Filmes (teste): procura no Drive o que foi liberado para esta conta e toca direto de lá.
  if (path === '/__video__/lista') {
    if (!s.token || Date.now() > s.tokenExp) return json({error: 'Sessão expirada'}, 401, {'X-Balitu-Nuvem': 'token'});
    const nome = (url.searchParams.get('nome') || '').replace(/['\\]/g, '');
    const q = encodeURIComponent(`name contains '${nome}' and trashed=false and mimeType != 'application/vnd.google-apps.folder'`);
    const r = await fetch(DRIVE + '?q=' + q + '&fields=files(id,name,size,mimeType,owners(emailAddress))&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true', {headers: {Authorization: 'Bearer ' + s.token}});
    return new Response(await r.text(), {status: r.status, headers: {'Content-Type': 'application/json'}});
  }
  const video = /^\/__video__\/arquivo\/([A-Za-z0-9_-]{10,})$/.exec(path);
  if (video) return (await driveFile(video[1], request, url.searchParams.get('tipo') || 'video/x-matroska')) || offline();
  // Jogos: catálogo, capas e ROMs direto do Drive.
  { const g = await gamesApi(s, path, url, request); if (g) return g; }
  // BalituFlix: catálogo e vídeos direto do Drive da Ulbra.
  { const f = await flixApi(s, path, url, request); if (f) return f; }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // Progresso do Reader: aceita e devolve o livro (fica salvo no aparelho pelo próprio player).
    const prog = /^\/balito-leitor\/api\/progress\/([a-f0-9-]{36})$/.exec(path);
    if (prog) { const b = readerBook(s, prog[1]); if (b) return json(b); }
    return offline();
  }
  const key = path + url.search;
  let e = s.entries[key] || s.entries[path] || (path.endsWith('/') ? s.entries[path + 'index.html'] : null);
  if (!e && !url.search && !path.endsWith('/')) e = s.entries[path + '/'];
  if (!e) e = coverEntry(s, path);
  if (e) {
    if (e.x != null) return new Response(rewrite(e.x, e.t), {headers: {'Content-Type': e.t + (/charset/.test(e.t) ? '' : '; charset=utf-8')}});
    const id = s.blobs[e.b];
    if (id) {
      const r = await driveFile(id, request, e.t);
      if (r && r.status < 300 && /text|javascript|json|svg/.test(e.t)) return new Response(rewrite(await r.text(), e.t), {headers: {'Content-Type': e.t}});
      if (r) return r;
    }
  }
  const book = /^\/balito-leitor\/api\/book\/([a-f0-9-]{36})$/.exec(path);
  if (book) { const b = readerBook(s, book[1]); return b ? json(b) : offline(404); }
  if (/^\/balito-leitor\/api\/cover\//.test(path) || request.destination === 'image' || /\.(png|jpe?g|webp|gif|svg)$/i.test(path)) return new Response(PLACEHOLDER, {headers: {'Content-Type': 'image/svg+xml'}});
  if (isNav || request.destination === 'document') return offlinePage(path);
  return offline();
}
self.addEventListener('fetch', e => {
  const p = handle(e.request).catch(() => offline());
  e.respondWith(p);
  // Mantém vivo o download do audiolivro para o aparelho.
  e.waitUntil(p.then(() => Promise.all([...downloading.values()])).catch(() => {}));
});
