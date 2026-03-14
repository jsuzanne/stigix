# Stigix API Reference pour l'Orchestrateur MCP

Ce document liste les routes API HTTP (`:3000` ou `:8080` selon la configuration) exposées par les instances "Target" (les agents Stigix) et consommées par le **Serveur MCP** pour orchestrer les tests (XFR, Convergence, Traffic, Voix).

Toutes les requêtes vers les agents nécessitent un header d'authentification :
`Authorization: Bearer <JWT_TOKEN>`

---

## 1. Découverte et Topologie (Stigix Registry)

Le MCP Server (via `registry.py`) interroge le Cloudflare Worker central pour découvrir les nœuds actifs.

### `GET https://stigix-registry.stigix.workers.dev/api/peers`

*   **Description** : Récupère la liste de tous les agents enregistrés sur le réseau de démonstration.
*   **Réponse Attendue** (Tableau JSON) :
```json
[
  {
    "id": "Hetzner-Ubuntu",
    "public_ip": "142.132.193.157",
    "private_ips": ["10.0.0.1"],
    "api_port": 3000,
    "last_seen": 1710411123456,
    "metadata": {
      "kind": "fabric",
      "site_name": "Hetzner DC"
    }
  }
]
```

---

## 2. Speedtests (XFR)

Routes pour déclencher et surveiller les transferts de données bruts.

### `POST /api/tests/xfr`

*   **Description** : Démarre un test de débit XFR.
*   **Payload** :
```json
{
  "mode": "custom", 
  "target": { 
      "host": "142.132.193.157", 
      "port": 9000 
  },
  "protocol": "tcp",              // "tcp", "udp", "quic"
  "direction": "bidirectional",   // "client-to-server", "server-to-client", "bidirectional"
  "duration_sec": 30,             // Durée du test (secondes)
  "bitrate": "0",                 // 0 = illimité, ou ex: "200M"
  "parallel_streams": 4
}
```
*   **Réponse** :
```json
{
  "success": true,
  "job_id": "G-20260313-ABCD",    // ID Global (Dashboard)
  "sequence_id": "XFR-0007"       // ID Séquentiel Natif Backend
}
```

### `POST /api/tests/status`

*   **Description** : Interroge le statut d'un test XFR en cours ou terminé.
*   **Payload** : `{"testId": "G-20260313-ABCD"}` (Utilise le `job_id` global).
*   **Réponse** :
```json
{
  "success": true,
  "status": "success",            // "running", "success", "failed"
  "received_mbps": 85.4,          // Extraction du débit
  "rtt_ms_avg": 22.1,             // Latence moyenne
  "packet_loss_percent": 0.0      // Perte de paquets (si UDP)
}
```

---

## 3. Convergence (Failover Probes)

Routes pour lancer des sondes continues mesurant la latence, la gigue et les coupures réseau (blackouts). Les tests de convergence n'ont pas de durée limite par défaut : ils s'exécutent jusqu'à l'appel explicite de `/stop`.

### `POST /api/convergence/start`

*   **Description** : Démarre l'orchestrateur de convergence Python en tâche de fond.
*   **Payload** :
```json
{
  "target": "192.168.217.5",
  "port": 6100,                   // Port par défaut des sondes UDP
  "rate": 50,                     // Cadence d'envoi en Packets Per Second (PPS)
  "label": ""                     // Label custom (Laisser vide pour n'afficher que CONV-XXXX)
}
```
*   **Réponse** :
```json
{
  "success": true,
  "testId": "CONV-0012"           // Séquentiel natif
}
```

### `POST /api/convergence/stop`

*   **Description** : Envoie un signal `SIGTERM` au test en cours pour l'arrêter gracieusement (déclenche le calcul des statistiques finales après 2 à 7s).
*   **Payload** : `{"testId": "CONV-0012"}`
*   **Réponse** : `{"success": true}`

### `GET /api/convergence/status`

*   **Description** : Renvoie les métriques *en temps réel* de tous les tests de convergence actuellement en cours.
*   **Réponse** (Tableau JSON):
```json
[
  {
    "testId": "CONV-0012",
    "status": "running",
    "loss_pct": 0.1,
    "avg_rtt_ms": 30.5,
    "jitter_ms": 1.2
  }
]
```

### `GET /api/convergence/history`

*   **Description** : Renvoie l'historique de tous les tests terminés (fichier `convergence-history.jsonl`). Utilisé par le MCP après un `stop` pour extraire les métriques stabilisées définitives.
*   **Réponse** (Tableau JSON):
```json
[
  {
    "test_id": "CONV-0012",       // Correspond à "testId"
    "status": "stopped",
    "sent": 4015,
    "received": 4015,
    "loss_pct": 0.0,
    "avg_rtt_ms": 30.73,
    "jitter_ms": 0.39,
    "max_blackout_ms": 0
  }
]
```

---

## 4. Simulation de Trafic (Data & Voix)

Routes de contrôle pour les générateurs de trafic en bruit de fond (sans nécessité de renvoyer des métriques de fin au MCP).

### Bruit de Fond Applicatif (`applications.txt`)

*   **`POST /api/traffic/start`** -> `{"success": true}`
*   **`POST /api/traffic/stop`** -> `{"success": true}`

### Simulation QoS Voix (G711)

*   **`POST /api/voice/control`**
    *   **Payload** : `{"action": "start"}` ou `{"action": "stop"}`
    *   **Réponse** : `{"success": true, "status": "running"}`
