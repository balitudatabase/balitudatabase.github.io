// Colocado em todas as páginas do modo nuvem: selo "modo nuvem" e o aviso
// quando algo precisa do PC ligado (tocar vídeo, música, abrir arquivo...).
(function () {
  'use strict';
  var BASE = '';
  var MSG = 'O servidor não está ativo no momento! :( Volte mais tarde';
  var CLIENT_ID = '330955968953-hkm76a032m98apcoidf3jc00m7qm15r7.apps.googleusercontent.com';
  var lastClick = 0, lastShown = 0;
  var fetch0 = window.fetch;

  // ---------- O PC voltou? ----------
  // O modo nuvem é só uma cópia para quando o PC está desligado. Se o servidor responde,
  // a pessoa é levada para o site completo (mesmo caminho), em vez de ver "servidor não está ativo".
  var PC_FIXO = 'https://jucabalitu-pc.tailcec770.ts.net';
  var DESTINO = 'https://alaorfrangullysjunior01-dot.github.io/googlefotos/destino.txt';
  var pcCheck = null, pcCheckAt = 0, indoParaPc = false;
  function sonda(base) {
    return new Promise(function (ok, no) {
      var i = new Image(), t = setTimeout(function () { i.onload = i.onerror = null; i.src = ''; no(); }, 6000);
      i.onload = function () { clearTimeout(t); ok(base); };
      i.onerror = function () { clearTimeout(t); no(); };
      i.src = base + '/logo-backup.svg?' + Date.now();
    });
  }
  // Devolve o endereço do PC se ele estiver no ar, ou null. Guarda a resposta por 20 s.
  function pcOnline() {
    if (pcCheck && Date.now() - pcCheckAt < 20000) return pcCheck;
    pcCheckAt = Date.now();
    pcCheck = new Promise(function (ok) {
      var abertas = 0, feito = false, listaFechada = false;
      function fim(valor) { if (!feito && (valor || (listaFechada && abertas === 0))) { feito = true; ok(valor || null); } }
      function tentar(base) { abertas++; sonda(base).then(function (b) { abertas--; fim(b); }, function () { abertas--; fim(null); }); }
      tentar(PC_FIXO);
      // O endereço público atual também fica publicado em destino.txt (caso o fixo mude um dia).
      var espera = new Promise(function (r) { setTimeout(r, 4000); });
      Promise.race([fetch0(DESTINO + '?' + Date.now(), {cache: 'no-store'}).then(function (r) { return r.ok ? r.text() : ''; }), espera])
        .then(function (t) { var u = String(t || '').trim().replace(/\/+$/, ''); if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(u) && u !== PC_FIXO) tentar(u); })
        .catch(function () {})
        .then(function () { listaFechada = true; fim(null); });
    });
    return pcCheck;
  }
  function irParaPc(base, caminho) {
    if (indoParaPc) return; indoParaPc = true;
    ready(function () {
      var n = document.createElement('div');
      n.setAttribute('style', 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;background:#0b0f22f2;color:#9ff0d4;border:1px solid #2ad1a155;border-radius:99px;padding:9px 16px;font:600 13px system-ui,sans-serif');
      n.textContent = 'Servidor no ar — abrindo o site completo…';
      document.body.appendChild(n);
    });
    location.replace(base + (caminho || (location.pathname + location.search + location.hash)));
  }
  window.BalituNuvem = {pcOnline: pcOnline, irParaPc: irParaPc};
  // Ao abrir qualquer página da nuvem: se o PC já voltou, vai para ele.
  if (!/^\/entrar(\.html)?$/.test(location.pathname)) pcOnline().then(function (b) { if (b) irParaPc(b); });
  addEventListener('pointerdown', function () { lastClick = Date.now(); renovar(false); }, true);

  // Renova sozinho o acesso ao Google Drive (vale 1 hora) no próximo toque na tela,
  // sem precisar entrar de novo. Os audiolivros continuam tocando.
  var gis = null, renovando = false;
  function carregarGis(cb) {
    if (window.google && google.accounts && google.accounts.oauth2) return cb();
    if (document.getElementById('bn-gis')) return setTimeout(function () { carregarGis(cb); }, 300);
    var sc = document.createElement('script'); sc.id = 'bn-gis'; sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = cb; document.head.appendChild(sc);
  }
  if (document.readyState !== 'loading') carregarGis(function () {}); else addEventListener('DOMContentLoaded', function () { carregarGis(function () {}); });
  function renovar(forcar, depois) {
    var exp = Number(localStorage.getItem('bal-nuvem-exp') || 0);
    if (renovando || (!forcar && exp - Date.now() > 15 * 60000)) return;
    if (!(window.google && google.accounts && google.accounts.oauth2)) { carregarGis(function () {}); return; }
    renovando = true;
    gis = gis || google.accounts.oauth2.initTokenClient({client_id: CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.readonly openid email', callback: function () {}});
    gis.callback = function (r) {
      renovando = false;
      if (!r || r.error || !r.access_token) return;
      var tokenExp = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000;
      localStorage.setItem('bal-nuvem-exp', String(tokenExp));
      if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({type: 'token', token: r.access_token, tokenExp: tokenExp});
      if (depois) setTimeout(depois, 300);
    };
    gis.error_callback = function () { renovando = false; };
    try { gis.requestAccessToken({prompt: '', login_hint: localStorage.getItem('bal-nuvem-email') || ''}); } catch (e) { renovando = false; }
  }
  addEventListener('keydown', function () { lastClick = Date.now(); }, true);

  var css = '.bn-badge{position:fixed;left:12px;bottom:12px;z-index:2147483646;background:#0b0f22e6;color:#9ff0d4;border:1px solid #2ad1a155;border-radius:99px;padding:5px 11px;font:600 12px system-ui,sans-serif;pointer-events:none}' +
    '.bn-back{position:fixed;inset:0;z-index:2147483647;background:#05081acc;display:grid;place-items:center;padding:20px;font:16px system-ui,sans-serif}' +
    '.bn-box{max-width:380px;background:#151a35;color:#fff;border:1px solid #ffffff24;border-radius:20px;padding:28px 22px;text-align:center;box-shadow:0 20px 60px #000a}' +
    '.bn-box b{display:block;font-size:19px;margin:8px 0 6px}.bn-box p{color:#c5c1dc;margin:0 0 18px;font-size:14px}' +
    '.bn-box button{border:0;border-radius:99px;padding:11px 22px;font-weight:700;color:#fff;background:linear-gradient(135deg,#ff4b62,#9c4dff);cursor:pointer;font-size:15px}';
  function ready(f) { document.body ? f() : addEventListener('DOMContentLoaded', f); }
  ready(function () {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  });

  function modal(title, text, button, action) {
    if (document.querySelector('.bn-back')) return;
    var back = document.createElement('div'); back.className = 'bn-back';
    back.innerHTML = '<div class="bn-box"><div style="font-size:42px">😴</div><b></b><p></p><button></button></div>';
    back.querySelector('b').textContent = title; back.querySelector('p').textContent = text; back.querySelector('button').textContent = button;
    back.querySelector('button').onclick = function () { back.remove(); if (action) action(); };
    back.onclick = function (e) { if (e.target === back) back.remove(); };
    ready(function () { document.body.appendChild(back); });
  }
  function avisar() {
    if (Date.now() - lastShown < 4000) return; lastShown = Date.now();
    document.querySelectorAll('video,audio').forEach(function (m) { try { m.pause(); } catch (e) {} });
    // Antes de dizer que o servidor está fora, confere: se ele responde, abre o site completo.
    pcOnline().then(function (b) {
      if (b) return irParaPc(b);
      modal(MSG, 'Tocar, baixar e abrir arquivos precisa do PC ligado. O resto do Balitu Database continua aqui.', 'Entendi');
    });
  }
  function entrarDeNovo() { location.href = '/entrar?volta=' + encodeURIComponent(location.pathname + location.search); }
  function sessao() {
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    modal('Sua sessão na nuvem expirou', 'Toque para continuar de onde parou.', 'Continuar', function () {
      renovar(true, function () { if (!retomarMidia()) location.reload(); });
      setTimeout(function () { if (renovando || Number(localStorage.getItem('bal-nuvem-exp') || 0) < Date.now()) location.href = '/entrar?volta=' + encodeURIComponent(location.pathname + location.search); }, 15000);
    });
  }
  // Filme ou audiolivro que parou porque o acesso venceu: volta do mesmo ponto, sem recarregar.
  function retomarMidia() {
    var feito = false;
    document.querySelectorAll('video,audio').forEach(function (m) {
      if (!m.error || !m.currentSrc) return;
      var t = m.currentTime, src = m.currentSrc;
      m.addEventListener('loadedmetadata', function () { try { m.currentTime = t; } catch (e) {} m.play().catch(function () {}); }, {once: true});
      m.src = src; feito = true;
    });
    return feito;
  }
  // Filme longo: avisa antes do acesso de 1 hora vencer (um toque renova sem parar o vídeo).
  var aviso = null;
  setInterval(function () {
    var exp = Number(localStorage.getItem('bal-nuvem-exp') || 0), tocando = false;
    document.querySelectorAll('video').forEach(function (v) { if (!v.paused && !v.ended) tocando = true; });
    var mostrar = tocando && exp && exp - Date.now() < 5 * 60000;
    if (mostrar && !aviso && document.body) {
      aviso = document.createElement('div'); aviso.className = 'bn-badge';
      aviso.style.cssText = 'left:50%;transform:translateX(-50%);bottom:auto;top:14px;color:#fff;background:#3a1d6ee6;border-color:#b48cff88;font-size:13px;padding:8px 14px';
      aviso.textContent = 'Toque na tela para o filme continuar sem parar';
      document.body.appendChild(aviso);
    } else if (!mostrar && aviso) { aviso.remove(); aviso = null; }
  }, 15000);
  function checar(res, method, url) {
    var tipo = res && res.headers && res.headers.get('X-Balitu-Nuvem');
    if (tipo === 'token') return sessao();
    if (tipo === 'entrar') return entrarDeNovo();
    if (tipo === 'offline' && (method !== 'GET' || Date.now() - lastClick < 2500 || /media|play|stream|download|file|audio|video/i.test(url))) avisar();
  }
  var f0 = fetch0;
  window.fetch = function (input, init) {
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase(), url = String(input && input.url || input);
    return f0.apply(this, arguments).then(function (r) { checar(r, method, url); return r; });
  };
  var open0 = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var x = this; x.addEventListener('load', function () { checar({headers: {get: function (h) { return x.getResponseHeader(h); }}}, String(method).toUpperCase(), String(url)); });
    return open0.apply(this, arguments);
  };
  // Vídeo ou música que não carregam = precisam do PC.
  // (Se o acesso ao Google Drive venceu, o problema é a sessão, não o servidor.)
  addEventListener('error', function (e) {
    var t = e.target; if (!t || !/^(VIDEO|AUDIO|SOURCE)$/.test(t.tagName)) return;
    if (Number(localStorage.getItem('bal-nuvem-exp') || 0) < Date.now()) sessao(); else avisar();
  }, true);
})();
