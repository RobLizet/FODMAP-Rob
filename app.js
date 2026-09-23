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
  //  1.7.0 - Zachtblauw kleurthema, AI-chatvenster hoger op het scherm
  //  1.8.0 - Waarschuwing bij onbetrouwbare ingrediëntentekst (voorkomt vals-groene uitslag)
  //  1.9.0 - Scherpte-check bij foto van etiket (waarschuwt vóór OCR bij een wazige foto) + lichte verscherping
  //  1.9.1 - Fix: verscherpingsfilter versterkte camerakorrel en maakte tekst juist onduidelijker;
  //          vervangen door hogere resolutie + betere OCR-paginamodus voor lopende tekst
  //  2.0.0 - Dagboek houdt nu ook eiwit en calorieën bij (automatisch bij barcode-scan, anders
  //          handmatig), gegroepeerd per maaltijd (Ontbijt/Lunch/Diner/Snack) met dagtotalen
  //  2.1.0 - Product zoeken op naam (Open Food Facts), net als handmatig een barcode intypen
  //  2.2.0 - Back-up: instellingen, dagboek en historie exporteren/importeren als bestand
  //  2.3.0 - "Schat met AI" bij handmatige dagboek-items: AI vult eiwit/kcal-schatting in
  //  2.4.0 - Dagboek-items achteraf bewerken (maaltijd, hoeveelheid, eiwit, kcal)
  //  2.4.1 - AI-schatting eiwit/kcal: merknaam meegeven en voorzichtiger bij merkproducten
  //          (voorkomt te hoge schattingen zoals bij koffiecapsules), plus duidelijke
  //          waarschuwing dat een AI-schatting kan afwijken van de echte verpakking
  //  2.5.0 - Product zoeken: ingebouwde basisproducten (ei, melk, brood, kip…) bovenaan,
  //          merkproducten alleen uit Nederland en populairste eerst
  const APP_VERSION = '2.5.0';

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
    unknown: { cls: 'unk', title: 'Geen ingrediënten beschikbaar', sub: 'Plak de ingrediëntenlijst zelf om te controleren.' },
    lowSuspect: { cls: 'unk', title: 'Onduidelijk — controleer zelf', sub: 'De ingrediëntentekst van dit product lijkt onvolledig of niet kloppend (vaak een fout in Open Food Facts). Er zijn geen FODMAPs herkend, maar vertrouw dit niet blind: maak een foto van het etiket of typ de lijst handmatig over.' }
  };

  // Herkent ingrediëntentekst die er niet uitziet als een echte ingrediëntenlijst
  // (bijv. kapotte/foutieve data uit Open Food Facts) zodat we niet ten onrechte
  // "Geen FODMAP gevonden" tonen terwijl de tekst eigenlijk onbruikbaar is.
  function looksUnreliable(text) {
    if (!text) return false;
    const t = String(text).trim();
    if (t.length < 15) return false; // te kort om zinvol te beoordelen
    if (/&(?:gt|lt|amp|quot|#\d+);/i.test(t)) return true; // onverwerkte HTML-entities
    if (/\b(galaxy|iphone|redmi|xiaomi|huawei|pixel)\s*[a-z]?\s*\d/i.test(t)) return true; // telefoonmodel in de tekst
    const commas = (t.match(/,/g) || []).length;
    if (t.length > 80 && commas < 2) return true; // lange tekst zonder opsomming: geen echte ingrediëntenlijst
    return false;
  }

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
    const suspect = res.verdict === 'low' && looksUnreliable(data.text);
    const v = suspect ? VERDICT.lowSuspect : VERDICT[res.verdict];

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

    const verdictKey = suspect ? 'lowSuspect' : res.verdict;
    const acts = actions ? actions(res) : [];
    if (data.text) {
      const diaryBtn = h('button', {
        class: 'btn ghost', type: 'button', onclick: () => {
          openDiaryAddDialog(data.title || 'Product', verdictKey, data.source || (data.barcode ? 'Scan' : 'Handmatig'), data.per100 || null, data.brand || null);
        }
      }, 'Voeg toe aan dagboek');
      acts.push(diaryBtn);

      const askBtn = h('button', {
        class: 'btn ghost', type: 'button', onclick: () => {
          const hitNames = res.hits.map(hh => hh.name).join(', ') || 'geen specifieke FODMAP-treffers';
          const prefill = 'Ik heb "' + (data.title || 'dit product') + '" gescand. Uitslag: ' + v.title +
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
      barcode: data.barcode || '', text: data.text, verdict, t: Date.now(), per100: data.per100 || null
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

  // Haalt eiwit en energie per 100g uit de Open Food Facts-nutriments, indien beschikbaar.
  function per100Nutrients(nutr) {
    if (!nutr) return null;
    const protein = typeof nutr.proteins_100g === 'number' ? nutr.proteins_100g : null;
    let kcal = typeof nutr['energy-kcal_100g'] === 'number' ? nutr['energy-kcal_100g'] : null;
    if (kcal == null && typeof nutr.energy_100g === 'number') kcal = nutr.energy_100g / 4.184; // kJ -> kcal
    if (protein == null && kcal == null) return null;
    return { protein, kcal };
  }

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
        '.json?fields=code,product_name,brands,image_front_small_url,ingredients_text,ingredients_text_nl,ingredients_text_en,nutriments',
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
        text: p.ingredients_text_nl || p.ingredients_text || p.ingredients_text_en || '', source: 'Open Food Facts',
        per100: per100Nutrients(p.nutriments)
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

  // ---------- product zoeken op naam (Open Food Facts) ----------
  const productSearchDialog = $('#productSearchDialog');
  const productSearchInput = $('#productSearchInput');
  const productSearchResultsEl = $('#productSearchResults');
  let productSearchAbort = null;
  let productSearchTimer = null;

  function setProductSearchStatus(t, show) {
    const el = $('#productSearchStatus');
    el.textContent = t;
    el.hidden = !show;
  }

  function openProductSearch() {
    productSearchInput.value = '';
    productSearchResultsEl.replaceChildren();
    setProductSearchStatus('', false);
    productSearchDialog.showModal();
    setTimeout(() => productSearchInput.focus(), 50);
  }

  // Basisvoedingsmiddelen (foods.js) — direct doorzoekbaar, ook offline
  const GENERIC = (window.GENERIC_FOODS || []).map(([name, protein, kcal, extra], idx) => ({
    name, idx, per100: { protein, kcal },
    words: normSearch(name).split(/[^a-z0-9]+/).filter(Boolean),
    extra: normSearch(extra || '').split(/[^a-z0-9]+/).filter(Boolean)
  }));
  function normSearch(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function searchGeneric(term) {
    const tokens = normSearch(term).split(/[^a-z0-9]+/).filter(Boolean);
    if (!tokens.length) return [];
    const scored = [];
    GENERIC.forEach(g => {
      let score = 0;
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        let s;
        if (g.words[0] === t) s = 0;
        else if (g.words[0].startsWith(t)) s = 1;
        else if (g.words.some(w => w.startsWith(t))) s = 2;
        else if (g.extra.some(w => w.startsWith(t))) s = 3;
        else return; // alle zoekwoorden moeten matchen
        score += i === 0 ? s * 10 : s;
      }
      scored.push({ g, score });
    });
    return scored.sort((a, b) => a.score - b.score || a.g.idx - b.g.idx).slice(0, 8).map(x => x.g);
  }

  let genericShown = [];
  let offShown = [];
  function psrHead(t) { return h('li', { class: 'psr-head', text: t }); }
  function renderProductSearchResults() {
    const items = [];
    if (genericShown.length) {
      items.push(psrHead('Basisproducten'));
      genericShown.forEach(g => items.push(h('li', null, h('button', { class: 'plain grow', type: 'button', onclick: () => pickGenericFood(g) },
        h('div', { class: 'psr-name', text: g.name }),
        h('div', { class: 'psr-meta', text: fmtG(g.per100.protein) + ' g eiwit /100g · ' + Math.round(g.per100.kcal) + ' kcal /100g' })))));
    }
    if (offShown.length) {
      items.push(psrHead('Merkproducten (Open Food Facts)'));
      offShown.forEach(p => {
        const per100 = per100Nutrients(p.nutriments);
        const meta = [p.brands || ''];
        if (per100 && per100.protein != null) meta.push(fmtG(per100.protein) + ' g eiwit /100g');
        if (per100 && per100.kcal != null) meta.push(Math.round(per100.kcal) + ' kcal /100g');
        items.push(h('li', null, h('button', { class: 'plain grow', type: 'button', onclick: () => pickSearchResult(p) },
          h('div', { class: 'psr-name', text: p.product_name }),
          h('div', { class: 'psr-meta', text: meta.filter(Boolean).join(' · ') || 'Geen merk- of voedingsinfo bekend' }))));
      });
    }
    productSearchResultsEl.replaceChildren(...items);
  }

  async function runProductSearch(term) {
    if (productSearchAbort) productSearchAbort.abort();
    productSearchAbort = new AbortController();
    setProductSearchStatus('Merkproducten zoeken…', true);
    try {
      // Alleen producten die in Nederland verkocht worden, populairste eerst
      const url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(term) +
        '&search_simple=1&action=process&json=1&page_size=20&sort_by=unique_scans_n' +
        '&tagtype_0=countries&tag_contains_0=contains&tag_0=netherlands' +
        '&fields=code,product_name,brands,nutriments,ingredients_text_nl,ingredients_text,ingredients_text_en,image_front_small_url';
      const r = await fetch(url, { signal: productSearchAbort.signal });
      const j = await r.json();
      offShown = (j.products || []).filter(p => p.product_name);
      renderProductSearchResults();
      const none = !offShown.length && !genericShown.length;
      setProductSearchStatus(none ? 'Niets gevonden voor “' + term + '”. Probeer een andere zoekterm, of scan de barcode.' : '', none);
    } catch (e) {
      if (e.name === 'AbortError') return;
      offShown = [];
      renderProductSearchResults();
      setProductSearchStatus(genericShown.length
        ? 'Merkproducten konden niet geladen worden (geen internet?). Basisproducten staan hieronder.'
        : 'Zoeken mislukt. Controleer je internetverbinding en probeer opnieuw.', true);
    }
  }

  function scheduleProductSearch(term) {
    clearTimeout(productSearchTimer);
    const q = term.trim();
    offShown = [];
    if (q.length < 2) {
      if (productSearchAbort) productSearchAbort.abort();
      genericShown = [];
      productSearchResultsEl.replaceChildren();
      setProductSearchStatus('', false);
      return;
    }
    genericShown = searchGeneric(q);
    renderProductSearchResults(); // basisproducten meteen tonen
    productSearchTimer = setTimeout(() => runProductSearch(q), 450);
  }

  function pickGenericFood(g) {
    const data = {
      title: g.name, brand: '', image: '', barcode: '',
      text: g.name, source: 'Basisproduct', per100: { protein: g.per100.protein, kcal: g.per100.kcal }
    };
    productSearchDialog.close();
    showView('scan');
    $('#codeInput').value = '';
    setMsg('');
    show($('#scanResult'), data, true, () => [rescanBtn()]);
  }

  function pickSearchResult(p) {
    const data = {
      title: p.product_name || 'Onbekend product', brand: p.brands || '',
      image: p.image_front_small_url || '', barcode: p.code || '',
      text: p.ingredients_text_nl || p.ingredients_text || p.ingredients_text_en || '',
      source: 'Open Food Facts', per100: per100Nutrients(p.nutriments)
    };
    productSearchDialog.close();
    showView('scan');
    $('#codeInput').value = data.barcode || '';
    setMsg('');
    show($('#scanResult'), data, true, res => [
      res.verdict === 'unknown' ? h('button', { class: 'btn', onclick: () => goToText(data.barcode, data.title) }, 'Ingrediënten invoeren') : null,
      rescanBtn()
    ]);
  }

  productSearchInput.addEventListener('input', e => scheduleProductSearch(e.target.value));
  $('#productSearchOpen').addEventListener('click', openProductSearch);
  $('#productSearchClose').addEventListener('click', () => productSearchDialog.close());

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
    // PSM 6 = "één uniform blok tekst": veel betrouwbaarder dan de standaard automatische
    // paginasegmentatie voor een lopende ingrediëntenparagraaf op een etiket.
    await ocrWorker.setParameters({ tessedit_pageseg_mode: '6' });
    return ocrWorker;
  }

  function loadImageEl(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Kon de foto niet laden.')); };
      img.src = url;
    });
  }

  // Grove maat voor scherpte: variantie van een Laplaciaan-filter op een verkleinde grijswaarden-versie.
  // Een scherpe foto heeft veel harde randjes (hoge variantie), een wazige foto is "vlak" (lage variantie).
  const BLUR_THRESHOLD = 35;
  function blurScore(img) {
    const w = 400;
    const scale = Math.min(1, w / img.width);
    const cw = Math.max(2, Math.round(img.width * scale));
    const ch = Math.max(2, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    const d = ctx.getImageData(0, 0, cw, ch).data;
    const gray = new Float32Array(cw * ch);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    let sum = 0, sumSq = 0, n = 0;
    for (let y = 1; y < ch - 1; y++) {
      for (let x = 1; x < cw - 1; x++) {
        const i = y * cw + x;
        const lap = gray[i - 1] + gray[i + 1] + gray[i - cw] + gray[i + cw] - 4 * gray[i];
        sum += lap; sumSq += lap * lap; n++;
      }
    }
    if (!n) return 0;
    const mean = sum / n;
    return sumSq / n - mean * mean;
  }

  // Schaalt naar een ruimere breedte (meer pixels per letter = betere OCR bij kleine etikettekst)
  // en zet om naar grijs + meer contrast: helpt OCR op gebogen verpakkingen.
  // Let op: bewust GEEN verscherpingsfilter — die versterkt op echte telefoonfoto's vooral
  // camerakorrel/ruis en maakt kleine tekst juist onherkenbaarder (dat bleek in de praktijk).
  function prepCanvas(img) {
    const maxW = 2200;
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
    return c;
  }

  let pendingOcrImg = null; // { img, url } — bewaard zodat "Toch doorgaan" niet opnieuw hoeft te fotograferen
  const blurWarnEl = $('#ocrBlurWarn');

  function cleanupPendingImg() {
    if (pendingOcrImg) { URL.revokeObjectURL(pendingOcrImg.url); pendingOcrImg = null; }
  }

  async function runOcr({ img, url }) {
    ocrBtn.disabled = true;
    blurWarnEl.hidden = true;
    setOcrStatus('Foto verwerken…', true);
    try {
      const canvas = prepCanvas(img);
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
      URL.revokeObjectURL(url);
    }
  }

  ocrBtn.addEventListener('click', () => ocrInput.click());
  ocrInput.addEventListener('change', async () => {
    const file = ocrInput.files && ocrInput.files[0];
    ocrInput.value = '';
    if (!file) return;
    cleanupPendingImg();
    blurWarnEl.hidden = true;
    ocrBtn.disabled = true;
    setOcrStatus('Foto verwerken…', true);
    try {
      const loaded = await loadImageEl(file);
      if (blurScore(loaded.img) < BLUR_THRESHOLD) {
        pendingOcrImg = loaded;
        setOcrStatus('', false);
        blurWarnEl.hidden = false;
        ocrBtn.disabled = false;
        return;
      }
      await runOcr(loaded);
    } catch (e) {
      setOcrStatus('Herkenning mislukt: ' + (e && e.message ? e.message : 'onbekende fout') + '. Typ de ingrediënten anders zelf over.', true);
      ocrBtn.disabled = false;
    }
  });

  $('#ocrRetake').addEventListener('click', () => {
    cleanupPendingImg();
    blurWarnEl.hidden = true;
    setOcrStatus('', false);
    ocrInput.click();
  });
  $('#ocrProceed').addEventListener('click', () => {
    blurWarnEl.hidden = true;
    if (pendingOcrImg) { const img = pendingOcrImg; pendingOcrImg = null; runOcr(img); }
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

  const MEAL_LABELS = { ontbijt: 'Ontbijt', lunch: 'Lunch', diner: 'Diner', snack: 'Snack' };
  const MEAL_ORDER = ['ontbijt', 'lunch', 'diner', 'snack'];
  function guessMeal() {
    const hr = new Date().getHours();
    if (hr < 11) return 'ontbijt';
    if (hr < 15) return 'lunch';
    if (hr < 21) return 'diner';
    return 'snack';
  }
  function fmtG(n) { return n.toLocaleString('nl-NL', { maximumFractionDigits: 1 }); }

  function addDiaryItem(entry) {
    const key = todayKey();
    if (!diary[key]) diary[key] = { items: [], note: '' };
    diary[key].items.push({
      text: (entry.text || '').trim() || 'Item',
      verdict: entry.verdict || '',
      source: entry.source || 'Handmatig',
      brand: entry.brand || null,
      meal: entry.meal || 'snack',
      qty: typeof entry.qty === 'number' && !isNaN(entry.qty) ? entry.qty : null,
      protein: typeof entry.protein === 'number' && !isNaN(entry.protein) ? entry.protein : null,
      kcal: typeof entry.kcal === 'number' && !isNaN(entry.kcal) ? entry.kcal : null,
      t: Date.now()
    });
    store.set('diary', diary);
    renderDiary();
  }

  // ---------- toevoegen-aan-dagboek dialoog (maaltijd, hoeveelheid, eiwit/kcal) ----------
  const diaryAddDialog = $('#diaryAddDialog');
  const diaryQtyEl = $('#diaryQty');
  const diaryAutoNoteEl = $('#diaryAutoNote');
  const diaryManualBox = $('#diaryManualNutrients');
  const diaryProteinInput = $('#diaryProteinInput');
  const diaryKcalInput = $('#diaryKcalInput');
  let diaryAddCtx = null; // { text, verdict, source, per100 }
  let diaryEditCtx = null; // het bestaande item-object dat bewerkt wordt, of null bij toevoegen

  function selectMealChip(meal) {
    $$('#diaryMealChips .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.meal === meal)));
  }
  function getSelectedMeal() {
    const el = $('#diaryMealChips .chip[aria-pressed=true]');
    return el ? el.dataset.meal : 'snack';
  }
  $$('#diaryMealChips .chip').forEach(c => c.addEventListener('click', () => selectMealChip(c.dataset.meal)));

  function updateDiaryAutoNote() {
    if (!diaryAddCtx || !diaryAddCtx.per100) return;
    const qty = parseFloat(diaryQtyEl.value);
    const p100 = diaryAddCtx.per100;
    if (!qty || qty <= 0) { diaryAutoNoteEl.textContent = 'Vul een hoeveelheid in om eiwit/energie te berekenen.'; return; }
    const parts = [];
    if (p100.protein != null) parts.push(fmtG(p100.protein * qty / 100) + ' g eiwit');
    if (p100.kcal != null) parts.push(Math.round(p100.kcal * qty / 100) + ' kcal');
    diaryAutoNoteEl.textContent = parts.length
      ? '≈ ' + parts.join(', ') + ' bij ' + qty + ' g (bron: ' + (diaryAddCtx.source === 'Basisproduct' ? 'gemiddelde waarden' : 'Open Food Facts') + ', per 100 g).'
      : 'Geen voedingswaarden bekend voor dit product bij Open Food Facts.';
  }
  diaryQtyEl.addEventListener('input', updateDiaryAutoNote);

  function setDiaryAiStatus(t, show) {
    const el = $('#diaryAiStatus');
    el.textContent = t;
    el.hidden = !show;
  }

  async function estimateNutrientsWithAi() {
    const ctx = diaryEditCtx || diaryAddCtx;
    if (!ctx || !ctx.text) return;
    const btn = $('#diaryAiEstimate');
    const qty = parseFloat(diaryQtyEl.value);
    const isBranded = !!(ctx.brand || (ctx.source && /open food facts|scan/i.test(ctx.source)));
    const desc = ctx.brand ? (ctx.text + ' (merk: ' + ctx.brand + ')') : ctx.text;
    btn.disabled = true;
    setDiaryAiStatus('AI schat de voedingswaarden…', true);
    try {
      const sys = [
        'Je schat voedingswaarden van een gerecht of product voor een Nederlands voedingsdagboek.',
        'Antwoord UITSLUITEND met geldige JSON, zonder uitleg en zonder markdown-codeblok, exact in dit formaat:',
        '{"grams": <getal: portiegrootte in gram>, "protein_g": <getal: eiwit in gram voor die portie>, "kcal": <getal: energie in kcal voor die portie>}',
        (qty > 0)
          ? ('Gebruik als portiegrootte exact ' + qty + ' gram; vul dat ook in als "grams".')
          : 'Kies zelf een realistische, gangbare portiegrootte voor dit gerecht en geef die als "grams".',
        'Gebruik algemene, realistische Nederlandse voedingswaarden-kennis. Geef bij twijfel een redelijke inschatting in plaats van te weigeren.',
        isBranded
          ? ('Dit is een specifiek merkproduct (mogelijk met barcode) waarvan je de exacte voedingswaarden niet zeker weet. ' +
             'Ga uit van het product zoals het VERKOCHT wordt (bijv. droge koffiecapsule/-poeder, snack in de verpakking), ' +
             'niet van een bereid gerecht met extra toegevoegde ingrediënten zoals melk, tenzij de naam dat expliciet noemt. ' +
             'Geef bij onzekerheid liever een lagere, behoudende schatting dan een hoge.')
          : ''
      ].filter(Boolean).join(' ');
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: AI_MODEL, max_tokens: 200, system: sys, messages: [{ role: 'user', content: 'Product/gerecht: ' + desc }] })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) throw new Error(data.error || 'Daglimiet van de AI bereikt — probeer het morgen weer of vul zelf in.');
      if (!res.ok) throw new Error(data.error || data.message || ('status ' + res.status));
      const raw = (data.content || []).map(b => b.text || '').join('');
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Kon geen schatting uit het antwoord halen.');
      const parsed = JSON.parse(match[0]);
      if (typeof parsed.protein_g === 'number') diaryProteinInput.value = Math.round(parsed.protein_g * 10) / 10;
      if (typeof parsed.kcal === 'number') diaryKcalInput.value = Math.round(parsed.kcal);
      if (!(qty > 0) && typeof parsed.grams === 'number') diaryQtyEl.value = Math.round(parsed.grams);
      setDiaryAiStatus('Schatting ingevuld — controleer en pas aan waar nodig' + (isBranded ? ', zeker bij dit merkproduct' : '') + '.', true);
    } catch (e) {
      const msg = (e && e.message ? e.message : 'onbekende fout').replace(/\.+$/, '');
      setDiaryAiStatus('Schatten mislukt: ' + msg + '.', true);
    } finally {
      btn.disabled = false;
    }
  }
  $('#diaryAiEstimate').addEventListener('click', estimateNutrientsWithAi);

  function openDiaryAddDialog(text, verdict, source, per100, brand) {
    diaryEditCtx = null;
    diaryAddCtx = { text, verdict, source, per100: per100 || null, brand: brand || null };
    $('#diaryAddTitle').textContent = 'Toevoegen aan dagboek';
    $('#diaryAddConfirm').textContent = 'Toevoegen';
    $('#diaryAddProduct').textContent = text;
    selectMealChip(guessMeal());
    diaryQtyEl.value = per100 ? '100' : '';
    diaryProteinInput.value = '';
    diaryKcalInput.value = '';
    setDiaryAiStatus('', false);
    if (per100) {
      diaryManualBox.hidden = true;
      diaryAutoNoteEl.hidden = false;
      updateDiaryAutoNote();
    } else {
      diaryManualBox.hidden = false;
      diaryAutoNoteEl.hidden = true;
    }
    diaryAddDialog.showModal();
    setTimeout(() => diaryQtyEl.focus(), 50);
  }

  function openDiaryEditDialog(it) {
    diaryAddCtx = null;
    diaryEditCtx = it;
    $('#diaryAddTitle').textContent = 'Item wijzigen';
    $('#diaryAddConfirm').textContent = 'Opslaan';
    $('#diaryAddProduct').textContent = it.text;
    selectMealChip(it.meal || 'snack');
    diaryQtyEl.value = it.qty != null ? it.qty : '';
    diaryProteinInput.value = it.protein != null ? it.protein : '';
    diaryKcalInput.value = it.kcal != null ? it.kcal : '';
    setDiaryAiStatus('', false);
    // Bij bewerken altijd de handmatige velden tonen: de oorspronkelijke per-100g-gegevens
    // (indien van een barcode/zoekresultaat) zijn niet per item bewaard, dus eiwit/kcal
    // worden direct bewerkt in plaats van herberekend uit een percentage.
    diaryManualBox.hidden = false;
    diaryAutoNoteEl.hidden = true;
    diaryAddDialog.showModal();
    setTimeout(() => diaryProteinInput.focus(), 50);
  }

  $('#diaryAddClose').addEventListener('click', () => { diaryEditCtx = null; diaryAddDialog.close(); });
  diaryAddDialog.addEventListener('close', () => { diaryEditCtx = null; });
  $('#diaryAddConfirm').addEventListener('click', () => {
    if (diaryEditCtx) {
      const qty = parseFloat(diaryQtyEl.value);
      const pv = parseFloat(diaryProteinInput.value);
      const kv = parseFloat(diaryKcalInput.value);
      diaryEditCtx.meal = getSelectedMeal();
      diaryEditCtx.qty = qty > 0 ? qty : null;
      diaryEditCtx.protein = !isNaN(pv) ? pv : null;
      diaryEditCtx.kcal = !isNaN(kv) ? Math.round(kv) : null;
      store.set('diary', diary);
      diaryEditCtx = null;
      diaryAddDialog.close();
      renderDiary();
      return;
    }
    if (!diaryAddCtx) return;
    const qty = parseFloat(diaryQtyEl.value);
    let protein = null, kcal = null;
    if (diaryAddCtx.per100) {
      if (qty > 0) {
        if (diaryAddCtx.per100.protein != null) protein = Math.round(diaryAddCtx.per100.protein * qty / 100 * 10) / 10;
        if (diaryAddCtx.per100.kcal != null) kcal = Math.round(diaryAddCtx.per100.kcal * qty / 100);
      }
    } else {
      const pv = parseFloat(diaryProteinInput.value);
      const kv = parseFloat(diaryKcalInput.value);
      if (!isNaN(pv)) protein = pv;
      if (!isNaN(kv)) kcal = Math.round(kv);
    }
    addDiaryItem({
      text: diaryAddCtx.text, verdict: diaryAddCtx.verdict, source: diaryAddCtx.source, brand: diaryAddCtx.brand,
      meal: getSelectedMeal(), qty: qty > 0 ? qty : null, protein, kcal
    });
    diaryAddDialog.close();
    $('#diaryInput').value = '';
  });

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

      let totalProtein = 0, totalKcal = 0, hasProtein = false, hasKcal = false;
      day.items.forEach(it => {
        if (typeof it.protein === 'number') { totalProtein += it.protein; hasProtein = true; }
        if (typeof it.kcal === 'number') { totalKcal += it.kcal; hasKcal = true; }
      });
      const totalsRow = (hasProtein || hasKcal) ? h('div', { class: 'row', style: 'gap:20px;margin:8px 0 4px' },
        hasProtein ? h('div', null, h('div', { class: 'muted small', text: 'Eiwit' }), h('strong', { style: 'font-size:19px', text: fmtG(totalProtein) + ' g' })) : null,
        hasKcal ? h('div', null, h('div', { class: 'muted small', text: 'Energie' }), h('strong', { style: 'font-size:19px', text: Math.round(totalKcal) + ' kcal' })) : null
      ) : null;

      function itemRow(it, i) {
        return h('li', null,
          h('span', { class: 'dot ' + (LV[it.verdict] || 'unsure'), style: 'margin-top:6px' }),
          h('div', { class: 'grow' },
            h('b', { text: it.text }),
            h('div', {
              class: 'muted small', text: [
                VERDICT[it.verdict] ? VERDICT[it.verdict].title : 'Niet gecontroleerd',
                it.qty != null ? it.qty + ' g' : null,
                it.protein != null ? fmtG(it.protein) + ' g eiwit' : null,
                it.kcal != null ? Math.round(it.kcal) + ' kcal' : null,
                it.source,
                new Date(it.t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
              ].filter(Boolean).join(' · ')
            })),
          h('button', { class: 'x', 'aria-label': 'Bewerken', style: 'font-size:16px', onclick: () => openDiaryEditDialog(it) }, '✎'),
          h('button', { class: 'x', 'aria-label': 'Verwijderen', onclick: () => { day.items.splice(day.items.indexOf(it), 1); store.set('diary', diary); renderDiary(); } }, '×'));
      }

      const itemsBlock = day.items.length
        ? h('div', null, MEAL_ORDER.map(meal => {
            const items = day.items.filter(it => (it.meal || 'snack') === meal);
            if (!items.length) return null;
            return h('div', { style: 'margin-top:12px' },
              h('h3', { text: MEAL_LABELS[meal] }),
              h('ul', { class: 'list' }, items.map(it => itemRow(it))));
          }))
        : h('p', { class: 'muted small', style: 'margin-top:8px' }, 'Nog geen items voor deze dag.');

      return h('section', { class: 'card' },
        h('div', { class: 'row', style: 'align-items:center;margin-bottom:2px' },
          h('h3', { style: 'font-size:15px;text-transform:none;letter-spacing:0;color:inherit;margin:0', text: dayHeading(key) })),
        totalsRow,
        itemsBlock,
        noteArea);
    }));
  }

  $('#diaryAdd').addEventListener('click', () => {
    const text = $('#diaryInput').value.trim();
    if (!text) return;
    openDiaryAddDialog(text, '', 'Handmatig', null);
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
  $('#diarySearch').addEventListener('click', openProductSearch);

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

  // ---------- back-up (export/import) ----------
  function setBackupStatus(t, show) {
    const el = $('#backupStatus');
    el.textContent = t;
    el.hidden = !show;
  }

  $('#exportDataBtn').addEventListener('click', () => {
    const payload = {
      app: 'fodmap-scanner', appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
      settings, history, diary, aiHistory
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'fodmap-scanner-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setBackupStatus('Back-up gedownload.', true);
  });

  $('#importDataBtn').addEventListener('click', () => $('#importDataInput').click());
  $('#importDataInput').addEventListener('change', async () => {
    const file = $('#importDataInput').files && $('#importDataInput').files[0];
    $('#importDataInput').value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const j = JSON.parse(text);
      if (!j || typeof j !== 'object' || (j.app && j.app !== 'fodmap-scanner')) {
        throw new Error('Dit bestand lijkt geen back-up van deze app te zijn.');
      }
      const summary = 'Dit vervangt je huidige gegevens op dit toestel door de back-up van ' +
        (j.exportedAt ? new Date(j.exportedAt).toLocaleString('nl-NL') : 'onbekende datum') +
        ' (' + (j.history ? j.history.length : 0) + ' historie-items, ' +
        (j.diary ? Object.keys(j.diary).length : 0) + ' dagboek-dagen). Doorgaan?';
      if (!window.confirm(summary)) { setBackupStatus('Importeren geannuleerd.', true); return; }

      settings = Object.assign({ groups: Object.keys(F.GROUPS) }, j.settings || {});
      history = Array.isArray(j.history) ? j.history : [];
      diary = j.diary && typeof j.diary === 'object' ? j.diary : {};
      aiHistory = Array.isArray(j.aiHistory) ? j.aiHistory : [];
      store.set('settings', settings);
      store.set('history', history);
      store.set('diary', diary);
      store.set('aiHistory', aiHistory);

      buildSettings();
      renderHistory();
      renderDiary();
      Object.keys(shown).forEach(id => {
        const s = shown[id];
        const el = document.getElementById(id);
        if (el) renderResult(el, s.data, s.actions);
      });
      setBackupStatus('Back-up geïmporteerd — je gegevens zijn hersteld.', true);
    } catch (e) {
      setBackupStatus('Importeren mislukt: ' + (e && e.message ? e.message : 'ongeldig bestand') + '.', true);
    }
  });

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
