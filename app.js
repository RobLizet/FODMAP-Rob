(function () {
  'use strict';

  // Versiehistorie:
  //  1.0.0 - Scan, tekst-check, zoeken, historie
  //  1.1.0 - Foto-herkenning (OCR) van etiketten toegevoegd
  //  1.2.0 - Franse/Duitse ingrediëntnamen herkend (fix appelsap-bug)
  //  1.3.0 - Dagboek-tabblad (gegeten items + notitie per dag)
  //  1.4.0 - Crème/karamel kleurthema
  //  1.5.0 - Snelkoppelingen "Barcode scannen"/"Foto van etiket" in het Dagboek
  //  1.5.1 - Fix: melk met lactase-enzym (lactosevrij) werd onterecht als hoog-FODMAP gezien
  //  1.6.0 - AI-assistent (chat + uitleg bij resultaat) via bestaande toto-proxy Worker
  const APP_VERSION = '1.6.0';

  // AI-assistent: hergebruikt de generieke /anthropic-route van de bestaande toto-proxy Worker
  // (zelfde ANTHROPIC_KEY-secret als TOTO AI). Geen eigen backend nodig voor deze app.
  const AI_ENDPOINT = 'https://toto-proxy.zweetzakken.workers.dev/anthropic';
  const AI_MODEL = 'claude-sonnet-4-6';
  const AI_SYSTEM_PROMPT = [
    'Je bent een vriendelijke, beknopte FODMAP- en voedingsassistent in een Nederlandse app.',
    'De gebruiker (Rob) volgt een laag-FODMAP eliminatiedieet.',
    'Antwoord altijd in het Nederlands, kort en praktisch (meestal 2-6 zinnen, gebruik een lijst alleen als dat echt duidelijker is).',
    'Baseer je op de Monash-FODMAP-aanpak: fructanen, GOS, lactose, fructose(-overmaat) en polyolen.',
    'Als je het niet zeker weet, zeg dat eerlijk en adviseer het etiket te scannen in de app of het te bespreken met een diëtist.',
    'Je geeft geen medische diagnoses en herinnert er bij gevoelige vragen kort aan dat dit geen medisch advies is.'
  ].join(' ');

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
  let diary = store.get('diary', {}); // { 'YYYY-MM-DD': { items: [{text, verdict, source, t}], note: '' } }
  let aiHistory = store.get('aiHistory', []); // [{role:'user'|'assistant', content}]
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
    if (data.text) {
      const diaryBtn = h('button', {
        class: 'btn ghost', type: 'button', onclick: () => {
          addDiaryItem(data.title || 'Product', res.verdict, data.source || (data.barcode ? 'Scan' : 'Handmatig'));
          diaryBtn.textContent = 'Toegevoegd aan dagboek ✓';
          diaryBtn.disabled = true;
        }
      }, 'Voeg toe aan dagboek');
      acts.push(diaryBtn);

      const askBtn = h('button', {
        class: 'btn ghost', type: 'button', onclick: () => {
          const hitNames = res.hits.map(hh => hh.name).join(', ') || 'geen specifieke FODMAP-treffers';
          const prefill = 'Ik heb "' + (data.title || 'dit product') + '" gescand. Uitslag: ' + VERDICT[res.verdict].title +
            '. Gevonden: ' + hitNames + '. Ingrediënten: ' + data.text + '. Kun je uitleggen waarom, en of ik het in een kleine portie zou kunnen proberen?';
          openAiChat(prefill);
        }
      }, 'Vraag het de AI');
      acts.push(askBtn);
    }
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
    setOcrStatus('', false);
  });

  // ---------- foto / OCR ----------
  const ocrBtn = $('#ocrBtn');
  const ocrInput = $('#ocrInput');
  const ocrStatusEl = $('#ocrStatus');
  let ocrWorker = null;

  function setOcrStatus(t, show) {
    ocrStatusEl.textContent = t;
    ocrStatusEl.hidden = !show;
  }

  async function getOcrWorker() {
    if (ocrWorker) return ocrWorker;
    if (typeof Tesseract === 'undefined') throw new Error('OCR-bibliotheek kon niet geladen worden. Controleer je internetverbinding en probeer opnieuw.');
    ocrWorker = await Tesseract.createWorker('nld+eng', 1, {
      logger: m => {
        if (!m || !m.status) return;
        if (m.status === 'recognizing text') setOcrStatus('Tekst herkennen… ' + Math.round((m.progress || 0) * 100) + '%', true);
        else setOcrStatus(m.status.charAt(0).toUpperCase() + m.status.slice(1) + '…', true);
      }
    });
    return ocrWorker;
  }

  // Schaalt naar een redelijke breedte en zet om naar grijs + meer contrast: helpt OCR op gebogen verpakkingen.
  function prepImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const maxW = 1800;
        const scale = Math.min(1, maxW / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const id = ctx.getImageData(0, 0, w, h);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const v = Math.min(255, Math.max(0, (g - 128) * 1.4 + 128));
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(id, 0, 0);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Kon de foto niet laden.')); };
      img.src = url;
    });
  }

  ocrBtn.addEventListener('click', () => ocrInput.click());
  ocrInput.addEventListener('change', async () => {
    const file = ocrInput.files && ocrInput.files[0];
    ocrInput.value = '';
    if (!file) return;
    ocrBtn.disabled = true;
    setOcrStatus('Foto verwerken…', true);
    try {
      const canvas = await prepImage(file);
      const worker = await getOcrWorker();
      const { data } = await worker.recognize(canvas);
      const text = (data.text || '').replace(/\s*\n+\s*/g, ', ').replace(/,\s*,+/g, ',').trim();
      if (!text) {
        setOcrStatus('Geen tekst gevonden op de foto. Probeer een scherpere, rechte foto met goed licht.', true);
      } else {
        const existing = $('#txtIngr').value.trim();
        $('#txtIngr').value = existing ? existing + ', ' + text : text;
        setOcrStatus('Tekst herkend — controleer de lijst hieronder en corrigeer waar nodig voor je analyseert.', true);
        $('#txtIngr').focus();
      }
    } catch (e) {
      setOcrStatus('Herkenning mislukt: ' + (e && e.message ? e.message : 'onbekende fout') + '. Typ de ingrediënten anders zelf over.', true);
    } finally {
      ocrBtn.disabled = false;
    }
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

  // ---------- dagboek ----------
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayKey() { return dateKey(new Date()); }

  function dayHeading(key) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const label = dt.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
    if (key === todayKey()) return 'Vandaag · ' + label;
    if (key === dateKey(new Date(Date.now() - 86400000))) return 'Gisteren · ' + label;
    return label;
  }

  function addDiaryItem(text, verdict, source) {
    const key = todayKey();
    if (!diary[key]) diary[key] = { items: [], note: '' };
    diary[key].items.push({ text: (text || '').trim() || 'Item', verdict: verdict || '', source: source || 'Handmatig', t: Date.now() });
    store.set('diary', diary);
    renderDiary();
  }

  function setDiaryNote(key, note) {
    if (!diary[key]) diary[key] = { items: [], note: '' };
    diary[key].note = note;
    store.set('diary', diary);
  }

  function renderDiary() {
    const list = $('#diaryList');
    const keys = Array.from(new Set([todayKey(), ...Object.keys(diary)])).sort().reverse();
    const visible = keys.filter(k => k === todayKey() || (diary[k] && (diary[k].items.length || (diary[k].note || '').trim())));
    $('#diaryEmpty').hidden = visible.some(k => diary[k] && (diary[k].items.length || (diary[k].note || '').trim()));

    list.replaceChildren(...visible.map(key => {
      const day = diary[key] || { items: [], note: '' };
      const noteArea = h('textarea', {
        placeholder: 'Notitie voor deze dag (bijv. klachten, hoe je je voelde)…',
        style: 'min-height:60px;margin-top:8px',
        oninput: e => setDiaryNote(key, e.target.value)
      });
      noteArea.value = day.note || '';

      const itemsList = day.items.length
        ? h('ul', { class: 'list' }, day.items.map((it, i) => h('li', null,
            h('span', { class: 'dot ' + (LV[it.verdict] || 'unsure'), style: 'margin-top:6px' }),
            h('div', { class: 'grow' },
              h('b', { text: it.text }),
              h('div', { class: 'muted small', text: [VERDICT[it.verdict] ? VERDICT[it.verdict].title : 'Niet gecontroleerd', it.source, new Date(it.t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ') })),
            h('button', { class: 'x', 'aria-label': 'Verwijderen', onclick: () => { day.items.splice(i, 1); store.set('diary', diary); renderDiary(); } }, '×'))))
        : h('p', { class: 'muted small', style: 'margin-top:8px' }, 'Nog geen items voor deze dag.');

      return h('section', { class: 'card' },
        h('div', { class: 'row', style: 'align-items:center;margin-bottom:2px' },
          h('h3', { style: 'font-size:15px;text-transform:none;letter-spacing:0;color:inherit;margin:0', text: dayHeading(key) })),
        itemsList,
        noteArea);
    }));
  }

  $('#diaryAdd').addEventListener('click', () => {
    const text = $('#diaryInput').value.trim();
    if (!text) return;
    addDiaryItem(text, '', 'Handmatig');
    $('#diaryInput').value = '';
  });
  $('#diaryToText').addEventListener('click', () => {
    const text = $('#diaryInput').value.trim();
    pendingBarcode = '';
    $('#txtName').value = '';
    $('#txtIngr').value = text;
    $('#txtHint').textContent = '';
    $('#textResult').replaceChildren();
    showView('text');
    $('#txtIngr').focus();
  });
  $('#diaryScan').addEventListener('click', () => {
    showView('scan');
    startCamera();
  });
  $('#diaryPhoto').addEventListener('click', () => {
    pendingBarcode = '';
    $('#txtName').value = '';
    $('#txtIngr').value = '';
    $('#txtHint').textContent = 'Maak een foto van het etiket — de tekst verschijnt hieronder om te controleren.';
    $('#textResult').replaceChildren();
    showView('text');
    ocrInput.click();
  });

  // ---------- AI-assistent ----------
  const aiDialog = $('#aiChatDialog');
  const aiMessagesEl = $('#aiMessages');
  const aiInput = $('#aiInput');
  const aiSendBtn = $('#aiSend');
  let aiBusy = false;

  function diarySummaryText() {
    const key = todayKey();
    const day = diary[key];
    if (!day || (!day.items.length && !(day.note || '').trim())) return '';
    const items = day.items.map(it => it.text + (it.verdict ? ' (' + (VERDICT[it.verdict] ? VERDICT[it.verdict].title : it.verdict) + ')' : '')).join(', ');
    let s = 'Context uit het dagboek van vandaag';
    if (items) s += ' — gegeten: ' + items + '.';
    if ((day.note || '').trim()) s += ' Notitie van de gebruiker: ' + day.note.trim() + '.';
    return s;
  }

  function renderAiMessages() {
    aiMessagesEl.replaceChildren(...aiHistory.map(m => h('div', { class: 'ai-msg ' + (m.role === 'user' ? 'user' : 'assistant'), text: m.content })));
    aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight;
  }

  function openAiChat(prefill) {
    if (!aiHistory.length) {
      aiHistory.push({ role: 'assistant', content: 'Hoi! Ik ben je FODMAP-assistent. Vraag me bijvoorbeeld of iets mag, waarom een ingrediënt hoog-FODMAP is, of om een idee voor een maaltijd. Ik ben geen dokter of diëtist, dus bij twijfel altijd even overleggen.' });
      store.set('aiHistory', aiHistory);
    }
    renderAiMessages();
    aiDialog.showModal();
    if (prefill) { aiInput.value = prefill; autoGrow(); }
    setTimeout(() => aiInput.focus(), 50);
  }

  function autoGrow() {
    aiInput.style.height = 'auto';
    aiInput.style.height = Math.min(110, aiInput.scrollHeight) + 'px';
  }
  aiInput.addEventListener('input', autoGrow);
  aiInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#aiForm').requestSubmit(); }
  });

  async function sendAiMessage() {
    const text = aiInput.value.trim();
    if (!text || aiBusy) return;
    aiHistory.push({ role: 'user', content: text });
    aiHistory = aiHistory.slice(-40); // beperk lokale geschiedenis
    store.set('aiHistory', aiHistory);
    aiInput.value = '';
    autoGrow();
    renderAiMessages();

    aiBusy = true;
    aiSendBtn.disabled = true;
    const typing = h('div', { class: 'ai-typing', text: 'Bezig met antwoorden…' });
    aiMessagesEl.append(typing);
    aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight;

    try {
      const context = diarySummaryText();
      const apiMessages = aiHistory.slice(-20).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: AI_MODEL,
          max_tokens: 700,
          system: AI_SYSTEM_PROMPT + (context ? ('\n\n' + context) : ''),
          messages: apiMessages
        })
      });
      const data = await res.json().catch(() => ({}));
      typing.remove();

      if (res.status === 429) {
        aiMessagesEl.append(h('div', { class: 'ai-msg err', text: data.error || 'Daglimiet bereikt — probeer het morgen weer.' }));
      } else if (!res.ok) {
        aiMessagesEl.append(h('div', { class: 'ai-msg err', text: 'Er ging iets mis: ' + (data.error || data.message || ('status ' + res.status)) }));
      } else {
        const reply = (data.content || []).map(b => b.text || '').join('').trim() || '(geen antwoord ontvangen)';
        aiHistory.push({ role: 'assistant', content: reply });
        aiHistory = aiHistory.slice(-40);
        store.set('aiHistory', aiHistory);
        renderAiMessages();
      }
    } catch (e) {
      typing.remove();
      aiMessagesEl.append(h('div', { class: 'ai-msg err', text: 'Geen verbinding met de AI-assistent. Controleer je internetverbinding en probeer het opnieuw.' }));
    } finally {
      aiBusy = false;
      aiSendBtn.disabled = false;
      aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight;
    }
  }

  $('#aiForm').addEventListener('submit', e => { e.preventDefault(); sendAiMessage(); });
  $('#aiChatBtn').addEventListener('click', () => openAiChat());
  $('#aiChatClose').addEventListener('click', () => aiDialog.close());

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
  renderDiary();
  const verEl = $('#appVersion');
  if (verEl) verEl.textContent = 'Versie ' + APP_VERSION;
})();
