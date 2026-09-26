/* FODMAP-data en analyse-engine.
 * Werkt in de browser (window.FODMAP) en in Node (module.exports).
 * Indicatief: gebaseerd op algemene FODMAP-kennis, niet op officiële portiedata.
 * Nieuwe ingrediënten toevoegen: voeg een E(...)-regel toe aan DB.
 *   keys  = woordbegin-match (tarwe -> tarwebloem, tarwemeel)
 *   exact = alleen hele woorden (ui -> niet "uit")
 *   codes = E-nummers (bijv. '420' voor E420)
 */
(function (root) {
  'use strict';

  const GROUPS = {
    fructanen: 'Fructanen',
    gos: 'GOS',
    lactose: 'Lactose',
    fructose: 'Fructose',
    polyolen: 'Polyolen'
  };

  const GROUP_INFO = {
    fructanen: 'Tarwe, rogge, ui, knoflook, inuline',
    gos: 'Peulvruchten, cashew, pistache',
    lactose: 'Melk, room, yoghurt, verse kaas',
    fructose: 'Honing, appel, peer, mango, fructosestroop',
    polyolen: 'Sorbitol, xylitol, champignons, bloemkool'
  };

  const E = (id, name, level, groups, o) => Object.assign({ id, name, level, groups }, o);

  const DB = [
    // ---------- Fructanen ----------
    E('ui', 'Ui', 'high', ['fructanen'], {
      exact: ['ui', 'uien', 'uitje', 'uitjes', 'ail'],
      keys: ['uienpoeder', 'uipoeder', 'uiengranulaat', 'uivlokken', 'uiensap', 'onion', 'sjalot', 'shallot',
        'oignon', 'zwiebel', 'echalote'],
      note: 'Zit in veel sauzen, bouillon en kant-en-klaarmaaltijden. Ook als Franse "oignon"/"ail" of Duitse "Zwiebel"/"Knoblauch" op geïmporteerde etiketten.'
    }),
    E('lenteui', 'Lente-ui / bosui', 'moderate', ['fructanen'], {
      keys: ['lenteui', 'bosui', 'spring onion', 'scallion'],
      note: 'Het witte deel is hoog, het groene deel is laag.'
    }),
    E('knoflook', 'Knoflook', 'high', ['fructanen'], {
      keys: ['knoflook', 'garlic', 'knoblauch'],
      note: 'Knoflookolie zonder stukjes is meestal wel te doen.'
    }),
    E('prei', 'Prei', 'moderate', ['fructanen'], {
      exact: ['prei', 'leek', 'leeks'],
      keys: ['poireau', 'porree'],
      note: 'Het witte deel is hoog, het groene deel is laag.'
    }),
    E('tarwe', 'Tarwe', 'high', ['fructanen'], {
      keys: ['tarwe', 'wheat', 'durum', 'froment', 'weizen'],
      exact: ['ble', 'bles'],
      note: 'In kleine hoeveelheden (bijv. één boterham) vaak wel te doen. Ook als Franse "blé" of Duitse "Weizen".'
    }),
    E('spelt', 'Spelt', 'moderate', ['fructanen'], {
      keys: ['spelt'],
      note: 'Zuurdesem-spelt is vaak laag.'
    }),
    E('rogge', 'Rogge', 'high', ['fructanen'], {
      keys: ['rogge', 'rye', 'seigle', 'roggen'],
      note: 'Zuurdesem-roggebrood in kleine portie kan soms wel.'
    }),
    E('gerst', 'Gerst', 'high', ['fructanen'], {
      keys: ['gerst', 'barley', 'gerste'],
      exact: ['orge', 'orges']
    }),
    E('granen', 'Couscous, bulgur, griesmeel', 'high', ['fructanen'], {
      keys: ['couscous', 'bulgur', 'griesmeel', 'semolina', 'kamut', 'farro']
    }),
    E('inuline', 'Inuline / cichorei / oligofructose', 'high', ['fructanen'], {
      keys: ['inuline', 'inulin', 'cichorei', 'chicory', 'oligofructose', 'fructo-oligo', 'fructooligo', 'fructaan', 'fructan',
        'chicoree', 'zichorie'],
      exact: ['fos'],
      note: 'Wordt vaak als vezel toegevoegd (o.a. in "vezelrijke" producten).'
    }),
    E('topinamboer', 'Topinamboer / aardpeer', 'high', ['fructanen'], {
      keys: ['topinamboer', 'aardpeer', 'jerusalem artichoke']
    }),
    E('asperge', 'Asperge / artisjok', 'high', ['fructanen'], {
      keys: ['asperge', 'asparagus', 'artisjok', 'artichoke']
    }),
    E('biet', 'Rode biet', 'moderate', ['fructanen', 'gos'], {
      exact: ['biet', 'bieten', 'rode biet', 'beetroot']
    }),

    // ---------- GOS ----------
    E('peulvruchten', 'Peulvruchten (bonen, linzen, kikkererwten)', 'high', ['gos'], {
      keys: ['kikkererwt', 'chickpea', 'linz', 'lentil', 'kidneyboon', 'kidneybon', 'kidney bean', 'witte boon', 'witte bon',
        'bruine boon', 'bruine bon', 'zwarte boon', 'zwarte bon', 'black bean', 'sojaboon', 'sojabon', 'soybean',
        'sojameel', 'sojabloem', 'tuinboon', 'tuinbon', 'kapucijner', 'borlotti', 'adzuki', 'hummus', 'humus',
        'falafel', 'peulvrucht', 'lupine', 'haricot', 'lentille', 'pois chiche', 'kichererbse', 'linse', 'bohne'],
      exact: ['bonen', 'boon', 'beans', 'bean'],
      note: 'Uit blik en goed afgespoeld is een kleine portie soms wel te doen. Ook als Franse "haricot"/"lentille" of Duitse "Bohne"/"Linse" op geïmporteerde etiketten.'
    }),
    E('erwten', 'Erwten', 'moderate', ['gos'], {
      exact: ['erwten', 'erwt', 'peas', 'pois', 'erbse', 'erbsen'],
      note: 'Erwteneiwit-isolaat wordt vaak beter verdragen.'
    }),
    E('noten', 'Cashew / pistache', 'high', ['gos', 'fructanen'], {
      keys: ['cashew', 'pistache', 'pistachio']
    }),

    // ---------- Lactose ----------
    E('lactose', 'Melk / room / yoghurt / verse kaas', 'high', ['lactose'], {
      exact: ['melk', 'milk', 'room', 'cream', 'wei', 'whey', 'lait', 'laits', 'milch',
        'koemelk', 'geitenmelk', 'schapenmelk', 'buffelmelk', 'weidemelk', 'rohmilch'],
      keys: ['lactose', 'melkpoeder', 'melksuiker', 'weipoeder', 'weiproduct', 'weiproteine', 'wei-eiwit', 'weieiwit',
        'whey protein', 'slagroom', 'kookroom', 'creme fraiche', 'roomkaas', 'ricotta', 'mascarpone', 'cottage',
        'huttenkase', 'milk powder', 'cream cheese', 'karnemelk', 'yoghurt', 'yogurt', 'kwark', 'kefir',
        'creme', 'sahne', 'rahm', 'quark', 'joghurt',
        'vollmilch', 'magermilch', 'buttermilch', 'frischmilch', 'kondensmilch', 'trockenmilch', 'milchpulver',
        'schlagsahne', 'sauerrahm', 'frischkase'],
      note: 'Harde kaas en boter bevatten nauwelijks lactose; lactosevrije melk is prima. Ook als Franse "lait"/"crème" of Duitse "Milch"/"Sahne" op geïmporteerde etiketten.'
    }),
    E('melkchocolade', 'Melkchocolade', 'moderate', ['lactose'], {
      keys: ['melkchocolade', 'milk chocolate']
    }),

    // ---------- Fructose ----------
    E('honing', 'Honing', 'high', ['fructose'], { keys: ['honing', 'honey', 'miel', 'honig'] }),
    E('agave', 'Agave', 'high', ['fructose'], { keys: ['agave'] }),
    E('fructosestroop', 'Fructose(-glucose)stroop', 'high', ['fructose'], {
      keys: ['fructose', 'glucose-fructose', 'glucose fructose', 'hfcs', 'high fructose', 'high-fructose',
        'isoglucose', 'fruitsuiker', 'vruchtensuiker', 'hoge fructose'],
      note: 'Glucosestroop zonder fructose is wel laag.'
    }),
    E('invertsuiker', 'Invertsuiker', 'moderate', ['fructose'], {
      keys: ['invertsuiker', 'invert sugar', 'invert-suiker', 'invertsiroop', 'invertstroop']
    }),

    // ---------- Fruit ----------
    E('appel', 'Appel', 'high', ['fructose', 'polyolen'], {
      keys: ['appel', 'apple', 'pomme', 'apfel'],
      note: 'Ook als appelsap(concentraat) of appelmoes, of Franse "pomme"/Duitse "Apfel" op geïmporteerde etiketten.'
    }),
    E('peer', 'Peer', 'high', ['fructose', 'polyolen'], { keys: ['peer', 'peren', 'birne'], exact: ['pear', 'pears', 'poire', 'poires'] }),
    E('mango', 'Mango', 'high', ['fructose'], { keys: ['mango', 'mangue'] }),
    E('watermeloen', 'Watermeloen', 'high', ['fructose', 'polyolen'], { keys: ['watermeloen', 'watermelon', 'pasteque', 'wassermelone'] }),
    E('perzik', 'Perzik / nectarine', 'high', ['fructose', 'polyolen'], { keys: ['perzik', 'peach', 'nectarine', 'pfirsich'], exact: ['peche', 'peches'] }),
    E('abrikoos', 'Abrikoos', 'high', ['fructose', 'polyolen'], { keys: ['abrikoos', 'abrikozen', 'apricot', 'abricot', 'aprikose'] }),
    E('pruim', 'Pruim / gedroogde pruim', 'high', ['polyolen', 'fructose'], { keys: ['pruim', 'prune', 'plum', 'pflaume'] }),
    E('kers', 'Kers', 'high', ['fructose', 'polyolen'], { exact: ['kers', 'kersen', 'cherry', 'cherries', 'cerise', 'cerises', 'kirsche'] }),
    E('braam', 'Braam', 'high', ['polyolen'], { keys: ['braam', 'bramen', 'blackberr'] }),
    E('lychee', 'Lychee', 'high', ['fructose', 'polyolen'], { keys: ['lychee', 'lichi', 'litchi'] }),
    E('vijg', 'Vijg', 'high', ['fructose'], { exact: ['vijg', 'vijgen', 'fig', 'figs', 'figue', 'figues', 'feige'] }),
    E('dadel', 'Dadel', 'moderate', ['fructose', 'fructanen'], { keys: ['dadel', 'dattel'], exact: ['dates', 'date', 'datte', 'dattes'] }),
    E('rozijn', 'Rozijn / sultana', 'moderate', ['fructose'], {
      keys: ['rozijn', 'raisin', 'sultana'],
      note: 'Een kleine portie (1 eetlepel) is meestal laag.'
    }),
    E('avocado', 'Avocado', 'moderate', ['polyolen'], {
      keys: ['avocado', 'guacamole'],
      note: 'Een kleine portie (ca. 1/8) is meestal laag.'
    }),

    // ---------- Polyolen ----------
    E('polyolen', 'Polyolen (sorbitol, mannitol, xylitol, maltitol, isomalt)', 'high', ['polyolen'], {
      keys: ['sorbitol', 'mannitol', 'mannit', 'xylitol', 'maltitol', 'isomalt', 'lactitol', 'polyol', 'suikeralcohol',
        'sugar alcohol', 'gehydrogeneerde glucose', 'hydrogenated glucose'],
      codes: ['420', '421', '953', '965', '966', '967'],
      note: 'Vaak in suikervrije snoep, kauwgom en light-producten. Werkt laxerend.'
    }),
    E('erythritol', 'Erythritol', 'moderate', ['polyolen'], {
      keys: ['erythritol', 'erythrit'],
      codes: ['968'],
      note: 'Wordt beter opgenomen dan andere polyolen; bij gevoeligheid toch voorzichtig.'
    }),

    // ---------- Groenten ----------
    E('champignon', 'Champignons / paddenstoelen', 'high', ['polyolen'], {
      keys: ['champignon', 'mushroom', 'paddenstoel', 'portobello', 'shiitake', 'oesterzwam', 'cantharel', 'eekhoorntjesbrood', 'pilz']
    }),
    E('bloemkool', 'Bloemkool', 'high', ['polyolen'], { keys: ['bloemkool', 'cauliflower', 'blumenkohl', 'choufleur'], exact: ['chou-fleur'] }),
    E('zoetepatat', 'Zoete aardappel', 'moderate', ['polyolen'], { keys: ['zoete aardappel', 'bataat', 'sweet potato', 'patate douce'] }),
    E('selderij', 'Bleekselderij', 'moderate', ['polyolen'], {
      keys: ['bleekselderij', 'selderij', 'celery', 'celeri', 'sellerie'],
      note: 'Knolselderij (ook Franse "céleri-rave") is wel laag.'
    }),

    // ---------- Onzeker ----------
    E('aroma', 'Aroma / kruiden (niet gespecificeerd)', 'unsure', [], {
      exact: ['aroma', "aroma's", 'aromas', 'kruiden', 'specerijen', 'kruidenmix', 'smaakstof', 'smaakstoffen',
        'spices', 'herbs', 'flavouring', 'flavourings', 'flavoring', 'flavorings'],
      note: 'Kan ui of knoflook bevatten zonder dat dit apart vermeld staat.'
    })
  ];

  // Voorbeelden van laag-FODMAP producten (alleen voor het zoekscherm).
  const LOW = [
    { name: 'Rijst', alias: ['rice'], note: 'Alle soorten rijst zijn laag.' },
    { name: 'Havermout', alias: ['haver', 'oats'], note: 'Kleine portie (ca. 40 g droog) is laag.' },
    { name: 'Quinoa', alias: [], note: '' },
    { name: 'Gierst', alias: ['millet'], note: '' },
    { name: 'Maïszetmeel / maïsmeel', alias: ['maiszetmeel', 'maismeel', 'cornstarch'], note: '' },
    { name: 'Aardappel', alias: ['potato'], note: '' },
    { name: 'Wortel', alias: ['carrot'], note: '' },
    { name: 'Courgette', alias: ['zucchini'], note: 'Kleine tot middelgrote portie.' },
    { name: 'Komkommer', alias: ['cucumber'], note: '' },
    { name: 'Tomaat', alias: ['tomato'], note: 'Tomatenpuree in kleine hoeveelheid is laag.' },
    { name: 'Paprika (rood)', alias: ['bell pepper'], note: '' },
    { name: 'IJsbergsla / sla', alias: ['sla', 'lettuce'], note: '' },
    { name: 'Spinazie', alias: ['spinach'], note: '' },
    { name: 'Aubergine', alias: ['eggplant'], note: 'Kleine portie.' },
    { name: 'Knolselderij', alias: ['celeriac'], note: '' },
    { name: 'Sperziebonen / snijbonen / sla-bonen', alias: ['green beans', 'sperzieboon', 'snijboon', 'slaboon'], note: '' },
    { name: 'Banaan (stevig)', alias: ['banana'], note: 'Rijpe banaan is matig.' },
    { name: 'Blauwe bessen', alias: ['blueberry', 'bosbes'], note: '' },
    { name: 'Aardbei', alias: ['strawberry', 'aardbeien'], note: '' },
    { name: 'Framboos', alias: ['raspberry', 'frambozen'], note: '' },
    { name: 'Kiwi', alias: [], note: '' },
    { name: 'Sinaasappel / mandarijn', alias: ['orange', 'mandarin'], note: '' },
    { name: 'Ananas', alias: ['pineapple'], note: '' },
    { name: 'Druiven', alias: ['grapes'], note: '' },
    { name: 'Ei', alias: ['egg', 'eieren'], note: '' },
    { name: 'Kip, rund, varken, vis', alias: ['chicken', 'kip', 'vlees', 'fish'], note: 'Puur vlees/vis is laag; let op marinades en sauzen.' },
    { name: 'Tofu (stevig)', alias: [], note: 'Zachte tofu (silken) is hoger.' },
    { name: 'Lactosevrije melk', alias: ['lactosevrij'], note: '' },
    { name: 'Harde kaas (cheddar, parmezaan, oude kaas)', alias: ['kaas', 'cheese'], note: '' },
    { name: 'Boter', alias: ['butter'], note: '' },
    { name: 'Olijfolie / plantaardige olie', alias: ['olie', 'oil'], note: '' },
    { name: 'Amandelmelk / rijstmelk', alias: ['amandeldrink', 'rijstdrink'], note: 'Zonder toegevoegde inuline of appelsap.' },
    { name: 'Pinda\'s, walnoten, macadamia', alias: ['pinda', 'walnoot', 'peanut'], note: 'Kleine handje.' },
    { name: 'Chiazaad / lijnzaad', alias: ['chia', 'lijnzaad'], note: '' },
    { name: 'Zuurdesem spelt brood', alias: ['zuurdesem', 'sourdough'], note: 'Verschilt per bakker; check het label.' },
    { name: 'Glutenvrij brood', alias: ['glutenvrij'], note: 'Let op inuline of peulvrucht-meel.' },
    { name: 'Suiker (sacharose) / glucose', alias: ['suiker', 'sugar', 'glucosestroop'], note: '' },
    { name: 'Ahornsiroop', alias: ['maple'], note: '' },
    { name: 'Stevia / sucralose', alias: [], note: '' },
    { name: 'Sojasaus', alias: ['soy sauce', 'ketjap'], note: 'Zonder uit/knoflook toegevoegd.' },
    { name: 'Gember', alias: ['ginger'], note: '' },
    { name: 'Thee (zwart / groen)', alias: ['tea'], note: 'Kruidenthee (kamille, venkel) is matig.' },
    { name: 'Pure chocolade', alias: ['chocolade', 'dark chocolate'], note: 'Kleine portie.' }
  ];

  // Teksten die eerst weggehaald worden zodat ze geen vals alarm geven.
  const EXCEPT = [
    'lactose[\\s-]?vrij\\w*(\\s+(melk|room|yoghurt|kwark|kaas))?',
    'melk[\\s-]?(eiwit|vet|zuur)\\w*',
    'appel(cider)?azijn', 'apple cider vinegar',
    'pruimtomat\\w*', 'plum tomato\\w*',
    'tarwe[\\s-]?(zetmeel|gluten|dextrine|dextrose|glucose\\w*)', 'wheat (starch|gluten|dextrin)',
    'whey protein isolate', 'wei[\\s-]?eiwit[\\s-]?isolaat', 'weiproteine[\\s-]?isolaat',
    'green beans?', 'string beans?', 'french beans?', 'haricots? verts?',
    'cocoa beans?', 'cacao beans?', 'coffee beans?', 'vanilla beans?',
    'sperzie[\\s-]?bon\\w*', 'snij[\\s-]?bon\\w*', 'sla[\\s-]?bon\\w*', 'prinsess\\w*[\\s-]?bon\\w*',
    'pronk[\\s-]?bon\\w*', 'groene[\\s-]?bon\\w*', 'sojaboon[\\s-]?scheut\\w*', 'taugé', 'tauge',
    'grune[\\s-]?bohn\\w*',
    'pommes?[\\s-]?de[\\s-]?terre\\w*', 'apfelsinen?',
    'lait[\\s-]?(de|d.)?[\\s-]?(coco|amande|avoine|soja|riz|noisette)\\w*',
    'celeri[\\s-]?rave\\w*', 'knolselderij',
    // "wei" als grasland, niet als wei (whey): "koeien die in de wei lopen", "weidegang"
    '(?<![\\p{L}\\p{N}])(in|op|de|het|naar|buiten)\\s+(de\\s+)?(\\p{L}+\\s+)?wei(?![\\p{L}\\p{N}])(?!\\s*(poeder|eiwit|proteine|product|permeaat)\\w*)',
    '(?<![\\p{L}\\p{N}])wei(?=\\s+(lopen|loopt|liepen|grazen|graast|staan|staat|gaan|gaat))',
    '(?<![\\p{L}\\p{N}])weide(gang|vogel|grond|land|seizoen|dag|en)?(?![\\p{L}\\p{N}])'
  ];

  // Einde van de ingrediëntenlijst: alles hierna (bewaaradvies, voedingswaarde, wervende
  // tekst over weidemelk) hoort er niet bij en mag geen treffers opleveren.
  const END_MARKERS = [
    'verpakt onder', 'beschermende atmosfeer', 'gekoeld bewaren', 'koel en droog', 'droog en koel',
    'bewaren bij', 'bewaren beneden', 'na openen', 'na opening', 'ten minste houdbaar', 'tenminste houdbaar',
    'houdbaar tot', 'gemiddelde voedingswaarde', 'voedingswaarde', 'voedingswaarden', 'nutrition',
    'deze kaas is gemaakt', 'gemaakt van weidemelk', 'store in', 'best before', 'keep refrigerated'
  ];
  const HEADER_RE = /ingredi[eë]nten\s*[:\-]|ingredients\s*[:\-]|ingr[eé]dients\s*[:\-]|zutaten\s*[:\-]/i;

  // Haalt het eigenlijke ingrediëntenlijstje uit een volledige etiket-tekst (OCR).
  // cut = true als er iets is weggeknipt (kop gevonden of einde-markering na een opsomming).
  function ingredientPart(text) {
    const src = String(text || '');
    let t = src, cut = false, header = false;
    const h = t.match(HEADER_RE);
    if (h) { t = t.slice(h.index + h[0].length); cut = true; header = true; }
    const low = norm(t);
    let end = -1;
    END_MARKERS.forEach(m => {
      const i = low.indexOf(m);
      if (i > 0 && (end < 0 || i < end)) end = i;
    });
    if (end > 0) {
      const before = t.slice(0, end);
      if (header || (before.match(/,/g) || []).length >= 2) { t = before; cut = true; }
    }
    t = t.replace(/[\s.,;:]+$/, '');
    return { text: cut ? t : src, cut };
  }

  const WB = '(?<![\\p{L}\\p{N}])', WA = '(?![\\p{L}\\p{N}])';
  // Harde / gerijpte kaas: bij het rijpen verdwijnt de lactose vrijwel volledig.
  const CHEESE_RE = new RegExp(WB + '(gouda|goudse|edam\\w*|leerdam\\w*|maasdam\\w*|leidse|beemster|old amsterdam|boerenkaas|' +
    'cheddar|parmez\\w*|parmigiano|parmesan|grana padano|pecorino|emment\\w*|gruyere|comte|manchego|' +
    'natuurgerijpt\\w*|(20|30|35|40|45|48|50|60)\\+)', 'u');
  const CHEESE_WEAK_RE = new RegExp(WB + '(kaas|cheese|kase|fromage)' + WA, 'u');
  const RIPE_RE = new RegExp(WB + '(stremsel|rennet|gerijpt\\w*|belegen|jong|oud|extra belegen|ripened|aged)' + WA, 'u');
  const FRESH_RE = new RegExp(WB + '(roomkaas|smeerkaas|smeltkaas|verse kaas|zuivelspread|ricotta|mascarpone|cottage|huttenkase|' +
    'kwark|quark|skyr|cream cheese|frischkase|mozzarella|burrata|feta|fromage frais|monchou|philadelphia|kaassaus|fondue|' +
    'yoghurt|yogurt|pudding|vla)', 'u');
  // Ingrediënten die in een gewone kaas horen; staat er iets anders in, dan is het een samengesteld product.
  const CHEESE_OK_RE = /^(gepasteuriseerde |rauwe |volle |magere |halfvolle )*(koe|geiten|schapen|buffel|weide)?(melk|milk|milch|lait)|^(zee)?zout|^salt|^zuursel|^(kaas)?cultures?|^(microbieel |dierlijk |vegetarisch )*(stremsel|rennet|lab)|^ferment|^kleurstof|^(beta-?)?caroten|^annatto|^bixine|^e ?16\d|^conserveermiddel|^natriumnitra|^e ?25\d|^natamycine|^e ?235|^lysozym|^e ?1105|^calciumchloride|^e ?509|^komijn|^kummel|^fenegriek|^kruiden|^specerijen|^mosterdzaad|^peper|^brandnetel|^bieslook|^pesto/;
  const PLAIN_MILK_RE = /^(koe|geiten|schapen|buffel|weide|voll|mager|roh|frisch)?(melk|milk|milch|lait|laits)$/;

  function isHardCheese(fullNorm, tokens) {
    if (FRESH_RE.test(fullNorm)) return false;
    if (!(CHEESE_RE.test(fullNorm) || (CHEESE_WEAK_RE.test(fullNorm) && RIPE_RE.test(fullNorm)))) return false;
    return tokens.every(t => {
      const n = norm(t).replace(/[^\p{L}\p{N}+ -]/gu, ' ').replace(/\s+/g, ' ').trim();
      if (!/\p{L}{3}/u.test(n)) return true; // OCR-ruis zoals "\:"
      return CHEESE_OK_RE.test(n);
    });
  }

  // Suikers per 100 g van het etiket (voedingswaardetabel in de OCR-tekst). null = onbekend.
  function parseSugars(text) {
    const m = norm(text).match(/(?:suikers?|sugars?|zucker|sucres)\s*[:\-]?\s*(<\s*)?(\d+(?:[.,]\d+)?)\s*g/u);
    return m ? parseFloat(m[2].replace(',', '.')) : null;
  }

  // ---------- helpers ----------
  function norm(s) {
    return (s == null ? '' : String(s)).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/_/g, ' ')
      .replace(/[’`´]/g, "'");
  }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const B = '(?<![\\p{L}\\p{N}])';
  const A = '(?![\\p{L}\\p{N}])';

  function buildRe(e) {
    const parts = [];
    (e.keys || []).forEach(k => parts.push(B + esc(norm(k)) + '[\\p{L}\\p{N}]*'));
    (e.exact || []).forEach(k => parts.push(B + esc(norm(k)) + A));
    (e.codes || []).forEach(c => parts.push(B + 'e[\\s-]?' + c + A));
    return parts.length ? new RegExp(parts.join('|'), 'gu') : null;
  }
  DB.forEach(e => { e._re = buildRe(e); });
  const EXC_RE = new RegExp(EXCEPT.join('|'), 'gu');

  function cleanText(t) {
    return (t || '')
      .replace(/<[^>]+>/g, '')
      .replace(/_/g, '')
      .replace(/\r?\n+/g, ' ')
      .replace(/[•·●▪]/g, ',')
      .replace(/^\s*(ingredi[eë]nten|ingredients|ingr[eé]dients)\s*[:\-]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitIngredients(text) {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of text) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if ((ch === ',' || ch === ';') && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim()).filter(Boolean);
  }

  const RANK = { high: 3, moderate: 2, unsure: 1 };

  const LACTASE_RE = new RegExp(B + 'lactase' + A, 'u');

  // opts.context = productnaam/categorie; opts.sugars = suikers per 100 g (Open Food Facts)
  function analyze(text, enabled, opts) {
    opts = opts || {};
    const part = ingredientPart(text);
    const cleaned = cleanText(part.text);
    if (!cleaned) return { verdict: 'unknown', total: 0, hits: [], items: [] };
    const tokens = splitIngredients(cleaned);
    const fullNorm = norm([opts.context, text].filter(Boolean).join(' '));
    // Harde kaas: de melk als basisingrediënt geeft geen lactose meer (rijping).
    const hardCheese = isHardCheese(fullNorm, tokens);
    // 0 g suikers per 100 g = ook (vrijwel) 0 g lactose, want lactose is een suiker.
    let sugars = typeof opts.sugars === 'number' ? opts.sugars : parseSugars(text);
    const noSugar = sugars != null && sugars < 0.5;
    const CHEESE_NOTE = 'Harde/gerijpte kaas: de lactose uit de melk verdwijnt bij het rijpen, dus geen probleem.';
    const SUGAR_NOTE = 'Het etiket vermeldt (vrijwel) 0 g suikers per 100 g, dus ook nauwelijks lactose.';
    const en = enabled || null; // Set met groepsnamen, of null = alles
    // Melk/room met toegevoegd lactase-enzym is enzymatisch lactosevrij gemaakt,
    // ook als het ingrediëntenlijstje het woord "lactosevrij" zelf niet gebruikt.
    const hasLactase = LACTASE_RE.test(norm(cleaned));

    const items = tokens.map((t, i) => {
      const tn = norm(t).replace(EXC_RE, ' ');
      const hits = [];
      for (const e of DB) {
        if (!e._re) continue;
        const m = tn.match(e._re);
        if (!m) continue;
        let active = e.level === 'unsure' || !en || e.groups.some(g => en.has(g));
        let term = m[0].trim(), note = e.note || '';
        const lactoseOnly = e.groups.length === 1 && e.groups[0] === 'lactose';
        if (e.id === 'lactose' && hasLactase) active = false;
        if (active && e.id === 'lactose' && hardCheese) {
          const other = m.map(x => x.trim()).filter(x => !PLAIN_MILK_RE.test(x));
          if (other.length) term = other[0];
          else { active = false; note = CHEESE_NOTE; }
        }
        if (active && lactoseOnly && noSugar) { active = false; note = SUGAR_NOTE; }
        hits.push({ id: e.id, name: e.name, level: e.level, groups: e.groups, term, note, active });
      }
      let level = 'none';
      hits.forEach(h => {
        if (!h.active || h.level === 'unsure') return;
        if (h.level === 'high') level = 'high';
        else if (level !== 'high') level = 'moderate';
      });
      if (level === 'none' && hits.some(h => h.level === 'unsure')) level = 'unsure';
      return { text: t, index: i + 1, hits, level };
    });

    const map = new Map();
    items.forEach(it => it.hits.forEach(h => {
      if (!h.active) return;
      let a = map.get(h.id);
      if (!a) {
        a = { id: h.id, name: h.name, level: h.level, groups: h.groups, note: h.note, first: it.index, count: 0, terms: [] };
        map.set(h.id, a);
      }
      a.count++;
      if (!a.terms.includes(h.term)) a.terms.push(h.term);
    }));
    const hits = Array.from(map.values()).sort((a, b) => (RANK[b.level] - RANK[a.level]) || (a.first - b.first));

    let verdict = 'low';
    if (hits.some(h => h.level === 'high')) verdict = 'high';
    else if (hits.some(h => h.level === 'moderate')) verdict = 'moderate';

    return { verdict, total: tokens.length, hits, items, hardCheese, noSugar };
  }

  function search(q) {
    const words = s => ' ' + norm(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
    const nq = words(q).trim();
    const rows = [];
    DB.forEach(e => {
      if (e.level === 'unsure') return;
      const hay = words([e.name].concat(e.keys || [], e.exact || []).join(' '));
      if (!nq || hay.includes(' ' + nq)) rows.push({ name: e.name, level: e.level, groups: e.groups, note: e.note || '' });
    });
    LOW.forEach(l => {
      const hay = words([l.name].concat(l.alias || []).join(' '));
      if (!nq || hay.includes(' ' + nq)) rows.push({ name: l.name, level: 'low', groups: [], note: l.note || '' });
    });
    const order = { high: 0, moderate: 1, low: 2 };
    rows.sort((a, b) => (order[a.level] - order[b.level]) || a.name.localeCompare(b.name, 'nl'));
    return rows;
  }

  const api = { GROUPS, GROUP_INFO, DB, LOW, analyze, search, norm, cleanText, splitIngredients, ingredientPart, parseSugars };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FODMAP = api;
})(typeof window !== 'undefined' ? window : globalThis);
