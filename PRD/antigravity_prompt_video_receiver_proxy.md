# Prompt pour Antigravity — Branche vidéo Stigix, proxy Receiver et CI Docker de lab

Tu travailles sur le dépôt GitHub **`jsuzanne/stigix`**. Ton objectif est de créer et préparer une branche de développement dédiée à une fonctionnalité de validation vidéo inter-instances pour les labs SD-WAN.

Ne merge rien dans `main`, ne modifie pas `main` directement, et ne publie jamais une image expérimentale sous les tags Docker `stable` ou `latest`.

## Objectif fonctionnel

Implémenter une fonctionnalité **Video Experience** où une instance Stigix "Receiver" (par exemple BR8) récupère une vidéo MP4 hébergée sur une instance Stigix "Video Server" (par exemple BR5) à travers le chemin SD-WAN de l’instance Receiver, puis la relaie vers le navigateur de l’opérateur.

Le besoin de démonstration est le suivant :

```text
Browser sur VLAN management
  │
  │ UI et lecture same-origin
  ▼
Stigix BR8 / Receiver — 192.168.123.102:8080
  │
  │ HTTP streaming proxy ; chemin de routage de BR8
  ▼
SD-WAN BR8 ↔ BR5
  ▼
Stigix BR5 / Video Server — 192.168.123.101:8084
```

Le browser ne doit pas récupérer la vidéo directement depuis BR5. Il doit uniquement appeler BR8. BR8 doit récupérer le média depuis BR5 et relayer les octets en streaming.

L’effet recherché est qu’une perte, une congestion ou un failover sur BR8↔BR5 soit visible dans le player HTML5 du browser : continuité grâce au buffer, `Buffering…`, reprise ou erreur selon la durée et le comportement du chemin SD-WAN.

## Première tâche : créer une branche

Créer la branche à partir du `main` à jour :

```bash
git checkout main
git pull origin main
git checkout -b feature/video-receiver-proxy
git push -u origin feature/video-receiver-proxy
```

Tout le travail doit être réalisé et poussé dans :

```text
feature/video-receiver-proxy
```

Ne créer aucune Pull Request et ne merger aucune branche sans approbation explicite ultérieure.

## Lire le PRD

Utiliser le document suivant comme source de vérité fonctionnelle et technique :

```text
VIDEO_STREAMING_SPECIFICATION_PROXY_PRD.md
```

S’il n’est pas encore présent dans le dépôt, l’ajouter dans une documentation appropriée, par exemple :

```text
docs/VIDEO_STREAMING_SPECIFICATION_PROXY_PRD.md
```

Le PRD contient le périmètre, les routes, les critères d’acceptation et les contraintes de sécurité. Respecter en priorité les règles ci-dessous.

## Architecture obligatoire

### Video Server

L’instance Stigix qui héberge les vidéos doit proposer :

```text
GET    /api/videos/health
GET    /api/videos
POST   /api/videos
GET    /api/videos/:id/stream
DELETE /api/videos/:id
```

Contraintes :

- Accepter uniquement MP4 pour le MVP.
- Stocker les vidéos dans un volume Docker persistant : `/data/videos`.
- Utiliser des IDs opaques pour les fichiers ; ne jamais exposer de chemin local.
- Imposer les limites de taille, quota et nombre de fichiers.
- Servir les MP4 depuis le disque sans les charger entièrement en mémoire.
- Supporter HTTP `Range` et répondre `206 Partial Content` lorsque nécessaire.
- Retourner correctement `Content-Type`, `Content-Length`, `Content-Range` et `Accept-Ranges`.

### Video Receiver Proxy

L’instance Receiver doit exposer des routes same-origin :

```text
GET    /api/video-receiver/servers
POST   /api/video-receiver/servers
DELETE /api/video-receiver/servers/:serverId
GET    /api/video-receiver/servers/:serverId/health
GET    /api/video-receiver/servers/:serverId/videos
GET    /api/video-receiver/servers/:serverId/videos/:videoId/stream
```

La route de streaming Receiver doit :

1. Résoudre `serverId` uniquement depuis une configuration locale validée.
2. Ne jamais accepter de `url`, `host`, `ip`, `port` ou chemin upstream arbitraire venant de la requête browser.
3. Construire l’URL upstream à partir de la source configurée et du `videoId` encodé.
4. Transmettre l’en-tête `Range` reçu du browser vers BR5.
5. Propager vers le browser le statut HTTP upstream et les headers :
   - `Content-Type`
   - `Content-Length`
   - `Content-Range`
   - `Accept-Ranges`
   - `Cache-Control`
   - `ETag`
   - `Last-Modified`
6. Relayer le body upstream immédiatement en streaming ; ne jamais faire de buffering complet du fichier.
7. Annuler la requête upstream si le client ferme la connexion, arrête la vidéo ou change de média.
8. Retourner des erreurs propres : `502` si l’amont est injoignable, `504` si la connexion amont ne s’établit pas dans le timeout configuré, et propager les codes HTTP pertinents de l’amont (`404`, `416`, `401`, `403`, etc.).
9. Protéger les routes avec le mécanisme d’authentification Stigix existant.
10. Ajouter une limite configurable de streams concurrents.

Le tag HTML5 doit utiliser une URL **locale à BR8**, par exemple :

```html
<video
  controls
  src="/api/video-receiver/servers/br5-video/videos/vid_01J.../stream">
</video>
```

Il ne doit pas contenir directement l’IP/URL BR5.

## UI demandée

Ajouter deux vues ou sections cohérentes avec l’UI Stigix existante :

### Video Library

Pour l’instance Video Server :

- Upload MP4.
- Barre de progression.
- Affichage quota utilisé / disponible.
- Liste de vidéos : nom, taille, date, suppression confirmée.
- Messages explicites sur fichier invalide, limite de taille, quota, limite de fichiers et erreur réseau.

### Video Receiver

Pour l’instance Receiver :

- Liste de Video Servers configurés et autorisés.
- Gestion simple d’un serveur : label, protocole, hostname/IP et port.
- Health check depuis le Receiver vers le Video Server.
- Chargement du catalogue distant via le Receiver.
- Player HTML5 dont la source est same-origin sur le Receiver.
- Bouton Stop.
- États visibles : `Idle`, `Loading`, `Playing`, `Buffering`, `Ended`, `Error`.
- Informations visibles :

```text
Video source: BR5 — 192.168.123.101:8084
Receiver: BR8
Playback path: Receiver proxy via SD-WAN
```

Ne pas introduire de transcodage, HLS, DASH, WebRTC, RTP vidéo, CDN, cache complet ou infrastructure externe.

## Configuration requise

Ajouter les variables d’environnement suivantes, documentées dans `.env.example` et dans la documentation :

```bash
VIDEO_ENABLED=true
VIDEO_PORT=8084
VIDEO_STORAGE_PATH=/data/videos
VIDEO_MAX_FILE_SIZE_MB=250
VIDEO_STORAGE_LIMIT_MB=1024
VIDEO_MAX_FILES=10

VIDEO_RECEIVER_ENABLED=true
VIDEO_PROXY_CONNECT_TIMEOUT_MS=10000
VIDEO_PROXY_IDLE_TIMEOUT_MS=0
VIDEO_PROXY_MAX_CONCURRENT_STREAMS=5
VIDEO_PROXY_ALLOWED_PROTOCOLS=http,https
```

Ajouter une configuration persistante locale pour les sources vidéo, par exemple :

```text
config/video-servers.json
```

Exemple :

```json
{
  "servers": [
    {
      "id": "br5-video",
      "label": "BR5 — Video Server",
      "protocol": "http",
      "host": "192.168.123.101",
      "port": 8084,
      "enabled": true
    }
  ]
}
```

Assurer la persistance Docker du répertoire de vidéos du serveur, sans casser les déploiements existants.

## GitHub Actions / Docker : indispensable pour le lab

Analyser le workflow existant :

```text
.github/workflows/build-stigix-allinone.yml
```

Modifier ce workflow **dans la branche feature uniquement** afin que chaque push sur la branche :

```text
feature/video-receiver-proxy
```

construise et publie une image Docker de lab pour au moins le composant `sdwan-web-ui`.

### Règles CI/CD

- Un push sur `main` doit conserver exactement le comportement actuel de publication stable ; ne pas casser les tags existants.
- Un push sur `feature/video-receiver-proxy` doit produire des tags distincts de test.
- Ne jamais publier `stable` ni `latest` depuis la branche de feature.
- Conserver la plateforme Docker actuelle si elle est déjà définie, en particulier `linux/amd64` si c’est le choix actuel.
- Conserver les mécanismes existants de login au registry et les secrets ; ne pas exposer de secret.

### Tags recommandés pour la branche vidéo

Publier au minimum :

```text
jsuzanne/sdwan-web-ui:video-proxy
jsuzanne/sdwan-web-ui:video-proxy-<short-sha>
```

Si le workflow construit plusieurs images, appliquer une convention cohérente sans modifier les tags stables de `main`.

À chaque push de la branche, l’image `video-proxy` peut être mise à jour. Le tag `video-proxy-<short-sha>` doit être immuable et permettre de savoir exactement quel commit est déployé sur BR5 et BR8.

Les Pull Requests vers `main` doivent au minimum builder/tester. La publication d’image de PR est optionnelle ; prioriser d’abord le build/push fiable de la branche feature.

## Tests requis

Ajouter des tests automatisés lorsque l’architecture du repository le permet, et exécuter les tests existants sans introduire de régression.

Couvrir au minimum :

- Upload MP4 valide.
- Rejet fichier non MP4.
- Rejet dépassement de taille/quota/limite de fichiers.
- Catalogue local.
- Suppression.
- Réponse `Range` directe du Video Server avec `206`.
- Proxy Receiver transmettant `Range` et headers essentiels.
- Stream proxifié sans buffering intégral.
- `serverId` inconnu ou désactivé refusé.
- Video Server inaccessible : erreur exploitable.
- Annulation de la connexion browser : abort de l’upstream.
- Limite de streams concurrents.

## Commits demandés

Organiser le travail en commits lisibles. Exemple :

```text
feat(video-server): add persistent MP4 library and Range streaming
feat(video-receiver): add validated remote video server registry
feat(video-proxy): relay upstream Range streams through receiver
feat(video-ui): add library and receiver playback screens
feat(video): add configuration and Docker persistence
test(video): cover Range proxy errors and abort handling
ci(docker): publish video-proxy feature tags
docs(video): document SD-WAN receiver-proxy workflow
```

Ne pas combiner de grandes modifications non liées dans un même commit.

## Validation finale attendue

À la fin, fournir un rapport clair contenant :

1. La branche créée et son dernier commit SHA.
2. Les fichiers modifiés ou ajoutés.
3. Les routes API implémentées.
4. Les variables d’environnement ajoutées.
5. Les modifications exactes du workflow GitHub Actions.
6. Les tags Docker de lab qui seront publiés après un push.
7. Les tests exécutés et leur résultat.
8. La commande Docker Compose recommandée pour déployer le tag de feature sur BR5 et BR8.
9. Les éventuels points restant à décider ou limitations connues.

Ne crée pas de Pull Request, ne merge pas dans `main`, ne supprime pas de branche et ne modifie pas de tags stables sans une instruction explicite.
