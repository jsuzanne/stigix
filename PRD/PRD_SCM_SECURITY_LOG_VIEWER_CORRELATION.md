# PRD — Stigix Security Module: SCM Log Viewer & Threat Policy Correlation Engine (Option B)

## 📌 Document Metadata
- **Feature Name**: Tiered Security Engine: Universal Black-Box Probing & SCM SASE White-Box Correlation
- **Status**: Approved for Roadmap / Targeted for Next Sprint
- **Target Branch**: `v2`
- **Author**: Stigix Core Engineering & AI Architecture
- **Date**: 2026-09-07
- **Reference Script**: [`Scripts/scm_traffic_log_viewer.py`](file:///Users/jsuzanne/Github/stigix/Scripts/scm_traffic_log_viewer.py)

---

## 1. Executive Summary & Vision

Le module de sécurité de Stigix génère des campagnes de tests automatisées (requêtes HTTP/HTTPS `curl` sur des catégories d'URL, résolutions `DNS` pour détection de Sinkhole/C2, transferts de fichiers `EICAR` pour validation Antivirus/WildFire).

Ce PRD introduit une **architecture à deux niveaux (Tiered Architecture)** qui concilie deux exigences fondamentales :

1. **Universalité Totale (Niveau 1 - Black-Box)** : Stigix reste 100% autonome et agnostique. Il peut tester la sécurité de n'importe quel réseau (Cisco, Fortinet, Check Point, Zscaler, box opérateur, lab personnel) sans nécessiter d'identifiants API, en extrapolant les verdicts à partir des comportements réseau (`TCP Reset`, `HTTP 403`, `DNS Sinkhole`).
2. **Excellence & Preuve Formelle en Environnement Palo Alto (Niveau 2 - White-Box)** : En environnement Palo Alto Networks (Strata Cloud Manager / Prisma Access / Prisma SD-WAN), Stigix active automatiquement un plugin d'enrichissement par API. Il élimine toute supposition ("reverse engineering") pour certifier la **vérité terrain** :
   - **Plateforme exacte d'inspection** : **`PRISMA_SDWAN`** (traitement local sur le boîtier ION) vs **`PRISMA_ACCESS`** (traitement cloud dans les SPN).
   - **Règle de sécurité active** (ex: `CAN-CustomRules`, `AllowWebTraffic`).
   - **Profil de menace réel** (ex: `EICAR Standard Anti-Virus Test File`, Threat ID `6000`, Catégorie `virus`, Action `RESET-BOTH`).
   - **Preuve PCAP** et journalisation **Cortex Data Lake (CDL)**.

---

## 2. Analyse Stratégique : Black-Box vs White-Box

```
+-----------------------------------------------------------------------------------------------+
| NIVEAU 1 : Moteur Universel Black-Box (TOUJOURS ACTIF & INDÉPENDANT DU CONSTRUCTEUR)         |
| • Exécute curl, dig, eicar sur n'importe quel réseau (Cisco, Fortinet, Zscaler, Palo, Home).  |
| • Interprète les codes retours, DNS Sinkhole, TCP Resets (Heuristiques).                     |
| • Fonctionne à 100% même SANS identifiants SCM / hors environnement Palo Alto.                |
+-----------------------------------------------------------------------------------------------+
                                               │
                                               │ Si identifiants SCM configurés (prisma-config.json)
                                               ▼
+-----------------------------------------------------------------------------------------------+
| NIVEAU 2 : Plugin d'Enrichissement SASE / SCM (OPTIONNEL & AUTOMATIQUE - Option B)            |
| • Interroge l'API Log Viewer SCM (1 seul appel consolidé post-batch).                         |
| • Transforme l'extrapolation Black-Box en certitude White-Box certifiée :                     |
|   - 🏷️  Plateforme exacte : PRISMA_SDWAN vs PRISMA_ACCESS                                     |
|   - 🛡️  Règle & Profile Group SCM réels                                                       |
|   - 🆔  Threat ID (ex: 6000 Virus/EICAR) & Catégorie réelle                                   |
|   - 📦  Preuve PCAP & Log Forwarding Cortex Data Lake                                         |
|   - 📑  Détection des règles masquées (Shadowed Rules)                                        |
+-----------------------------------------------------------------------------------------------+
```

### Tableau Comparatif :

| Dimension | Approche Black-Box (Niveau 1) | Approche White-Box Enrichie SCM (Niveau 2) |
| :--- | :--- | :--- |
| **Périmètre réseau** | Universel (Tout constructeur, tout réseau) | Écosystème Palo Alto Networks (SASE / SCM) |
| **Prérequis API** | Aucun (0 identifiant requis) | Service Account SCM (`config/prisma-config.json`) |
| **Détection du blocage** | Heuristique (`curl` timeout/RST, HTTP 403, Sinkhole) | Décision réelle journalisée dans le Log Viewer SCM |
| **Attribution de la plateforme** | Inconnue (impossible de savoir qui a coupé) | **`PRISMA_SDWAN`** (ION) vs **`PRISMA_ACCESS`** (Cloud) |
| **Règle de sécurité associée** | Inconnue | Règle exacte (`CAN-CustomRules`) + Dossier (`Remote Networks`) |
| **Profil de sécurité** | Inconnu | Profile Group exact (`CAN-ProfileGRP` / `best-practice`) |
| **Preuve PCAP** | Non liée | Lien vers la capture PCAP du firewall |

---

## 3. Les 3 Modes d'Exécution Opérationnels dans Stigix

Le module de sécurité de Stigix propose 3 modalités d'exécution adaptées à la fois aux tests interactifs et aux campagnes automatisées périodiques :

```
                                 MODES D'EXÉCUTION STIGIX SECURITY
                                                 │
          ┌──────────────────────────────────────┼──────────────────────────────────────┐
          │                                      │                                      │
          ▼                                      ▼                                      ▼
+──────────────────────────+          +──────────────────────────+          +──────────────────────────+
|  MODE 1 : TEST UNITAIRE  |          |  MODE 2 : BATCH MANUEL   |          | MODE 3 : BATCH PLANIFIÉ  |
|     (Clic Bouton ▶️)      |          | ("RUN SELECTED CAT.")    |          |   (Schedule ex: 60m)     |
|                          |          |                          |          |                          |
| • 1 seule cible testée   |          | • N catégories cochées   |          | • Exécution background   |
| • Exécution immédiate    |          | • Exécution de la salve  |          | • Périodicité régulière  |
| • Corrélation SCM flash  |          | • 1 SEUL appel SCM fin   |          | • 1 SEUL appel SCM fin   |
| • Feedback UI direct     |          | • Mise à jour en masse   |          | • Enrichissement stats   |
+──────────────────────────+          +──────────────────────────+          +──────────────────────────+
```

### 3.1 Mode 1 — Exécution Unitaire Interactive (Bouton ▶️ par Tuile)
- **Déclencheur** : L'utilisateur clique sur le bouton "Play" d'une catégorie spécifique (ex: `Abortion`, `Malware Sites`, `EICAR`).
- **Comportement** :
  1. Stigix lance la requête unitaire (`curl` ou `dig`).
  2. Il interroge immédiatement SCM (ou évalue la règle en mémoire via le cache des politiques synchronisées).
  3. La tuile s'anime et affiche directement le badge enrichi : `Blocked (PRISMA_SDWAN)` ou `Allowed (PRISMA_ACCESS)` et la règle matchée.
- **Usage typique** : Diagnostic ponctuel, vérification rapide d'un faux positif / faux négatif.

### 3.2 Mode 2 — Exécution Manuelle Multi-Sélection (Bouton "RUN SELECTED CATEGORIES")
- **Déclencheur** : L'utilisateur sélectionne $N$ cases à cocher (ex: 11 catégories actives sur 70) et clique sur le bouton rouge **"RUN SELECTED CATEGORIES"** (ou "RUN ALL").
- **Comportement (Smart Batch Correlation)** :
  1. Stigix enregistre l'horodatage de départ `T_start`.
  2. Stigix exécute la série des $N$ tests séquentiellement ou avec un pool de threads maîtrisé.
  3. Stigix enregistre l'horodatage de fin `T_end`.
  4. **Un seul appel API SCM** est déclenché sur la fenêtre `[T_start - T_end]` pour corréler les $N$ flux d'un coup.
  5. Toutes les tuiles et lignes du tableau sont mises à jour simultanément.
- **Usage typique** : Validation d'un changement de politique de sécurité en direct lors d'un POC.

### 3.3 Mode 3 — Exécution Planifiée / Batch Automatique (Background Scheduler ex: `60m`)
- **Déclencheur** : Le toggle planificateur est activé (ex: `URL Schedule: 60m`, `DNS Schedule: 15m`).
- **Comportement** :
  1. Le moteur d'arrière-plan de Stigix se réveille périodiquement et lance la campagne sur toutes les catégories activées.
  2. Même mécanique d'Option B : un seul appel API post-batch par cycle.
  3. Les résultats enrichis (verdict client + verdict SCM + plateforme) sont enregistrés dans l'historique `test_history` et alimentent les scores de conformité (`ScoreDashboard`).
- **Usage typique** : Surveillance continue de la posture de sécurité sur un ou plusieurs sites distants, détection de dérives de politique.

---

## 4. Architecture Fonctionnelle & Workflow (Option B)

```
+--------------------------------------------------------------------------------------------------------+
|                                    STIGIX SECURITY TEST EXECUTION                                      |
+--------------------------------------------------------------------------------------------------------+
   |
   | 1. Lancement du lot de tests (Mode 2 ou Mode 3 : ex: 30 requêtes URL, 5 EICAR, 10 DNS)
   v
+------------------------------------+
| STIGIX CLIENT RUNNER (T_start)     |
| • Exécute curl, dig, eicar         | ------> [ Flux traversant l'ION SD-WAN / Prisma Access ]
| • Collecte métadonnées locales :   |                            |
|   - Horodatage T_test              |                            v
|   - Port source / IP source        |               +----------------------------------+
|   - Code retour client (Reset/403) |               | PALO ALTO SASE / FIREWALL ENGINE |
+------------------------------------+               | • Inspection L7 / WildFire       |
   |                                                 | • Blocage & Log vers CDL         |
   | 2. Fin du lot (T_end)                           +----------------------------------+
   v                                                              |
+-------------------------------------------------------------+   | 3. Logs consolidés dans SCM
| 4. BATCH CORRELATION ENGINE (1 seul appel API SASE)         |<--+
| • Requête SCM sur la fenêtre [T_start, T_end] & IP source   |
| • Corrélation 1-à-1 des événements locaux avec les logs SCM |
+-------------------------------------------------------------+
   |
   v
+--------------------------------------------------------------------------------------------------------+
| 5. RAPPORT DE SÉCURITÉ CONSOLIDÉ (Web Dashboard & CLI & Export PDF)                                    |
| [Client Verdict] + [SCM Rule & Threat ID] + [Platform: PRISMA_SDWAN vs PRISMA_ACCESS] + [PCAP Link]   |
+--------------------------------------------------------------------------------------------------------+
```

---

## 5. Spécifications Détaillées des Données

### 5.1 Modèle de Données Enrichi (`EnhancedSecurityTestResult`)

Chaque test dans `test_history` contiendra les informations suivantes :

```typescript
interface EnhancedSecurityTestResult {
    // 1. Données du Test Stigix (Niveau 1 - Client)
    testId: number;
    testType: 'url_filtering' | 'dns_security' | 'threat_prevention';
    testName: string;                     // ex: "EICAR Test File Download", "Gambling URL"
    targetUrlOrIp: string;                // ex: "http://192.168.206.10/eicar.com"
    timestamp: number;                    // Horodatage UTC
    executionMode: 'single_click' | 'manual_batch' | 'scheduled_batch';
    clientResult: {
        rawStatus: string;                // "RESET", "BLOCKED_HTTP_403", "ALLOWED_200", "SINKHOLED"
        httpCode?: number;                // 200, 403, 0
        resolvedIp?: string;              // "72.5.65.111" (Sinkhole)
        sourceIp: string;                 // "192.168.219.1"
        sourcePort: number;               // 56400
        destinationIp: string;            // "192.168.206.10"
        destinationPort: number;          // 80
    };

    // 2. Données corrélées SCM Log Viewer (Niveau 2 - Optionnel)
    scmCorrelation?: {
        matched: boolean;
        platformType: 'PRISMA_SDWAN' | 'PRISMA_ACCESS'; // 🏷️ Plateforme de traitement
        logType: 'THREAT' | 'TRAFFIC' | 'URL';
        severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Informational';
        matchedRule: string;              // ex: "CAN-CustomRules"
        folder: string;                   // ex: "Remote Networks", "Shared"
        enforcementAction: string;        // "RESET-BOTH", "DROP", "ALLOW"
        threatName?: string;              // ex: "EICAR Standard Anti-Virus Test File"
        threatId?: string;                // ex: "6000 (Virus/Win32.Worm.Eicar.1)"
        profileGroup?: string;            // ex: "CAN-ProfileGRP", "best-practice"
        decryptionStatus?: string;        // "SSL Decrypt (DoNotDecriptAll)"
        logForwarding: string;            // "Cortex Data Lake"
        pcapAvailable: boolean;           // true
        shadowedRulesCount?: number;      // 14
    };

    // 3. Verdict Global de Conformité
    verdict: {
        status: 'PASSED' | 'FAILED' | 'WARNING';
        summary: string;                  // "✅ Bloqué avec succès par Prisma SD-WAN (Règle CAN-CustomRules)"
    };
}
```

---

## 6. Interface Utilisateur (Web Dashboard Stigix)

### 6.1 Tuiles de Catégories Interactives
Sur chaque tuile de catégorie (ex: `Abortion`, `Dynamic DNS`, `Adult Content`) :
- **Badge de statut enrichi** :
  - `🔴 Blocked (PRISMA_SDWAN)`
  - `🔴 Blocked (PRISMA_ACCESS)`
  - `🟢 Allowed (PRISMA_ACCESS)`
- **Bouton Play unitaire (▶️)** : Déclenche le test unitaire (Mode 1) avec feedback visuel direct.

### 6.2 Tableau de Résultats & Historique
Dans le tableau récapitulatif du Dashboard ([`web-dashboard/src/Security.tsx`](file:///Users/jsuzanne/Github/stigix/web-dashboard/src/Security.tsx)) :

| Horodatage | Mode | Type de Test | Cible | Constat Client | Verdict SCM | Règle SCM | Plateforme | Statut |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `21:38:37` | `Unit` | **Threat (EICAR)** | `192.168.206.10:80` | 🛑 `TCP Reset` | 🛑 `RESET-BOTH` | `CAN-CustomRules` | <span style="background:#e0f2fe;color:#0369a1;padding:2px 6px;border-radius:4px;font-weight:600;">PRISMA_SDWAN</span> | ✅ **PASS** |
| `21:38:40` | `Batch` | **URL (Gambling)** | `https://poker.com` | 🛑 `HTTP 403` | 🛑 `BLOCK` | `Web-Security-Default` | <span style="background:#f0fdf4;color:#15803d;padding:2px 6px;border-radius:4px;font-weight:600;">PRISMA_ACCESS</span> | ✅ **PASS** |
| `21:38:42` | `Batch` | **DNS (C2)** | `malicious-c2.net` | 🛑 `Sinkhole IP` | 🛑 `SINKHOLE` | `best-practice` | <span style="background:#e0f2fe;color:#0369a1;padding:2px 6px;border-radius:4px;font-weight:600;">PRISMA_SDWAN</span> | ✅ **PASS** |
| `21:38:45` | `Sched` | **HTTP (Google)** | `https://google.com` | 🟢 `HTTP 200` | 🟢 `ALLOW` | `AllowWebTraffic` | <span style="background:#f0fdf4;color:#15803d;padding:2px 6px;border-radius:4px;font-weight:600;">PRISMA_ACCESS</span> | ✅ **PASS** |

### 6.3 Tiroir de Détails (Drawer / Modal)
En cliquant sur une ligne, un tiroir latéral affiche la **fiche complète du Log Viewer SCM** avec :
- Les interfaces d'entrée (`vlan.219`) et de sortie (`ethernet0/1`).
- Le bouton de téléchargement PCAP (`⬇️ Télécharger le PCAP`).
- La liste des **Shadowed Rules** (règles masquées qui auraient matché si la première règle n'était pas là).

---

## 7. Analyse de Complexité & Faisabilité Technique

### 7.1 Complexité estimée : **TRÈS SIMPLE et MODULAIRE**

#### Pourquoi ?
1. **Moteur déjà existant et opérationnel** : Le script [`Scripts/scm_traffic_log_viewer.py`](file:///Users/jsuzanne/Github/stigix/Scripts/scm_traffic_log_viewer.py) est déjà codé, testé, autonome (0 dépendance) et connecté avec succès à l'API SASE Gateway.
2. **Point d'entrée backend unique** : Dans [`web-dashboard/server.ts`](file:///Users/jsuzanne/Github/stigix/web-dashboard/server.ts), la fonction qui exécute les batchs de sécurité n'a besoin que d'un appel post-batch :
   ```typescript
   // À la fin de runSecurityBatch():
   const scmResults = await executeScmLogCorrelation({
       startTime: batchStartTime,
       endTime: batchEndTime,
       sourceIp: localHostIp,
       testCount: batchTests.length
   });
   ```
3. **Zéro impact sur le moteur de trafic principal** : La génération de paquets reste inchangée, la corrélation SCM n'intervient qu'en étape de reporting/enrichissement.
4. **Fallback gracieux automatique** : Si `prisma-config.json` n'est pas présent (environnement non-Palo Alto), Stigix désactive le Niveau 2 sans aucune erreur et affiche les résultats Niveau 1.

---

## 8. Plan d'Implémentation & Jalons

| Phase | Description | Fichiers impactés | Complexité |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Moteur Python autonome avec support `--json`, `--limit`, `--platform` | [`Scripts/scm_traffic_log_viewer.py`](file:///Users/jsuzanne/Github/stigix/Scripts/scm_traffic_log_viewer.py) | **Terminé ✅** |
| **Phase 2** | Endpoint backend `/api/security/correlate-scm` et hook post-batch | [`web-dashboard/server.ts`](file:///Users/jsuzanne/Github/stigix/web-dashboard/server.ts) | Faible (1 jour) |
| **Phase 3** | Mise à jour UI : Badges de plateforme sur tuiles, colonnes SCM, drawer de détails PCAP | [`web-dashboard/src/Security.tsx`](file:///Users/jsuzanne/Github/stigix/web-dashboard/src/Security.tsx) | Faible (1 jour) |
| **Phase 4** | Intégration CLI (`stigix security-test --with-scm-check`) | [`Scripts/stigix-cli.py`](file:///Users/jsuzanne/Github/stigix/Scripts/stigix-cli.py) | Très faible (0.5 jour) |

---

## 9. Critères d'Acceptation & Validation

1. **Précision 100%** : Le test EICAR doit être flagué avec `platformType: PRISMA_SDWAN`, `Threat ID: 6000`, `Action: RESET-BOTH`.
2. **Performance Batch** : Un lot de 30 tests ne doit générer qu'une seule requête de corrélation API et s'exécuter en moins de 3 secondes totales.
3. **Résilience hors-ligne / Non-Palo Alto** : Si les identifiants SCM ne sont pas configurés, Stigix affiche le résultat client normal (Niveau 1) sans bloquer ni alerter d'erreur.
