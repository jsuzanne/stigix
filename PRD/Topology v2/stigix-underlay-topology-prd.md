# PRD — Stigix Underlay Details

## 1. Résumé

### Décision produit

Ajouter dans **Stigix Topology** une fonctionnalité de drill-down optionnelle, nommée **Underlay Details**, qui permet d’inspecter le prochain saut underlay VyOS d’un circuit WAN Prisma SD-WAN.

L’underlay ne doit pas être affiché en permanence sur la carte globale. L’opérateur l’ouvre explicitement depuis un circuit WAN, un ION, un site sélectionné ou le bouton **Underlay** de la toolbar.

### Pourquoi

La carte actuelle est une vue globale dense : sites, ION, circuits WAN, Internet/MPLS providers et liens overlay. Ajouter tous les routeurs VyOS, interfaces et liens physiques au niveau global réduirait fortement la lisibilité. Le détail underlay est précieux lors du troubleshooting et des démonstrations, mais ne doit être visible qu’au niveau local du circuit concerné.

### Résultat attendu

Pour un circuit Prisma dont l’adresse WAN appartient à un unique sous-réseau IPv4 configuré sur VyOS, l’opérateur peut ouvrir une vue zoomée affichant :

- Le site Prisma.
- L’ION Prisma.
- Le circuit / interface WAN sélectionné.
- L’adresse WAN Prisma et son CIDR.
- Le routeur VyOS correspondant.
- L’interface VyOS correspondante.
- L’adresse IPv4/CIDR de l’interface VyOS.
- La description d’interface VyOS.
- Le sous-réseau commun et la méthode de résolution.

---

## 2. Contexte technique

### Composants existants

| Composant | Rôle actuel | Extension attendue |
|---|---|---|
| `web-dashboard/src/Topology.tsx` | Carte React / TypeScript / React Flow | Sélection, mode Underlay Details, zoom, rendu local et retour au viewport global |
| Backend Node.js / TypeScript | API consommée par la Topology | Enrichissement sécurisé du payload avec les résolutions underlay |
| `engines/getflow.py` | Accès Prisma SD-WAN via SDK, découverte topologie | Normalisation additive des interfaces WAN Prisma disponibles |
| Configuration VyOS | Inventaire des routeurs et interfaces | Source de vérité locale pour les IP/CIDR et descriptions VyOS |

### Source VyOS disponible

La configuration VyOS contient déjà, par routeur :

- `id`, `name`, `location`, `enabled`, `status` ;
- la liste `interfaces[]` ;
- `name` de l’interface ;
- `description` fonctionnelle ;
- une ou plusieurs adresses dans `address[]`.

Exemple de donnée exploitable :

```json
{
  "router": "vyosrouter",
  "interface": "eth0",
  "description": "MPLS190",
  "address": "192.168.190.254/24"
}
```

Cette entrée peut être mise en correspondance avec une interface WAN Prisma ayant une adresse telle que `192.168.190.1/24`.

---

## 3. Problème utilisateur

Depuis la carte globale, l’utilisateur peut identifier un circuit `BR1-MPLS`, `BR1-INET`, `DC1-INET` ou `DC1-MPLS`, mais il ne peut pas vérifier immédiatement :

- L’adresse WAN de l’ION.
- Le next hop underlay VyOS correspondant.
- L’interface VyOS connectée.
- La description réseau associée, par exemple `MPLS190` ou `Internet220`.
- La raison pour laquelle aucune correspondance n’est possible.

L’opérateur doit être capable de passer rapidement d’une vue globale overlay à une vue locale underlay lisible, puis de revenir exactement à sa vue initiale.

---

## 4. Objectifs

### Objectifs fonctionnels

1. Permettre l’inspection à la demande du next hop VyOS d’un WAN Prisma.
2. Conserver une vue globale overlay propre par défaut.
3. Construire les associations uniquement avec une règle IPv4/CIDR déterministe et sûre.
4. Fournir des états de diagnostic complets lorsque la relation ne peut pas être établie.
5. Ne pas exposer de secrets ou de détails d’administration sensibles.
6. Ne pas modifier le comportement actuel de la topologie Prisma overlay.

### Objectifs UX

1. Réduire la complexité visuelle par progressive disclosure.
2. Donner un zoom automatique suffisamment lisible pour une utilisation laptop.
3. Permettre un retour au viewport global précédent.
4. Distinguer sans ambiguïté liens overlay et underlay.
5. Faciliter le troubleshooting d’un lien WAN sans changer de page.

---

## 5. Hors périmètre v1

Les capacités suivantes ne font pas partie de la première version :

- Découverte physique automatique via LLDP/CDP.
- Validation par ARP, MAC address table ou table de voisinage dynamique.
- Validation active par ICMP, traceroute ou sonde de connectivité.
- Déduction par le nom du site, du circuit, de l’interface ou de la description.
- Inférence lorsque plusieurs candidats VyOS appartiennent au même subnet.
- Affichage complet et permanent de la topologie VyOS sur la carte globale.
- Actions de contrôle VyOS depuis la Topology.
- Prise en charge IPv6.
- Résolution tenant compte des VRF ou des tables de routage multiples.

---

## 6. Règle de confiance

### Règle unique v1

Un lien underlay est affiché uniquement si :

1. L’interface Prisma est une interface WAN identifiable.
2. Prisma fournit une IPv4 avec CIDR, ou une IPv4 permettant de déterminer un réseau CIDR fiable.
3. Le routeur VyOS est actif (`enabled: true`).
4. Une interface VyOS porte une IPv4 statique valide avec CIDR.
5. L’adresse WAN Prisma appartient au sous-réseau de l’interface VyOS.
6. Un seul candidat VyOS satisfait cette condition.

Formellement :

\[
\text{Afficher le lien} \iff |\{v \in V : ip_{prisma} \in network(v)\}| = 1
\]

### Interdictions

Le resolver ne doit jamais :

- Faire du matching sur un préfixe de chaîne ;
- Faire du matching sur le texte `MPLS`, `INET`, `WAN`, `Internet` ;
- Utiliser le nom du site ou de l’ION comme preuve ;
- Choisir arbitrairement un candidat en cas d’ambiguïté ;
- Construire un lien si l’IP Prisma n’est pas connue.

### États de résolution

| Statut | Condition | Rendu UI |
|---|---|---|
| `matched` | Un candidat unique dans le même subnet | Lien underlay + routeur/interface VyOS |
| `no_match` | Aucun candidat VyOS dans le subnet | Message explicatif, aucun lien |
| `ambiguous` | Plusieurs candidats VyOS dans le subnet | Message + candidats sanitized, aucun lien |
| `wan_ip_unavailable` | WAN Prisma sans IPv4/CIDR exploitable | Message Prisma, aucun lien |
| `vyos_unavailable` | Config VyOS non disponible ou inventaire inutilisable | Message VyOS, topologie Prisma inchangée |

---

## 7. Parcours utilisateur

### Parcours principal : inspection d’un circuit

1. L’utilisateur ouvre **Topology**.
2. Il consulte la carte globale sans nœud VyOS affiché.
3. Il clique une WAN circuit card, par exemple `BR1-MPLS`.
4. La card est visuellement sélectionnée.
5. Une action `Inspect Underlay` devient disponible dans le panneau contextuel ou dans la toolbar.
6. L’utilisateur clique `Inspect Underlay`.
7. Stigix capture le viewport courant : position X/Y et niveau de zoom.
8. Stigix entre en mode **Underlay Details**.
9. Stigix construit un sous-graphe local et exécute un zoom/pan automatique.
10. L’utilisateur lit le lien entre le WAN Prisma et l’interface VyOS ou un état de non-résolution.
11. L’utilisateur clique `Exit Underlay`.
12. Stigix restaure le viewport global précédent.

### Parcours depuis un site/ION

1. L’utilisateur sélectionne un site ou un ION.
2. Il ouvre `Underlay` puis `Inspect selected site`.
3. Stigix affiche la liste des circuits WAN du site avec leur statut : resolved, no-match, ambiguous ou unavailable.
4. L’utilisateur choisit un circuit.
5. Stigix ouvre le détail local correspondant.

### Parcours global secondaire

1. L’utilisateur clique `Underlay` dans la toolbar.
2. Il choisit `Show resolved circuits`.
3. Les cards WAN possédant un match unique reçoivent une pastille de résolution.
4. Aucun routeur VyOS ni aucun lien underlay n’est ajouté à la carte globale.
5. Un clic sur une card marquée ouvre le drill-down Underlay Details.

---

## 8. Exigences UX

### Vue globale par défaut

- Aucun nœud VyOS dans la vue globale.
- Aucun lien underlay pointillé dans la vue globale.
- Les liens overlay existants ne changent pas de style ni de sémantique.
- Un bouton `Underlay` est ajouté à la toolbar si VyOS est disponible.
- Un badge optionnel montre le nombre de circuits résolus, par exemple `8/12`.

### Sélection de circuit

Lorsqu’un circuit WAN est sélectionné :

- Il est visuellement surligné.
- Une action `Inspect Underlay` est présentée.
- Son statut est indiqué sans obligation d’ouvrir le détail :
  - vert : `VyOS next hop resolved` ;
  - gris : `No VyOS match` ;
  - orange : `Ambiguous` ;
  - neutre : `WAN IP unavailable`.

### Mode Underlay Details

Le mode détail ne recharge pas la page et ne force pas un nouvel appel par circuit au navigateur. Il utilise les données de topologie déjà récupérées, enrichies côté serveur.

Le sous-graphe affiche :

```text
[Prisma Site]
    |
[ION]
    |
[WAN Circuit]
WAN IP: 192.168.190.1/24
    |
    | Underlay — 192.168.190.0/24
    v
[VyOS Router]
Interface: eth0
Description: MPLS190
IP: 192.168.190.254/24
```

### Zoom et retour

À l’entrée du mode détail :

- Le frontend appelle `fitView` ou un mécanisme React Flow équivalent sur les nœuds du sous-graphe.
- Une marge est appliquée afin d’éviter le rognage des edge labels et des descriptions.
- Le zoom final garantit que les IP, CIDR et descriptions sont lisibles.
- Un mouvement animé est préféré si disponible.
- L’utilisateur garde ensuite le contrôle manuel sur pan et zoom.

Contrôles dans le mode détail :

- `Fit Detail` : recentrage et re-zoom du sous-graphe.
- `Exit Underlay` : retour au graphe global et restauration de la position/du zoom antérieurs.

### Sémantique visuelle

| Élément | Style attendu |
|---|---|
| VPN overlay | Style actuel, inchangé |
| Lien underlay confirmé | Pointillé, couleur neutre bleu/gris, flèche discrète, label subnet |
| Nœud VyOS | Style distinct d’un ION Prisma, icône routeur/server cohérente avec le thème sombre |
| Match confirmé | Chip `CONFIRMED SAME-SUBNET MATCH` |
| Ambiguïté | Orange/ambre, sans edge vers VyOS |
| Aucune correspondance | Gris/neutre, sans edge |

### États non résolus

**No match**

```text
No VyOS next-hop discovered
No enabled VyOS interface belongs to 192.168.190.0/24.
```

**Ambiguous**

```text
Ambiguous VyOS mapping
More than one enabled VyOS interface matches 192.168.190.0/24.
No underlay link is displayed.
```

**WAN IP unavailable**

```text
WAN address unavailable from Prisma SD-WAN
Stigix cannot safely resolve the underlay next hop.
```

**VyOS unavailable**

```text
VyOS configuration unavailable
The Prisma overlay topology remains available.
```

---

## 9. Architecture et données

### Collecte Prisma

`engines/getflow.py --build-topology --json` reste la source de collecte Prisma. Il doit exposer de manière additive une liste normalisée d’interfaces WAN lorsqu’elles sont disponibles.

```json
{
  "wan_interfaces": [
    {
      "element_id": "prisma-element-id",
      "element_name": "BR1",
      "site_id": "prisma-site-id",
      "site_name": "BR1",
      "interface_id": "wan-interface-id",
      "interface_name": "BR1-MPLS",
      "wan_ip_cidr": "192.168.190.1/24",
      "wan_ip": "192.168.190.1",
      "wan_network": "192.168.190.0/24",
      "used_for": "wan",
      "link_type": "MPLS"
    }
  ]
}
```

Contraintes :

- Le contrat actuel de topologie est préservé.
- Les nouveaux champs sont uniquement additifs.
- Les objets bruts Prisma ne doivent pas être retournés au navigateur.
- Une interface sans IP utilisable peut être retournée avec `wan_ip_cidr: null` pour préserver son identité et fournir un état de diagnostic.

### Resolver underlay

Créer un module backend dédié, par exemple :

```text
web-dashboard/underlay-topology-manager.ts
```

Responsabilités :

1. Charger la configuration VyOS de manière sûre.
2. Construire l’inventaire d’interfaces IPv4 VyOS éligibles.
3. Normaliser les IP/CIDR VyOS.
4. Consommer les WAN Prisma normalisés.
5. Produire les résolutions et statistiques.
6. Isoler toute erreur sans casser l’endpoint de topologie.

### Types publics recommandés

```ts
type UnderlayResolutionStatus =
  | 'matched'
  | 'no_match'
  | 'ambiguous'
  | 'wan_ip_unavailable'
  | 'vyos_unavailable';

type PrismaWanEndpoint = {
  elementId: string;
  elementName?: string;
  siteId?: string;
  siteName?: string;
  interfaceId?: string;
  interfaceName?: string;
  ipCidr?: string | null;
  ip?: string | null;
  network?: string | null;
  linkType?: string | null;
};

type VyosInterfaceEndpoint = {
  routerId: string;
  routerName: string;
  location?: string | null;
  interfaceName: string;
  description?: string | null;
  ipCidr: string;
  ip: string;
  network: string;
  routerStatus?: string | null;
};

type UnderlayResolution = {
  id: string;
  status: UnderlayResolutionStatus;
  prismaWan: PrismaWanEndpoint;
  vyos?: VyosInterfaceEndpoint;
  candidates?: VyosInterfaceEndpoint[];
  matchMethod?: 'same_subnet';
  matchedNetwork?: string;
  diagnostic?: string;
};
```

### Payload backend

L’endpoint existant de topologie est enrichi de manière additive :

```json
{
  "topology": {
    "nodes": [],
    "edges": [],
    "wan_interfaces": []
  },
  "underlay": {
    "available": true,
    "vyosConfigAvailable": true,
    "summary": {
      "wanInterfacesSeen": 12,
      "matched": 8,
      "noMatch": 2,
      "ambiguous": 1,
      "wanIpUnavailable": 1
    },
    "resolutions": []
  }
}
```

### Gestion du cache

- L’inventaire VyOS peut être mis en cache selon la stratégie déjà utilisée par la topologie.
- Le navigateur ne doit pas déclencher un appel VyOS par card WAN.
- Le resolver tourne côté backend, une fois par rafraîchissement de topologie ou selon le TTL défini.
- En cas d’erreur VyOS, le backend retourne un bloc `underlay` dégradé mais conserve la topologie Prisma.

---

## 10. Sécurité

### Informations autorisées en frontend

- Nom du routeur VyOS.
- Identifiant du routeur VyOS.
- Localisation VyOS.
- Nom d’interface.
- Description d’interface.
- IPv4/CIDR de l’interface.
- Statut de routeur non sensible.
- Diagnostic de matching.

### Informations interdites en frontend

- `apiKey` VyOS.
- Credentials Prisma.
- Client secret et TSG secrets.
- Réponse brute des API Prisma.
- Contenu complet de la configuration VyOS.
- Informations d’administration ne participant pas au détail underlay.

### Logs sûrs

Journaliser sous un namespace `UNDERLAY` ou `TOPOLOGY` :

- disponibilité de la configuration VyOS ;
- nombre de WAN Prisma vus ;
- nombre d’interfaces VyOS éligibles ;
- compteurs de `matched`, `no_match`, `ambiguous`, `wan_ip_unavailable` ;
- erreurs techniques sans données sensibles.

Ne jamais logger les secrets, les réponses brutes complètes, ni le fichier de configuration VyOS complet.

---

## 11. Critères d’acceptation

### Fonctionnels

- [ ] La vue globale Topology conserve son comportement actuel.
- [ ] Les VyOS ne sont pas affichés par défaut dans la vue globale.
- [ ] La toolbar propose une entrée `Underlay` lorsque VyOS est disponible.
- [ ] Un circuit WAN peut être sélectionné et inspecté.
- [ ] Le mode détail affiche la relation complète lorsqu’un match unique existe.
- [ ] Le mode détail affiche une explication lorsque la relation ne peut pas être confirmée.
- [ ] Aucun edge underlay n’est dessiné en cas d’ambiguïté.
- [ ] L’opérateur peut sortir du détail sans reload.
- [ ] La vue globale retrouve son viewport précédent après sortie.

### Matching

- [ ] Les matching IPv4 utilisent une bibliothèque CIDR fiable, sans comparaison textuelle.
- [ ] Les routeurs VyOS désactivés sont exclus.
- [ ] Les valeurs `dhcp`, invalides et IPv6 sont exclues en v1.
- [ ] Les interfaces VyOS à plusieurs adresses IPv4 sont supportées.
- [ ] Les préfixes `/24`, `/30` et `/31` sont supportés.
- [ ] Un candidat unique génère un lien.
- [ ] Zéro candidat génère `no_match`.
- [ ] Plusieurs candidats génèrent `ambiguous` et aucun lien.

### UX

- [ ] Le zoom automatique rend les labels lisibles.
- [ ] Les liens overlay et underlay sont visuellement différents.
- [ ] `Fit Detail` est disponible dans la vue de détail.
- [ ] `Exit Underlay` est disponible dans la vue de détail.
- [ ] Les états critiques ne reposent pas uniquement sur un tooltip.
- [ ] Les contrôles sont accessibles au clavier et libellés pour les lecteurs d’écran.

### Sécurité

- [ ] Aucun `apiKey` VyOS n’est transmis au navigateur.
- [ ] Aucun secret Prisma ne quitte le backend.
- [ ] Aucune donnée brute sensible n’est exposée.
- [ ] Les logs sont nettoyés de secrets.

---

## 12. Plan de livraison

### Phase 1 — Découverte et contrat Prisma

- Auditer la sortie actuelle de `getflow.py --build-topology --json`.
- Identifier la source exacte des IP WAN dans Prisma.
- Ajouter `wan_interfaces[]` de manière additive.
- Documenter les cas où Prisma ne fournit pas d’IP WAN exploitable.

### Phase 2 — Résolution underlay backend

- Créer `underlay-topology-manager.ts`.
- Charger et assainir l’inventaire VyOS.
- Implémenter les statuts et le matching CIDR.
- Ajouter les tests unitaires de résolution.

### Phase 3 — Extension API

- Enrichir le payload Topology avec le bloc `underlay`.
- Ajouter cache et logs sûrs.
- Vérifier la dégradation gracieuse si VyOS est indisponible.

### Phase 4 — UX Topology

- Ajouter toolbar Underlay, sélection de circuit et badges.
- Implémenter Underlay Details.
- Ajouter le sous-graphe local et les contrôles de viewport.
- Restaurer le viewport global lors de la sortie.

### Phase 5 — Validation lab

- Cas match unique.
- Cas no-match.
- Cas ambiguous.
- Cas adresse Prisma absente.
- Cas VyOS indisponible.
- Tests de non-régression sur topologie globale, filtres et overlay existant.

---

## 13. Tests requis

### Tests unitaires resolver

- Match unique dans un `/24`.
- Absence de match.
- Deux candidats dans le même subnet : état `ambiguous`, aucun edge.
- Adresse VyOS `dhcp` ignorée.
- Adresse VyOS invalide ignorée.
- IPv6 ignorée en v1.
- Routeur VyOS désactivé ignoré.
- WAN Prisma sans CIDR : `wan_ip_unavailable`.
- Fichier VyOS indisponible : `vyos_unavailable`.
- Sous-réseaux `/30`, `/31` et `/24`.
- Plusieurs adresses IPv4 sur la même interface VyOS.

### Tests UI

Selon la stack de tests présente dans le projet :

- La vue globale ne rend aucun nœud VyOS par défaut.
- Sélectionner un circuit résolu rend l’action `Inspect Underlay` disponible.
- L’ouverture du détail applique un focus/zoom sur le sous-graphe.
- La sortie du détail rétablit le mode global.
- Les états `no_match` et `ambiguous` ne créent aucun lien underlay.
- Les badges et tooltips ne contiennent que des données assainies.

---

## 14. Définition of Done

La fonctionnalité est terminée lorsque :

1. La topologie Prisma globale existante fonctionne sans changement visuel par défaut.
2. L’underlay est accessible uniquement à la demande.
3. Le drill-down d’un WAN résolu ouvre une vue locale zoomée et lisible.
4. La vue locale affiche routeur VyOS, interface, description, IP/CIDR et réseau de matching.
5. Le lien underlay repose sur un match IPv4/CIDR unique.
6. Les cas non résolus sont explicites, sûrs et sans lien artificiel.
7. Le retour restaure la position et le zoom précédents.
8. Les secrets ne sont jamais exposés.
9. Les tests de matching et de non-régression sont exécutables et passent.
