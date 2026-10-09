# 🛠️ Guide Complet : Maintenance, Mises à Jour & Sauvegardes Stigix

Ce guide détaille le fonctionnement, l'impact technique et les bonnes pratiques pour toutes les options disponibles dans le menu **Settings ➔ Maintenance & Updates** (ainsi que le bandeau rapide de **System Info**).

---

## Sommaire
1. [Vue d'ensemble de l'interface](#1-vue-densemble-de-linterface)
2. [Section 1 : Mises à jour du Système (System Updates)](#2-section-1--mises-à-jour-du-système-system-updates)
   - [Bouton « Update To v... »](#bouton--update-to-v-)
   - [Bouton « Force Pull »](#bouton--force-pull-)
   - [La Console « Upgrade Monitor »](#la-console--upgrade-monitor-)
   - [Gestion des canaux de mise à jour (v2 vs Stable)](#gestion-des-canaux-de-mise-à-jour-v2-vs-stable)
3. [Section 2 : Redémarrages Système (Service Restart vs Redeploy)](#3-section-2--redémarrages-système-service-restart-vs-redeploy)
   - [Option A : Service Restart (Soft Reload)](#option-a--service-restart-soft-reload)
   - [Option B : System Redeploy (Hard Recreate)](#option-b--system-redeploy-hard-recreate)
4. [Section 3 : Sauvegarde & Restauration (Configuration Backup)](#4-section-3--sauvegarde--restauration-configuration-backup)
   - [Export Engine State (Ce qui est inclus vs non inclus)](#export-engine-state-ce-qui-est-inclus-vs-non-inclus)
   - [Restore State & Mécanisme de sécurité pré-import](#restore-state--mécanisme-de-sécurité-pré-import)
5. [Tableau récapitulatif des impacts & temps d'arrêt](#5-tableau-récapitulatif-des-impacts--temps-darrêt)

---

## 1. Vue d'ensemble de l'interface

Le menu de maintenance est accessible depuis :
- **Chemin direct** : Barre latérale gauche ➔ **Settings (⚙️)** ➔ Onglet **Maintenance & Updates (🔄)**.
- **Raccourci rapide** : Onglet **System Info** ➔ Bandeau supérieur *"Stigix Engine Version"*.

---

## 2. Section 1 : Mises à jour du Système (System Updates)

Cette section orchestre l'auto-mise à jour du conteneur Stigix via Docker Hub de façon 100% automatisée et sécurisée.

```
[1. CLIC UTILISATEUR] ──> [2. PULL SÉCURISÉ (3x retries)] ──> [3. UPDATER ÉPHÉMÈRE DÉTACHÉ] ──> [4. RECONNEXION AUTO]
```

### Bouton « Update To v... »
- **Rôle** : Déclenche la mise à jour lorsque le système détecte qu'un build plus récent est disponible sur Docker Hub pour ton canal.
- **Fonctionnement technique** :
  1. Lance en tâche de fond le téléchargement (`docker pull`) de la nouvelle image.
  2. Effectue jusqu'à **3 tentatives automatiques** en cas de micro-coupure réseau ou de rate-limit.
  3. **Sécurité Zero-Downtime** : Tant que le pull n'a pas réussi à 100%, l'ancien conteneur **reste actif et ne s'arrête jamais**. Si le pull échoue, l'opération est avortée sans aucun impact.
  4. Dès que l'image est téléchargée, Stigix délègue la recréation à un micro-conteneur tiers éphémère (`stigix-updater`) lancé avec `--entrypoint /bin/sh`.
  5. Le helper recrée le conteneur via Docker Compose (`docker compose up -d --force-recreate`), valide la santé du nouveau conteneur sur `/api/health`, puis s'auto-détruit (`--rm`).
- **Impact** : Coupure de service très brève de **3 à 6 secondes** pendant la bascule du conteneur.
- **Données conservées** : 100% des configurations, historiques et logs persistés sur les volumes montés.

### Bouton « Force Pull »
- **Rôle** : Force le re-téléchargement immédiat de l'image Docker Hub et la recréation du conteneur, **même si le numéro de version affiché est identique**.
- **Cas d'usage typiques** :
  - Tu viens de pousser un correctif sur la branche `v2` et le build Docker Hub vient de se terminer.
  - Tu veux récupérer la dernière version sans attendre un incrément de numéro de version sur GitHub.
- **Impact** : Identique au bouton Update.

### La Console « Upgrade Monitor »
Pendant la procédure, une console interactive sombre s'ouvre sous les boutons :
- **Phase PULLING** : Affiche les couches Docker téléchargées et décompressées en direct.
- **Phase RESTARTING** : Affiche un bandeau bleu animé. L'UI bascule en polling discret toutes les 2 secondes sans afficher d'erreur réseau rouge.
- **Phase COMPLETE** : Affiche un toast vert dès que le nouveau conteneur répond, et actualise le numéro de version.

### Gestion des canaux de mise à jour (v2 vs Stable)
Le moteur Stigix détecte automatiquement le canal de déploiement de l'instance locale :
- **Instance sur le canal `v2`** :
  - Analyse l'image locale `jsuzanne/stigix:v2`.
  - Vérifie les mises à jour sur l'endpoint Docker Hub du tag `v2`.
  - Ne télécharge que des images `v2`.
- **Instance sur le canal `stable`** :
  - Analyse l'image locale `jsuzanne/stigix:stable`.
  - Vérifie les releases stables officielles.
  - **Ne propose jamais** de build de développement `v2` pour ne pas déstabiliser une production.

---

## 3. Section 2 : Redémarrages Système (Service Restart vs Redeploy)

Deux modes de redémarrage aux impacts très différents sont proposés :

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Option A : Service Restart (Soft)    │ Option B : System Redeploy (Hard)                │
├──────────────────────────────────────┼──────────────────────────────────────────────────┤
│ Redémarre les processus internes     │ Recrée entièrement le conteneur Docker          │
│ Temps d'arrêt : 1 à 2 secondes       │ Temps d'arrêt : 5 à 10 secondes                  │
│ Le conteneur Docker reste allumé     │ Le conteneur Docker est détruit et recréé        │
│ Ne recharge PAS le docker-compose    │ Recharge le docker-compose.yml et le fichier .env│
└──────────────────────────────────────┴──────────────────────────────────────────────────┘
```

### Option A : Service Restart (Soft Reload)
- **Commande sous-jacente** : `supervisorctl restart all` exécuté à l'intérieur du conteneur.
- **Ce qui est redémarré** :
  - Le serveur web Node.js / Express (`web-dashboard`).
  - Le générateur de trafic SD-WAN (`traffic-generator.sh`).
  - Les moteurs de simulation Voice / RTP, IoT, Custom TCP, et XFR Speedtest.
- **Quand l'utiliser ?**
  - Après avoir modifié des fichiers de configuration JSON à la main.
  - Pour libérer de la mémoire RAM en cas de fuite de processus.
  - Pour réinitialiser l'état des simulations sans couper Docker.
- **Impact** : Très faible. Les flux réseau s'interrompent 1 à 2 secondes et reprennent instantanément. Le conteneur Docker ne change pas de PID.

### Option B : System Redeploy (Hard Recreate)
- **Commande sous-jacente** : `docker compose -f docker-compose.yml up -d --force-recreate` via conteneur éphémère.
- **Ce qui est redémarré** : L'ensemble du conteneur Docker de fond en comble.
- **Quand l'utiliser ?**
  - Tu as modifié des variables d'environnement dans ton fichier `.env` (ex: `PRISMA_SDWAN_CLIENT_SECRET`, `PORT`, `JWT_SECRET`).
  - Tu as modifié le fichier `docker-compose.yml` (nouveaux volumes, nouveaux ports, modification des `cap_add`).
  - Le démon Docker local a des problèmes de socket ou de réseau virtuel.
- **Impact** : Interruption complète de Stigix pendant **5 à 10 secondes** le temps de recréer le conteneur et de réinitialiser Supervisord.

---

## 4. Section 3 : Sauvegarde & Restauration (Configuration Backup)

Cette section permet d'exporter l'intégralité du paramétrage logique de Stigix dans un fichier JSON portable ou de restaurer une configuration précédente.

### Export Engine State (Téléchargement du Bundle)

Le bouton **Download Bundle** génère un fichier nommé `stigix-backup-YYYY-MM-DD.json`.

#### ✅ Ce qui EST sauvegardé dans le Bundle :
Tous les fichiers de paramétrage stockés dans `/app/config/` (volume `./config`) :
1. **Règles Applicatives & Trafic** : `applications-config.json`, `connectivity-custom.json`.
2. **Simulations Voix & Téléphonie** : `voice-config.json` (serveurs SIP, codecs, gigue, profils).
3. **Périphériques IoT** : `iot-devices.json` (capteurs, compteurs d'énergie, caméras, intervalles).
4. **Applications Custom TCP & DEM** : `custom-tcp-applications.json` (ports d'écoute, profils TCP).
5. **Routeurs & Intégration VyOS** : `vyos-config.json` (adresses IP, clés API, interfaces).
6. **Contrôle & Convergence SD-WAN** : `convergence-config.json`, `convergence-endpoints.json`.
7. **Profils de Sécurité & Failles** : `security-profile.json`, `security-config.json`.
8. **Identité de Nœud & Paramètres Cluster** : `identity.json`, `site-detection.json`, `static-leader.json`.
9. **Comptes Utilisateurs Locaux** : `users.json` (utilisateurs et mots de passe hashés).
10. **Identifiants API Prisma SASE** : `prisma-config.json`.
11. **Historique des Tests XFR** : `xfr-history.json`.

#### ❌ Ce qui N'EST PAS sauvegardé dans le Bundle (et pourquoi) :
| Élément exclu | Raison technique | Où est-il stocké ? |
| :--- | :--- | :--- |
| **Fichiers binaires PCAP** (`pcap-uploads/`, `pcap-profiles/`) | Fichiers volumineux (jusqu'à plusieurs Go). Exclus pour garder le backup ultra-léger (< 500 Ko). | Répertoire `./config/pcap-uploads/` sur l'hôte. |
| **Certificats TLS locaux** (`certs/`) | Clés privées cryptographiques générées localement par instance. | Répertoire `./config/certs/` sur l'hôte. |
| **Variables d'environnement système** (`.env`) | Non stockées dans `config/`. Ce sont des variables injectées par Docker à l'hôte. | Fichier `.env` à la racine de Stigix. |
| **Fichiers de logs opérationnels** | Données volatiles de traçabilité. | Répertoire `./logs/` sur l'hôte. |
| **Bases Vectorielles / Données MCP** | Cache des modèles IA. | Répertoire `./mcp-data/` sur l'hôte. |
| **Fichiers temporaires** (`.backup.*`, `test-counter.json`) | Fichiers de travail automatiques éphémères. | Nettoyés à la volée. |

---

## 5. Tableau récapitulatif des impacts & temps d'arrêt

| Action | Commande interne | Temps d'arrêt estimé | Impact sur les flux | Risque |
| :--- | :--- | :--- | :--- | :--- |
| **Update To Latest** | `pull` ➔ `compose up -d --force-recreate` | 3 à 5 secondes | Interruption brève le temps du switch | **Très faible** (Annulé si le pull échoue) |
| **Force Pull** | `pull (forcé)` ➔ `compose up -d --force-recreate` | 3 à 5 secondes | Interruption brève le temps du switch | **Très faible** (Même canal préservé) |
| **Service Restart** | `supervisorctl restart all` | 1 à 2 secondes | Coupure micro des sockets TCP/UDP | **Nul** (Conteneur reste up) |
| **System Redeploy** | `compose up -d --force-recreate` | 5 à 10 secondes | Coupure complète du conteneur | **Faible** (Recharge `.env` et compose) |
| **Export Bundle** | Lecture JSON en mémoire | **0 seconde** (En ligne) | Aucun impact | **Aucun** (Lecture seule) |
| **Restore Bundle** | Écriture JSON + reboot serveur | ~2 secondes | Rechargement complet de la configuration | **Moyen** (Écrase la configuration actuelle après snapshot de secours) |
