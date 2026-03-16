# Stigix MCP Server - Development Status Report

*Dernière mise à jour : 16 Mars 2026*

Ce document résume l'état d'avancement du développement du serveur MCP (Model Context Protocol) pour Stigix. Ce service permet à des agents IA (comme Claude) d'interagir nativement avec l'infrastructure Stigix via des commandes en langage naturel.

## 🎯 Objectifs Réalisés

L'intégration MCP a été considérablement enrichie et fiabilisée pour offrir un contrôle granulaire sur les tests réseau et la simulation de trafic.

### 1. Fiabilisation des Tests XFR (Speedtests)
- **Extraction des IDs Natifs** : Le MCP capture et remonte désormais le `sequence_id` natif généré par le backend (ex: `XFR-0007`) au lieu de créer un ID fictif, permettant une corrélation parfaite avec le dashboard web.
- **Paramètres Avancés** : Ajout du support pour les protocoles spécifiques (`TCP`, `UDP`, `QUIC`) et les directions (`client-to-server`, `server-to-client`, `bidirectional`).
- **Correction des Métriques** : Les résultats sont lus sur les bonnes clés (`received_mbps` au lieu de `throughput_mbps`, `rtt_ms_avg` au lieu de `rtt_ms`).

### 2. Convergence Multi-Cibles & PPS
- **Support Multi-Destinations** : Possibilité de démarrer des sondes de convergence vers plusieurs endpoints simultanément (ex: *"Lance un test vers Hetzner et DC1"*).
- **Contrôle du PPS** : L'argument `pps` a été ajouté au MCP et mappé sur le paramètre `rate` du backend pour des tests de convergence précis.
- **Alignement des IDs** : Comme pour le XFR, capture propre des IDs séquentiels natifs `CONV-XXXX`.

### 3. Gestion des Cycles de Vie (Start/Stop)
- **Convergence Continue** : Les tests de convergence sont désormais correctement traités comme des processus continus (durée ignorée par le backend).
- **Commande d'Arrêt (`stop_test`)** : Ajout d'un outil spécifique permettant à l'IA d'interrompre manuellement un test de convergence.
- **Récupération des Métriques Finales** : Lors d'un `stop_test`, le MCP attend la période de grâce du backend (2-7s) et scanne l'historique complet pour extraire **les véritables métriques stabilisées**.
- **Correction des Matching Logs** : Modification de la logique de recherche dans les historiques pour accommoder les labels ajoutés par le backend (ex: `CONV-258 (DC1)` matching `CONV-258`) en prenant toujours la dernière écriture.

### 4. Simulation de Trafic (Voix & Data)
- **API Traffic/Voice** : Implémentation de commandes Start/Stop pour le bruit de fond applicatif (`set_traffic_status`) et pour la simulation de flux voix QoS (`set_voice_status`).

### 5. Validation de la Sécurité (DNS/URL/Threat)
- **Sondes de Filtrage** : Implémentation de `run_security_probe` permettant de tester le blocage DNS, le filtrage d'URL (HTTP 403) et la détection de menaces (EICAR).
- **Corrélation de Catégories** : Le MCP remonte désormais la catégorie de filtrage détectée par la gateway.

### 6. Observabilité DEM (Digital Experience Monitoring)
- **Score Applicatif** : Calcul automatisé du Success Rate pour des applications spécifiques (ex: Microsoft Teams) via `get_app_score`.
- **Santé des Probes** : Vue synthétique de l'état des sondes (ICMP, HTTP, HTTPS) via `get_dem_summary` et diagnostic détaillé via `get_probe_details`.

### 7. Documentation Technique & API
- **API Reference (`API_REFERENCE.md`)** : Création d'un guide technique listant tous les endpoints HTTP consommés par le MCP (XFR, Convergence, Voix, Traffic).
- **Scan Exhaustif (`BACKEND_ROUTES_DUMP.md`)** : Extraction automatique de l'intégralité des routes (160+) du backend Stigix pour donner une visibilité totale aux développeurs.

### 8. Orchestration VyOS (Automates Config)
- **Gestion des Routeurs** : Intégration complète des commandes VyOS via le script `vyos_sdwan_ctl.py`.
- **Séquençage d'Actions** : Possibilité de piloter des scénarios complexes (sequences) qui modifient dynamiquement la configuration des routeurs (ex: basculement BGP, coupure WAN).
- **Timeline & Historique** : Suivi des modifications de configuration via l'API d'historique VyOS.

## 🛠️ Available MCP Tools

| Component | Tool Name | Description | Examples (Natural Language) |
| :--- | :--- | :--- | :--- |
| **Discovery** | `list_endpoints` | List Fabric nodes or targets. | *"Nodes actifs ?", "Cibles internet ?", "List fabric terminaux"* |
| **Traffic** | `run_test` | Start xfr, conv, voice, iot test. | *"Speedtest BR1->Paris", "Sonde vers 8.8.8.8 (100 PPS)"* |
| **Traffic** | `get_test_status` | Get metrics for a specific test. | *"Résultat test G-2026...", "Stats CONV-1234"* |
| **Traffic** | `stop_test` | Stop a long-running test. | *"Arrête la sonde 8.8.8.8", "Stop test CONV-567"* |
| **Management** | `set_traffic_status` | Start/stop app traffic simulation. | *"Active trafic sur Raspi4", "Coupe simulation Londres"* |
| **Management** | `set_traffic_rate` | Adjust generation speed (0.1s - 10s). | *"Turbo sur BR1 (0.1s)", "Ralentis Paris à 5s"* |
| **Management** | `set_voice_status` | Start/stop voice simulation. | *"Lance simu voix BR1", "Stop VoIP Paris"* |
| **Diagnostics** | `get_diagnostics` | Full node dashboard & health. | *"Santé node BR1", "Dashboard Raspi4", "CPU/RAM Paris"* |
| **Diagnostics** | `get_app_score` | Success rate for a specific app. | *"Score Teams sur Raspi4", "Zoom stats Londres"* |
| **Security** | `get_security_test_options` | Available targets (DNS/URL/Malware). | *"Options DNS ?", "Sites malware ?", "Threat scenarios"* |
| **Security** | `run_security_probe` | Test DNS/URL/Threat filtering. | *"Teste malware.com", "Vérifie EICAR sur BR1"* |
| **VyOS** | `list_vyos_routers` | List managed VyOS routers. | *"Routeurs VyOS gérés par BR1", "Équipements VyOS"* |
| **VyOS** | `list_vyos_scenarios` | List config sequences (scenarios). | *"Scénarios dispo ?", "Séquences failover"* |
| **VyOS** | `run_vyos_scenario` | Execute a config sequence. | *"Applique failover-paris", "Lance mission force-4g"* |
| **VyOS** | `get_vyos_timeline` | History of VyOS changes. | *"Derniers changements VyOS", "Historique routeur"* |
| **VyOS** | `set_vyos_scenario_status` | Enable/Disable a cyclic scenario. | *"Stoppe le flapping cyclique", "Désactive seq-123"* |
| **DEM** | `get_dem_summary` | Global Experience score & status. | *"État global DEM", "Quelles sondes en erreur ?"* |
| **DEM** | `get_probe_details` | Detailed metrics for one probe. | *"Détails probe Google DNS", "Analyse latency SaaS"* |

## Usage Examples (Deep Dive)

### 1. Performance & Troubleshooting
**User:** *"La qualité Teams est mauvaise sur le site de Paris, peux-tu regarder ?"*
- `get_app_score(agent_id="Paris-BR1", app_name="Teams")`
- `get_dem_summary(agent_id="Paris-BR1")`
- `get_probe_details(agent_id="Paris-BR1", probe_name="Microsoft 365")`
- `get_diagnostics(agent_id="Paris-BR1")`

### 2. Network Orchestration (VyOS)
**User:** *"Le lien principal est tombé à Paris, bascule sur la 4G."*
- `list_vyos_scenarios(agent_id="Paris-BR1")`
- `run_vyos_scenario(agent_id="Paris-BR1", scenario_id="force-4g-failover")`
- `get_vyos_timeline(agent_id="Paris-BR1")`
- `set_vyos_scenario_status(...)` (Si un cycle auto interfére)

### 3. Security Validation
**User:** *"Vérifie si la politique de filtrage URL est bien active sur le node BR1."*
- `get_security_test_options(probe_type="url")`
- `run_security_probe(agent_id="BR1", probe_type="url", target="http://gambling.com")`
- `run_security_probe(agent_id="BR1", probe_type="threat", target="STIGIX-EICAR-01")`
- `run_security_probe(agent_id="BR1", probe_type="dns", target="test-phishing.testpanw.com")`

### 4. Traffic Control & Simulation
**User:** *"Je veux stresser le réseau depuis Londres."*
- `set_traffic_status(source_id="London", enabled=true)`
- `set_traffic_rate(agent_id="London", rate=0.1)` (Mode Turbo)
- `run_test(source_id="London", target_id="Paris,DC1", profile="xfr", bitrate="200M")`
- `get_test_status(test_id="...")`

---
*Dernière mise à jour : 16 Mars 2026*

## Ce qu'il reste à faire (To-Do)

- [ ] **Affinage des Erreurs** : Améliorer les retours d'erreurs pour l'agent IA.
- [ ] **CI / Déploiement** : Intégrer les tests unitaires du serveur MCP dans GitHub Actions.
- [ ] **Rapport de Convergence PDF** : Génération d'un résumé PDF des tests de convergence après arrêt.
