# US Bouloire Football — site copié depuis le site basket

Ce dossier contient le site foot, copie du site USBouloire Basket avec :
- le nom du club, les couleurs (bleu #0d2f6b / rouge #d62828), le ballon ⚽ et le vocabulaire foot (stade, FFF, buts…) ;
- les catégories foot : U6-U7, U8-U9, U10-U11, U13, U15, U18, Seniors, Vétérans (35 ans et +), Loisirs ;
- des icônes provisoires (bleu / rouge avec « USB ») — à remplacer par le vrai logo quand tu l'as ;
- TOUS les identifiants techniques du basket retirés (classeur, script, Firebase, clé privée).
  Tant qu'ils ne sont pas remplis, le site tourne en **mode démo** avec des données fictives.

## Ce qui manque encore (à demander à ton père)
- `usb-common.js` et `usb-common.css` : le site basket les charge, ils n'étaient pas dans le zip. Sans eux, la connexion et la boutique ne marchent pas. Il faut les copier tels quels dans ce dossier.

## À remplir dans les fichiers (cherche le mot `A-REMPLIR` ou `À REMPLIR`)
| Où | Quoi |
|---|---|
| `index.html`, ligne ~6186 | `APPS_SCRIPT_URL` : l'adresse du script (étape 3 ci-dessous) |
| `admin.html`, ligne ~2321 | même `APPS_SCRIPT_URL` |
| `gs.txt`, ligne ~157 | `SHEET_CENTRAL_ID` : l'identifiant du classeur Google Sheets (étape 1) |
| `gs.txt`, ligne ~158 | `EMAIL_CLUB` : l'email du club |
| `index.html`, page Contact (ligne ~5100) | email, téléphone, noms du bureau, page Facebook |
| `index.html`, ligne ~7657 | Firebase (uniquement pour les notifications push — peut attendre) |
| `gs.txt`, ligne ~12685 | Firebase, clé du compte de service (idem, peut attendre) |
| `gs.txt` + `boutique.html` | lien HelloAsso pour payer la licence (`A-REMPLIR-page-helloasso-du-club`) |

## Installation, étape par étape (tout à la souris)

### 1. Le classeur Google Sheets
1. Va sur sheets.google.com, connecté avec le compte Google qui servira au club.
2. Crée un classeur vide, appelle-le « US Bouloire Football — données ».
3. Dans l'adresse de la page, copie la longue suite de lettres entre `/d/` et `/edit` : c'est l'ID du classeur. Colle-le dans `gs.txt` à la place de `A_REMPLIR_ID_DU_CLASSEUR_GOOGLE_SHEETS`.

### 2. Le script Apps Script
1. Dans le classeur : menu **Extensions → Apps Script**.
2. Efface le contenu de `Code.gs`, puis colle TOUT le contenu de `gs.txt` (une fois l'ID rempli).
3. Clique sur 💾 Enregistrer.
4. En haut, dans la liste déroulante des fonctions, choisis `_admin_setup_TOUT` puis ▶️ **Exécuter**. Google demande des autorisations : accepte. Ça crée tous les onglets du classeur.
5. Ensuite, choisis `_admin_seedEquipes` et ▶️ Exécuter : ça crée les équipes de départ.
6. Puis `_admin_setupAdminsSheet` et ▶️ Exécuter : regarde en bas dans **Journal d'exécution**, le mot de passe du compte `admin` y est affiché UNE SEULE FOIS. Note-le.
7. Enfin `installerMaintienAuChaud` et ▶️ Exécuter (ça garde le script réactif dans la journée).

### 3. Mettre le script en ligne
1. En haut à droite : **Déployer → Nouveau déploiement**.
2. Roue crantée à côté de « Sélectionner le type » → **Application Web**.
3. « Exécuter en tant que » : **Moi**. « Qui a accès » : **Tout le monde**.
4. Clique **Déployer**, puis copie l'**URL de l'application Web** (elle finit par `/exec`).
5. Colle cette URL dans `index.html` et `admin.html` à la place de `VOTRE_URL_APPS_SCRIPT`.

⚠️ À chaque fois que tu modifies `gs.txt` plus tard : Déployer → **Gérer les déploiements** → crayon ✏️ → Version : **Nouvelle version** → Déployer. L'URL ne change pas.

### 4. Le site sur GitHub Pages
1. Sur github.com, crée un nouveau dépôt (par exemple `usbouloire-foot`), **Public**.
2. **Add file → Upload files** : glisse tous les fichiers de ce dossier (sauf ce guide si tu veux), puis **Commit changes**. Fais-le en une seule fois, pas fichier par fichier.
3. **Settings → Pages → Branch : main → Save**. Au bout d'une minute, l'adresse du site s'affiche en haut.

### 5. Première connexion
- Site : l'adresse GitHub Pages.
- Admin : la même adresse suivie de `/admin.html`, compte `admin` + le mot de passe noté à l'étape 2.

## Bon à savoir
- Les notifications push (Firebase) et le paiement HelloAsso sont désactivés tant que leurs identifiants ne sont pas remplis : le reste du site fonctionne normalement.
- Le lien Instagram est mis à `instagram.com/usbouloire` par défaut, mais je n'ai pas vérifié qu'il existe : à corriger si besoin dans `index.html`.
- L'adresse du stade est mise « Rue du Jeu de Paumes, 72440 Bouloire (à vérifier) » : à corriger avec la vraie adresse.
