# PRD — Stigix Security Module: SCM Log Viewer & Threat Correlation (Option B)

## 📌 Document Metadata
- **Feature Name**: SCM Log Viewer & Threat Policy Correlation Engine for Stigix Security Testing
- **Status**: Draft / Proposed
- **Target Branch**: `v2`
- **Author**: Stigix Core Engineering & AI Architecture
- **Date**: 2026-09-06
- **Reference Script**: [`Scripts/scm_traffic_log_viewer.py`](file:///Users/jsuzanne/Github/stigix/Scripts/scm_traffic_log_viewer.py)

---

## 1. Executive Summary

Le module de sécurité actuel de Stigix génère des campagnes de tests automatisées (requêtes HTTP/HTTPS `curl` sur des catégories d'URL, résolutions `DNS` pour détection de Sinkhole/C2, transferts de fichiers `EICAR` pour validation Antivirus/WildFire).

Aujourd'hui, Stigix évalue le résultat **uniquement du point de vue du client** (ex: `curl timeout`, `connection reset`, `HTTP 403`, `DNS NXDOMAIN`).

**Objectif du PRD** : Intégrer une corrélation intelligente et par lot (**Smart Batch Correlation - Option B**) avec les APIs Strata Cloud Manager (SCM) et Prisma Access / SD-WAN. 

Cette corrélation permet de réconcilier automatiquement chaque test client avec le **journal réel du Log Viewer SCM** :
1. **Règle de sécurité active** (ex: `CAN-CustomRules`, `AllowWebTraffic`, `Web-Security-Default`).
2. **Menace & Profil détectés** (ex: `EICAR Standard Anti-Virus Test File`, Threat ID `6000`, Catégorie `virus`, Action `RESET-BOTH`).
3. **Plateforme d'inspection** (**`PRISMA_SDWAN`** sur le boîtier ION vs **`PRISMA_ACCESS`** dans les SPN Cloud).
4. **Disponibilité des captures de paquets (PCAP)** et **Forwarding Cortex Data Lake (CDL)**.

---

## 2. Contexte & Cas d'Usage (POC & Multi-Instance)

### 2.1 Contexte POC (Proof of Concept)
Dans 90% des démonstrations ou validations clients (POC), le testeur Stigix est déployé sur **un site de branche** (derrière un ION Prisma SD-WAN avec passerelle vers Prisma Access) :
- Le testeur valide l'efficacité des politiques de sécurité NGFW / SASE.
- Le client final et l'ingénieur avant-vente demandent immédiatement la preuve dans le **Log Viewer SCM** : *"Est-ce bien Prisma SD-WAN ou Prisma Access qui a bloqué ce flux EICAR ? Quelle règle a matché ?"*.

### 2.2 Contexte Multi-Instances (Trafic programmé en lot)
Les instances Stigix exécutent également des batchs planifiés périodiques (ex: 30 tests toutes les 15 minutes) :
- **Contrainte critique** : Ne pas saturer les quotas de requêtes API Palo Alto Networks (rate limiting) en évitant de faire 1 appel API par test individuel.
- **Solution Option B** : Lancer la salve de 30 tests localement, puis effectuer **1 seul appel API de réconciliation groupée** sur la fenêtre temporelle `[T_start - T_end]`.

---

## 3. Architecture Fonctionnelle & Choix de l'Option B

```
+--------------------------------------------------------------------------------------------------------+
|                                    STIGIX SECURITY TEST EXECUTION                                      |
+--------------------------------------------------------------------------------------------------------+
   |
   | 1. Lancement du lot de tests (ex: 30 requêtes URL, 5 EICAR, 10 DNS)
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

## 4. Spécifications Détaillées des Données

### 4.1 Modèle de Données Enrichi (`EnhancedSecurityTestResult`)

Chaque test dans `test_history` contiendra les informations suivantes :

```typescript
interface EnhancedSecurityTestResult {
    // 1. Données du Test Stigix (Client)
    testId: number;
    testType: 'url_filtering' | 'dns_security' | 'threat_prevention';
    testName: string;                     // ex: "EICAR Test File Download", "Gambling URL"
    targetUrlOrIp: string;                // ex: "http://192.168.206.10/eicar.com"
    timestamp: number;                    // Horodatage UTC
    clientResult: {
        rawStatus: string;                // "RESET", "BLOCKED_HTTP_403", "ALLOWED_200", "SINKHOLED"
        httpCode?: number;                // 200, 403, 0
        resolvedIp?: string;              // "72.5.65.111" (Sinkhole)
        sourceIp: string;                 // "192.168.219.1"
        sourcePort: number;               // 56400
        destinationIp: string;            // "192.168.206.10"
        destinationPort: number;          // 80
    };

    // 2. Données corrélées SCM Log Viewer (Firewall)
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

## 5. Interface Utilisateur (Web Dashboard Stigix)

### 5.1 Tableau de Résultats Enrichi (Onglet Security)

Dans le tableau des tests du Dashboard ([`web-dashboard/src/Security.tsx`](file:///Users/jsuzanne/Github/stigix/web-dashboard/src/Security.tsx)) :

| Horodatage | Type de Test | Cible | Constat Client | Verdict SCM (Log Viewer) | Règle SCM | Plateforme | Statut |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `21:38:37` | **Threat (EICAR)** | `192.168.206.10:80` | 🛑 `TCP Reset` | 🛑 `RESET-BOTH (Virus)` | `CAN-CustomRules` | <span style="background:#e0f2fe;color:#0369a1;padding:2px 6px;border-radius:4px;font-weight:600;">PRISMA_SDWAN</span> | ✅ **PASS** |
| `21:38:40` | **URL (Gambling)** | `https://poker.com` | 🛑 `HTTP 403` | 🛑 `BLOCK (URL Filtering)`| `Web-Security-Default` | <span style="background:#f0fdf4;color:#15803d;padding:2px 6px;border-radius:4px;font-weight:600;">PRISMA_ACCESS</span> | ✅ **PASS** |
| `21:38:42` | **DNS (C2)** | `malicious-c2.net` | 🛑 `Sinkhole IP` | 🛑 `SINKHOLE (DNS Sec)` | `best-practice` | <span style="background:#e0f2fe;color:#0369a1;padding:2px 6px;border-radius:4px;font-weight:600;">PRISMA_SDWAN</span> | ✅ **PASS** |
| `21:38:45` | **HTTP (Google)** | `https://google.com` | 🟢 `HTTP 200` | 🟢 `ALLOW` | `AllowWebTraffic` | <span style="background:#f0fdf4;color:#15803d;padding:2px 6px;border-radius:4px;font-weight:600;">PRISMA_ACCESS</span> | ✅ **PASS** |

### 5.2 Tiroir de Détails (Drawer / Modal)
En cliquant sur une ligne, un tiroir latéral affiche la **fiche complète du Log Viewer SCM** avec :
- Les interfaces d'entrée (`vlan.219`) et de sortie (`ethernet0/1`).
- Le bouton de téléchargement PCAP (`⬇️ Télécharger le PCAP`).
- La liste des **Shadowed Rules** (règles masquées qui auraient matché si la première règle n'était pas là).

---

## 6. Analyse de Complexité & Faisabilité Technique

### 6.1 Question : Est-ce complexe ou simple à implémenter ?

**Réponse : C'est une modification TRÈS SIMPLE, modulaire et à faible risque.**

#### Pourquoi est-ce simple ?
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

---

## 7. Plan d'Implémentation Étape par Étape

| Phase | Description | Fichiers impactés | Complexité |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Export du moteur Python sous forme de module/sous-processus invocable en JSON (`--json`) | [`Scripts/scm_traffic_log_viewer.py`](file:///Users/jsuzanne/Github/stigix/Scripts/scm_traffic_log_viewer.py) | **Terminé ✅** |
| **Phase 2** | Ajout de l'endpoint backend `/api/security/correlate-scm` et hook dans le batch runner | [`web-dashboard/server.ts`](file:///Users/jsuzanne/Github/stigix/web-dashboard/server.ts) | Faible (1 jour) |
| **Phase 3** | Mise à jour de l'interface graphique : Badge `PRISMA_SDWAN` / `PRISMA_ACCESS`, colonnes SCM, tiroir de détails PCAP | [`web-dashboard/src/Security.tsx`](file:///Users/jsuzanne/Github/stigix/web-dashboard/src/Security.tsx) | Faible (1 jour) |
| **Phase 4** | Intégration CLI (`stigix security-test --with-scm-check`) | [`Scripts/stigix-cli.py`](file:///Users/jsuzanne/Github/stigix/Scripts/stigix-cli.py) | Très faible (0.5 jour) |

---

## 8. Critères d'Acceptation & Validation

1. **Précision 100%** : Le test EICAR doit être flagué avec `platformType: PRISMA_SDWAN`, `Threat ID: 6000`, `Action: RESET-BOTH`.
2. **Performance Batch** : Un lot de 30 tests ne doit générer qu'une seule requête de corrélation API et s'exécuter en moins de 3 secondes totales.
3. **Résilience hors-ligne** : Si les identifiants SCM ne sont pas configurés ou si l'API est temporairement inaccessible, Stigix affiche le résultat client normal sans bloquer le test.
