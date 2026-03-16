# Stigix MCP Server - Development Status Report

*Dernière mise à jour : 13 Mars 2026*

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

### 6. Documentation Technique & API
- **API Reference (`API_REFERENCE.md`)** : Création d'un guide technique listant tous les endpoints HTTP consommés par le MCP (XFR, Convergence, Voix, Traffic).
- **Scan Exhaustif (`BACKEND_ROUTES_DUMP.md`)** : Extraction automatique de l'intégralité des routes (160+) du backend Stigix pour donner une visibilité totale aux développeurs.

## 🚧 Outils MCP Actuellement Disponibles

| Nom de l'Outil | Description |
| :--- | :--- |
| `list_endpoints` | Récupère la topologie (routeurs, serveurs) et leur statut via le Registry Cloudflare. |
| `run_test` | Lance une sonde XFR (vitesse) ou de Convergence (failover continu). |
| `stop_test` | Arrête un test et récupère les métriques finales stabilisées. |
| `get_test_status`| Remonte les données en direct ou historiques d'un test. |
| `set_traffic_status` | Active/Désactive la génération de trafic applicatif (SaaS). |
| `set_voice_status` | Active/Désactive la simulation d'appels voix (QoS). |

### 7. Orchestration VyOS (Automates Config)
- **Gestion des Routeurs** : Intégration complète des commandes VyOS via le script `vyos_sdwan_ctl.py`.
- **Séquençage d'Actions** : Possibilité de piloter des scénarios complexes (sequences) qui modifient dynamiquement la configuration des routeurs (ex: basculement BGP, coupure WAN).
- **Timeline & Historique** : Suivi des modifications de configuration via l'API d'historique VyOS.

## 🚧 Outils MCP Actuellement Disponibles

| Nom de l'Outil | Description |
| :--- | :--- |
| `list_endpoints` | Récupère la topologie (routeurs, serveurs) et leur statut via le Registry Cloudflare. |
| `run_test` | Lance une sonde XFR (vitesse) ou de Convergence (failover continu). |
| `stop_test` | Arrête un test et récupère les métriques finales stabilisées. |
| `get_test_status`| Remonte les données en direct ou historiques d'un test. |
| `set_traffic_status` | Active/Désactive la génération de trafic applicatif (SaaS). |
| `set_voice_status` | Active/Désactive la simulation d'appels voix (QoS). |
| `get_diagnostics` | Récupère l'intégralité des métriques (CPU, Bitrate, Apps) d'un nœud. |
| `get_app_score` | Calcule le taux de réussite (success rate) d'une application SaaS. |
| `run_security_probe` | Lance un test de sécurité DNS, URL ou Malware (EICAR). |
| `list_vyos_routers` | Liste les routeurs VyOS gérés. |
| `list_vyos_scenarios` | Liste les séquences de configuration (scénarios) disponibles. |
| `run_vyos_scenario` | Exécute un scénario VyOS (basé sur `vyos_sdwan_ctl.py`). |
| `get_vyos_timeline` | Affiche l'historique des dernières actions de configuration. |

## 🔜 Phase d'Enrichissement : Diagnostics Globaux & Sécurité

L'objectif est d'utiliser le `dashboard-data` du backend pour répondre à des questions complexes sur la performance "vécue" par les applications.

### 📝 Exemples de questions tests pour l'IA :
- *"Donne-moi un diagnostic complet du node Hetzner-Ubuntu."*
- *"Quel est le taux de réussite (success rate) de Microsoft Teams sur le node Hetzner ?"*
- *"Lance un test de sécurité DNS pour 'abortion.com' sur London."*
- *"Quels sont les scénarios VyOS disponibles pour le réseau ?"*
- *"Lance le scénario 'Failover-Paris' et montre-moi quand l'action est terminée."*
- *"Donne-moi l'historique des 5 dernières actions VyOS."*
- *"Quels sont les routeurs VyOS actuellement en ligne ?"*

## Ce qu'il reste à faire (To-Do)

- [ ] **Implémentation `get_dashboard_stats`** : Nouveau tool MCP pour agréger toutes les métriques d'un nœud.
- [ ] **Implémentation `run_security_probe`** : Tool pour lancer les tests DNS/URL/EICAR.
- [ ] **Affinage des Erreurs** : Améliorer les retours d'erreurs pour l'agent IA.
- [ ] **CI / Déploiement** : Intégrer les tests unitaires du serveur MCP dans GitHub Actions.
