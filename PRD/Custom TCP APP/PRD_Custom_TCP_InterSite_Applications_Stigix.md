# PRD — Custom TCP Inter-Site Applications

**Produit :** Stigix  
**Statut :** Draft à revoir  
**Propriétaire :** Produit / Engineering Stigix  
**Version :** 0.1  
**Date :** 2 septembre 2026

---

## 1. Résumé

Cette fonctionnalité ajoute à Stigix la capacité de définir, déployer et exécuter plusieurs **applications TCP personnalisées inter-sites**.

Chaque instance Stigix joue simultanément les deux rôles :

- **Serveur TCP**, en écoutant localement sur un port configuré et en appliquant un comportement serveur sélectionné.
- **Client TCP**, en ouvrant des sessions vers une ou plusieurs autres instances Stigix déclarées comme peers.

L’objectif est de simuler un trafic applicatif interne réaliste entre agences, datacenters, hubs, usines ou sites distants, à travers le réseau SD-WAN. La fonctionnalité doit permettre de générer des sessions TCP persistantes ou répétées, de moduler les comportements applicatifs des deux côtés, et d’observer clairement les connexions entrantes et sortantes.

Ce n’est pas un outil de benchmarking pur de type iperf3. C’est un simulateur d’application stateful destiné à montrer et mesurer l’expérience applicative : établissement de session, échanges request/reply, latence applicative, pertes de réponse, délais, déconnexions et récupération après un changement de chemin ou une coupure WAN.

---

## 2. Contexte et problème

Stigix dispose déjà de générateurs de trafic SaaS et de tests spécialisés : voix UDP, convergence UDP, XFR, iperf3, tests HTTP et sécurité. Ces fonctions permettent de démontrer la performance, la connectivité et le comportement SD-WAN sur des flux bien identifiés.

Il manque néanmoins une simulation générique de trafic **east-west / inter-site** : une application contrôlée, hébergée sur chaque site, qui échange avec une autre application Stigix au travers de l’overlay.

Cette lacune limite certains scénarios de démonstration ou de POC :

- Simulation d’une application métier entre une agence et un datacenter.
- Validation d’un steering SD-WAN entre deux sites privés.
- Observation de la continuité d’une session TCP lors d’un failover.
- Validation de segmentation, de règles de firewall ou de QoS sur un flux interne connu.
- Illustration du décalage entre une mesure réseau de convergence et le comportement réellement perçu par une application TCP.
- Démonstration de flux bidirectionnels entre plusieurs sites sans déployer une application externe supplémentaire.

La fonctionnalité proposée doit rester cohérente avec l’architecture Stigix : il n’y a qu’un conteneur Stigix par instance, exécuté en `network_mode: host`. Un listener TCP peut donc écouter directement sur l’adresse IP du host, à condition que le port choisi soit libre et autorisé par les politiques réseau.

---

## 3. Vision produit

Permettre à un utilisateur de créer dans **Settings** plusieurs profils d’applications TCP et de les utiliser dans une nouvelle vue dédiée pour établir des communications inter-sites entre instances Stigix.

Chaque profil définit :

- L’identité de l’application.
- Le port TCP d’écoute local.
- Les paramètres du comportement serveur.
- Les paramètres de génération côté client.
- Les peers distants que le client peut joindre.
- Les règles de sécurité et les limites de ressources.

Une instance Stigix qui possède une application active est à la fois :

```text
Instance Stigix A
  ├── Serveur : écoute TCP locale sur le port de l’application
  └── Client  : ouvre des sessions vers les peers configurés

Instance Stigix B
  ├── Serveur : écoute TCP locale sur le même port ou un port différent
  └── Client  : peut également ouvrir ses propres sessions vers A ou C
```

Le modèle doit permettre une topologie N-vers-N sans imposer de rôle permanent « générateur » ou « target ».

---

## 4. Objectifs

### Objectifs fonctionnels

- Créer, modifier, dupliquer, activer et désactiver plusieurs applications TCP personnalisées dans Settings.
- Faire fonctionner chaque instance Stigix comme serveur TCP et client TCP pour une même application.
- Configurer des peers distants, chacun avec un nom, une IP ou FQDN, un port et des paramètres optionnels.
- Générer du trafic TCP stateful entre instances Stigix.
- Proposer des profils de comportement côté serveur et côté client.
- Afficher les connexions entrantes et sortantes en temps réel.
- Identifier une connexion entrante par un identifiant d’instance/site porté dans le protocole applicatif.
- Produire des statistiques par application, par peer, par session et par site d’origine.
- Permettre des scénarios exploitables pour démontrer le failover et le steering SD-WAN.
- Préserver le principe de déploiement simple : aucun nouveau conteneur obligatoire pour le MVP.

### Objectifs de démonstration SD-WAN

- Rendre les flux facilement identifiables dans les outils de supervision réseau : IP source/destination, port TCP, nom d’application, identifiant de session.
- Mesurer la dégradation et la récupération telles qu’elles sont visibles par une application TCP.
- Montrer l’impact d’une modification de chemin, d’un brownout ou d’une coupure WAN sur des sessions persistantes.
- Créer des flux internes reproductibles pour les politiques QoS, app steering, firewall et segmentation.

### Non-objectifs du MVP

- Remplacer iperf3, XFR ou une solution de test de débit à très haute performance.
- Reproduire exactement un protocole propriétaire tel qu’Oracle Net, SMB, SAP RFC, Modbus/TCP ou un protocole industriel réel.
- Créer un cluster Stigix, un orchestrateur distribué ou un control plane de réplication entre instances.
- Exposer une API de contrôle distante non authentifiée sur le même canal que le trafic de test.
- Fournir une découverte automatique de tous les peers sur le réseau.
- Garantir la survie d’une connexion TCP lors de toute coupure : le comportement dépend du réseau, du stack TCP et des délais configurés.

---

## 5. Utilisateurs et cas d’usage

### Utilisateurs cibles

- Ingénieur SD-WAN / SASE réalisant une démonstration ou un POC.
- Architecte réseau validant des politiques de chemin, de QoS ou de segmentation.
- Ingénieur support ou lab reproduisant un problème applicatif inter-sites.
- Équipe avant-vente souhaitant montrer une application métier simulée plutôt qu’un test de débit isolé.

### Cas d’usage principaux

| Cas d’usage | Description | Valeur attendue |
|---|---|---|
| Application agence vers DC | Une instance de branche envoie des transactions TCP vers une instance installée au datacenter | Simulation ERP, caisse, inventaire ou application métier interne |
| Application maillée inter-branches | Plusieurs instances envoient et reçoivent des sessions entre elles | Démonstration de topologie mesh et de flux east-west |
| Test de failover applicatif | Des sessions persistantes restent actives pendant la perte d’un WAN ou se reconnectent | Mesure de l’interruption réellement perçue par TCP |
| Validation de steering | Le flux TCP est soumis à une politique SD-WAN donnée | Vérification du chemin retenu avant et après événement |
| Test de firewall / segmentation | Le service TCP est autorisé ou bloqué entre zones/sites | Validation d’une politique avec trafic connu et contrôlé |
| Brownout applicatif | Le serveur introduit volontairement du délai ou des erreurs | Simulation d’un service lent ou instable sans modifier le réseau |
| Démonstration QoS | Plusieurs profils génèrent des débits, tailles de messages et cadences distincts | Illustration d’une priorité applicative et de son impact |

---

## 6. Principes de conception

### Une instance est toujours client et serveur

Une application active doit démarrer son listener local, indépendamment du fait que cette instance émette ou non des sessions vers des peers. Un même profil peut donc recevoir des connexions entrantes et initier des connexions sortantes simultanément.

### Port local en host mode

Le listener utilise un port TCP du host car Stigix s’exécute en `network_mode: host`.

Conséquences produit et techniques :

- Le port est réservé au niveau du host, pas uniquement à l’intérieur du conteneur.
- Deux applications actives d’une même instance ne peuvent pas écouter sur la même combinaison `IP locale + port`.
- L’interface doit détecter et expliquer les conflits avant l’activation.
- Le port doit être autorisé par les firewalls host et les politiques inter-sites.
- Le port 8080 est déjà utilisé par l’interface Web Stigix ; il ne doit jamais être proposé comme valeur par défaut.

### Protocole applicatif léger mais observable

Le flux doit s’appuyer sur TCP, mais il ne peut pas être seulement un flux de bytes sans structure. Un petit framing applicatif est nécessaire pour :

- Identifier le site/instance à l’origine d’une connexion.
- Associer les réponses à une session et une requête.
- Calculer un RTT applicatif.
- Afficher des métriques exploitables côté client et côté serveur.
- Éviter de confondre plusieurs applications partageant des comportements similaires.

Le protocole MVP peut être binaire ou JSON lines. La préférence est un framing binaire simple pour limiter l’overhead et éviter que la charge utile ne devienne artificiellement verbueuse.

---

## 7. Expérience utilisateur

La fonctionnalité introduit deux zones principales dans l’interface :

1. **Settings → Custom TCP Applications** : définition persistante des profils.
2. **Custom Apps** : exploitation, lancement, observation et historique.

La séparation est importante : Settings sert à construire les applications, tandis que la vue opérationnelle sert à voir et démarrer les flux. L’utilisateur ne doit pas avoir à reconfigurer un serveur à chaque test.

### Navigation proposée

```text
Settings
  └── Custom TCP Applications
        ├── Liste des applications
        ├── Créer / Modifier / Dupliquer
        └── Validation des ports et configuration locale

Custom Apps
  ├── Vue d’ensemble
  ├── Applications locales
  ├── Connexions entrantes
  ├── Connexions sortantes
  ├── Peers et santé
  └── Historique / métriques
```

### Vue d’ensemble Custom Apps

La page opérationnelle doit présenter immédiatement :

- Le nom de l’instance locale et son `instance_id`.
- Les applications actives et les ports d’écoute associés.
- Le nombre de connexions entrantes actives.
- Le nombre de connexions sortantes actives.
- Le volume TX/RX cumulé.
- Les erreurs, timeouts, reconnects et sessions dégradées.
- Un état global : sain, dégradé, indisponible ou conflit de port.

Exemple de carte :

```text
ERP-TCP
Port local : TCP/8443     État : LISTENING
Entrantes : 8             Sortantes : 12
RTT applicatif moyen : 14 ms
Reconnexions (5 min) : 2  Erreurs : 0
```

### Vue des connexions entrantes

Cette vue répond directement au besoin d’identifier qui communique avec l’instance locale.

Colonnes recommandées :

| Champ | Description |
|---|---|
| Application | Nom du profil TCP local |
| État | Connected, idle, delayed, closing, error |
| Site d’origine déclaré | Nom envoyé dans le handshake applicatif |
| Instance ID déclarée | UUID stable de l’instance Stigix émettrice |
| IP source observée | Adresse IP réellement vue par le listener |
| Port source | Port éphémère TCP source |
| Peer configuré | Oui / non ; permet de détecter un client inattendu |
| Session ID | Identifiant unique de session |
| Ouverte depuis | Date/heure et durée de session |
| Dernière activité | Dernière requête reçue |
| RX / TX | Octets reçus et envoyés par session |
| RTT rapporté | RTT client fourni par le protocole, si disponible |
| Comportement serveur | Echo, delay, drop, error, etc. |

L’UI doit distinguer clairement :

- **Origine déclarée** : nom du site/instance contenu dans le payload et donc contrôlé par le client.
- **Origine observée** : IP source TCP effectivement observée sur le host.
- **Peer reconnu** : comparaison entre l’identité déclarée, l’IP observée et la configuration locale.

Cela évite de présenter l’identité contenue dans le payload comme une preuve de sécurité.

### Vue des connexions sortantes

Colonnes recommandées :

| Champ | Description |
|---|---|
| Application | Nom du profil local |
| Peer de destination | Nom métier du peer configuré |
| IP/FQDN et port | Endpoint effectivement joint |
| État | Connecting, connected, reconnecting, stopped, error |
| Sessions souhaitées / actives | Objectif de charge et sessions réellement établies |
| Dernier succès | Dernier échange request/reply valide |
| RTT applicatif | Min, moyen, p95 et maximum sur une fenêtre donnée |
| Reconnects | Nombre de rétablissements depuis le lancement |
| Timeouts / erreurs | Compteurs et dernier message d’erreur |
| TX / RX | Octets envoyés et reçus |
| Durée | Durée de l’exécution ou de la session |

### Ergonomie pour plusieurs applications

Le risque principal est de créer une configuration trop lourde. L’expérience doit donc privilégier les profils et les valeurs par défaut :

- Une application possède des paramètres locaux réutilisables.
- Les peers sont ajoutés dans une table simple ; les réglages avancés restent masqués par défaut.
- Un bouton **Dupliquer** permet de partir d’un profil existant.
- Des templates aident à démarrer : Transactional, Persistent Session, Bulk Transfer, Heartbeat, Slow Server Demo.
- Les paramètres client et serveur sont séparés visuellement, mais figurent dans le même assistant de création.
- Les valeurs avancées n’apparaissent que via un panneau « Advanced ».

---

## 8. Gestion dans Settings

### Liste des applications

Settings → Custom TCP Applications affiche une table avec :

| Champ | Description |
|---|---|
| Nom | Nom lisible et unique localement |
| État | Active, inactive, error, port conflict |
| Port local | Port TCP d’écoute en host mode |
| Profil client | Transactional, persistent, bulk ou custom |
| Profil serveur | Echo, delay, variable delay, drop ou custom |
| Peers | Nombre de peers déclarés |
| Dernière activité | Dernier trafic entrant ou sortant |
| Actions | Démarrer/arrêter, éditer, dupliquer, exporter, supprimer |

### Assistant de création

L’assistant est proposé en quatre étapes :

1. **Identity & Listener**
2. **Server Behavior**
3. **Client Behavior & Peers**
4. **Review & Validate**

L’utilisateur peut enregistrer l’application inactive, puis l’activer après validation du port et de la configuration.

### Étape 1 — Identity & Listener

| Paramètre | Type | Défaut / exemple | Règle |
|---|---|---|---|
| Nom d’application | Texte | `ERP-TCP` | Unique localement, 3 à 64 caractères |
| Description | Texte | `ERP simulation Paris to DC` | Optionnel |
| Application ID | Généré | `erp-tcp` | Stable, URL-safe, modifiable avec confirmation |
| Port TCP local | Entier | `8443` | 1024–65535 ; doit être libre localement |
| Bind address | Liste / avancé | `0.0.0.0` | Défaut toutes interfaces ; support futur d’IP spécifique |
| Activée | Toggle | Off à la création | Listener démarré uniquement si actif |
| Instance identity | Lecture seule | `PARIS-BR01 / uuid` | Défini au niveau Stigix, inclus dans le handshake |

### Étape 2 — Server Behavior

Le serveur doit proposer des comportements simples, utiles en démonstration, et non destructifs par défaut.

| Paramètre | Type | Défaut | Description |
|---|---|---|---|
| Mode serveur | Liste | Echo | Comportement de réponse aux requêtes |
| Taille maximale de message | Entier | 1 MiB | Protection contre payload excessif |
| Nombre maximal de connexions | Entier | 100 | Limite locale pour protéger le host |
| Idle timeout | Durée | 60 s | Fermeture d’une session inactive |
| Keepalive TCP | Toggle | On | Active les options TCP keepalive lorsque supportées |
| Allowlist CIDR | Liste | Vide = warning | Réseaux autorisés ; recommandé pour lab fermé |
| Auth token | Secret / optionnel | Désactivé MVP par défaut | Partagé entre peers si activé |
| TLS | Toggle | Off MVP | Hors périmètre MVP, prévu pour phase ultérieure |

#### Modes serveur MVP

| Mode | Comportement |
|---|---|
| Echo | Répond avec le même payload et les métadonnées nécessaires |
| Acknowledge | Répond par un ACK compact contenant request ID et timestamp |
| Fixed Delay | Attend un délai fixe avant de répondre |
| Random Delay | Ajoute un délai aléatoire dans une plage donnée |
| Looping Delay | Alterne automatiquement périodes normales et lentes |
| Drop Response | Ignore certaines requêtes selon une probabilité configurée tout en gardant la session ouverte |
| Close Connection | Ferme volontairement la session après N requêtes ou après une durée donnée |
| Error Response | Retourne une erreur applicative structurée selon une probabilité configurée |

Les comportements « Drop Response », « Close Connection » et « Error Response » doivent être explicitement signalés comme des modes de simulation ; ils ne doivent jamais être activés par défaut.

#### Paramètres associés aux modes

| Paramètre | Applicable à | Défaut |
|---|---|---|
| Délai fixe | Fixed Delay | 500 ms |
| Délai minimum / maximum | Random Delay | 100 / 1000 ms |
| Phase lente / phase normale | Looping Delay | 60 s / 60 s |
| Probabilité de drop | Drop Response | 10 % |
| Fermeture après N requêtes | Close Connection | 100 |
| Fermeture après durée | Close Connection | 60 s |
| Probabilité d’erreur | Error Response | 10 % |
| Code/message d’erreur | Error Response | `SIMULATED_SERVER_ERROR` |

### Étape 3 — Client Behavior & Peers

Le client doit être configuré par application, avec des surcharges possibles par peer si nécessaire.

| Paramètre | Type | Défaut | Description |
|---|---|---|---|
| Mode client | Liste | Persistent Request/Reply | Modèle d’échange applicatif |
| Connexions par peer | Entier | 1 | Nombre de sessions concurrentes désirées |
| Durée d’exécution | Durée / infini | Infinite | Durée du run manuel ou scénario |
| Intervalle entre requêtes | Durée | 1000 ms | Cadence des échanges |
| Taille de payload | Entier | 1024 bytes | Taille de chaque message de test |
| Pattern de payload | Liste | Structured | Structured, random, repeated, file-like |
| Request timeout | Durée | 5 s | Timeout au niveau protocole applicatif |
| Connect timeout | Durée | 5 s | Timeout de connexion TCP |
| Reconnexion automatique | Toggle | On | Recréation de session après erreur/coupure |
| Backoff initial / maximum | Durées | 1 s / 30 s | Backoff exponentiel borné |
| TCP keepalive | Toggle | On | Conservation et détection des sessions inactives |
| Source interface | Liste / avancé | Auto | Auto-detection Stigix ou interface explicitement choisie |

#### Modes client MVP

| Mode | Description |
|---|---|
| Heartbeat | Petit message request/reply périodique ; utile pour visibilité et récupération |
| Transactional | Une requête puis une réponse, avec connexion courte ou réutilisée |
| Persistent Request/Reply | Sessions durables avec échanges périodiques ; mode recommandé pour failover applicatif |
| Bulk Burst | Envoie un volume défini par bursts, puis attend une réponse ou confirmation |
| Continuous Stream | Flux TCP continu à débit borné ; utile mais pas destiné à remplacer XFR |

#### Définition d’un peer

| Paramètre | Type | Exemple | Description |
|---|---|---|---|
| Nom du peer | Texte | `DC-LYON` | Nom lisible dans l’UI |
| Site logique | Texte | `DC-LYON` | Label de corrélation et de reporting |
| Host | IP/FQDN | `10.20.30.40` | Adresse de l’instance distante |
| Port | Entier | `8443` | Port listener de l’application distante |
| Activé | Toggle | On | Inclut le peer dans les runs |
| Connexions override | Entier optionnel | `10` | Remplace le défaut global pour ce peer |
| Délai / cadence override | Optionnel | `500 ms` | Remplace le défaut global |
| Token | Secret optionnel | `***` | Si auth applicative activée |
| Tags | Liste | `dc`, `critical` | Filtrage et scénarios futurs |

### Étape 4 — Review & Validate

Avant activation, l’UI exécute une validation non destructive :

- Port compris entre 1024 et 65535.
- Port non réservé par Stigix et non utilisé par un autre profil actif.
- Vérification locale que le port est libre lorsque cela est possible.
- Vérification du format IP/FQDN des peers.
- Validation des limites : connexions, payload, timeouts, probabilités.
- Avertissement si aucune allowlist ni token n’est configuré.
- Avertissement si aucun peer n’est présent : l’application fonctionnera en serveur uniquement.
- Avertissement si le port ne semble pas joignable à cause d’un firewall local, si une vérification est disponible.

---

## 9. Protocole applicatif

### Objectif du protocole

Le protocole doit permettre l’observabilité, pas seulement le transport. Chaque nouvelle session doit commencer par un handshake applicatif avant l’envoi de trafic normal.

### Handshake logique

```text
Client TCP connect
  ↓
CLIENT_HELLO
  application_id
  protocol_version
  origin_instance_id
  origin_site_name
  origin_hostname
  client_session_id
  timestamp
  optional_auth_token
  ↓
SERVER_HELLO / REJECT
  destination_instance_id
  destination_site_name
  server_session_id
  accepted_behavior
  timestamp
  ↓
REQUEST / RESPONSE / ACK / ERROR
  ↓
CLIENT_CLOSE or SERVER_CLOSE
```

### Métadonnées de session minimales

| Champ | Rôle |
|---|---|
| `protocol_version` | Compatibilité entre versions Stigix |
| `application_id` | Identifie le profil applicatif attendu |
| `origin_instance_id` | UUID stable de l’instance source |
| `origin_site_name` | Nom lisible du site source |
| `origin_hostname` | Aide au diagnostic, non fiable comme identité de sécurité |
| `client_session_id` | Corrélation entre logs client/serveur |
| `server_session_id` | Corrélation côté serveur |
| `request_id` | Mesure du RTT et détection de réponses perdues |
| `sent_timestamp` | Calcul du délai applicatif et troubleshooting |
| `payload_length` | Validation de framing et statistiques |

### Identification de l’origine

La vue des connexions entrantes doit afficher à la fois :

```text
Origine déclarée : BR-PARIS-01 / instance UUID 5e4c...
Origine observée : 10.10.10.25:49152
Peer configuré : BR-PARIS-01 (match IP et instance ID)
```

Règle importante : le nom de site et l’instance ID portés par le payload servent à la **corrélation fonctionnelle**. Ils ne suffisent pas à authentifier un client hostile ou non approuvé.

Pour le MVP, une allowlist CIDR et un token partagé optionnel offrent une première protection. Le TLS mutuel est la solution cible pour garantir l’identité cryptographique du peer.

---

## 10. Mesures et états

### Métriques client

- Tentatives de connexion.
- Connexions réussies et échouées.
- Sessions actives, fermées et en reconnexion.
- Requêtes envoyées, réponses reçues, timeouts et erreurs applicatives.
- Bytes TX/RX.
- RTT applicatif : minimum, moyen, p50, p95, maximum.
- Délai de récupération après perte de réponse.
- Nombre et durée des périodes sans réponse.
- Reconnects et cause de la dernière déconnexion.
- Débit applicatif moyen et maximum, lorsqu’applicable.

### Métriques serveur

- État listener : listening, stopped, bind error, port conflict.
- Connexions entrantes simultanées et maximum observé.
- Connexions refusées par allowlist, token ou limites de ressources.
- Sessions par site déclaré et par IP observée.
- Requêtes reçues, réponses envoyées, drops intentionnels et erreurs simulées.
- Bytes RX/TX.
- Délai serveur introduit par les modes de simulation.
- Fermetures volontaires versus erreurs réseau observées.

### États de session

| État | Sens |
|---|---|
| Connecting | Ouverture TCP en cours |
| Handshaking | TCP établi, identification applicative en cours |
| Connected | Session saine avec échange récent |
| Idle | Session ouverte sans échange depuis le seuil défini |
| Delayed | Réponse reçue au-delà du seuil de latence configuré |
| Timed Out | Réponse ou connexion expirée |
| Reconnecting | Backoff ou tentative de rétablissement en cours |
| Rejected | Serveur a refusé la session |
| Closed | Fermeture propre |
| Error | Erreur réseau, protocolaire ou applicative |

### Santé d’une application

L’état global d’une application doit être dérivé de règles simples et visibles :

| État global | Critère indicatif |
|---|---|
| Healthy | Listener actif, aucune erreur récente critique, réponses dans les seuils |
| Degraded | RTT élevé, timeouts limités, reconnects ou erreurs récentes |
| Unreachable | Tous les peers actifs sont injoignables ou aucun échange valide dans la fenêtre définie |
| Listener Error | Échec de bind, conflit de port ou erreur fatale serveur |
| Stopped | Application désactivée ou arrêtée manuellement |

Les seuils doivent être configurables par profil ou reprendre des valeurs globales raisonnables.

---

## 11. Scénarios opérationnels

### Lancement manuel

Depuis la page Custom Apps, l’utilisateur sélectionne :

- Une application.
- Un ou plusieurs peers.
- Une durée : 30 s, 1 min, 5 min, 30 min, infini ou valeur personnalisée.
- Le nombre de sessions ou le multiplicateur de charge.
- Éventuellement une surcharge temporaire de cadence ou payload.

Le lancement ne modifie pas le profil enregistré sauf si l’utilisateur choisit explicitement « Save as profile defaults ».

### Démarrage automatique

Chaque application peut avoir deux flags distincts :

| Flag | Effet |
|---|---|
| Start listener on Stigix startup | Démarre le rôle serveur au lancement du conteneur |
| Start client workload on Stigix startup | Démarre automatiquement les sessions client vers les peers activés |

Par défaut, seul le listener peut être démarré automatiquement ; la génération client automatique doit exiger une confirmation explicite pour éviter du trafic inattendu.

### Scénario failover

Exemple :

```text
Application : ERP-TCP
Client : BR-PARIS-01
Serveur : DC-LYON
Mode client : Persistent Request/Reply
Sessions : 20
Payload : 8 KiB
Intervalle : 500 ms
Timeout : 3 s
Reconnect : enabled

Action réseau : perte WAN primaire pendant 30 s
```

Résultats attendus dans l’UI :

- Timestamp du dernier échange avant incident.
- Nombre de requêtes sans réponse.
- Sessions maintenues, fermées puis reconstruites.
- Temps jusqu’à la première réponse valide après l’événement.
- RTT avant, pendant et après récupération.
- Vue des erreurs TCP/applicatives et du nombre de reconnects.
- Corrélation future avec le chemin SD-WAN observé dans les logs/API de supervision.

### Interactions avec les fonctions existantes

- La fonctionnalité est complémentaire du test de convergence UDP ; elle ne doit pas modifier ses ports ni ses métriques.
- Elle est complémentaire de Voice : Voice mesure une qualité RTP/MOS, tandis que Custom TCP Apps mesure un comportement applicatif TCP.
- Elle ne remplace pas XFR ou iperf3 pour la mesure de capacité maximale.
- Elle peut être orchestrée avec VyOS Control afin d’injecter des incidents réseau pendant que les sessions sont actives.
- Les statistiques doivent avoir leur propre namespace pour ne pas mélanger le trafic SaaS de fond et les applications TCP custom.

---

## 12. Architecture technique proposée

### Composants

Le MVP s’exécute dans le conteneur Stigix existant. Il introduit :

- Un **TCP Application Manager** dans le backend Node.js/TypeScript.
- Un **TCP listener runtime** capable de gérer plusieurs listeners configurés.
- Un **client session engine** asynchrone capable de gérer plusieurs peers et sessions concurrentes.
- Une API backend pour CRUD, contrôle d’exécution, métriques et streaming d’événements.
- Une interface React dédiée.
- Une persistance JSON locale, cohérente avec les autres configurations Stigix.

### Diagramme logique

```text
React UI
  │
  ├── Settings: CRUD profiles
  ├── Custom Apps: start/stop, sessions, metrics
  │
Node.js / TypeScript backend (same Stigix container)
  │
  ├── CustomAppConfigStore
  ├── TcpAppManager
  │     ├── TcpServerRuntime × N applications
  │     └── TcpClientRuntime × N applications × peers × sessions
  ├── MetricsStore / event stream
  └── REST API + Socket.IO/SSE
  │
Host network TCP sockets
  │
SD-WAN overlay / LAN / WAN
  │
Remote Stigix instance running the same backend runtime
```

### Contraintes host mode

- Le runtime doit binder explicitement les ports TCP configurés au niveau host.
- L’implémentation doit supporter plusieurs listeners, chacun sur un port distinct.
- Les erreurs `EADDRINUSE`, `EACCES`, bind IP invalide et limite de fichiers descripteurs doivent remonter clairement dans l’UI.
- Le nombre de connexions doit être borné pour éviter un épuisement de ressources du conteneur ou du host.
- L’implémentation doit éviter des boucles de reconnexion agressives qui pourraient générer une tempête de SYN lors d’un incident WAN.

### Persistance proposée

Fichier principal :

```text
config/custom-tcp-applications.json
```

Fichiers runtime et historique :

```text
config/custom-tcp-app-state.json
config/custom-tcp-app-history.jsonl
```

Principes :

- La définition statique est séparée de l’état runtime.
- Les secrets ne doivent pas être exposés dans les endpoints de lecture ni dans les logs.
- Les écritures sont atomiques.
- Le fichier de configuration est validé avec un schéma versionné.
- L’historique est soumis à rotation et rétention configurables.

### Exemple de schéma de configuration

```json
{
  "version": 1,
  "instance": {
    "instanceId": "a347c7f1-ae6f-4a9d-a7c8-61a9d559d320",
    "siteName": "BR-PARIS-01",
    "displayName": "Paris Branch"
  },
  "applications": [
    {
      "id": "erp-tcp",
      "name": "ERP-TCP",
      "description": "Simulation ERP branch to DC",
      "enabled": true,
      "listener": {
        "bindAddress": "0.0.0.0",
        "port": 8443,
        "maxConnections": 100,
        "idleTimeoutMs": 60000,
        "maxPayloadBytes": 1048576,
        "tcpKeepalive": true,
        "allowCidrs": ["10.0.0.0/8"],
        "auth": {
          "enabled": false
        }
      },
      "serverBehavior": {
        "mode": "echo",
        "fixedDelayMs": 0,
        "randomDelayMinMs": 0,
        "randomDelayMaxMs": 0,
        "dropProbability": 0,
        "closeAfterRequests": null,
        "errorProbability": 0
      },
      "clientDefaults": {
        "mode": "persistent_request_reply",
        "connectionsPerPeer": 2,
        "intervalMs": 1000,
        "payloadBytes": 1024,
        "requestTimeoutMs": 5000,
        "connectTimeoutMs": 5000,
        "autoReconnect": true,
        "reconnectInitialMs": 1000,
        "reconnectMaxMs": 30000,
        "tcpKeepalive": true,
        "sourceInterface": "auto"
      },
      "peers": [
        {
          "id": "dc-lyon",
          "name": "DC-LYON",
          "siteName": "DC-LYON",
          "host": "10.20.30.40",
          "port": 8443,
          "enabled": true,
          "tags": ["dc", "critical"]
        }
      ],
      "startup": {
        "startListener": true,
        "startClientWorkload": false
      }
    }
  ]
}
```

---

## 13. API proposée

Les routes sont indicatives et doivent respecter les conventions API existantes de Stigix.

### Configuration

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/custom-tcp-apps` | Liste des profils sans secrets |
| POST | `/api/custom-tcp-apps` | Création d’un profil |
| GET | `/api/custom-tcp-apps/:id` | Détail d’un profil |
| PUT | `/api/custom-tcp-apps/:id` | Modification d’un profil |
| POST | `/api/custom-tcp-apps/:id/duplicate` | Duplication d’un profil |
| DELETE | `/api/custom-tcp-apps/:id` | Suppression avec garde-fous |
| POST | `/api/custom-tcp-apps/validate` | Validation de configuration et port |

### Runtime

| Méthode | Route | Usage |
|---|---|---|
| POST | `/api/custom-tcp-apps/:id/listener/start` | Démarre le listener local |
| POST | `/api/custom-tcp-apps/:id/listener/stop` | Arrête le listener local |
| POST | `/api/custom-tcp-apps/:id/client/start` | Lance les flux vers un ou plusieurs peers |
| POST | `/api/custom-tcp-apps/:id/client/stop` | Arrête les flux sortants |
| POST | `/api/custom-tcp-apps/:id/peers/:peerId/test` | Teste connect + handshake sans charge prolongée |
| GET | `/api/custom-tcp-apps/:id/status` | État listener, peers, sessions et santé |
| GET | `/api/custom-tcp-apps/:id/metrics` | Métriques agrégées avec fenêtre temporelle |
| GET | `/api/custom-tcp-apps/:id/sessions/incoming` | Connexions entrantes actives ou récentes |
| GET | `/api/custom-tcp-apps/:id/sessions/outgoing` | Sessions sortantes actives ou récentes |
| GET | `/api/custom-tcp-apps/:id/history` | Historique des runs et incidents |

### Streaming

- Socket.IO ou SSE diffuse les changements de sessions et les compteurs de métriques.
- Les mises à jour doivent être regroupées pour éviter une pression excessive sur l’UI avec un grand nombre de sessions.
- Le détail par session peut être rafraîchi toutes les 1 à 2 secondes ; les compteurs agrégés peuvent être plus fréquents.

---

## 14. Exigences fonctionnelles détaillées

### FR-1 — Instance identity

Le système doit générer et persister un `instance_id` stable lors de la première exécution si aucun n’existe. L’utilisateur doit pouvoir définir ou modifier un nom de site lisible dans Settings.

### FR-2 — Multi-applications

Le système doit autoriser plusieurs applications custom TCP par instance, chacune avec son propre port TCP local, comportement serveur, paramètres client et liste de peers.

### FR-3 — Écoute locale

Lorsqu’une application est activée, Stigix doit démarrer le listener TCP correspondant et afficher son état de bind.

### FR-4 — Rôle double

Pour chaque application active, Stigix doit pouvoir accepter des sessions entrantes et initier des sessions sortantes en parallèle.

### FR-5 — Gestion de port

Le système doit empêcher l’activation de deux profils qui utilisent le même bind address/port lorsqu’ils sont incompatibles. Il doit remonter une erreur compréhensible si le host utilise déjà le port.

### FR-6 — Identification applicative

Le client doit transmettre application ID, instance ID, site name, hostname et session ID dans le handshake. Le serveur doit afficher ces informations avec l’IP source observée.

### FR-7 — Peers

L’utilisateur doit pouvoir créer, modifier, désactiver et supprimer plusieurs peers par application.

### FR-8 — Lancement ciblé

L’utilisateur doit pouvoir lancer le trafic vers tous les peers activés ou seulement vers une sélection de peers.

### FR-9 — Comportements serveur

Le serveur doit supporter au minimum Echo, Acknowledge, Fixed Delay, Random Delay, Drop Response et Close Connection.

### FR-10 — Comportements client

Le client doit supporter au minimum Heartbeat, Transactional et Persistent Request/Reply.

### FR-11 — Reconnexion

Le client doit rétablir les sessions interrompues lorsque la reconnexion est activée, avec backoff exponentiel borné et visible dans l’UI.

### FR-12 — Métriques

Le système doit fournir les métriques client et serveur définies dans ce document, au niveau application, peer et session.

### FR-13 — Visibilité entrante

L’utilisateur doit pouvoir filtrer les connexions entrantes par site déclaré, instance ID, IP observée, état et application.

### FR-14 — Historique

Chaque run client doit produire un enregistrement d’historique avec configuration effective, peers ciblés, durée, volume, RTT, erreurs et reconnects.

### FR-15 — Validation

La création et l’édition doivent valider syntaxe, plages de valeurs, collisions de port connues et cohérence des comportements.

### FR-16 — Dégradations simulées

Les comportements de serveur créant du délai, drop ou fermeture doivent être explicitement visibles dans les métriques afin de distinguer un incident volontaire d’un incident réseau.

---

## 15. Exigences non fonctionnelles

### Performance et capacité

Les valeurs MVP sont des cibles initiales à confirmer par test :

- Jusqu’à 20 applications configurées par instance.
- Jusqu’à 10 applications actives simultanément.
- Jusqu’à 100 connexions TCP entrantes simultanées par application par défaut, configurable avec limite absolue.
- Jusqu’à 100 sessions sortantes simultanées par application par défaut, configurable avec limite absolue.
- Affichage des métriques agrégées sans dégrader significativement le dashboard.
- Écriture asynchrone et bornée des logs/historiques.

Ces chiffres ne constituent pas une promesse de débit ; ils visent une simulation applicative de lab et de démonstration, pas un moteur de charge massif.

### Fiabilité

- Un échec de listener d’une application ne doit pas interrompre les autres fonctions Stigix.
- Une erreur de peer ne doit pas stopper les sessions vers les autres peers.
- Les changements de configuration doivent être atomiques.
- Une mise à jour d’un profil actif doit suivre une stratégie explicite : apply live lorsque possible, ou demander restart du listener / des sessions si nécessaire.
- Au redémarrage du conteneur, les listeners configurés pour autostart doivent revenir proprement.

### Sécurité

- Ports non privilégiés par défaut : 1024–65535.
- Avertissement explicite si l’application écoute sur `0.0.0.0` sans allowlist ni auth.
- Allowlist CIDR disponible au MVP.
- Token optionnel au MVP, jamais journalisé ni retourné via API GET.
- TLS et mTLS planifiés pour une phase ultérieure ; ils sont requis avant toute utilisation hors lab de confiance.
- Limites de payload, de connexions et de cadence afin de réduire les risques de consommation abusive.
- Les fonctions de simulation ne doivent pas accepter d’instructions shell ou de commandes à travers les payloads.

### Observabilité

- Tous les événements importants doivent être journalisés avec application ID, session ID et peer ID si disponible.
- Les logs doivent indiquer clairement si un délai, une erreur ou une fermeture est simulé par le comportement serveur.
- Une option debug peut exposer les métadonnées de protocole, jamais les secrets ou le payload complet par défaut.

---

## 16. Critères d’acceptation MVP

### Création et activation

- Un utilisateur peut créer une application `ERP-TCP` sur TCP/8443, l’enregistrer puis l’activer.
- L’UI indique `LISTENING` lorsque le bind est réussi.
- Si le port 8443 est déjà occupé sur le host, l’UI montre un état `Listener Error` avec un message utilisable.
- Il est impossible d’activer deux applications utilisant le même port local sans adressage de bind compatible.

### Communication inter-instances

- Deux instances Stigix configurées avec la même application peuvent établir une session TCP A → B.
- L’instance B affiche une connexion entrante provenant de A.
- La connexion entrante montre le nom de site déclaré par A, son `instance_id`, son hostname, l’IP TCP observée et le session ID.
- L’instance A affiche l’état de la session, le RTT applicatif, les bytes TX/RX et les erreurs éventuelles.
- A et B peuvent simultanément lancer des sessions l’une vers l’autre.

### Comportements

- En mode Echo, chaque requête client reçoit une réponse corrélée à son request ID.
- En Fixed Delay à 1000 ms, le RTT applicatif observé augmente approximativement de 1000 ms, hors transport.
- En Drop Response à 20 %, les timeouts client augmentent et le serveur compte les drops simulés.
- En Close Connection après 10 requêtes, le client détecte la fermeture et se reconnecte si l’option est activée.

### Ergonomie

- L’utilisateur peut créer au moins trois profils sans éditer manuellement un fichier JSON.
- Il peut dupliquer une application existante pour créer une variante avec un autre port ou comportement.
- Il peut démarrer le listener sans démarrer de trafic client.
- Il peut lancer le trafic vers un peer sélectionné sans modifier les autres peers.
- Les détails avancés sont masqués par défaut et accessibles à la demande.

### Robustesse

- L’arrêt d’une application ferme proprement les listeners et sessions associés sans affecter Voice, Convergence, XFR, IoT, Traffic Generator ou le dashboard.
- Une perte de réseau déclenche une reconnexion bornée et ne crée pas une boucle CPU excessive ou une tempête de connexions.
- Les secrets, s’ils sont activés, ne figurent ni dans l’UI de lecture, ni dans les logs, ni dans l’historique exporté.

---

## 17. Décisions produit à prendre

Les questions suivantes nécessitent une décision avant l’implémentation finale :

| Sujet | Options | Recommandation initiale |
|---|---|---|
| Nom de la fonctionnalité | Custom TCP Apps, Inter-Site Apps, App Simulator | **Custom TCP Apps** pour le MVP ; explicite techniquement |
| Port par défaut | 8443, 9100, 10000+ | **8443** si disponible ; prévoir avertissement de conflit |
| Format protocolaire | JSON lines, framing binaire, HTTP/HTTPS | **Framing binaire léger** pour MVP, versionné |
| Auth MVP | aucune, token partagé, mTLS | **Allowlist CIDR + token optionnel** ; mTLS phase 2 |
| Identity locale | hostname seul, UUID, UUID + site name | **UUID stable + site name + hostname** |
| Persistance | JSON local, SQLite | **JSON versionné** cohérent avec Stigix ; SQLite si historique devient volumineux |
| Transport sécurisé | TCP clair, TLS optionnel, TLS obligatoire | TCP clair en lab MVP, **TLS/mTLS avant usage élargi** |
| Interface réseau | auto, par app, par peer | **Auto par défaut**, override avancé par app puis par peer si besoin |
| Modes avancés | dès MVP ou phase 2 | Echo/ACK/delay/drop/close en MVP ; script/custom protocol phase 2 |
| Corrélation Prisma SD-WAN | immédiate ou phase 2 | Phase 2 : enrichir par Flow Browser quand les champs de flux sont exploitables |

---

## 18. Phasage recommandé

### Phase 0 — Spike technique

Objectif : confirmer la faisabilité dans le conteneur Stigix existant en host mode.

- Implémenter un listener TCP minimal et un client request/reply.
- Vérifier coexistence avec port dashboard et autres services.
- Valider sessions bidirectionnelles entre deux instances Stigix.
- Mesurer comportement lors de coupure/retour de chemin.
- Tester les erreurs de bind, reconnect, et limites de ressources.

### Phase 1 — MVP utilisable

- CRUD des applications dans Settings.
- Plusieurs applications par instance.
- Listener TCP multi-ports et client multi-peers.
- Handshake avec instance ID/site name/session ID.
- Modes serveur Echo, ACK, Fixed Delay, Random Delay, Drop Response, Close Connection.
- Modes client Heartbeat, Transactional, Persistent Request/Reply.
- Vue entrante, vue sortante, métriques et historique basique.
- Validation de port, limites et allowlist CIDR.
- Démarrage/arrêt manuel et autostart listener.

### Phase 2 — Maturité démonstration SD-WAN

- Corrélation de sessions avec flows et chemin SD-WAN.
- Seuils SLA et états Good/Degraded/Bad similaires aux autres modules.
- Templates applicatifs enrichis : ERP transactionnel, point-of-sale, telemetry, database-like.
- TLS et authentification mutuelle.
- Export CSV/JSON de l’historique et des métriques.
- Schedules/scénarios et intégration plus directe avec VyOS sequences.
- Affichage topologique des peers et sessions actives.

### Phase 3 — Fonctions avancées éventuelles

- Profils HTTP/HTTPS, HTTP/2 ou gRPC pour une classification plus applicative.
- Overrides par peer plus complets.
- Gestion de groupes de peers et de campagnes multi-sites.
- API externe documentée et authentifiée pour l’orchestration.
- Détection ou import de peers depuis l’inventaire Prisma SD-WAN, sans autoconfiguration implicite.
- Stockage de métriques time-series si la volumétrie l’exige.

---

## 19. Risques et mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| Conflit de port host | Listener impossible à démarrer | Validation préalable, états explicites, port par défaut non réservé |
| Complexité UX avec plusieurs profils et peers | Fonction difficile à configurer | Assistant en étapes, templates, defaults, panneau Advanced replié |
| Confusion entre identité payload et identité sécurisée | Risque d’interprétation erronée | Afficher origine déclarée et observée séparément ; mTLS en phase 2 |
| Reconnexion agressive lors de panne | Charge inutile et bruit dans le lab | Backoff exponentiel, plafond de tentatives, jitter, limites par peer |
| Consommation excessive de ressources | Instabilité du conteneur/host | Limites sur sessions, payload, taux et taille de logs |
| Confusion avec iperf/XFR | Mauvais usage comme test de débit | Positionnement UI et documentation : simulateur applicatif, pas benchmark |
| Interprétation erronée de la convergence TCP | Résultats non comparables à UDP | Exposer « application recovery » distinct de « network interruption » |
| Évolutions de schéma | Configurations incompatibles après upgrade | Version de schéma, migration, sauvegarde avant conversion |
| Exposition involontaire sur réseau large | Surface d’attaque accrue | Allowlist, avertissements, token, TLS/mTLS cible, non-root ports |

---

## 20. Exemple utilisateur de bout en bout

### Objectif

Simuler une application ERP entre l’agence Paris et le datacenter Lyon, avec 20 sessions TCP persistantes et une transaction toutes les 500 ms.

### Configuration sur BR-PARIS-01

```text
Application : ERP-TCP
Listener : TCP/8443
Mode serveur : Echo
Mode client : Persistent Request/Reply
Peer : DC-LYON (10.20.30.40:8443)
Sessions : 20
Payload : 8192 bytes
Intervalle : 500 ms
Timeout : 3000 ms
Reconnect : enabled
```

### Configuration sur DC-LYON

```text
Application : ERP-TCP
Listener : TCP/8443
Mode serveur : Looping Delay
Phase normale : 60 s
Phase lente : 60 s
Délai en phase lente : 1500 ms
Peer : BR-PARIS-01 (10.10.10.25:8443), optionnel
```

### Résultat attendu

- Paris affiche 20 sessions sortantes vers Lyon.
- Lyon affiche 20 sessions entrantes, identifiées comme `BR-PARIS-01` via handshake, avec l’IP source réellement observée.
- Durant la phase lente de Lyon, le RTT applicatif Paris augmente d’environ 1,5 seconde et l’état devient Degraded selon le seuil configuré.
- Durant une coupure WAN, les timeouts et reconnexions sont visibles ; après bascule SD-WAN, l’UI calcule le délai de récupération applicative.
- Lyon peut, simultanément, initier son propre trafic vers Paris : aucune instance n’est limitée au rôle de target.

---

## 21. Positionnement final

Custom TCP Apps doit être présenté comme une capacité de **simulation d’applications inter-sites configurables**, conçue pour les laboratoires, démonstrations et validations SD-WAN/SASE.

La promesse à l’utilisateur est simple :

> Définissez une application TCP, activez son serveur sur chaque instance Stigix, reliez les instances comme peers, et observez le comportement réel de sessions applicatives bidirectionnelles à travers votre réseau.

Le facteur différenciant n’est pas de générer le plus grand nombre de Mbps. C’est de rendre visibles, contrôlables et reproductibles les effets du réseau sur une application TCP stateful : disponibilité, latence applicative, pertes de réponse, reconnexion et reprise de service.
