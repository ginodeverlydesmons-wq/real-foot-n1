// ─────────────────────────────────────────────────────────────────────────────
//  Service Worker — US Bouloire Football
// ─────────────────────────────────────────────────────────────────────────────
// Stratégie : cache shell + cache séparé pour les Google Fonts.
// Les données (Apps Script) passent toujours par le réseau pour rester à jour.
//
// IMPORTANT : à chaque nouvelle version du site, incrémenter CACHE_VERSION.
// Le SW supprimera automatiquement les anciens caches au prochain chargement.
// ─────────────────────────────────────────────────────────────────────────────

// ⚠️ CETTE VALEUR DOIT TOUJOURS ETRE EGALE A APP_VERSION DANS index.html.
//    C'est la comparaison entre les deux qui permet a une page issue d'un
//    cache de detecter qu'elle est perimee et de se recharger d'office.
//    Bumper l'une sans l'autre desarme le garde-fou (ou provoque un
//    rechargement inutile). Les deux, a chaque deploiement, point final.
const CACHE_VERSION = 'v1'; // Première version du site foot (septembre 2026)
const CACHE_NAME    = `usbfoot-shell-${CACHE_VERSION}`;
const FONTS_CACHE   = `usbfoot-fonts-${CACHE_VERSION}`; // cache séparé pour les Google Fonts

// Liste des fichiers du shell à pré-cacher dès l'installation.
const SHELL_ASSETS = [
  './',
  './index.html',
  './boutique.html',
  './usb-common.js',
  './usb-common.css',
  './manifest.webmanifest',
  './favicon-16.png',
  './favicon-32.png',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
];

// ── Install : pré-cache du shell ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn(`[SW] Cache miss: ${url}`, err))
        )
      );
    })
  );
  // ⛔ PAS de self.skipWaiting() ici (retiré août 2026).
  //
  //  C'ÉTAIT LE BUG DU TOAST « MISE À JOUR DISPONIBLE ».
  //  Cet appel promouvait le nouveau SW dès la fin de l'install, sans jamais
  //  passer durablement par l'état `waiting`. Or TOUT le code du toast, côté
  //  index.html, est gardé par `if (!reg.waiting) return;`. On demandait donc
  //  à l'interface d'annoncer un état que le SW s'employait à supprimer le
  //  plus vite possible : le toast ne s'affichait que si le navigateur
  //  gagnait la course. Sur desktop ça arrivait parfois, sur mobile
  //  quasiment jamais — d'où « ça ne s'affiche jamais sur téléphone ».
  //
  //  Le nouveau SW attend maintenant sagement. C'est le clic sur « Recharger »
  //  qui envoie SKIP_WAITING (voir le handler `message` plus bas) et déclenche
  //  la bascule. La mise à jour devient explicite et visible, au lieu de
  //  s'appliquer en douce sous les pieds de l'utilisateur.
});

// ── Activate : navigationPreload + ménage des anciens caches ─────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch(_) {}
    }
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => (k.startsWith('usbfoot-shell-') || k.startsWith('usbfoot-fonts-'))
                    && k !== CACHE_NAME && k !== FONTS_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.status === 200) {
          cache.put(req, res.clone());
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
}


// ─────────────────────────────────────────────────────────────────────────────
//  Résilience Apps Script — rejeu transparent (août 2026)
// ─────────────────────────────────────────────────────────────────────────────
//  Trois tentatives, avec abandon à 12 s. Motivation chiffrée : les exécutions
//  serveur durent 0,8 à 5 s, mais un appel qui échoue reste suspendu ~29 s
//  avant de rendre un 404. Au-delà de 12 s la réponse est perdue — mieux vaut
//  abandonner et rejouer que patienter.
//
//  Le rejeu est sûr côté serveur : verifyCode est idempotent (cache 5 min du
//  couple email+code), et les autres routes sont des lectures ou des écritures
//  déjà protégées par _withLock.
//
//  On renvoie TOUJOURS un JSON, jamais une erreur réseau : les pages savent
//  lire { ok:false, reason } et l'affichent proprement.
// Passe à true dès qu'un appel a abouti : l'instance Apps Script est alors
// chaude, et le délai serré redevient pertinent. Remis à false après dix
// minutes sans appel — au-delà, Google a probablement recyclé l'instance.
var _dejaChaud = false;
var _dernierSucces = 0;

async function _appsScriptResilient(req) {
  if (_dejaChaud && (Date.now() - _dernierSucces) > 10 * 60 * 1000) {
    _dejaChaud = false;   // l'instance a sans doute refroidi
  }
  const corps = (req.method === 'POST') ? await req.clone().text() : null;

  // ⏱️ LE DÉLAI DÉPEND DE LA NATURE DE L'APPEL (corrigé août 2026).
  //
  //    Les 12 s d'origine sont calibrées sur un appel ISOLÉ : l'exécution
  //    serveur dure 0,8 à 5 s, donc au-delà de 12 s la réponse est perdue.
  //
  //    Un LOT (`action:'batch'`) fait le travail de N appels dans UNE seule
  //    exécution : il dépasse structurellement les 12 s. Le seuil le coupait
  //    en vol, le rejeu le coupait à nouveau, et l'appel finissait en
  //    `reponse_invalide` — la page HTML d'erreur Google n'étant que la
  //    conséquence de la coupure, pas sa cause.
  //
  //    On lui laisse donc 55 s (sous la limite d'exécution Apps Script de
  //    6 min, mais au-delà de tout lot raisonnable), et UNE seule tentative :
  //    rejouer un lot déjà long ne fait que doubler l'attente avant le repli,
  //    et la page bascule de toute façon sur les appels individuels.
  const estLot = corps !== null && corps.indexOf('"action":"batch"') !== -1;

  // 📦 LE DÉLAI DOIT SUIVRE LE POIDS DU CORPS (corrigé août 2026).
  //
  //    ⚠️ C'ÉTAIT LA CAUSE DES `action_inconnue` SUR upload_certif.
  //
  //    Les seuils ci-dessous sont calibrés sur des appels dont le corps tient
  //    en quelques kilo-octets : le temps mesuré est alors presque entièrement
  //    celui de l'EXÉCUTION serveur. Un envoi de certificat, lui, transporte
  //    plusieurs centaines de kilo-octets de base64 : sur un lien 4G montant,
  //    la seule TRANSMISSION dure déjà plus longtemps que le délai accordé.
  //
  //    Ce qui se passait alors, dans l'ordre :
  //      1. l'AbortController coupait la requête EN COURS D'ENVOI ;
  //      2. Google recevait un corps tronqué, mais appelait quand même
  //         doPost — dont le JSON.parse échouait ;
  //      3. doPost avalait l'erreur et retombait sur action='' →
  //         il répondait `{ok:false, reason:'action_inconnue'}` ;
  //      4. ce JSON étant parfaitement valide, on le prenait pour une
  //         réponse légitime et on la remontait à la page.
  //
  //    D'où un message parfaitement trompeur — « action inconnue » pour une
  //    route qui existe bel et bien — dont la vraie cause était un abandon
  //    prématuré côté client.
  //
  //    On accorde donc une seconde par tranche de 40 Ko, en plus du délai de
  //    base : de quoi couvrir un lien montant médiocre sans jamais dépasser
  //    la limite d'exécution d'Apps Script.
  const poids = corps ? corps.length : 0;
  const rallonge = Math.min(25000, Math.floor(poids / 40000) * 1000);
  // ♻️ Un envoi lourd PORTANT UNE CLÉ D'IDEMPOTENCE peut être rejoué sans
  //    risque : le serveur reconnaît la clé et rend sa réponse d'origine au
  //    lieu de recréer un fichier Drive. C'est ce qui permet de retenter face
  //    à une couche de livraison qui perd une réponse sur sept, au lieu de
  //    renoncer au premier échec.
  const idempotent = corps !== null &&
                     corps.indexOf('"idem_key"') !== -1 &&
                     corps.indexOf('"idem_key":""') === -1;
  const estLourd = poids > 100000 && !idempotent;

  // ⏳ DÉLAI ANNONCÉ PAR LA PAGE (août 2026).
  //
  //    Le service worker est la couche la plus basse : son abandon prime sur
  //    celui de la page, toujours. Une page qui accorde 45 s à une lecture de
  //    document ne sert donc à rien si le worker coupe à 10 s — et c'est
  //    exactement ce qui se passait sur `get_certif_url` et `upload_certif`,
  //    deux routes qui lisent ou écrivent sur Drive et prennent couramment
  //    10 à 30 s côté serveur.
  //
  //    La page place donc `__delai` dans le corps. On le lit ici. Le serveur
  //    ignore ce champ, il ne coûte que quelques octets.
  let delaiAnnonce = 0;
  if (corps) {
    const m = /"__delai"\s*:\s*(\d+)/.exec(corps);
    if (m) delaiAnnonce = Math.min(120000, parseInt(m[1], 10) || 0);
  }

  // 🚫 UNE SEULE TENTATIVE POUR LES ENVOIS LOURDS.
  //    Une requête coupée en vol a très bien pu être exécutée entièrement
  //    côté serveur — un certificat peut donc déjà être écrit dans Drive.
  //    La rejouer crée un second fichier et met le premier à la corbeille.
  //    Sur une lecture, rejouer est gratuit ; sur une écriture volumineuse,
  //    c'est un pari qu'on ne prend pas.

  // ⏱️ LE PREMIER APPEL A DROIT À BEAUCOUP PLUS DE TEMPS (corrigé août 2026).
  //
  //    Les 12 s étaient calibrées sur une instance CHAUDE, où l'exécution
  //    serveur dure 0,8 à 5 s. Mais un démarrage à froid d'Apps Script met
  //    15 à 40 s — le premier appel de la journée était donc coupé
  //    systématiquement, quelle que soit la vitesse du code.
  //
  //    Le symptôme était trompeur : sur `send_code`, le mail partait bien
  //    (le serveur avait fini son travail), mais la réponse était coupée en
  //    vol. Le front rejouait, et le serveur répondait « code déjà envoyé,
  //    patiente 8 secondes ». L'utilisateur recevait son code sans jamais
  //    pouvoir passer à l'écran de saisie.
  //
  //    On accorde donc 45 s tant qu'aucun appel n'a encore abouti dans ce
  //    service worker, puis on redescend à 12 s une fois l'instance chaude.
  // ⏱️ Délais resserrés (13/08/2026), sur mesures et non sur hypothèse.
  //
  //    Deux faits établis depuis :
  //      • le serveur répond en 1,9 s de médiane, mesuré en appelant /exec
  //        depuis le réseau Google (5 succès sur 5, aucune page HTML) ;
  //      • le déclencheur `maintienAuChaud` tourne toutes les 5 minutes,
  //        donc l'instance n'est quasiment jamais froide.
  //
  //    Les 45 s accordées à froid n'ont plus lieu d'être — elles ne font
  //    plus qu'allonger l'attente avant le repli quand la redirection
  //    échoue. Or ce mode d'échec dure ~15 s puis rend 404 : mieux vaut
  //    couper avant et rejouer.
  //
  //    Au-delà de 10 s à chaud, ce n'est plus une exécution lente, c'est
  //    une redirection perdue. Inutile d'attendre davantage.
  const TIMEOUT  = estLot ? 55000
                          : ((delaiAnnonce || (_dejaChaud ? 10000 : 20000)) + rallonge);
  // ⏱️ PREMIER ESSAI GENEREUX (aout 2026), sur mesure.
  //
  //    `usbDiag(10,'config')` sur le poste de Remi : 0/10 echecs, mais une
  //    mediane de 20 483 ms, avec SEPT valeurs collees entre 20 et 21 s, et
  //    deux a 2,8 et 7,8 s. Ce plateau a ~20 s n'est pas de la latence
  //    naturelle : c'est 10 s d'abandon + 10 s de rejeu, autrement dit LA
  //    SIGNATURE DE CE FICHIER. Le worker coupait a 10 s des appels qui
  //    aboutissaient a 16 s.
  //
  //    Le commentaire ci-dessus affirmait « au-dela de 10 s a chaud, c'est
  //    une redirection perdue ». La mesure le contredit sur ce poste : les
  //    appels y sont simplement lents. On accorde donc 25 s au PREMIER essai
  //    — de quoi laisser passer un reseau lent — et on garde un budget serre
  //    au rejeu, ou l'echec est effectivement probable.
  // Ramene de 25 a 16 s (aout 2026, le soir meme). Un premier essai tres
  // long ne rend pas les appels plus fiables : il retarde seulement le rejeu,
  // et il immobilise un jeton de la file pendant tout ce temps — au point de
  // ralentir aussi les appareils qui, eux, repondaient en 2 s. On garde une
  // marge par rapport aux 10 s d'origine, sans transformer chaque echec en
  // demi-minute d'attente.
  const TIMEOUT_PREMIER = estLot ? 55000 : Math.max(16000, TIMEOUT);
  const TENTATIVES = (estLot || estLourd) ? 1 : 2;
  let apercu = '';

  // ⚠️ DEUX tentatives, pas trois — et c'est délibéré.
  // apiPost() et _authApi() rejouent DÉJÀ 3 fois côté page. Les couches se
  // MULTIPLIENT : 3 essais page × 3 essais SW = jusqu'à 9 allers-retours pour
  // un seul appel, soit plus d'une minute d'attente sur un échec persistant.
  // Le SW n'est pas là pour doubler ce que la page fait déjà, mais pour
  // couvrir celles qui ne le font pas (admin.html, boutique.html). Une seule
  // reprise rattrape l'écrasante majorité des échecs, qui sont transitoires.
  for (let i = 0; i < TENTATIVES; i++) {
    if (i) await new Promise(r => setTimeout(r, 400 * i * (0.8 + Math.random() * 0.4)));
    const ctrl = new AbortController();
    const budget = (i === 0) ? TIMEOUT_PREMIER : TIMEOUT;
    const chrono = setTimeout(() => ctrl.abort(), budget);
    try {
      const init = { method: req.method, redirect: 'follow', signal: ctrl.signal };
      if (corps !== null) init.body = corps;
      const r = await fetch(req.url, init);
      const t = await r.text();

      // Réponse valide ?
      try {
        JSON.parse(t);
        _dejaChaud = true; _dernierSucces = Date.now();
        return new Response(t, { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch (_) {}
      // JSON noyé dans du HTML : on le récupère plutôt que de rejouer pour rien.
      const m = t.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          JSON.parse(m[0]);
          _dejaChaud = true; _dernierSucces = Date.now();
          return new Response(m[0], { status: 200, headers: { 'Content-Type': 'application/json' } });
        } catch (__) {}
      }
      apercu = t.slice(0, 120);
      console.warn(`[sw] réponse non-JSON (essai ${i + 1}) →`, apercu);
    } catch (e) {
      apercu = (e && e.name === 'AbortError') ? ('abandon apres ' + Math.round(budget/1000) + ' s') : String(e && e.message || e);
      console.warn(`[sw] échec (essai ${i + 1}) :`, apercu);
    } finally {
      clearTimeout(chrono);
    }
  }

  return new Response(
    JSON.stringify({ ok: false, reason: 'reponse_invalide', _sw: true, apercu }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

// ── Fetch : routage par type de ressource ────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Apps Script : JAMAIS de cache — mais on INTERCEPTE désormais (août 2026).
  //
  //    Avant, le SW se contentait de laisser passer (`return`). Chaque page
  //    devait donc porter sa propre logique de résistance aux pannes, et
  //    seule authApi() dans index.html en avait une — la boutique, l'admin et
  //    tout le reste du site restaient à nu.
  //
  //    Le problème : /exec répond par un 302 vers script.googleusercontent.com,
  //    et cette seconde URL renvoie par intermittence la page d'accueil de
  //    Google Docs au lieu du JSON attendu. En interceptant ici, le rejeu
  //    devient universel : toutes les pages, tous les appels, toutes les
  //    familles — sans qu'aucune ligne des pages n'ait à changer.
  //
  //    googleusercontent n'est PAS intercepté : c'est le saut interne suivi
  //    par `redirect:'follow'`, il doit rester transparent.
  if (url.hostname.includes('script.google.com')) {
    // L'agenda iCal renvoie du texte brut, pas du JSON : on le laisse passer.
    if (url.search.includes('action=ical')) return;
    event.respondWith(_appsScriptResilient(req));
    return;
  }
  if (url.hostname.includes('googleusercontent.com')) return;

  if (req.method !== 'GET') return;

  // 2) Google Fonts : stale-while-revalidate
  // ── Google Fonts : la CSS et les fichiers ne se traitent PAS pareil ──
  //
  //    ⚠️ C'ÉTAIT LA CAUSE DES « download failed » SUR DM SANS.
  //
  //    La feuille CSS de fonts.googleapis.com contient les URL des fichiers
  //    .woff2 — et Google fait tourner ces URL. Mise en cache, la CSS finit
  //    par pointer vers des fichiers qui n'existent plus : trois 404, et le
  //    navigateur retombe sur une police système sans rien dire.
  //
  //    La CSS pèse environ un kilo-octet : la mettre en cache n'apporte rien
  //    et casse tout. On la prend au réseau, avec le cache en secours pour
  //    le mode hors ligne uniquement.
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONTS_CACHE);
      try {
        const frais = await fetch(req);
        if (frais && frais.ok) cache.put(req, frais.clone()).catch(() => {});
        return frais;
      } catch (_) {
        return (await cache.match(req)) || Response.error();
      }
    })());
    return;
  }

  //    Les fichiers de police, eux, ont des URL immuables (elles contiennent
  //    une empreinte). Cache d'abord, sans réserve.
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONTS_CACHE);
      const connu = await cache.match(req);
      if (connu) return connu;
      try {
        const frais = await fetch(req);
        // Un 404 ne se met JAMAIS en cache : ce serait figer l'erreur.
        if (frais && frais.ok) cache.put(req, frais.clone()).catch(() => {});
        return frais;
      } catch (_) {
        return Response.error();
      }
    })());
    return;
  }

  // 3) HTML (navigation) : RÉSEAU D'ABORD, cache en secours
  //
  //    ⚠️ C'ÉTAIT LE BUG « MES CORRECTIFS N'ARRIVENT JAMAIS ».
  //
  //    La stratégie précédente était stale-while-revalidate : `if (cached)
  //    return cached;` renvoyait la page en cache SANS ATTENDRE, et ne
  //    rafraîchissait le cache que pour le chargement suivant. Sur un site
  //    classique c'est le bon choix — la coquille HTML change rarement et
  //    les scripts sont dans des fichiers versionnés à part.
  //
  //    Ici, non : index.html porte TOUT le JavaScript en ligne, un
  //    mégaoctet. Servir la coquille depuis le cache, c'est servir le code
  //    d'hier. Chaque correction déployée n'apparaissait qu'au deuxième
  //    chargement — et jamais du tout si l'utilisateur ne rechargeait pas
  //    deux fois d'affilée.
  //
  //    Réseau d'abord corrige ça. Le coût est nul en pratique : la page est
  //    servie par GitHub Pages en une centaine de millisecondes, et le
  //    cache reste là pour le mode hors ligne. Un délai de 4 s plafonne
  //    l'attente sur réseau lent, au-delà duquel on bascule sur le cache.
  //
  //    Et cela respecte la règle du projet : personne ne doit croire à jour
  //    une page qui ne l'est pas. Ici, la page affichée EST celle du serveur
  //    sauf coupure réseau — auquel cas le cache prend le relais, ce qui est
  //    une dégradation assumée et non un mensonge silencieux.
  const isHTML = req.mode === 'navigate' ||
                 req.headers.get('accept')?.includes('text/html');
  if (isHTML) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        const preload = await event.preloadResponse;
        const reseau = preload || await Promise.race([
          fetch(req),
          new Promise((_, rejeter) => setTimeout(() => rejeter(new Error('lent')), 4000)),
        ]);
        if (reseau && reseau.status === 200) {
          cache.put(req, reseau.clone()).catch(() => {});
        }
        return reseau;
      } catch (_) {
        // Hors ligne, ou réseau trop lent : on sert ce qu'on a.
        const cached = await cache.match(req);
        return cached || (await caches.match('./')) ||
          new Response('<h1>Hors ligne</h1><p>Reconnectez-vous pour charger le site.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // 4) Assets statiques meme origine : cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  MESSAGE HANDLER
// ─────────────────────────────────────────────────────────────────────────────
//  SKIP_WAITING : activer la nouvelle version (toast "Recharger")
//  UPDATE_BADGE : pousser un compteur depuis le front
//  PREFETCH     : précharger des URLs HTML en background
//                 → gain perçu énorme sur navigation entre pages
//  REVALIDATE   : forcer mise à jour silencieuse d'une URL HTML cachée
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // ─── GET_VERSION ─────────────────────────────────────────────────────────
  // Permet au front d'interroger un SW (actif OU waiting) pour comparer leurs
  // CACHE_VERSION. Évite les faux positifs "nouvelle version dispo" quand le
  // navigateur télécharge un sw.js identique en contenu (cache CDN GitHub Pages,
  // re-évaluation périodique, etc.).
  //
  // Usage côté front :
  //   const ch = new MessageChannel();
  //   ch.port1.onmessage = (e) => console.log('version:', e.data.version);
  //   sw.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  if (data.type === 'GET_VERSION') {
    const respond = (port) => {
      try { port.postMessage({ type: 'VERSION', version: CACHE_VERSION }); } catch(_) {}
    };
    if (event.ports && event.ports[0]) respond(event.ports[0]);
    else if (event.source) {
      // Fallback : pas de MessageChannel → on répond au client source
      try { event.source.postMessage({ type: 'VERSION', version: CACHE_VERSION }); } catch(_) {}
    }
    return;
  }

  if (data.type === 'UPDATE_BADGE') {
    _setOsBadgeSW(typeof data.count === 'number' ? data.count : 0);
    return;
  }

  // ─── Préfetch best-effort des pages adjacentes ────────────────────────────
  // Appelé par le front au load (après idle) pour avoir boutique.html /
  // admin.html déjà chauds dans le cache du SW. Ça permet de naviguer
  // entre les pages sans aucun aller-retour réseau pour le HTML.
  if (data.type === 'PREFETCH' && Array.isArray(data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(data.urls.map(async (u) => {
        try {
          const existing = await cache.match(u);
          if (existing) return; // déjà en cache, on ne refait pas
          const res = await fetch(u, { credentials: 'same-origin' });
          if (res && res.status === 200) await cache.put(u, res.clone());
        } catch(_) {}
      }));
    })());
    return;
  }

  // ─── Revalidation silencieuse ────────────────────────────────────────────
  if (data.type === 'REVALIDATE' && data.url) {
    event.waitUntil((async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const res = await fetch(data.url, { credentials: 'same-origin', cache: 'no-cache' });
        if (res && res.status === 200) await cache.put(data.url, res.clone());
      } catch(_) {}
    })());
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PUSH FCM — handler de fallback
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch(_) {
    try { payload = { data: { titre: 'US Bouloire Football', corps: event.data?.text() || '' } }; }
    catch(__) {}
  }
  const data = payload.data || {};
  const titre = data.titre || 'US Bouloire Football';
  const corps = data.corps || '';
  const url   = data.url   || './';
  const tag   = data.context_id ? (data.type + ':' + data.context_id) : (data.notif_id || data.type || 'usb');

  event.waitUntil(
    self.registration.showNotification(titre, {
      body: corps,
      icon: './icon-192.png',
      badge: './badge-mono.png',
      tag: tag,
      renotify: true,
      data: { url, type: data.type || 'info', notif_id: data.notif_id || null, context_id: data.context_id || null }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url  = data.url || './';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      try {
        if (new URL(client.url).origin === self.location.origin) {
          client.postMessage({ type: 'NOTIF_CLICK', url, payload: data });
          return client.focus();
        }
      } catch(_) {}
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

// ─────────────────────────────────────────────────────────────────────────────
//  BADGE OS — fallback periodicSync
// ─────────────────────────────────────────────────────────────────────────────

const _BG_DB_NAME = 'usb-bg';
const _BG_STORE   = 'config';

function _bgDbOpenSW(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_BG_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(_BG_STORE)) {
        db.createObjectStore(_BG_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function _bgConfigGetSW(){
  try {
    const db = await _bgDbOpenSW();
    const cfg = await new Promise((res, rej) => {
      const tx = db.transaction(_BG_STORE, 'readonly');
      const req = tx.objectStore(_BG_STORE).get('main');
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
    db.close();
    return cfg || null;
  } catch(_) { return null; }
}

function _setOsBadgeSW(n){
  try {
    if (n > 0 && 'setAppBadge' in self.navigator) {
      return self.navigator.setAppBadge(n).catch(() => {});
    } else if ('clearAppBadge' in self.navigator) {
      return self.navigator.clearAppBadge().catch(() => {});
    }
  } catch(_) {}
  return Promise.resolve();
}

// v7.5 : le SW n'a pas accès à apiPost, mais on peut simuler un POST
// en passant par fetch avec method:'POST' et body JSON — même logique
// que la bascule GET→POST faite dans index.html pour contourner le 404
// sur la double redirection googleusercontent.
async function _fetchNotifsPost(cfg){
  const body = JSON.stringify({
    action: 'get_notifs',
    email: cfg.email,
    token: cfg.token || undefined,
  });
  const r = await fetch(cfg.apiUrl, {
    method: 'POST',
    redirect: 'follow',
    body,
  });
  const txt = await r.text();
  let data;
  try { data = JSON.parse(txt); }
  catch(_) {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { data = JSON.parse(m[0]); } catch(__) {} }
  }
  return data;
}

function _isUsefulCheckWindow(now){
  now = now || new Date();
  let h;
  try {
    const fmt = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', hour: '2-digit', hour12: false
    });
    h = parseInt(fmt.format(now), 10);
  } catch(_) {
    h = now.getHours();
  }
  if (isNaN(h)) return true;
  if (h >= 23 || h < 6) return false;
  return true;
}

async function _checkNotifsBackground(){
  if (!_isUsefulCheckWindow()) return;
  const cfg = await _bgConfigGetSW();
  if (!cfg || !cfg.apiUrl || !cfg.email) return;
  try {
    const data = await _fetchNotifsPost(cfg);
    if (!data || !data.ok) return;
    const nonLues = parseInt(data.non_lues, 10) || 0;
    await _setOsBadgeSW(nonLues);
  } catch(e) {}
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-notifs') {
    event.waitUntil(_checkNotifsBackground());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'check-notifs-once') {
    event.waitUntil(_checkNotifsBackground());
  }
});
