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

### 5. Clarté Cognitive pour l'IA
- Refonte des `docstrings` des outils Python (`server.py`). Les arguments sont maintenant catégorisés par profil (ex: `[XFR ONLY]`, `[CONV ONLY]`) pour empêcher Claude de confondre les paramètres d'un speedtest avec ceux d'une convergence.

## 🚧 Outils MCP Actuellement Disponibles

| Nom de l'Outil | Description |
| :--- | :--- |
| `list_endpoints` | Récupère la topologie (routeurs, serveurs) et leur statut. |
| `run_test` | Lance une sonde XFR (durée fixe, débit max) ou de Convergence (flux continu pps). |
| `stop_test` | Arrête manuellement un test en cours (requis pour la convergence). |
| `get_test_status`| Remonte les données en direct ou finales d'un test (ID `G-...` ou natif `XFR-...`). |
| `set_traffic_status` | Active/Désactive la génération de trafic applicatif de fond. |
| `set_voice_status` | Active/Désactive la simulation d'appels voix (QoS). |

## 🔜 Ce qu'il reste à faire (To-Do)

- [ ] **Tests de Sécurité / Connectivité** : Implémenter le support pour les profils `security` et `connectivity` dans `orchestrator.py` afin de couvrir tous les types de tests disponibles.
- [ ] **Consultation d'Historique** : Ajouter un outil `get_endpoint_history` permettant à l'IA de lister et analyser de manière autonome les derniers tests (XFR, CONV) exécutés sur un nœud donné.
- [ ] **Diagnostics Avancés (Routage)** : Créer des outils de lecture des tables de routage (ex: via FRR ou `ip route`) pour que l'IA puisse diagnostiquer l'origine exacte d'un problème de connectivité signalé par les tests.
- [ ] **Affinage des Erreurs** : Améliorer les retours d'erreurs HTTP (4xx/5xx) du `registry` et de l'`orchestrator` pour qu'ils contiennent plus de contexte utile pour l'agent IA.
- [ ] **CI / Déploiement** : Intégrer les tests unitaires ou de validation du serveur MCP dans le pipeline GitHub Actions (en cohérence avec `DOC_CI_CD.md`).
