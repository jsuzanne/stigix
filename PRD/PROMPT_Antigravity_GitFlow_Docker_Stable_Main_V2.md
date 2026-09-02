# Prompt — Google Antigravity / Gemini Flash High

Copiez-collez le prompt ci-dessous dans Google Antigravity. Si Antigravity permet d’attacher un dépôt, sélectionnez le dépôt Stigix et autorisez-le à analyser les workflows GitHub Actions, Dockerfiles, fichiers Compose, scripts de build et documentation existants avant toute modification.

---

```text
Tu es un senior DevOps engineer, release manager et mainteneur open-source expérimenté. Tu maîtrises Git/GitHub, GitHub Actions, Docker Buildx, Docker Hub, Docker Compose, Node.js/TypeScript et les stratégies de release reproductibles.

Tu travailles sur le dépôt Stigix. Ton objectif est de mettre en place, de bout en bout, un workflow Git + Docker simple, robuste et réellement utilisable pour ce projet.

# Objectif de branchement et publication

Je veux le modèle suivant :

```text
main  = branche stable, prête à être publiée
v2    = branche de développement actif et continu de la prochaine version
feature/* = branches courtes facultatives pour les gros sujets
```

Règles attendues :

1. `main` ne contient que des versions validées et stables.
2. L’image Docker `:latest` est publiée UNIQUEMENT à partir de `main`.
3. La branche `v2` reste ma branche de développement actif après chaque promotion vers `main`.
4. Les pushes ou merges vers `v2` doivent produire une image de test clairement identifiée, typiquement `:v2` et un tag lié au commit.
5. Les pushes ou merges vers `main` doivent produire une image stable, au minimum `:latest` et un tag lié au commit.
6. Lorsqu’une release Git est créée avec un tag SemVer `vX.Y.Z`, les images doivent recevoir les tags `vX.Y.Z`, `vX.Y` et éventuellement `vX` si cela est cohérent avec les pratiques du dépôt.
7. Tous les tags Docker importants doivent être traçables vers le commit Git source.
8. Le système doit permettre un rollback simple vers une version ou un commit identifié.
9. Aucun secret Docker Hub ou GitHub ne doit être écrit dans le dépôt, dans les logs, ou dans la documentation sous forme de valeur réelle.
10. Ne modifie jamais ni ne supprime des données, branches, tags, images ou releases existantes sans demander une confirmation explicite et distincte.

# Important : mode d’exécution

Tu dois d’abord analyser le dépôt avant toute modification. Ensuite, applique les changements nécessaires de manière prudente et minimale.

Ne fais pas de suppositions sur :
- le nom exact des images Docker ;
- le registry utilisé ;
- l’existence d’un Dockerfile ;
- l’existence de GitHub Actions ;
- le gestionnaire de paquets Node ;
- les commandes de build et de test ;
- le format de version actuel ;
- les tags Docker déjà utilisés.

Inspecte le dépôt et tire ces informations des fichiers réellement présents.

# Phase 1 — Audit du dépôt

Commence par examiner au minimum :

```text
README.md
package.json
package-lock.json / yarn.lock / pnpm-lock.yaml si présents
Dockerfile(s)
docker-compose*.yml / compose*.yml
.github/workflows/*
.gitignore
CHANGELOG.md
scripts de build, release ou publish
configuration existante de registry ou tags Docker
```

Produis un rapport d’audit concis avec :

1. Les branches et la stratégie Git actuellement visibles, si accessibles.
2. Les images Docker réellement construites et leurs noms actuels.
3. Les Dockerfiles et contextes de build existants.
4. Les services Docker concernés, par exemple UI, traffic generator, voice echo, XFR target ou autres composants réellement présents.
5. Les workflows CI/CD existants et leurs déclencheurs.
6. Les commandes réelles pour installer, lint, tester, builder et lancer le projet.
7. Les mécanismes de versioning déjà présents.
8. Les risques, incohérences ou informations manquantes.

Ne propose pas encore de gros changements avant ce rapport.

# Phase 2 — Plan de mise en œuvre

Après l’audit, propose un plan d’implémentation précis, avec des changements minimaux et adaptés au dépôt réel.

Le plan doit détailler :

- Quels fichiers créer ou modifier.
- Pourquoi chaque changement est nécessaire.
- Les déclencheurs GitHub Actions proposés.
- Les tags Docker générés pour `main`, `v2`, pull requests et tags Git.
- Les secrets GitHub à créer manuellement.
- Les étapes de test locales et CI.
- Les éventuelles règles de protection recommandées pour `main`.
- La procédure de release et de rollback.

Avant de réaliser toute opération irréversible à distance (push, création de tag Git, création de release, modification de paramètres de dépôt, suppression, publication d’image), présente un récapitulatif et demande mon accord explicite.

# Phase 3 — Implémentation attendue

Une fois le plan validé, implémente les fichiers nécessaires.

## A. GitHub Actions : CI de validation

Crée ou améliore un workflow de CI qui s’exécute au minimum lors :

- de chaque pull request vers `v2` et `main` ;
- de chaque push sur `v2` ;
- de chaque push sur `main`.

Le workflow doit :

1. Checkout avec historique suffisant si les tags/version sont nécessaires.
2. Détecter le gestionnaire de packages réellement utilisé.
3. Installer les dépendances de manière reproductible.
4. Exécuter lint si un script existe.
5. Exécuter tests si un script existe.
6. Exécuter le build si un script existe.
7. Construire les images Docker sans les publier lors des pull requests.
8. Utiliser le cache Buildx/GitHub Actions lorsque c’est pertinent.
9. Échouer clairement si une étape essentielle échoue.
10. Ne pas rendre le workflow fragile lorsque certains scripts n’existent pas : dans ce cas, afficher clairement que l’étape est ignorée parce qu’elle n’est pas configurée dans le dépôt.

## B. GitHub Actions : publication Docker

Crée ou améliore un workflow séparé de publication Docker avec les règles suivantes.

### Push ou merge vers `v2`

Publier des images de développement avec :

```text
:v2
:sha-<short-git-sha>
```

Optionnellement, ajouter un tag de branche normalisé si cela aide, mais ne jamais utiliser `:latest` depuis `v2`.

### Push ou merge vers `main`

Publier des images stables avec :

```text
:latest
:sha-<short-git-sha>
```

Ne pas créer automatiquement un tag de version SemVer à partir de `main` sans action explicite de release, sauf si le dépôt possède déjà une convention documentée qui le fait.

### Push d’un tag Git SemVer `vX.Y.Z`

Publier les tags Docker :

```text
:vX.Y.Z
:vX.Y
:vX
:sha-<short-git-sha>
```

Conserver aussi `:latest` uniquement si ce tag pointe sur le commit actuellement promu dans `main`. Si ce point est difficile à garantir automatiquement et sans ambiguïté, ne déplace pas `:latest` sur l’événement de tag : laisse `main` seul responsable de `:latest` et documente clairement ce choix.

### Pull requests

Ne publie jamais `:latest`, `:v2` ou une version stable depuis une pull request. Construis seulement pour validation. Si une image PR est souhaitable, utilise un tag clairement éphémère du type `pr-<number>` et seulement si le registry/projet le permet ; sinon, ne publie rien.

## C. Multi-images Docker

Stigix peut comporter plusieurs images et Dockerfiles. Détecte la réalité du dépôt, puis applique une stratégie cohérente à chaque image.

Pour chaque image réellement maintenue :

- Construis le bon Dockerfile avec le bon contexte.
- Ajoute les tags de branche/release cohérents.
- Ajoute des labels OCI :

```text
org.opencontainers.image.source
org.opencontainers.image.revision
org.opencontainers.image.created
org.opencontainers.image.version
```

- Ne casse pas les noms d’images déjà consommés par les utilisateurs sans raison forte.
- Si le dépôt ne peut pas construire toutes les images avec le même contexte, utilise une matrix GitHub Actions ou des jobs distincts, de façon lisible et maintenable.

## D. Versioning et releases

Propose et implémente, si cela s’intègre proprement avec le dépôt, une stratégie simple :

```text
Git branches : main stable, v2 développement
Git tag : vX.Y.Z pour une release immuable
Docker : latest depuis main, v2 depuis v2, version/tag SHA pour traçabilité
```

Ajoute une documentation de release expliquant :

1. Comment préparer une release depuis `v2`.
2. Comment promouvoir `v2` vers `main`.
3. Comment créer un tag Git annoté `vX.Y.Z`.
4. Comment vérifier les images Docker publiées.
5. Comment déployer une version stable avec un tag précis.
6. Comment revenir à une version antérieure.
7. Pourquoi ne pas utiliser `:latest` comme seul mécanisme de rollback.

Ne crée aucun tag Git, aucune GitHub Release et ne pousse aucune image de release pendant cette tâche sans mon accord explicite.

## E. Documentation opérationnelle

Crée ou mets à jour une documentation claire, par exemple `docs/RELEASE_WORKFLOW.md` ou un document équivalent selon les conventions existantes.

Elle doit contenir :

- Le schéma des branches.
- Un diagramme Mermaid du flux feature → v2 → main.
- Les règles de tags Docker.
- Des tableaux distinguant image stable, image de développement, image versionnée et image SHA.
- Les commandes Git usuelles et sûres.
- Les commandes de test local et de build local correspondant au dépôt réel.
- Des exemples de `docker pull` et de déploiement avec un tag immuable.
- La procédure de rollback.
- La liste des secrets à créer dans GitHub, sans valeur de secrets.
- Des avertissements sur les tags mutables, notamment `latest` et `v2`.

Utilise un français clair dans la documentation, sauf si le dépôt est déjà intégralement documenté en anglais et possède une convention établie : dans ce cas, conserve la langue dominante du dépôt.

# Convention souhaitée de tags

Adapte les préfixes et noms d’images aux conventions existantes, mais conserve l’intention suivante :

| Événement Git | Tags Docker attendus | Usage |
|---|---|---|
| Pull request | Build uniquement, aucun tag stable | Validation CI |
| Push sur `feature/*` | Build CI uniquement par défaut | Développement isolé |
| Push sur `v2` | `v2`, `sha-<short-sha>` | Lab et validation de la prochaine version |
| Push sur `main` | `latest`, `sha-<short-sha>` | Image stable par défaut |
| Tag Git `vX.Y.Z` | `vX.Y.Z`, `vX.Y`, `vX`, `sha-<short-sha>` | Release reproductible et rollback |

Si plusieurs images sont publiées, les tags doivent être appliqués à chacune des images concernées.

# Protection de main

Si Antigravity a la capacité de recommander des réglages GitHub mais pas de les appliquer sans une action explicite, prépare les instructions précises pour activer :

- Pull request obligatoire avant merge vers `main`.
- CI obligatoire avant merge.
- Interdiction de force-push sur `main`.
- Optionnel : approbation obligatoire, si le projet a plusieurs contributeurs.
- Restriction des pushes directs vers `main`.

Ne modifie pas les règles de protection à distance sans mon accord explicite.

# Gestion des secrets

Le workflow doit utiliser des secrets GitHub, jamais des valeurs hardcodées.

Détermine, selon le registry réellement utilisé, les secrets ou permissions nécessaires. Par exemple, pour Docker Hub, documente une approche de type :

```text
DOCKERHUB_USERNAME
DOCKERHUB_TOKEN
```

Pour GHCR, privilégie les permissions `packages: write` avec `GITHUB_TOKEN` si cela est adapté au dépôt.

Ne révèle jamais un secret dans une sortie, un exemple de workflow, une commande shell ou un fichier de documentation.

# Qualité des workflows

Les workflows doivent :

- Utiliser des actions maintenues et des versions majeures stables.
- Employer les permissions GitHub minimales nécessaires.
- Éviter les déclenchements en double inutiles.
- Utiliser `concurrency` lorsque cela évite que plusieurs publications de la même branche se chevauchent.
- Générer des métadonnées Docker de manière fiable, idéalement avec `docker/metadata-action` lorsque pertinent.
- Employer `docker/setup-buildx-action`, `docker/login-action` et `docker/build-push-action` si approprié.
- Ne jamais pousser une image si les tests/build obligatoires ont échoué.
- Être lisibles, commentés avec parcimonie, et maintenables par une personne seule.

# Vérification finale obligatoire

Après les changements locaux proposés ou appliqués, exécute les validations disponibles dans le dépôt :

- vérification YAML des workflows si possible ;
- installation des dépendances avec le gestionnaire détecté ;
- lint si disponible ;
- tests si disponibles ;
- build applicatif si disponible ;
- build Docker local sans push, au moins pour chaque Dockerfile impacté ;
- vérification que les tags produits correspondent exactement à la stratégie demandée.

Présente ensuite un rapport final contenant :

1. Les fichiers créés et modifiés.
2. Les comportements CI/CD mis en place.
3. Les tags Docker produits selon chaque événement Git.
4. Les secrets/permis GitHub que je dois configurer manuellement.
5. Les commandes exactes pour mon workflow quotidien : développement sur `v2`, test, promotion de `v2` vers `main`, tag de release et rollback.
6. Les validations exécutées et leur résultat.
7. Les points qui nécessitent ma décision ou mon autorisation.

# Commandes Git de référence à documenter

Le workflow souhaité est :

```bash
# Développement quotidien
git switch v2
git pull origin v2
# modifier, tester, commit, push

# Promotion stable lorsque v2 est validée
git switch main
git pull origin main
git merge --ff-only v2
git push origin main

# Retour immédiat au développement
git switch v2
```

Si l’état réel des branches ne permet pas `--ff-only`, explique pourquoi et propose la solution la moins risquée. Ne résous jamais un conflit par suppression arbitraire de code.

# Interdictions

- Ne supprime aucune branche, tag, image, release, fichier ou workflow existant sans confirmation explicite.
- Ne force-push jamais.
- Ne pousse jamais directement sur `main` sans une action de promotion explicitement demandée.
- Ne publie jamais `:latest` depuis `v2`, une feature branch ou une pull request.
- Ne mets jamais de secrets dans le code ou les logs.
- Ne change pas les noms d’images Docker existants sans expliquer la compatibilité et demander confirmation.
- Ne crée pas une GitHub release ou un tag de version sans confirmation explicite.

Commence maintenant par la Phase 1 : audit du dépôt, puis attends mon accord avant les modifications qui publient, poussent ou changent un état distant.
```

---

## Utilisation conseillée

1. Ouvrez le dépôt Stigix dans Google Antigravity et autorisez l’analyse des fichiers.
2. Collez le prompt complet ci-dessus.
3. Laissez Gemini produire l’audit du dépôt et le plan avant toute action.
4. Vérifiez surtout les noms des images et les Dockerfiles détectés : le prompt interdit à Gemini de les deviner.
5. Donnez votre accord uniquement après revue du plan de fichiers et des workflows proposés.
6. Configurez les secrets de registry uniquement dans les paramètres GitHub (`Settings → Secrets and variables → Actions`), jamais dans le dépôt.

## Résultat visé

```text
feature/*  →  v2  →  main
                  │      │
                  │      └── images stables :latest + :sha-...
                  │
                  └── image de lab :v2 + :sha-...

Git tag vX.Y.Z  →  images immuables :vX.Y.Z (+ vX.Y / vX si retenu)
```
