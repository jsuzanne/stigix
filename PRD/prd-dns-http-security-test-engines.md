# PRD — Moteurs natifs DNS et HTTP pour les tests Security de Stigix

**Produit :** Stigix  
**Statut :** Proposition / backlog  
**Auteur :** Jean-Louis Suzanne / Stigix  
**Date :** 16 septembre 2026  
**Version :** 0.1

---

## 1. Résumé

Stigix exécute aujourd’hui ses validations DNS Security et URL Filtering au moyen de programmes externes : `nslookup` / `dig` pour DNS et `curl` pour HTTP(S). Cette approche est rapide à mettre en œuvre et reste très utile pour le diagnostic opérateur. En revanche, elle limite la qualité des métriques, la richesse des verdicts, la reproductibilité des scénarios, le contrôle du trafic généré et la robustesse du parsing des résultats.

Ce projet introduit deux moteurs de test structurés :

1. Un **moteur DNS natif** destiné aux campagnes DNS Security, à la supervision et aux scénarios de trafic DNS contrôlé.
2. Un **moteur HTTP(S) structuré** destiné aux campagnes URL Filtering, avec une classification fiable des pages et comportements de blocage.

Les outils externes ne sont pas supprimés dans un premier temps. `dig` et `curl` restent disponibles en **mode diagnostic avancé** afin de préserver une méthode de troubleshooting connue des équipes réseau et sécurité.

L’objectif est de faire évoluer Stigix d’un lanceur de commandes système vers une plateforme de validation SASE / NGFW qui produit des observations structurées, explicables et exploitables dans un POC, une démonstration ou un suivi continu de policy.

---

## 2. Problème

### 2.1 Limites DNS actuelles

Les tests DNS Security s’appuient sur `nslookup` ou `dig`, puis interprètent la sortie texte. Dans le modèle actuel, une réponse de type `NXDOMAIN` ou une erreur comme `server can't find` est généralement considérée comme un blocage.

Cette approche crée plusieurs limites :

- Le parsing de texte dépend du binaire, de sa version et de son format de sortie.
- Une requête implique un processus externe, peu adapté aux campagnes volumineuses ou aux tests parallèles.
- Les détails importants sont difficiles à normaliser : RCODE, réponses, CNAME, TTL, retries, serveur interrogé, transport et temps de réponse.
- Un `NXDOMAIN` n’est pas à lui seul une preuve absolue d’un blocage de sécurité ; le domaine peut être inexistant ou le resolver indisponible.
- Les comportements DNS utiles pour une validation SASE sont insuffisamment contrôlables : UDP/TCP, EDNS(0), dual stack A/AAAA, fallback TCP, cadence, cache simulé et profils de clients.

### 2.2 Limites HTTP/URL Filtering actuelles

Les tests URL Filtering utilisent `curl` avec une logique simple :

- HTTP 200–399 : `allowed`
- HTTP 400+ : `blocked`
- Timeout ou erreur `curl` : `blocked`

Cette interprétation peut être erronée ou trop imprécise :

- Une page de blocage peut finalement renvoyer HTTP 200 après une redirection, et être interprétée à tort comme autorisée.
- Un HTTP 503, un timeout, un reset TCP, un échec DNS ou TLS peut être causé par un incident réseau ou une indisponibilité du site, pas forcément par la policy URL Filtering.
- Les redirections, l’URL finale, les headers, les timings réseau et les informations TLS ne sont pas conservés de façon structurée.
- Les résultats actuels ne portent pas toujours une preuve explicite et défendable du mécanisme de blocage.
- Le moteur `curl` appelé par processus est moins simple à intégrer dans une instrumentation uniforme, des règles de classification versionnées et des scénarios applicatifs riches.

---

## 3. Objectifs

### 3.1 Objectifs fonctionnels

- Produire des résultats DNS et HTTP(S) structurés, persistables et exportables.
- Distinguer clairement une policy de sécurité appliquée d’une erreur réseau, DNS, TLS ou applicative.
- Permettre l’exécution manuelle, planifiée, séquentielle et contrôlée en parallèle.
- Préserver une expérience de démonstration simple : un verdict clair et une preuve visible.
- Fournir une vue expert contenant les éléments techniques nécessaires au troubleshooting.
- Conserver `dig` et `curl` comme adaptateurs de diagnostic et de comparaison.
- Réutiliser les moteurs dans les tests Security, EDL, Connectivity Performance et futurs profils SaaS/IoT lorsque pertinent.

### 3.2 Objectifs de qualité

- Réduire la dépendance aux formats texte des programmes externes.
- Ne pas nécessiter l’installation de `dnsutils`, `bind-tools` ou `curl` pour les scénarios standards à terme.
- Conserver une API rétrocompatible pendant la migration.
- Garantir des délais maximums, limites de redirection, limites de taille et garde-fous sur les cibles.
- Générer des logs lisibles et ne jamais exposer de cookies, tokens, mots de passe ou credentials proxy dans l’interface.

---

## 4. Hors périmètre

Les éléments suivants ne font pas partie de la première livraison :

- Écrire manuellement un codec DNS ou un client HTTP au niveau wire protocol.
- Remplacer immédiatement tous les usages de `curl`, `dig` ou `nslookup` présents dans Stigix.
- Créer un scanner de vulnérabilités, un crawler web ou un outil d’exploration d’URL.
- Contourner des politiques de filtrage, des proxys, des mécanismes TLS ou des contrôles d’accès.
- Exécuter des tests actifs contre des cibles non autorisées.
- Tester DoH, DoT, HTTP/3/QUIC, proxy explicite et authentification proxy dans la première version, sauf si un besoin POC prioritaire est validé.
- Déduire un blocage depuis une seule heuristique faible, par exemple la présence du mot `blocked` dans une réponse HTML.

---

## 5. Utilisateurs et cas d’usage

| Utilisateur | Besoin | Exemple |
|---|---|---|
| Pre-sales SASE / NGFW | Démontrer de manière crédible l’application d’une policy | Montrer qu’une catégorie Malware est bloquée avec redirection vers une block page identifiée |
| Ingénieur réseau / sécurité | Diagnostiquer un résultat inattendu | Comprendre si un timeout est dû à URL Filtering, DNS, TLS, WAN ou à un endpoint indisponible |
| Équipe POC | Vérifier périodiquement les policies activées | Exécuter cinq tests DNS et cinq tests URL toutes les 60 minutes, conserver l’historique et détecter une régression |
| Administrateur Stigix | Configurer des scénarios sûrs | Ajouter des URLs de lab, un resolver de test et des signatures locales de page de blocage |
| Développeur Stigix | Réutiliser une sonde commune | Utiliser le moteur HTTP pour les URL EDL et le moteur DNS pour DNS EDL / Connectivity Performance |

---

## 6. Principes de conception

1. **Native by default, external for diagnostics.** Les campagnes standards passent par les moteurs structurés. `dig` et `curl` restent disponibles en mode expert.
2. **Expected outcome first.** Chaque test déclare le résultat attendu : `blocked` ou `allowed`. Le résultat observé est comparé à cette attente.
3. **Evidence-based verdict.** Un verdict `blocked_confirmed` nécessite une preuve explicite ou une signature suffisamment forte.
4. **Inconclusive is valid.** Un timeout, un reset ou un 5xx ne doit pas être automatiquement assimilé à un blocage confirmé.
5. **Safe by default.** Limites de durée, de redirections, de taille de réponse, de concurrence et validation des destinations.
6. **Observability first.** Les résultats sont nativement JSON, persistables, exportables et corrélables par test, campagne, source et scheduler.
7. **Backward-compatible migration.** Les endpoints et compteurs existants restent fonctionnels pendant l’introduction des nouveaux statuts.

---

## 7. Architecture cible

```text
React Security UI / Scheduler / EDL Runner
                |
                v
        Security Test Orchestrator
                |
       +--------+---------+
       |                  |
       v                  v
 Native DNS Engine   Structured HTTP Engine
       |                  |
       v                  v
 DNS resolver(s)      Web / test endpoints
       |
       +--------------------------+
                                  |
                                  v
                     Classification & Evidence Engine
                                  |
                                  v
                  Persistent History / Statistics / Export API
                                  |
                    +-------------+-------------+
                    |                           |
                    v                           v
             Expert Diagnostic              Dashboard UI
           adapters: dig / curl          verdict + evidence
```

### 7.1 Composants backend proposés

- `security-test-orchestrator.ts` : orchestration commune, limites de concurrence, corrélation, persistance et calcul de conformité.
- `dns-test-engine.ts` : construction/exécution/analyse de requêtes DNS.
- `http-test-engine.ts` : exécution HTTP(S), gestion des redirections, des délais et collecte de télémétrie.
- `security-result-classifier.ts` : classification de résultat et évaluation des signatures de blocage.
- `security-test-profiles.ts` : lecture/validation des profils, des attentes et des signatures configurées.
- `diagnostics/dig-adapter.ts` : exécution optionnelle de `dig` pour troubleshooting.
- `diagnostics/curl-adapter.ts` : exécution optionnelle de `curl` pour troubleshooting et comparaison.
- `security-result-store.ts` : compatibilité avec `config/security-tests.json` en V1, abstraction prête pour une future base de données.

### 7.2 Choix d’implémentation

- Le moteur DNS doit s’appuyer sur une bibliothèque DNS robuste permettant le contrôle des messages et des transports, plutôt que sur une implémentation wire-format maison.
- Le moteur HTTP doit s’appuyer sur un client Node.js maintenu et adapté à la télémétrie HTTP(S), par exemple `undici` ou une bibliothèque équivalente validée par le projet.
- Les moteurs ne doivent pas être dépendants de l’interface React. Ils doivent être invocables par API, scheduler, EDL et tests automatisés.

---

## 8. Moteur DNS

### 8.1 Fonctionnalités V1

- Requêtes vers un resolver configurable, avec port configurable.
- Transport UDP/53 par défaut.
- Types de requêtes : `A`, `AAAA`, `CNAME`, `TXT`.
- Timeout configurable, avec valeur sûre par défaut.
- Nombre de retries configurable, avec valeur sûre par défaut.
- Mesure du temps total de résolution.
- Capture du resolver interrogé, du RCODE, des réponses, des CNAME et des TTL lorsque disponibles.
- Résultat JSON homogène.
- Classification de blocage basée sur des attentes et indicateurs configurables.
- Compatibilité avec les tests DNS Security existants et les DNS EDL.

### 8.2 Fonctionnalités V2

- TCP/53 et fallback sur TCP lorsque la réponse UDP est tronquée.
- EDNS(0) configurable.
- Requêtes A et AAAA en parallèle dans un profil dual-stack.
- Support de `MX`, `PTR` et types supplémentaires selon besoin.
- Profil de cadence pour endpoints, IoT, SaaS ou DGA de lab explicitement autorisé.
- Simulation de cache et prise en compte des TTL.
- Comparaison contrôlée de plusieurs resolvers / chemins.

### 8.3 Modèle de résultat DNS

```json
{
  "id": "sec-20260916-000001",
  "timestamp": "2026-09-16T17:20:00.000Z",
  "testType": "dns_security",
  "testName": "Malware",
  "source": "manual",
  "expectedOutcome": "blocked",
  "request": {
    "domain": "test-malware.testpanw.com",
    "qtype": "A",
    "resolver": "10.10.10.53",
    "port": 53,
    "transport": "udp",
    "recursionDesired": true,
    "ednsEnabled": false,
    "timeoutMs": 3000,
    "retries": 1
  },
  "response": {
    "rcode": "NXDOMAIN",
    "truncated": false,
    "answers": [],
    "authority": [],
    "additional": []
  },
  "timing": {
    "totalMs": 24.8
  },
  "attempts": 1,
  "evidence": {
    "signals": ["rcode:NXDOMAIN"],
    "matchedRules": ["dns-nxdomain-block-v1"],
    "confidence": "high"
  },
  "verdict": "blocked_confirmed",
  "compliance": "pass"
}
```

### 8.4 Classification DNS

| Observation | Verdict suggéré | Commentaire |
|---|---|---|
| Réponse conforme attendue pour un domaine autorisé | `allowed` | La résolution a abouti comme prévu |
| NXDOMAIN explicitement attendu pour un domaine de test | `blocked_confirmed` | Valide seulement avec une règle de test explicite |
| REFUSED explicitement attendu | `blocked_confirmed` | Preuve explicite de refus DNS |
| Sinkhole IP ou CNAME connu | `blocked_confirmed` | La signature doit être configurée |
| SERVFAIL | `inconclusive` | Peut venir du resolver ou d’un upstream défaillant |
| Timeout / absence de réponse | `inconclusive` ou `blocked_suspected` | Ne pas compter comme conformité sans signal additionnel |
| Réponse valide inattendue alors que le blocage était attendu | `allowed` | Devient un échec de conformité |
| Erreur de configuration locale | `test_error` | Exclu du score de conformité |

### 8.5 Règles DNS configurables

```json
{
  "dns_block_signatures": [
    {
      "id": "dns-nxdomain-block-v1",
      "enabled": true,
      "match": {
        "rcodes": ["NXDOMAIN"]
      }
    },
    {
      "id": "dns-refused-block-v1",
      "enabled": true,
      "match": {
        "rcodes": ["REFUSED"]
      }
    },
    {
      "id": "dns-sinkhole-lab-v1",
      "enabled": false,
      "match": {
        "answerIps": ["192.0.2.10"],
        "cnameSuffixes": ["sinkhole.lab.example"]
      }
    }
  ]
}
```

---

## 9. Moteur HTTP(S) / URL Filtering

### 9.1 Fonctionnalités V1

- Requêtes HTTP et HTTPS avec méthode `GET` par défaut.
- Suivi des redirections configurable, activé par défaut pour les tests URL Filtering.
- Limite de redirections configurable, valeur par défaut : 5.
- Timeout total et timeout de connexion distincts.
- Capture de l’URL initiale, de la chaîne de redirections et de l’URL finale.
- Capture du code HTTP, headers non sensibles, IP distante, protocole TLS et métadonnées de certificat lorsque disponibles.
- Mesure DNS, connexion TCP, handshake TLS, TTFB et durée totale lorsque la bibliothèque/runtime le permet.
- Lecture optionnelle d’un body plafonné pour la détection de page de blocage.
- Classification par signatures : status HTTP, URL finale, headers, contenu HTML contrôlé, erreurs transport.
- Compatibilité avec les URL EDL et les catégories URL Filtering existantes.

### 9.2 Fonctionnalités V2

- Profils de client : navigateur, minimal, IoT.
- Configuration explicite d’un proxy si le cas POC le nécessite.
- Mode HTTPS avec déchiffrement : capture et affichage prudente des éléments TLS utiles au diagnostic.
- Support de tests autorisés avec requêtes POST minimales, seulement si justifié par un endpoint de lab.
- Exécution contrôlée en parallèle avec quotas par hôte et par campagne.
- Tests de comparaison avant/après policy change.

### 9.3 Modèle de résultat HTTP

```json
{
  "id": "sec-20260916-000002",
  "timestamp": "2026-09-16T17:20:00.000Z",
  "testType": "url_filtering",
  "testName": "Malware",
  "source": "scheduled",
  "expectedOutcome": "blocked",
  "request": {
    "initialUrl": "https://urlfiltering.paloaltonetworks.com/test-malware",
    "method": "GET",
    "followRedirects": true,
    "maxRedirects": 5,
    "timeoutMs": 15000,
    "connectTimeoutMs": 5000,
    "userAgentProfile": "browser"
  },
  "response": {
    "httpStatus": 200,
    "finalUrl": "https://block-page.lab.example/url-filtering",
    "redirectChain": [
      {
        "url": "https://urlfiltering.paloaltonetworks.com/test-malware",
        "status": 302,
        "location": "https://block-page.lab.example/url-filtering"
      }
    ],
    "remoteIp": "198.51.100.10",
    "headers": {
      "content-type": "text/html"
    },
    "bodySampleSha256": "optional-hash",
    "bodySampleTruncated": false
  },
  "timing": {
    "dnsMs": 8,
    "tcpConnectMs": 14,
    "tlsHandshakeMs": 41,
    "ttfbMs": 92,
    "totalMs": 184
  },
  "tls": {
    "protocol": "TLSv1.3",
    "peerSubject": "CN=block-page.lab.example",
    "peerIssuer": "CN=Lab CA"
  },
  "evidence": {
    "signals": ["redirect", "final-url-match", "html-marker-match"],
    "matchedRules": ["local-block-page-v1"],
    "confidence": "high"
  },
  "verdict": "blocked_confirmed",
  "compliance": "pass"
}
```

### 9.4 Classification HTTP

| Observation | Verdict suggéré | Commentaire |
|---|---|---|
| Page cible obtenue, comportement attendu | `allowed` | Si le blocage était attendu, conformité en échec |
| Redirection vers une block page reconnue | `blocked_confirmed` | Preuve forte |
| HTTP 403 ou 451 avec signature connue | `blocked_confirmed` | Preuve forte si la signature est présente |
| HTTP 200 contenant une signature de block page | `blocked_confirmed` | Cas important à couvrir |
| TCP reset / connection refused | `blocked_suspected` | Possiblement une policy, mais pas suffisant seul |
| Timeout | `inconclusive` ou `blocked_suspected` | Ne pas assimiler automatiquement à un blocage confirmé |
| DNS failure | `inconclusive` | Peut être un test DNS Security distinct ou une panne |
| TLS error | `inconclusive` | Peut être déchiffrement, certificat, SNI, proxy ou horloge |
| HTTP 5xx | `inconclusive` | Le site ou un proxy peut être indisponible |
| URL invalide / destination refusée par guardrail | `test_error` | Défaut local / règles de sécurité de Stigix |

### 9.5 Signatures HTTP configurables

```json
{
  "http_block_signatures": [
    {
      "id": "policy-http-451-v1",
      "enabled": true,
      "match": {
        "statusCodes": [451]
      }
    },
    {
      "id": "local-block-page-v1",
      "enabled": true,
      "match": {
        "finalUrlRegex": "^https://block-page\\.lab\\.example/",
        "bodyRegex": "Access to this site has been blocked|URL Filtering"
      }
    },
    {
      "id": "proxy-block-header-v1",
      "enabled": false,
      "match": {
        "headers": {
          "x-security-action": "blocked"
        }
      }
    }
  ]
}
```

Les signatures devront supporter plusieurs signaux combinés. Une signature fondée sur le seul contenu HTML devra être considérée comme plus faible qu’une combinaison URL finale + header + contenu.

---

## 10. Contrat commun de verdict

### 10.1 Valeurs standard

| Champ | Valeurs | Rôle |
|---|---|---|
| `expectedOutcome` | `blocked`, `allowed` | Comportement attendu du scénario |
| `verdict` | `allowed`, `blocked_confirmed`, `blocked_suspected`, `inconclusive`, `test_error` | Observation technique interprétée |
| `compliance` | `pass`, `fail`, `unknown`, `error` | Comparaison entre attente et verdict |
| `confidence` | `high`, `medium`, `low` | Solidité de la preuve de classification |

### 10.2 Règles de conformité

| Attendu | Verdict observé | Compliance |
|---|---|---|
| `blocked` | `blocked_confirmed` | `pass` |
| `blocked` | `allowed` | `fail` |
| `blocked` | `blocked_suspected` | `unknown` par défaut |
| `blocked` | `inconclusive` | `unknown` |
| `allowed` | `allowed` | `pass` |
| `allowed` | `blocked_confirmed` | `fail` |
| tout | `test_error` | `error` |

Les statistiques de conformité ne doivent pas compter `inconclusive`, `blocked_suspected` ni `test_error` comme succès de policy. L’UI pourra proposer un paramètre avancé permettant de traiter `blocked_suspected` comme acceptable dans un mode de démo explicitement choisi, mais ce ne devra jamais être le comportement par défaut.

---

## 11. Évolution API

### 11.1 Endpoints existants à préserver

Les endpoints suivants restent disponibles pendant la migration :

- `POST /api/security/url-test`
- `POST /api/security/url-test-batch`
- `POST /api/security/dns-test`
- `POST /api/security/dns-test-batch`
- `GET /api/security/results`
- `GET /api/security/config`
- `POST /api/security/config`

Les réponses doivent conserver les champs historiques essentiels (`success`, `status`, `url` / `domain`, `category` / `testName`) et ajouter les nouveaux champs structurés.

### 11.2 Exemple endpoint URL V2

```json
POST /api/security/url-test
{
  "url": "https://urlfiltering.paloaltonetworks.com/test-malware",
  "category": "Malware",
  "expectedOutcome": "blocked",
  "options": {
    "followRedirects": true,
    "maxRedirects": 5,
    "timeoutMs": 15000,
    "userAgentProfile": "browser"
  }
}
```

```json
{
  "success": true,
  "status": "blocked",
  "verdict": "blocked_confirmed",
  "compliance": "pass",
  "httpCode": 200,
  "url": "https://urlfiltering.paloaltonetworks.com/test-malware",
  "finalUrl": "https://block-page.lab.example/url-filtering",
  "timing": {
    "totalMs": 184
  },
  "evidence": {
    "matchedRules": ["local-block-page-v1"],
    "confidence": "high"
  }
}
```

### 11.3 Exemple endpoint DNS V2

```json
POST /api/security/dns-test
{
  "domain": "test-malware.testpanw.com",
  "testName": "Malware",
  "expectedOutcome": "blocked",
  "options": {
    "resolver": "10.10.10.53",
    "qtype": "A",
    "transport": "udp",
    "timeoutMs": 3000,
    "retries": 1
  }
}
```

```json
{
  "success": true,
  "status": "blocked",
  "verdict": "blocked_confirmed",
  "compliance": "pass",
  "domain": "test-malware.testpanw.com",
  "rcode": "NXDOMAIN",
  "resolved": false,
  "timing": {
    "totalMs": 25
  },
  "evidence": {
    "matchedRules": ["dns-nxdomain-block-v1"],
    "confidence": "high"
  }
}
```

### 11.4 Endpoint diagnostic optionnel

```text
POST /api/security/diagnostics/dig
POST /api/security/diagnostics/curl
```

Ces endpoints doivent être protégés par validation stricte des options et ne doivent pas accepter une commande shell libre. Les options doivent être représentées sous forme de paramètres allowlistés.

---

## 12. Configuration

### 12.1 Évolution proposée de `config/security-tests.json`

```json
{
  "engine": {
    "dns": {
      "mode": "native",
      "defaultResolver": null,
      "defaultPort": 53,
      "defaultTransport": "udp",
      "timeoutMs": 3000,
      "retries": 1,
      "maxConcurrent": 5
    },
    "http": {
      "mode": "native",
      "timeoutMs": 15000,
      "connectTimeoutMs": 5000,
      "followRedirects": true,
      "maxRedirects": 5,
      "maxBodyBytes": 131072,
      "maxConcurrent": 3,
      "userAgentProfile": "browser"
    }
  },
  "url_filtering": {
    "enabled_categories": ["malware", "phishing"],
    "protocol": "https",
    "expectedOutcome": "blocked"
  },
  "dns_security": {
    "enabled_tests": ["malware", "dns-tunneling"],
    "expectedOutcome": "blocked"
  },
  "classification": {
    "dnsBlockSignatures": [],
    "httpBlockSignatures": []
  },
  "resultRetention": {
    "maxResults": 500,
    "redactSensitiveHeaders": true
  }
}
```

### 12.2 Compatibilité

- Les configurations existantes sans section `engine` utilisent les valeurs par défaut.
- Le champ historique `status` demeure dérivé : `blocked` pour `blocked_confirmed`, `allowed` pour `allowed`, et une valeur adaptée ou documentée pour les états intermédiaires.
- La migration ne doit pas invalider les planifications URL, DNS et Threat déjà configurées.

---

## 13. UX / interface

### 13.1 Vue principale Security

La table de résultats doit afficher :

- Horodatage.
- Type de test : URL Filtering ou DNS Security.
- Nom/catégorie.
- Cible : URL ou domaine.
- Attendu : Blocked / Allowed.
- Verdict observé.
- Conformité : Pass / Fail / Unknown / Error.
- Preuve courte : HTTP 451, NXDOMAIN, sinkhole, block page, timeout, TLS error, etc.
- Durée totale.
- Origine : manuel, scheduler, EDL, API.

### 13.2 Codes couleur proposés

| État | Couleur UI | Sens |
|---|---|---|
| `pass` | Vert | Policy conforme à l’attendu |
| `fail` | Rouge | Policy non conforme à l’attendu |
| `unknown` | Orange / ambre | Résultat non concluant ou suspicion non confirmée |
| `error` | Gris / rouge foncé | Défaut local du test ou configuration invalide |

### 13.3 Panneau de détail expert

Le clic sur un résultat ouvre un panneau avec :

- Requête complète non sensible.
- Résultat réseau et applicatif.
- Timings détaillés.
- Chaîne de redirections HTTP.
- RCODE et réponses DNS.
- Informations TLS pertinentes.
- Signatures de classification évaluées et celles ayant matché.
- Sortie `curl` ou `dig` uniquement lorsqu’un diagnostic a été demandé.
- ID de corrélation de campagne et liens vers résultats associés DNS/HTTP si disponibles.

### 13.4 Bouton diagnostic

Pour chaque test URL ou DNS, proposer :

- `Run structured test` : moteur natif, comportement standard.
- `Run expert diagnostic` : `curl` ou `dig` via adaptateur contrôlé.

Le résultat diagnostic ne doit pas écraser le résultat structuré. Il doit être attaché comme artefact à l’exécution ou à un nouvel enregistrement explicitement identifié comme `diagnostic`.

---

## 14. Sécurité et garde-fous

### 14.1 Validation de cibles

Lorsqu’une URL ou un domaine est configurable par l’utilisateur, le backend doit :

- Accepter uniquement les schémas `http` et `https` pour les tests HTTP.
- Rejeter les URLs malformées et les redirections vers des schémas non supportés.
- Bloquer par défaut les adresses loopback, link-local, multicast, unspecified et metadata cloud.
- Définir explicitement si les plages RFC1918 sont autorisées. Dans Stigix, les cibles privées de lab peuvent être nécessaires ; elles doivent donc être activables via un paramètre explicite et documenté.
- Résoudre et revalider chaque destination de redirection afin de limiter les risques SSRF.
- Limiter le nombre de redirections, la taille de réponse, la durée totale et la concurrence.

### 14.2 Données sensibles

- Ne pas stocker ou afficher les headers `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization` et équivalents.
- Ne jamais accepter une chaîne de commande shell libre dans l’API de diagnostic.
- Redacter les credentials éventuellement présents dans une URL avant écriture en log.
- Hacher les échantillons de réponse lorsque le contenu ne doit pas être conservé.

### 14.3 Tests autorisés uniquement

- Les tests de malware, phishing, C2, DNS tunneling ou DGA doivent utiliser les URLs/domaines de test officiels, des domaines de lab ou des ressources explicitement autorisées.
- Les campagnes planifiées doivent avoir des limites par défaut afin de ne pas surcharger le firewall, les resolvers ou les sites de test.
- Les profils avancés doivent porter un marquage clair `Lab / Authorized Testing`.

---

## 15. Scheduler, charge et fiabilité

### 15.1 Comportement

- Les jobs URL, DNS et Threat conservent leurs schedulers séparés.
- Les schedulers URL et DNS réutilisent l’orchestrateur commun.
- Les exécutions manuelles restent prioritaires mais sont soumises aux mêmes garde-fous de concurrence.
- Chaque test porte un `runId` et un `source` : `manual`, `scheduled`, `edl`, `api`, `diagnostic`.

### 15.2 Limites initiales

| Type | Concurrence par défaut | Timeout par test | Limite scheduler initiale |
|---|---:|---:|---:|
| DNS | 5 | 3 s | 5 tests par run |
| HTTP URL Filtering | 3 | 15 s | 5 tests par run |
| HTTP EDL | 3 | 15 s | Configurable, plafond global |

Les valeurs doivent être configurables, mais les maximums autorisés doivent rester raisonnables afin de protéger les déploiements de lab et les infrastructures de sécurité testées.

### 15.3 Gestion des erreurs

- Une erreur d’un test ne doit pas interrompre la campagne.
- Chaque erreur est persistée avec un code interne, un message operator-friendly et un détail technique éventuellement masqué.
- Les erreurs répétées de configuration doivent être signalées au niveau du dashboard.
- Les timeouts et erreurs réseau doivent contribuer à un indicateur de santé, mais pas être automatiquement comptés comme policy enforcement.

---

## 16. Statistiques et reporting

### 16.1 Nouveaux compteurs

Les compteurs historiques `blocked` et `allowed` doivent être conservés pendant la migration. Ajouter :

```json
{
  "url_tests_blocked_confirmed": 0,
  "url_tests_blocked_suspected": 0,
  "url_tests_allowed": 0,
  "url_tests_inconclusive": 0,
  "url_tests_error": 0,
  "url_tests_compliance_pass": 0,
  "url_tests_compliance_fail": 0,
  "dns_tests_blocked_confirmed": 0,
  "dns_tests_blocked_suspected": 0,
  "dns_tests_allowed": 0,
  "dns_tests_inconclusive": 0,
  "dns_tests_error": 0,
  "dns_tests_compliance_pass": 0,
  "dns_tests_compliance_fail": 0
}
```

### 16.2 Exports

- CSV synthétique : date, test type, cible, catégorie, attendu, verdict, conformité, preuve, durée, source.
- JSON détaillé : résultat complet, métadonnées, timings, signatures et diagnostic associé s’il existe.
- Les exports ne doivent pas contenir de headers sensibles, de cookies ou de credentials.

### 16.3 Indicateurs de dashboard

- Taux de conformité URL et DNS séparés.
- Nombre de résultats non concluants sur la période.
- Latence DNS p50/p95 et temps HTTP total p50/p95 lorsque l’historique le permet.
- Régressions : un scénario auparavant `pass` devenu `fail` ou `unknown`.
- Dernier résultat confirmé pour chaque catégorie / domaine activé.

---

## 17. Plan de livraison

### Phase 0 — Préparation

- Cartographier les appels actuels à `curl`, `dig` et `nslookup` dans le backend.
- Identifier les modèles existants de résultat, de persistance, de scheduler et d’EDL.
- Définir le schéma TypeScript de résultat commun.
- Ajouter des fixtures de réponses DNS et HTTP pour les tests unitaires.

### Phase 1 — Enrichissement sans remplacement de transport

- Conserver `curl` mais collecter `exitCode`, stderr, URL effective, nombre de redirections, IP distante et timings disponibles.
- Distinguer `allowed`, `blocked_suspected`, `inconclusive` et `test_error` dans la classification HTTP existante.
- Ajouter `expectedOutcome`, `verdict`, `compliance` et `evidence` aux résultats persistés.
- Ne plus considérer automatiquement timeout, TLS error ou HTTP 5xx comme `blocked_confirmed`.
- Ajouter une vue de détail et maintenir les badges historiques pendant transition.

### Phase 2 — Moteur DNS natif V1

- Introduire `dns-test-engine.ts` avec UDP, A/AAAA/CNAME/TXT, timeout, retry, RCODE, réponses et durée.
- Migrer `/api/security/dns-test`, le batch DNS et les DNS EDL vers l’orchestrateur.
- Mettre en place les règles NXDOMAIN, REFUSED et sinkhole configurables.
- Maintenir le diagnostic `dig` / `nslookup` comme option expert.

### Phase 3 — Moteur HTTP natif V1

- Introduire `http-test-engine.ts` avec GET, HTTP/HTTPS, redirections, timeouts, body plafonné, headers redigés et métadonnées de résultat.
- Migrer les tests URL Filtering et URL EDL.
- Mettre en place les signatures de block pages versionnées.
- Conserver `curl` pour la reproduction et le diagnostic expert.

### Phase 4 — Reporting et fiabilisation

- Ajouter les statistiques de conformité et les séries de latence.
- Ajouter les exports CSV/JSON enrichis.
- Ajouter la détection de régression et les filtres de résultats.
- Mettre à jour la documentation Security Testing, FAQ, Architecture Overview et Traffic Flow Guide.

### Phase 5 — Évolutions avancées

- DNS TCP/EDNS/fallback TCP, dual stack et profils de trafic.
- Profils HTTP navigateur/IoT et proxy explicite si besoin validé.
- Base de données pour conservation longue durée et analytique.
- Comparaison avant/après policy change, alerting et intégration webhook.

---

## 18. Critères d’acceptation

### 18.1 DNS

- Un test DNS vers un resolver configurable retourne un objet JSON incluant domaine, qtype, resolver, transport, RCODE, réponses, durée et nombre d’essais.
- Un test configuré comme devant être bloqué et recevant une signature NXDOMAIN configurée retourne `verdict: blocked_confirmed` et `compliance: pass`.
- Un `SERVFAIL` ou timeout DNS retourne `inconclusive` par défaut et ne fait pas augmenter le compteur de blocages confirmés.
- Un domaine qui se résout alors qu’il est attendu bloqué retourne `allowed` et `compliance: fail`.
- Les tests DNS batch et scheduler enregistrent un `runId`, respectent la limite de concurrence et continuent après l’échec d’un élément.
- Le bouton diagnostic `dig` reste utilisable avec options allowlistées.

### 18.2 HTTP

- Un test HTTP conserve l’URL initiale, l’URL finale, la chaîne de redirections, le code HTTP, la durée totale et l’erreur éventuelle.
- Une block page retournant HTTP 200 après redirect est correctement classée `blocked_confirmed` lorsque la signature configurée matche.
- Un HTTP 5xx, timeout, erreur DNS ou erreur TLS n’est pas automatiquement compté comme `blocked_confirmed`.
- Une URL attendue bloquée qui répond normalement sans signature de blocage est classée `allowed` et `compliance: fail`.
- Un body de réponse ne dépasse jamais la limite configurée ; les headers sensibles sont redigés dans les logs, APIs et exports.
- Les tests URL batch, scheduler et URL EDL utilisent le même modèle de résultat et les mêmes limites de concurrence.
- Le bouton diagnostic `curl` reste utilisable sans exposer une primitive de commande shell libre.

### 18.3 Régression et compatibilité

- Les endpoints historiques continuent de fonctionner.
- Le champ historique `status` est maintenu pendant au moins une version majeure après la migration.
- Une configuration existante peut être lue sans intervention manuelle.
- Les tableaux et exports existants restent utilisables avec les anciens résultats.
- Les nouveaux résultats peuvent être filtrés par type, verdict, conformité, source et période.

---

## 19. Risques et décisions ouvertes

| Sujet | Risque / question | Décision proposée |
|---|---|---|
| Bibliothèque DNS | Couverture EDNS/TCP/parsing selon la librairie choisie | Faire un spike technique et sélectionner une bibliothèque maintenue, testable et compatible avec le runtime Stigix |
| Timings HTTP détaillés | Certaines métriques ne sont pas exposées identiquement par toutes les bibliothèques Node | Exposer ce qui est fiable en V1 ; ne pas simuler de précision inexistante |
| Block pages hétérogènes | Chaque produit/environnement peut avoir une page différente | Utiliser des signatures versionnées et configurables, pas des chaînes codées en dur |
| HTTP 200 de block page | Faux positifs si le contenu est analysé naïvement | Exiger des signaux combinés et afficher la confidence |
| SSRF via URL personnalisée / EDL | Le backend peut atteindre des cibles internes | Mettre en œuvre validation URL/IP, revalidation des redirects, allowlist lab explicite et plafonds stricts |
| Compatibilité UI | Plus de statuts peut complexifier la démo | Vue simple par défaut, détail expert à la demande |
| Résultats historiques | Ancien modèle à deux états | Conserver les champs legacy et traiter les anciennes entrées comme `legacy` / non enrichies |
| Dépendance curl/dig | Certains utilisateurs les utilisent pour le troubleshooting | Ne pas les supprimer ; les isoler en adaptateurs diagnostics |

---

## 20. Exemple de scénario POC

### Objectif

Valider qu’une policy Prisma Access ou NGFW bloque les catégories Malware et Phishing en URL Filtering, ainsi que les domaines de test DNS Security associés.

### Exécution

1. L’opérateur active les tests Malware et Phishing dans Stigix.
2. Le scheduler déclenche une campagne avec un `runId` unique.
3. Le moteur DNS interroge le resolver défini par le chemin de sécurité.
4. Le moteur HTTP contacte les URLs de test en HTTPS, suit au maximum cinq redirections et collecte la télémétrie.
5. Le classifieur compare les réponses aux signatures de blocage configurées.
6. L’UI affiche la conformité et la preuve par test.

### Résultat attendu

| Test | Attendu | Observation | Verdict | Conformité |
|---|---|---|---|---|
| DNS Malware | Blocked | NXDOMAIN via resolver de sécurité | `blocked_confirmed` | Pass |
| URL Malware | Blocked | 302 vers block page puis HTTP 200 avec marqueur connu | `blocked_confirmed` | Pass |
| DNS Phishing | Blocked | Timeout resolver | `inconclusive` | Unknown |
| URL Phishing | Blocked | HTTP 200 cible normale | `allowed` | Fail |

Ce tableau permet de distinguer une policy qui fonctionne, une anomalie de connectivité et une policy qui ne bloque pas le contenu attendu.

---

## 21. Mesure du succès

Le projet sera considéré comme réussi lorsque :

- Les tests DNS et URL Filtering produisent des résultats structurés et des preuves exploitables en POC.
- Les timeouts et erreurs génériques ne sont plus présentés comme des blocages confirmés par défaut.
- Les block pages HTTP avec code 200 sont correctement identifiées quand une signature fiable est configurée.
- Les résultats peuvent être exportés et comparés dans le temps.
- Les outils `curl` et `dig` restent accessibles pour l’investigation sans être le moteur principal.
- Les nouvelles couches sont réutilisées au moins par les tests Security et les EDL correspondantes.
- Les opérateurs peuvent expliquer, pour chaque test, non seulement le verdict mais aussi la preuve ayant conduit à ce verdict.

---

## 22. Décision produit recommandée

Adopter une stratégie progressive :

- **DNS :** migrer rapidement les scénarios standards vers un moteur natif basé sur une bibliothèque DNS robuste ; garder `dig` comme diagnostic expert.
- **HTTP URL Filtering :** enrichir immédiatement l’usage de `curl`, puis migrer les campagnes standards vers un client HTTP Node structuré ; garder `curl` comme référence de troubleshooting.
- **Classification :** introduire sans attendre les notions de `blocked_confirmed`, `blocked_suspected`, `inconclusive`, `test_error` et `compliance`.
- **UX :** conserver une lecture simple pour la démo et fournir un panneau expert avec les détails techniques et les preuves.

Cette approche maximise la valeur démonstrative et opérationnelle de Stigix tout en limitant le risque de régression, la complexité de migration et la perte des outils familiers aux ingénieurs réseau et sécurité.
