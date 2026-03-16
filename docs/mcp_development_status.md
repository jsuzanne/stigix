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

| Component | Tool Name | Description | Example Query (Natural Language) |
| :--- | :--- | :--- | :--- |
| **Discovery** | `list_endpoints` | List Fabric nodes or Internet targets. | *"Quels sont les nodes actifs ?"* |
| **Connectivity** | `run_test` | Start a traffic test (xfr, conv, voice). | *"Lance un speedtest entre BR1 et Paris."* |
| **Connectivity** | `get_test_status` | Get metrics for a specific test. | *"Donne moi le résultat du test G-2026..."* |
| **Connectivity** | `stop_test` | Stop a long-running convergence test. | *"Arrête la sonde vers 8.8.8.8."* |
| **Management** | `set_traffic_status` | Start/stop global app traffic simulation. | *"Active le trafic applicatif sur Raspi4."* |
| **Management** | `set_voice_status` | Start/stop voice simulation. | *"Lance la simulation de voix sur BR1."* |
| **Maintenance** | `get_diagnostics` | Full node dashboard (CPU, Bitrate, etc.). | *"Check la santé globale du node BR1."* |
| **Maintenance** | `get_app_score` | Success rate for a specific app (Teams, etc.). | *"Quel est le score Teams sur Raspi4 ?"* |
| **Security** | `run_security_probe` | Test DNS/URL/Threat filtering. | *"Teste si le domaine malware.com est bloqué."* |
| **VyOS** | `list_vyos_routers` | List managed VyOS routers. | *"Affiche les routeurs VyOS gérés par BR1."* |
| **VyOS** | `list_vyos_scenarios` | List available config sequences. | *"Quels scénarios VyOS sont dispo sur Raspi ?"* |
| **VyOS** | `run_vyos_scenario` | Run a specific config sequence. | *"Applique le scénario failover-paris."* |
| **VyOS** | `get_vyos_timeline` | History of VyOS changes. | *"Quels ont été les derniers changements VyOS ?"* |
| **VyOS** | `set_vyos_scenario_status` | Enable/Disable a cyclic scenario. | *"Désactive le scénario de flapping cyclique."* |
| **DEM** | `get_dem_summary` | Global Experience summary and probe list. | *"Quel est l'état général des probes DEM ?"* |
| **DEM** | `get_probe_details` | Rich metrics for a specific probe. | *"Donne moi les détails de la probe Google DNS."* |

## Usage Examples

### 1. Troubleshooting Performance
**User:** *"La qualité Teams est mauvaise sur le site de Paris, peux-tu regarder ?"*
1. **AI:** Calls `get_app_score(agent_id="Paris-BR1", app_name="Teams")`.
2. **AI:** Calls `get_dem_summary(agent_id="Paris-BR1")` to check underlying latency.
3. **AI:** Analysis: *"Le score Teams est à 42% car la latence vers Microsoft a augmenté de 50ms sur le lien MPLS."*

### 2. Network Orchestration (VyOS)
**User:** *"Le lien principal est tombé à Paris, bascule sur la 4G."*
1. **AI:** Calls `list_vyos_scenarios(agent_id="Paris-BR1")` to find the right sequence.
2. **AI:** Calls `run_vyos_scenario(agent_id="Paris-BR1", scenario_id="force-4g-failover")`.

### 3. Security Validation
**User:** *"Vérifie si la politique de filtrage URL est bien active."*
1. **AI:** Calls `run_security_probe(agent_id="BR1", probe_type="url", target="http://gambling.com")`.
2. **AI:** Confirms: *"Le site est bien bloqué (HTTP 403) par la gateway."*

---
*Dernière mise à jour : 16 Mars 2026*

## Ce qu'il reste à faire (To-Do)

- [ ] **Affinage des Erreurs** : Améliorer les retours d'erreurs pour l'agent IA.
- [ ] **CI / Déploiement** : Intégrer les tests unitaires du serveur MCP dans GitHub Actions.
- [ ] **Rapport de Convergence PDF** : Génération d'un résumé PDF des tests de convergence après arrêt.
