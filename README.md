# Gamins de Talus

L'app de Gamins de Talus (maraîchage à Marly), pour Noé et Nicolas : factures, finances, heures, tâches, plan de cultures, inventaire et contacts.

- App : https://gottonic.github.io/gamins-de-talus/
- Données : Supabase (projet `gamins-de-talus`), partagées entre les deux associés
- Fonctionne hors ligne : les changements partent dès que le réseau revient.
- Essai sans compte : ajouter `?local=1` à l'adresse (les données restent alors dans le navigateur).

## Modules

| Module | Ce qu'on y fait |
|---|---|
| Factures | Factures QR (virement) ou payées comptant, PDF, suivi des paiements, produits et prix |
| Finances | Dépenses, recettes (les factures payées s'y ajoutent seules), résultat de l'année, décompte « qui doit quoi » entre associés et remboursements |
| Calendrier | Mois en un coup d'œil : heures travaillées, jours off et vacances, journées de travail, chantiers de récolte (kg notés), livraisons et ventes (récurrentes ou non), échéances des tâches et des factures. Saisie des heures à la semaine, agenda, bilan des heures |
| Tâches | Tâches partagées : responsable, échéance, domaine, urgent |
| Cultures | Plan par saison modifiable directement dans le tableau : planning des semaines, planches, récoltes prévues et réelles, ventes, plantons, compost, engrais |
| Inventaire | Objets amortis (dégressif) et achats prévus |
| Contacts | Clients, grossistes, fournisseurs, partenaires |
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

### 4. Activer le site
GitHub → dépôt `gamins-de-talus` → **Settings** → **Pages** → Source : **Deploy from a branch**, branche `main`, dossier `/ (root)` → **Save**.

### 5. Reprendre les anciennes données
Se connecter, puis **Réglages → Données → Importer** et choisir le fichier de reprise (`gdt-reprise.json`, envoyé à part :
il n'est pas dans ce dépôt, qui est public). L'app affiche le contrôle des totaux avant d'importer. Ce qui existe déjà n'est jamais écrasé.

## Installer l'app

- **Téléphone** : ouvrir l'adresse dans le navigateur → menu → **Installer** ou **Ajouter à l'écran d'accueil**.
- **Ordinateur** : dans Chromium, Brave ou Vivaldi → icône d'installation dans la barre d'adresse.

Se connecter une fois par appareil.

## Sécurité des données

- **Rien n'est effacé définitivement** : supprimer met l'élément dans la corbeille (Réglages → Données), d'où on peut le restaurer.
  L'app n'a d'ailleurs pas le droit d'effacer une ligne de la base.
- **Historique complet** : chaque version de chaque élément (qui, quand, quoi) est gardée dans la table `rows_history`,
  que personne ne peut modifier depuis l'app. Utile pour retrouver une ancienne valeur : Supabase → Table Editor → `rows_history`.
- **Hors ligne** : chaque appareil garde une copie ; les changements en attente partent au retour du réseau
  (indicateur en haut à droite : Enregistré, Envoi…, Hors ligne, Problème).
- **Sauvegarde chez soi** : Réglages → Données → **Exporter tout** (fichier JSON). À faire de temps en temps, par exemple chaque mois.
- **Deux personnes en même temps** : chaque facture, dépense, heure, tâche… est une ligne séparée, donc on peut travailler
  à deux sans s'écraser. Si deux factures reçoivent le même numéro (créées hors ligne au même moment), l'app le signale
  et propose de renuméroter.

## Bon à savoir

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
`cul:` cultures, `inv:` inventaire, `achat:` achats prévus, `ev:` événements du calendrier.
