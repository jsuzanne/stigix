# Prompt — Google Antigravity / Gemini Flash High

Copiez-collez le prompt ci-dessous dans Google Antigravity, puis joignez le document PRD **Custom TCP Inter-Site Applications — Stigix**.

---

```text
Tu es un staff product engineer et un senior full-stack engineer expert en :
- TypeScript / Node.js / Express,
- React et interfaces d’administration techniques,
- Docker en network_mode: host,
- Linux networking et sockets TCP,
- produits SD-WAN / SASE,
- conception d’outils de test réseau et de simulation applicative.

## Contexte produit

Tu travailles sur Stigix, un outil de démonstration, de lab et de validation SD-WAN/SASE. Stigix est déployé sous la forme d’un seul conteneur principal par instance, généralement avec `network_mode: host` sous Linux.

Cette contrainte est essentielle :
- le conteneur partage le namespace réseau du host ;
- un listener TCP configuré dans Stigix écoute donc directement sur l’IP du host ;
- chaque port d’écoute doit être libre au niveau host ;
- un conflit de port doit être détecté et présenté clairement à l’utilisateur ;
- le nouveau composant ne doit pas casser les fonctions Stigix existantes.

Les instances Stigix sont installées sur différents sites, par exemple des agences et des datacenters, reliés par un réseau SD-WAN. Le besoin est de simuler une application métier TCP inter-sites, de façon contrôlée et observable.

Le PRD joint est la source principale des exigences produit. Lis-le intégralement avant de proposer une solution.

## Principe non négociable

Chaque instance Stigix doit pouvoir jouer simultanément les deux rôles pour chaque application TCP configurée :

1. **Serveur TCP** : elle écoute localement sur le port défini par l’application et accepte les connexions entrantes.
2. **Client TCP** : elle ouvre des sessions vers une ou plusieurs autres instances Stigix déclarées comme peers.

Aucune instance ne doit être considérée comme un « target » permanent. Une instance A et une instance B doivent pouvoir s’appeler mutuellement en parallèle, et plusieurs applications peuvent coexister avec des ports distincts.

## Mission

À partir du PRD joint, produis une proposition d’implémentation complète, pragmatique et incrémentale pour la fonctionnalité **Custom TCP Inter-Site Applications**.

Ne code pas immédiatement un gros bloc non contextualisé. Commence par analyser, décider, puis livre les artefacts techniques nécessaires. Si un point dépend de la structure réelle du dépôt, indique précisément ce qu’il faut inspecter et propose l’intégration la moins intrusive.

## Contraintes de conception

- Implémentation dans le conteneur Stigix existant ; ne propose pas de nouveau conteneur obligatoire pour le MVP.
- Backend Node.js / TypeScript et frontend React attendus.
- L’implémentation doit être non bloquante et capable de gérer plusieurs listeners, peers et sessions concurrentes.
- Préférer les primitives Node.js standard (`net`, `crypto`, `events`, `fs/promises`) sauf raison solide et explicitée d’ajouter une dépendance.
- Aucun accès shell ne doit être exposé via le protocole TCP ou les payloads.
- Aucun secret ne doit être retourné par les APIs GET, écrit dans les logs ou inclus dans les historiques/exportations.
- Les comportements de simulation qui produisent volontairement du délai, des drops, des erreurs ou des fermetures doivent être traçables explicitement afin de les distinguer d’un incident réseau.
- La reconnexion doit utiliser un backoff exponentiel borné avec jitter, jamais une boucle agressive.
- Les sessions et listeners d’une custom app doivent être stoppés proprement sans toucher aux autres modules Stigix.
- Toutes les entrées issues de l’UI, des fichiers JSON et du réseau doivent être validées.
- Les modifications de configuration doivent être atomiques, versionnées, et compatibles avec une migration future.

## Attendus de ta réponse

Structure impérativement ta réponse avec les sections suivantes.

### 1. Résumé d’architecture

Explique en quelques paragraphes :
- comment intégrer un `TcpAppManager` dans le backend existant ;
- comment gérer plusieurs `net.Server` et plusieurs clients asynchrones ;
- comment séparer configuration persistante, état runtime, métriques et historique ;
- comment le frontend reçoit les mises à jour temps réel ;
- pourquoi cette architecture respecte le host mode et le rôle simultané client/serveur.

Ajoute un diagramme Mermaid simple.

### 2. Décisions techniques

Fournis un tableau contenant pour chaque décision : le sujet, le choix, la justification et l’impact.

Couvre au minimum :
- framing protocolaire TCP ;
- encodage des messages ;
- handshake ;
- identité d’instance ;
- modèle de session ;
- gestion des messages partiels et concaténés TCP ;
- request IDs ;
- timeouts ;
- TCP keepalive ;
- reconnexion et jitter ;
- limitations de ressources ;
- allowlist CIDR ;
- token facultatif ;
- stratégie de persistance ;
- diffusion d’événements UI ;
- logs et rétention ;
- stratégie d’erreurs et de restart.

### 3. Spécification de protocole MVP

Conçois un protocole réellement implémentable sur TCP.

Il doit inclure :
- Un framing robuste, qui supporte les messages fragmentés et plusieurs messages dans une même lecture TCP.
- Une limite de taille de message.
- Un `CLIENT_HELLO` contenant au minimum : `protocolVersion`, `applicationId`, `originInstanceId`, `originSiteName`, `originHostname`, `clientSessionId`, timestamp et token optionnel.
- Un `SERVER_HELLO`, `REJECT`, `REQUEST`, `RESPONSE` ou `ACK`, `ERROR`, `PING`, `PONG`, `CLIENT_CLOSE` et `SERVER_CLOSE`.
- Les champs nécessaires pour mesurer le RTT applicatif, corréler les sessions et attribuer les métriques.
- Des codes d’erreur structurés.
- Une stratégie claire de compatibilité de version.

Propose :
1. le format de framing ;
2. les types de messages ;
3. des exemples complets de messages ;
4. le pseudo-code du parseur incrémental ;
5. les règles de validation et de refus de connexion.

Tu peux choisir un framing de longueur préfixée avec payload JSON UTF-8 si cela simplifie fortement le MVP. Si tu choisis cette solution, explique pourquoi elle reste suffisante pour un outil de lab et comment elle gère les messages incomplets/concaténés.

### 4. Modèle de données

Propose des interfaces TypeScript détaillées pour :
- configuration globale d’identité d’instance ;
- `CustomTcpApplicationConfig` ;
- listener ;
- comportements serveur ;
- paramètres client ;
- peer ;
- état runtime d’une application ;
- session entrante ;
- session sortante ;
- métriques agrégées ;
- événement temps réel ;
- enregistrement d’historique.

Le schéma doit supporter plusieurs applications et plusieurs peers par application. Il doit séparer les données persistées de l’état runtime. Il ne doit jamais sérialiser un token secret dans une réponse API de lecture.

Propose ensuite un exemple complet de `config/custom-tcp-applications.json` conforme à ces interfaces.

### 5. Design backend

Décompose la solution par modules TypeScript. Propose les fichiers, responsabilités et interfaces publiques.

Attendu au minimum :

```text
server/
  custom-tcp-apps/
    types.ts
    config-store.ts
    validation.ts
    tcp-app-manager.ts
    tcp-server-runtime.ts
    tcp-client-runtime.ts
    protocol.ts
    frame-parser.ts
    metrics.ts
    history-store.ts
    cidr.ts
    api-routes.ts
```

Pour chaque fichier, décris précisément :
- son rôle ;
- les fonctions/classes centrales ;
- les dépendances ;
- les erreurs à traiter ;
- les tests unitaires nécessaires.

Ajoute les signatures TypeScript essentielles de `TcpAppManager`, du runtime serveur et du runtime client.

### 6. REST API et temps réel

Propose les routes REST MVP avec :
- méthode ;
- route ;
- payload request ;
- payload response ;
- validations ;
- codes d’erreur ;
- risques d’effet de bord ;
- droits/contrôles éventuels.

Couvre notamment :
- CRUD des applications ;
- validation de profil et de port ;
- démarrage/arrêt du listener ;
- démarrage/arrêt de workload client ;
- test ponctuel connect + handshake d’un peer ;
- sessions entrantes ;
- sessions sortantes ;
- métriques ;
- historique ;
- endpoint de stream SSE ou événements Socket.IO.

Précise quelles routes modifient l’état et doivent être protégées contre les doublons ou demandes concurrentes.

### 7. Design frontend React

Propose une interface ergonomique qui évite l’explosion de complexité liée aux multiples applications, comportements et peers.

Décris :
- Settings → Custom TCP Applications ;
- tableau des profils ;
- assistant de création/édition en quatre étapes ;
- panneaux Client et Server séparés ;
- zone Advanced repliée par défaut ;
- templates ;
- vue Custom Apps opérationnelle ;
- tableau des connexions entrantes ;
- tableau des connexions sortantes ;
- filtres et états ;
- vues de métriques et historique ;
- messages d’erreur host-mode/port conflict ;
- distinction visuelle entre identité déclarée dans le payload et IP observée.

Propose les principaux composants React et le modèle de state management. Ajoute un wireframe textuel si utile.

### 8. Validation, sécurité et protection des ressources

Détaille les règles concrètes à implémenter :
- ports autorisés et ports réservés ;
- détection de collision de port entre profils ;
- check best-effort de disponibilité de port ;
- limites de nombre de listeners, sessions, payloads et cadence ;
- validation FQDN/IP/CIDR ;
- allowlist CIDR ;
- tokens et redaction ;
- prévention de payload malformé / oversized ;
- idle timeout ;
- timeout handshake ;
- traitement des clients inconnus ;
- contrôle des logs ;
- backoff avec jitter ;
- arrêt propre ;
- persistance atomique et récupération après crash.

Indique explicitement la différence entre :
- l’identité déclarée dans le payload ;
- l’identité observée au niveau socket ;
- une identité authentifiée cryptographiquement.

### 9. Plan de livraison

Propose un plan de développement en petites étapes avec dépendances et critères de sortie :

- Spike technique.
- MVP backend/protocole.
- MVP frontend/configuration.
- Observabilité et tests end-to-end entre deux instances.
- Durcissement sécurité et performance.
- Phase 2 : Flow Browser/Prisma SD-WAN correlation, TLS/mTLS, templates enrichis, scénarios VyOS.

Pour chaque étape, donne les tests à réaliser et les critères de réussite.

### 10. Plan de tests

Fournis une matrice de tests incluant :
- tests unitaires ;
- tests d’intégration backend ;
- tests protocole avec fragmentation et messages concaténés ;
- tests de conflits de ports ;
- tests de multi-applications ;
- tests A vers B, B vers A, et A/B simultanés ;
- tests de reconnexion après fermeture serveur ;
- tests de panne réseau / timeout simulé ;
- tests de delay, drop, error et close volontaire ;
- tests de limite de payload ;
- tests allowlist/token ;
- tests de persistence/restart ;
- tests UI ;
- tests de non-régression sur les modules Stigix existants.

### 11. Backlog priorisé

Termine par un backlog de user stories ordonné avec :
- priorité : P0, P1 ou P2 ;
- user story ;
- critères d’acceptation ;
- dépendances ;
- estimation relative S/M/L/XL ;
- risques.

## Style attendu

- Réponds en français.
- Sois précis, concret et orienté implémentation.
- Ne suppose pas qu’un accès root est disponible.
- Ne propose pas de commandes destructives.
- Ne confonds pas le trafic applicatif TCP avec un protocole de contrôle distribué de Stigix.
- Signale clairement les hypothèses et les éléments à valider dans le dépôt avant modification.
- Quand plusieurs options sont possibles, recommande une option pour le MVP puis mentionne brièvement l’alternative.
- Ne surdimensionne pas le MVP : privilégie une première version robuste, observable et ergonomique.

## Livrable additionnel final

Après l’analyse, fournis une section finale intitulée :

`Implementation Starter Pack`

Elle doit contenir :
1. l’arborescence de fichiers recommandée ;
2. le schéma JSON versionné ;
3. les interfaces TypeScript essentielles ;
4. le contrat de protocole résumé ;
5. la liste ordonnée des premiers fichiers à coder ;
6. une liste concise des questions bloquantes à valider dans le dépôt Stigix avant de commencer.
```

---

## Conseils d’utilisation

1. Joignez également le PRD avec ce prompt afin que Gemini puisse baser sa proposition sur les exigences détaillées.
2. Si Antigravity a accès au dépôt Stigix, ajoutez ensuite : « Analyse le dépôt avant de proposer les chemins exacts des fichiers et respecte les patterns existants. »
3. Demandez une première réponse de design/review, sans génération massive de code.
4. Dans un second tour, demandez-lui de créer un plan de patch par lots petits et vérifiables, puis de proposer le code module par module.
5. Faites valider explicitement le protocole TCP et le modèle JSON avant de commencer l’UI : ce sont les deux contrats les plus coûteux à changer ensuite.
