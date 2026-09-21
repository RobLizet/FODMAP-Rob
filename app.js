(function () {
  'use strict';

  const F = window.FODMAP;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    kids.flat().forEach(c => {
      if (c == null || c === false) return;
      el.append(c.nodeType ? c : document.createTextNode(c));
    });
    return el;
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem('fodmap.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('fodmap.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  let settings = Object.assign({ groups: Object.keys(F.GROUPS) }, store.get('settings', {}));
  let history = store.get('history', []);
  const shown = {};           // container-id -> {data, actions}
  let pendingBarcode = '';

  const enabled = () => new Set(settings.groups);
  const LV = { high: 'high', moderate: 'mod', unsure: 'unsure', none: 'none', low: 'low' };
  const VERDICT = {
    high: { cls: 'high', title: 'Hoog FODMAP', sub: 'Bevat ingrediënten die vaak klachten geven.' },
    moderate: { cls: 'mod', title: 'Matig FODMAP', sub: 'Bij dit product is de portiegrootte bepalend.' },
    low: { cls: 'low', title: 'Geen FODMAP-ingrediënten gevonden', sub: 'Op basis van de ingrediëntenlijst en jouw instellingen.' },
    unknown: { cls: 'unk', title: 'Geen ingrediënten beschikbaar', sub: 'Plak de ingrediëntenlijst zelf om te controleren.' }
  };

  function describeHit(hit, total) {
    let s = 'Gevonden als “' + hit.terms.join(', ') + '”';
    if (total > 1) s += ' (plek ' + hit.first + ' van ' + total + ')';
    s += '.';
    if (hit.note) s += ' ' + hit.note;
    return s;
  }

  function renderResult(target, data, actions) {
    shown[target.id] = { data, actions };
    const res = F.analyze(data.text, enabled());
    const v = VERDICT[res.verdict];

    const card = h('section', { class: 'card result' },
      h('div', { class: 'prod' },
        data.image ? h('img', { src: data.image, alt: '', loading: 'lazy' }) : null,
        h('div', null,
          h('h2', { text: data.title || 'Product' }),
          data.brand ? h('p', { class: 'muted small', text: data.brand }) : null,
          data.barcode ? h('p', { class: 'muted small', text: 'Barcode ' + data.barcode }) : null)),
      h('div', { class: 'verdict ' + v.cls },
        h('strong', { text: v.title }),
        v.sub ? h('span', { text: v.sub }) : null)
    );

    if (res.hits.length) {
      card.append(h('h3', { text: 'Gevonden' }));
      card.append(h('ul', { class: 'hits' }, res.hits.map(hit =>
        h('li', { class: 'hit' },
          h('div', { class: 'hit-head' },
            h('span', { class: 'dot ' + LV[hit.level] }),
            h('strong', { text: hit.name }),
            hit.groups.length ? h('span', { class: 'tags' }, hit.groups.map(g => h('span', { class: 'tag', text: F.GROUPS[g] }))) : null),
          h('p', { class: 'small', text: describeHit(hit, res.total) })))));
    }

    if (res.items.length) {
      card.append(h('h3', { text: 'Ingrediënten' }));
      const p = h('p', { class: 'ingr' });
      res.items.forEach((it, i) => {
        p.append(h('span', { class: 'tok ' + LV[it.level], text: it.text }));
        if (i < res.items.length - 1) p.append(', ');
      });
      card.append(p);
    }

    const acts = actions ? actions(res) : [];
    if (acts && acts.length) card.append(h('div', { class: 'actions' }, acts));
    card.append(h('p', { class: 'disc', text: 'Indicatief en zonder portiegroottes. Geen medisch advies.' }));

    target.replaceChildren(card);
    return res;
  }

  function saveHistory(data, verdict) {
    if (!data.text) return;
    const key = x => x.barcode || ('t:' + x.text.slice(0, 80));
    history = history.filter(x => key(x) !== key(data));
    history.unshift({
      title: data.title || 'Product', brand: data.brand || '', image: data.image || '',
      barcode: data.barcode || '', text: data.text, verdict, t: Date.now()
    });
    history = history.slice(0, 40);
    store.set('history', history);
    renderHistory();
  }

  function show(target, data, save, actions) {
    const res = renderResult(target, data, actions);
    if (save) saveHistory(data, res.verdict);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- navigatie ----------
  function showView(name) {
    if (name !== 'scan') stopCamera();
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    $$('nav.nav button').forEach(b => {
      if (b.dataset.view === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }
  $$('nav.nav button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  function goToText(barcode, title) {
    pendingBarcode = barcode || '';
    $('#txtName').value = title || '';
    $('#txtIngr').value = '';
    $('#txtHint').textContent = barcode ? 'Typ of plak de ingrediëntenlijst van de verpakking (barcode ' + barcode + ').' : '';
    $('#textResult').replaceChildren();
    showView('text');
    $('#txtIngr').focus();
  }

  // ---------- scannen ----------
  const cam = $('#cam');
  let stream = null, detector = null, timer = null, scanning = false;
  const setMsg = t => { $('#scanMsg').textContent = t; };

  async function startCamera() {
    if (!('BarcodeDetector' in window)) {
      setMsg('Deze browser ondersteunt geen barcodescanner. Typ de barcode hieronder in (werkt in Chrome op Android).');
      return;
    }
    try {
      detector = detector || new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    } catch (e) {
      detector = new BarcodeDetector();
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch (e) {
      setMsg('Geen toegang tot de camera. Geef toestemming in je browser of typ de barcode in.');
      return;
    }
    cam.srcObject = stream;
    try { await cam.play(); } catch (e) { /* ignore */ }
    $('#camBox').hidden = false;
    $('#camStart').hidden = true;
    $('#scanResult').replaceChildren();
    scanning = true;
    setMsg('Richt de camera op de barcode…');
    loop();
  }

  function loop() {
    if (!scanning) return;
    timer = setTimeout(async () => {
      try {
        if (cam.readyState >= 2) {
          const codes = await detector.detect(cam);
          if (codes.length) {
            const code = codes[0].rawValue;
            stopCamera();
            if (navigator.vibrate) navigator.vibrate(60);
            lookup(code);
            return;
          }
        }
      } catch (e) { /* volgende ronde */ }
      loop();
    }, 200);
  }

  function stopCamera() {
    scanning = false;
    clearTimeout(timer);
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    cam.srcObject = null;
    $('#camBox').hidden = true;
    $('#camStart').hidden = false;
  }

  const rescanBtn = () => h('button', { class: 'btn', onclick: () => { $('#codeInput').value = ''; startCamera(); } }, 'Volgend product scannen');

  async function lookup(raw) {
    const code = String(raw).replace(/\D/g, '');
    const out = $('#scanResult');
    if (code.length < 8) { setMsg('Dat is geen geldige barcode (minimaal 8 cijfers).'); return; }
    $('#codeInput').value = code;
    setMsg('Product opzoeken…');
    out.replaceChildren();

    const cached = history.find(x => x.barcode === code);
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch('https://world.openfoodfacts.org/api/v2/product/' + code +
        '.json?fields=code,product_name,brands,image_front_small_url,ingredients_text,ingredients_text_nl,ingredients_text_en',
        { signal: ctrl.signal });
      clearTimeout(to);
      const j = await r.json();
      if (j.status !== 1 || !j.product) {
        setMsg('');
        out.replaceChildren(h('div', { class: 'card' },
          h('h2', { style: 'font-size:18px', text: 'Product niet gevonden' }),
          h('p', { class: 'muted small', style: 'margin:6px 0 12px', text: 'Barcode ' + code + ' staat niet in Open Food Facts. Je kunt de ingrediëntenlijst zelf invoeren.' }),
          h('div', { class: 'actions' },
            h('button', { class: 'btn', onclick: () => goToText(code, '') }, 'Ingrediënten invoeren'),
            rescanBtn())));
        return;
      }
      const p = j.product;
      const data = {
        title: p.product_name || 'Onbekend product', brand: p.brands || '',
        image: p.image_front_small_url || '', barcode: code,
        text: p.ingredients_text_nl || p.ingredients_text || p.ingredients_text_en || '', source: 'Open Food Facts'
      };
      setMsg('');
      show(out, data, true, res => [
        res.verdict === 'unknown' ? h('button', { class: 'btn', onclick: () => goToText(code, data.title) }, 'Ingrediënten invoeren') : null,
        rescanBtn()
      ]);
    } catch (e) {
      if (cached) {
        setMsg('Geen verbinding: dit is de eerder opgeslagen versie.');
        show(out, cached, false, () => [rescanBtn()]);
      } else {
        setMsg('Geen verbinding of de server reageert niet. Probeer het opnieuw of voer de ingrediënten zelf in.');
        out.replaceChildren(h('div', { class: 'card actions' },
          h('button', { class: 'btn', onclick: () => lookup(code) }, 'Opnieuw proberen'),
          h('button', { class: 'btn ghost', onclick: () => goToText(code, '') }, 'Ingrediënten invoeren')));
      }
    }
  }

  $('#camStart').addEventListener('click', startCamera);
  $('#camStop').addEventListener('click', () => { stopCamera(); setMsg('Scan de barcode op de verpakking, of typ hem hieronder in.'); });
  $('#codeForm').addEventListener('submit', e => { e.preventDefault(); stopCamera(); lookup($('#codeInput').value); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

  // ---------- tekst ----------
  $('#txtGo').addEventListener('click', () => {
    const text = $('#txtIngr').value.trim();
    if (!text) { $('#txtHint').textContent = 'Voer eerst een ingrediëntenlijst in.'; return; }
    const data = { title: $('#txtName').value.trim() || 'Eigen ingrediëntenlijst', brand: '', image: '', barcode: pendingBarcode, text, source: 'Handmatig' };
    show($('#textResult'), data, true);
  });
  $('#txtPaste').addEventListener('click', async () => {
    try { $('#txtIngr').value = await navigator.clipboard.readText(); }
    catch (e) { $('#txtHint').textContent = 'Plakken niet toegestaan: houd het tekstveld ingedrukt en kies Plakken.'; }
  });
  $('#txtClear').addEventListener('click', () => {
    $('#txtIngr').value = ''; $('#txtName').value = ''; pendingBarcode = '';
    $('#txtHint').textContent = ''; $('#textResult').replaceChildren();
  });

  // ---------- zoeken ----------
  let lvlFilter = 'all';
  function renderSearch() {
    const rows = F.search($('#q').value).filter(r => lvlFilter === 'all' || r.level === lvlFilter);
    const ul = $('#searchList');
    if (!rows.length) { ul.replaceChildren(h('li', null, h('span', { class: 'muted small', text: 'Niets gevonden. Staat het niet in de lijst, dan is de uitslag onbekend.' }))); return; }
    ul.replaceChildren(...rows.map(r => h('li', null,
      h('span', { class: 'dot ' + LV[r.level], style: 'margin-top:6px' }),
      h('div', { class: 'grow' },
        h('b', { text: r.name }),
        r.groups.length ? h('span', { class: 'tags', style: 'margin-left:8px;display:inline-flex' }, r.groups.map(g => h('span', { class: 'tag', text: F.GROUPS[g] }))) : null,
        r.note ? h('div', { class: 'muted small', text: r.note }) : null))));
  }
  $('#q').addEventListener('input', renderSearch);
  $$('#lvlChips .chip').forEach(c => c.addEventListener('click', () => {
    lvlFilter = c.dataset.l;
    $$('#lvlChips .chip').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
    renderSearch();
  }));

  // ---------- historie ----------
  function renderHistory() {
    const ul = $('#histList');
    $('#histEmpty').hidden = history.length > 0;
    $('#histClear').hidden = history.length === 0;
    ul.replaceChildren(...history.map((it, i) => {
      const res = F.analyze(it.text, enabled());
      return h('li', null,
        h('span', { class: 'dot ' + (res.verdict === 'high' ? 'high' : res.verdict === 'moderate' ? 'mod' : res.verdict === 'low' ? 'low' : 'unsure'), style: 'margin-top:6px' }),
        h('button', { class: 'plain grow', onclick: () => show($('#histResult'), it, false) },
          h('b', { text: it.title }),
          h('div', { class: 'muted small', text: [it.brand, new Date(it.t).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ') })),
        h('button', { class: 'x', 'aria-label': 'Verwijderen', onclick: () => {
          history.splice(i, 1); store.set('history', history); renderHistory();
        } }, '×'));
    }));
  }
  $('#histClear').addEventListener('click', () => {
    if (!confirm('Alle gescande producten wissen?')) return;
    history = []; store.set('history', history); renderHistory(); $('#histResult').replaceChildren();
  });

  // ---------- instellingen ----------
  function buildSettings() {
    const box = $('#groupBox');
    box.replaceChildren(...Object.keys(F.GROUPS).map(g => {
      const cb = h('input', { type: 'checkbox', id: 'g-' + g });
      cb.checked = settings.groups.includes(g);
      cb.addEventListener('change', () => {
        settings.groups = $$('#groupBox input').filter(x => x.checked).map(x => x.id.slice(2));
        store.set('settings', settings);
        Object.keys(shown).forEach(id => {
          const s = shown[id];
          renderResult(document.getElementById(id), s.data, s.actions);
        });
        renderHistory();
      });
      return h('label', { class: 'grp' }, cb,
        h('div', null, h('b', { text: F.GROUPS[g] }), h('div', { class: 'muted small', text: F.GROUP_INFO[g] })));
    }));
  }
  $('#settingsBtn').addEventListener('click', () => $('#settings').showModal());

  // ---------- installeren, offline, service worker ----------
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch (e) { /* ignore */ }
    deferred = null; $('#installBtn').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });

  const updateOnline = () => { $('#offline').hidden = navigator.onLine; };
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { }));
  }

  // ---------- start ----------
  buildSettings();
  renderSearch();
  renderHistory();
})();
