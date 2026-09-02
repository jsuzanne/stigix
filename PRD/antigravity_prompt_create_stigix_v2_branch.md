# Prompt Antigravity — Créer et préparer la branche Stigix V2

Tu travailles dans le dépôt GitHub :

```text
jsuzanne/stigix
```

## Objectif

Créer une branche longue durée nommée **`v2`**, basée sur le dernier état de `main`, puis préparer le workflow GitHub Actions Docker afin que :

- tous les prochains commits de développement soient réalisés et poussés sur `v2` ;
- `main` reste la branche V1 stable et ne soit jamais modifiée directement ;
- chaque push sur `v2` construise et publie les images Docker de test V2 ;
- les images V2 utilisent les tags Docker `v2` et `v2-<short-sha>` ;
- aucun push sur `v2` ne publie ou n’écrase les tags `stable` ou `latest`.

Cette branche V2 servira notamment au développement de la fonctionnalité Video Experience / Receiver Proxy, ainsi qu’aux évolutions futures multi-instance, global configuration, registry, provisioning et remote control.

## Règles strictes

- Ne jamais commit directement sur `main`.
- Ne jamais merger `v2` vers `main`.
- Ne jamais créer de Pull Request sans instruction explicite ultérieure.
- Ne jamais supprimer ou renommer `main`.
- Ne jamais utiliser `git push --force` sur `main` ou `v2`.
- Ne jamais publier les tags Docker `stable` ou `latest` depuis `v2`.
- Ne jamais afficher, modifier, exposer ou committer de secrets, tokens ou credentials de registry.
- Préserver le comportement actuel de build/publication de `main`.

## Étape 1 — Vérifier l’état local et distant

Exécuter d’abord :

```bash
git status
git remote -v
git fetch origin --prune
git branch -a
git log --oneline -5 origin/main
```

Si le répertoire de travail contient des modifications non commit, ne pas les écraser. Les signaler clairement et s’arrêter avant toute opération risquée.

## Étape 2 — Créer la branche v2 depuis main

Créer `v2` à partir du dernier `origin/main` avec les commandes suivantes :

```bash
git checkout main
git pull --ff-only origin main
git checkout -b v2
git push -u origin v2
```

Puis vérifier :

```bash
git status
git branch -vv
git log --oneline -3
```

Le résultat attendu est :

```text
* v2 <sha> [origin/v2] ...
  main <sha> [origin/main] ...
```

À partir de ce point, tous les développements ultérieurs doivent être faits sur `v2`.

## Étape 3 — Adapter GitHub Actions pour les tags Docker V2

Analyser le workflow existant :

```text
.github/workflows/build-stigix-allinone.yml
```

Adapter ce workflow **uniquement sur la branche `v2`** afin de supporter un build et une publication Docker automatiques lorsque des commits sont poussés sur `v2`.

### Comportement obligatoire

#### Push sur main

Le workflow doit conserver son comportement actuel pour `main`, notamment ses tags Docker existants. Ne pas modifier involontairement la publication V1.

#### Push sur v2

Un push sur `v2` doit :

1. déclencher le workflow Docker ;
2. construire les images déjà construites par le workflow existant, au minimum `sdwan-web-ui` ;
3. publier les tags de lab :

```text
v2
v2-<short-sha>
```

Exemple attendu :

```text
jsuzanne/sdwan-web-ui:v2
jsuzanne/sdwan-web-ui:v2-a1b2c3d
```

Si le workflow publie également `sdwan-traffic-gen`, appliquer une convention homogène :

```text
jsuzanne/sdwan-traffic-gen:v2
jsuzanne/sdwan-traffic-gen:v2-a1b2c3d
```

4. ne jamais publier `stable`, `latest`, ou un tag de release V1 depuis `v2` ;
5. conserver la plateforme existante du workflow, notamment `linux/amd64` si elle est définie ;
6. conserver les mécanismes existants de login au registry et les secrets GitHub Actions sans les modifier inutilement.

### Pull Requests

Si le workflow contient déjà un déclencheur `pull_request`, le conserver. Les PRs peuvent builder/tester sans publication d’image. Ne pas ouvrir de PR dans cette tâche.

### Implémentation préférée

Adopter une logique explicite et lisible par branche, par exemple :

```yaml
on:
  push:
    branches:
      - main
      - v2
```

Puis produire les tags conditionnellement selon `github.ref` :

```yaml
# main : conserver les tags existants
# v2   : publier seulement v2 et v2-<short-sha>
```

Ne pas supposer que cet extrait peut être copié tel quel : adapter exactement la solution à la structure, aux images et aux actions déjà utilisées dans le workflow existant.

## Étape 4 — Valider le workflow sans toucher main

Après modification du workflow :

1. vérifier sa syntaxe YAML ;
2. relire précisément les conditions de tags Docker ;
3. confirmer que `main` conserve ses tags actuels ;
4. confirmer que `v2` ne peut publier que `v2` et `v2-<short-sha>` ;
5. vérifier qu’aucun secret n’a été ajouté dans le repository ;
6. exécuter les tests/lint existants si disponibles et applicables.

## Étape 5 — Commit et push sur v2

Ajouter uniquement les changements nécessaires, puis créer un commit clair :

```bash
git add .github/workflows/build-stigix-allinone.yml
git commit -m "ci(docker): publish v2 development tags"
git push origin v2
```

Si des ajustements de documentation sont nécessaires pour décrire les tags V2, les inclure dans un commit séparé :

```bash
git add <documentation-files>
git commit -m "docs: document v2 Docker development tags"
git push origin v2
```

Ne committer aucun fichier non lié, fichier local, `.env`, credential, artefact de build ou configuration spécifique à une machine.

## Étape 6 — Vérifier la publication

Après le push, vérifier dans GitHub Actions que le workflow déclenché depuis la branche `v2` :

- a bien démarré ;
- a terminé avec succès ;
- a construit l’image attendue ;
- a publié le tag `v2` ;
- a publié le tag `v2-<short-sha>` ;
- n’a pas publié ni modifié `stable` ou `latest`.

Si l’accès au registry ou à l’interface Actions n’est pas disponible, indiquer les vérifications que l’opérateur doit réaliser manuellement, sans prétendre que la publication est confirmée.

## Commandes de déploiement lab attendues

À titre de résultat final, fournir les commandes recommandées pour déployer la dernière V2 sur BR5 et BR8 :

```bash
docker compose pull web-ui
docker compose up -d --no-deps web-ui
```

avec une configuration compose de ce type :

```yaml
services:
  web-ui:
    image: jsuzanne/sdwan-web-ui:v2
```

Pour une version immuable et reproductible, indiquer également :

```yaml
services:
  web-ui:
    image: jsuzanne/sdwan-web-ui:v2-<short-sha>
```

Utiliser le tag SHA réellement créé par le workflow, et ne pas inventer de SHA.

## Rapport final obligatoire

À la fin, fournir un rapport synthétique mais précis contenant :

1. Le SHA de `origin/main` utilisé comme base de `v2`.
2. Le nom de la branche créée : `v2`.
3. Le dernier commit SHA de `v2`.
4. Les fichiers modifiés.
5. La description exacte des changements au workflow GitHub Actions.
6. Les tags Docker attendus sur un push V2.
7. La confirmation explicite que `main`, `stable` et `latest` n’ont pas été modifiés par cette tâche.
8. Le résultat des tests/lint effectués.
9. Le statut du workflow GitHub Actions et de la publication Docker, ou les vérifications manuelles restantes.
10. Les commandes de déploiement lab BR5/BR8 avec `v2` et avec le tag SHA immuable.

Ne pas commencer le développement de la fonctionnalité vidéo dans cette tâche. Cette tâche s’arrête après la création de `v2`, l’adaptation contrôlée de la CI Docker et la validation du pipeline V2.
