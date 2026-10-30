# Gamins de Talus

L'app de Gamins de Talus (maraîchage à Marly), pour Noé et Nicolas : factures, finances, heures, tâches, plan de cultures, inventaire et contacts.

- App : https://gottonic.github.io/gamins-de-talus/
- Données : Supabase (projet `gamins-de-talus`), partagées entre les deux associés
- Fonctionne hors ligne : les changements partent dès que le réseau revient.
- Essai sans compte : ajouter `?local=1` à l'adresse (les données restent alors dans le navigateur).

## Modules

| Module | Ce qu'on y fait |
|---|---|
| Messages | Discussion entre associés, avec photos : non lus sur l'accueil, « vu par », notifications (appareils et/ou Discord) au choix de chacun dans Réglages → Notifications |
| Ventes | Factures QR (virement) ou payées comptant, bulletins de livraison, PDF, suivi des paiements, vente directe, stock et prix |
| Finances | Inventaire et amortissements, achats prévus. Fin d'année (chaque associé télécharge l'archive une fois) : vérifications, comptes en PDF et archive .zip (factures, justificatifs, tableaux) à garder 10 ans. Dépenses (photo du ticket ou PDF de la facture joint), recettes (les factures payées s'y ajoutent seules), résultat de l'année, décompte « qui doit quoi » entre associés et remboursements |
| Calendrier | Bouton « Enregistrer mes heures » (aujourd'hui, à mon nom) sur l'accueil. Mois en un coup d'œil : heures travaillées, jours off et vacances, journées de travail, chantiers de récolte (kg notés), livraisons et ventes (récurrentes ou non), échéances des tâches et des factures. Onglet Heures : la semaine (une case = un clic pour noter) et le bilan de l'année, agenda |
| Tâches | Tâches partagées : responsable, échéance, domaine, urgent |
| Cultures | « Nos cultures » : chaque culture se crée ici (rendement, prix, semaines, espacements, variété, fumure, notes), avec son bilan saison après saison. Le plan d'une saison les place (liste déroulante) et précise planches, longueur, récolte réelle ; corrections d'analyse de sol dans les hypothèses. Plan : planning des semaines, planches, récoltes prévues et réelles, ventes, plantons, compost, engrais |
| Irrigation | Arrosage conseillé par culture et par semaine (méthode FAO-56 : ETc = Kc × ET0 selon le stade), selon votre matériel (goutte-à-goutte, aspersion) ; pluie efficace, report d'une semaine à l'autre, heures réellement arrosées ; météo de Fribourg / Posieux mise à jour chaque jour |
| Contacts | Clients, grossistes, restauration collective, fournisseurs, partenaires (favoris). Prospection : établissements à appeler avec statut, priorité, horaires d'appel, journal des échanges, relances, pitch d'appel ; un prospect devient client en un clic |
| Réglages | Coordonnées, IBAN, associés et parts, export / import, corbeille |

## Mise en route (une seule fois)

### 1. Créer la base
Supabase → projet `gamins-de-talus` → **SQL Editor** → **New query** → coller le contenu de `supabase/schema.sql` → **Run**.

### 2. Créer les deux comptes
Supabase → **Authentication** → **Users** → **Add user** → **Create new user** : adresse e-mail + mot de passe,
cocher **Auto Confirm User**. Une fois pour Nicolas, une fois pour Noé.

Puis fermer la porte aux inconnus : **Authentication** → **Sign In / Providers** → désactiver **Allow new users to sign up**.

### 3. Relier chaque compte à sa personne
SQL Editor → nouvelle requête, en remplaçant les adresses :

```sql
insert into public.membres (user_id, personne, nom) select id, 'nicolas', 'Nicolas' from auth.users where email = 'ADRESSE-DE-NICOLAS' on conflict do nothing;
insert into public.membres (user_id, personne, nom) select id, 'noe', 'Noé' from auth.users where email = 'ADRESSE-DE-NOE' on conflict do nothing;
```

Seules les personnes de la table `membres` voient les données, même si quelqu'un d'autre arrivait à se connecter.

### Ajouter une personne plus tard (ex. Marc)
1. Dans l'app : **Réglages → Associés → Ajouter une personne**. Elle a d'abord une part de 0 (heures, tâches, calendrier seulement).
   Pour en faire un associé : sa part, la date d'entrée et, s'il y a lieu, le montant de la reprise de parts.
   Chaque dépense et recette est partagée selon les associés à sa date : le passé ne change pas.
2. Supabase → **Authentication → Users → Add user** (Auto Confirm User), puis dans le SQL Editor, avec l'identifiant affiché dans les Réglages :

```sql
insert into public.membres (user_id, personne, nom) select id, 'marc', 'Marc' from auth.users where email = 'ADRESSE-DE-MARC' on conflict do nothing;
```

### Photos et justificatifs (une fois)
SQL Editor → coller la partie « 7. Photos des messages et justificatifs » de `supabase/schema.sql` → Run.
Cela crée le stockage privé `fichiers` : seuls les membres voient et ajoutent des fichiers. Supabase n'autorise à effacer
que les photos de messages de plus de 6 mois et les justificatifs de plus de 2 ans ; l'app ne retire un justificatif
que si l'archive de son année a été téléchargée (Finances → Fin d'année).
Les photos sont réduites dans le téléphone avant l'envoi (messages : 1600 px ; justificatifs : 2600 px, lisibles comme un scan à ~200 dpi).
Les PDF passent tels quels (10 Mo au plus). L'export JSON contient les chemins, pas les fichiers : ils restent dans Supabase → Storage.

### Messages en direct (facultatif)
SQL Editor → `alter publication supabase_realtime add table public.rows;` → Run.
Les nouveaux messages apparaissent alors tout de suite chez les autres (sinon : toutes les 8 secondes dans la messagerie, chaque minute ailleurs).

### 4. Activer le site
GitHub → dépôt `gamins-de-talus` → **Settings** → **Pages** → Source : **Deploy from a branch**, branche `main`, dossier `/ (root)` → **Save**.

### 5. Reprendre les anciennes données
Se connecter, puis **Réglages → Données → Importer** et choisir le fichier de reprise (`gdt-reprise.json`, envoyé à part :
il n'est pas dans ce dépôt, qui est public). L'app affiche le contrôle des totaux avant d'importer. Ce qui existe déjà n'est jamais écrasé.

## Mise à jour du 30.10.2026 (Drive, corbeille, calendrier dans Google/Proton, mails)

1. **SQL** : Supabase → SQL Editor → coller tout `supabase/mise-a-jour-2026-10-30.sql` → Run.
   (Drive : tous types de fichiers jusqu'à 25 Mo ; corbeille vidée après 6 mois ; place utilisée.)
2. **Fonction « calendrier »** (pour voir le calendrier dans Google Agenda, Proton…) : Supabase → Edge Functions →
   **Deploy a new function** → **Via Editor** → nom `calendrier` → coller `supabase/functions/calendrier/index.ts` → Deploy.
   Puis dans les réglages de la fonction : désactiver **Verify JWT** (les agendas ne peuvent pas se connecter ; c'est le jeton
   personnel dans l'adresse qui protège). Dans l'app : Calendrier → Agenda → « Dans mon agenda ».
3. **Fonction « mails »** : même chose avec le nom `mails` et `supabase/functions/mails/index.ts`, Verify JWT désactivé
   (la fonction vérifie elle-même que l'appel vient d'un membre). Puis Edge Functions → **Secrets** :
   `IMAP_USER` = l'adresse (ex. info@gaminsdetalus.ch), `IMAP_PASSWORD` = son mot de passe (idéalement un mot de passe
   d'application Infomaniak), et si vous voulez la relève automatique : `CRON_SECRET` = une longue phrase au hasard,
   puis la partie 6 du fichier SQL (avec ce secret). Sans ça, la boîte est relevée quand quelqu'un ouvre l'app.

### Historique allégé (30.10.2026, 2e partie)
Supabase → SQL Editor → coller tout `supabase/mise-a-jour-2026-10-30-historique.sql` → Run. Les marques « lu »,
l'état des mails, l'irrigation de la semaine et la date de sauvegarde ne sont plus copiés dans l'historique (et les copies
déjà accumulées sont effacées). Rien d'autre n'est touché.

### Envoyer les factures par mail depuis l'app
Recoller `supabase/functions/mails/index.ts` dans la fonction `mails` et redéployer. L'envoi passe par le SMTP d'Infomaniak
(port 465) avec les mêmes secrets `IMAP_USER` / `IMAP_PASSWORD` ; une copie est rangée dans « Envoyés ».

### Notifications sur téléphone et ordinateur (30.10.2026, 3e partie)
1. Supabase → Edge Functions → **Deploy a new function** → **Via Editor** → nom `notifier` → coller
   `supabase/functions/notifier/index.ts` → Deploy, puis désactiver **Verify JWT**.
2. Edge Functions → **Secrets** : `VAPID_PRIVATE` = la clé privée VAPID (envoyée à part, jamais dans ce dépôt public).
   `CRON_SECRET` existe déjà (relève des mails).
3. SQL Editor : `supabase/mise-a-jour-2026-10-30-notifications.sql`, avec `LE-SECRET` remplacé par la valeur de `CRON_SECRET`.
4. Dans l'app, sur chaque appareil : **Réglages → Notifications → Activer sur cet appareil**, puis « Envoyer un test ».
   Sur iPhone, il faut d'abord ajouter l'app à l'écran d'accueil (Partager → Sur l'écran d'accueil).

## Installer l'app

- **Téléphone** : ouvrir l'adresse dans le navigateur → menu → **Installer** ou **Ajouter à l'écran d'accueil**.
- **Ordinateur** : dans Chromium, Brave ou Vivaldi → icône d'installation dans la barre d'adresse.

Se connecter une fois par appareil.

## Sécurité des données

- **Corbeille** : supprimer met l'élément dans la corbeille (Réglages → Données), d'où on peut le restaurer pendant 6 mois ;
  ensuite Supabase l'efface pour de bon, historique compris. L'app elle-même n'a pas le droit d'effacer une ligne de la base.
  Messages : à la corbeille au bout de 3 mois (sauf épinglés).
- **Historique complet** : chaque version de chaque élément (qui, quand, quoi) est gardée dans la table `rows_history`,
  que personne ne peut modifier depuis l'app. Utile pour retrouver une ancienne valeur : Supabase → Table Editor → `rows_history`.
- **Hors ligne** : chaque appareil garde une copie ; les changements en attente partent au retour du réseau
  (indicateur en haut à droite : Enregistré, Envoi…, Hors ligne, Problème).
- **Sauvegarde chez soi** : Réglages → Données → **Exporter tout** (fichier JSON). À faire de temps en temps, par exemple chaque mois.
- **Deux personnes en même temps** : chaque facture, dépense, heure, tâche… est une ligne séparée, donc on peut travailler
  à deux sans s'écraser. Si deux factures reçoivent le même numéro (créées hors ligne au même moment), l'app le signale
  et propose de renuméroter.

## Bon à savoir

- Météo : `.github/workflows/meteo.yml` télécharge chaque jour l'ET0 et la pluie de la station MeteoSwiss Fribourg / Posieux
  (données ouvertes, `scripts/meteo.py`) dans `meteo/posieux.json`. Ce commit quotidien garde aussi le dépôt actif.

- GitHub envoie un signal à la base deux fois par semaine pour qu'elle ne se mette pas en veille
  (`.github/workflows/garder-eveille.yml`). GitHub arrête ces signaux après 60 jours sans modification du dépôt :
  dans ce cas, Actions → « Garder Supabase éveillé » → **Enable workflow**.
- Les clés présentes dans le code (adresse du projet, clé « publishable ») sont faites pour être publiques.
  Ne jamais mettre ici la clé « secret / service_role » ni le mot de passe de la base.
- Après une modification du code, changer `VERSION` dans `sw.js` pour que les appareils prennent la nouvelle version.

## Organisation du code

Pas d'étape de compilation : `index.html` (page et styles) + des scripts dans `js/`.

- `js/calc.js` : tous les calculs (décompte entre associés, amortissements, cultures, heures), sans écran
- `js/core.js` : données, synchro Supabase, outils d'affichage communs
- `js/pdf.js` : facture A4 avec section paiement QR
- `js/m-*.js` : un fichier par module
- `lib/` : Supabase, jsPDF, qrcode-generator (copiés pour fonctionner hors ligne)

Chaque élément est une ligne `clé → contenu JSON` dans la table `rows`. Préfixes des clés :
`cfg:` réglages, `ct:` contacts, `prod:` produits, `fac:` factures, `dep:` dépenses, `rec:` recettes,
`reg:` remboursements, `h:AAAA-MM-JJ:personne` heures, `jour:` remarques du jour, `t:` tâches,
`cul:` cultures, `inv:` inventaire, `achat:` achats prévus, `ev:` événements du calendrier,
`fiche:` fiches de culture (avec `irr` : Kc et stades), `irr:` semaines d'irrigation, `msg:` messages, `lu:` jusqu'où chacun a lu, `cfg:discord:personne` webhook Discord de chacun.
