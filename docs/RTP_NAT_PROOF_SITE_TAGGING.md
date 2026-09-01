# 🏷️ Identification du Site Source par Tagging RTP (NAT-Proof)

## 📌 Contexte & Problématique
Dans les topologies SD-WAN complexes comportant du **Source NAT (SNAT)**, du **PAT** ou de la réécriture d'adresses IP à travers des routeurs (VyOS, Palo Alto, Cisco SD-WAN), les paquets UDP RTP entrants arrivent sur les récepteurs (ex: DC1 ou instance Cloud) avec une adresse IP translatée (ex: `10.10.207.129`).

Les mécanismes classiques basés uniquement sur l'adresse IP source échouent à associer ces IP translatées aux sites réels d'origine (ex: `BR1-Ubuntu` ou `BR8-Ubuntu`).

---

## 💡 Solution Architecture : Tagging dans le Payload RTP

Pour garantir une **identification 100% insensible au NAT**, Stigix injecte des métadonnées structurées dans le payload binaire de chaque paquet RTP émis :

$$\text{Payload UDP} = \text{Header RTP (12 octets)} + \mathbf{\text{"CID:<CALL-ID>:SITE:<SITE-NAME>:"}} + \text{Padding Audio/Vidéo...}$$

### Avantages Clés :
- **Immunité Totale au NAT / PAT** : L'identification du site d'origine reste exacte quel que soit le niveau de NAT, de proxy ou d'encapsulation VPN.
- **Détection Automatique Multi-Source** : Le nœud émetteur détermine automatiquement son nom de site parmi 5 sources hiérarchisées.
- **Surcharge Négligeable** : ~15 octets dans un paquet G.711 de 160 octets (aucun impact sur les performances).
- **Rétrocompatibilité Totale** : Si un récepteur utilise une version antérieure, le tag `SITE:` est ignoré sans interrompre la mesure.

---

## ⚙️ Hiérarchie de Détection du Nom de Site (`voice_orchestrator.py`)

Lors du lancement d'un flux voix, `voice_orchestrator.py` détermine automatiquement le nom du site local en consultant les sources suivantes dans l'ordre de priorité :

1. **Variables d'environnement** : `STIGIX_SITE_NAME`, `SITE_NAME`, `NODE_NAME`, `TARGET_NAME`.
2. **Fichier `.env` sur le disque** : Lecture directe de `/app/.env`, `/app/config/.env`, `./.env` (champ `STIGIX_SITE_NAME=...`).
3. **Configuration IHM (`site-name.json`)** : Nom saisi dans **Settings $\to$ Stigix Targets $\to$ LOCAL TARGET SERVICE $\to$ SITE NAME** (ex: `BR8-Ubuntu`).
4. **Auto-Détection Réseau (`site-detection.json`)** : Généré par le daemon de découverte Stigix Target Controller.
5. **Nom d'Hôte Système (`socket.gethostname()`)** : Nom d'hôte de la machine (ex: `UbuntuBR8`).

---

## 📥 Décodage Récepteur (`echo_server.py`)

Lorsque les paquets UDP arrivent sur les ports d'écoute 6100 / 6200 :
1. `echo_server.py` extrait le payload décodé (`latin-1`).
2. Extrait le tag `SITE:([A-Za-z0-9_-]+)` via une expression régulière.
3. Associe le champ `"src_site": "BR8-Ubuntu"` à la session enregistrée dans `ingress_sessions`.
4. Affiche directement le nom du site source dans les logs Docker :
   ```text
   stigix  | [20:10:36] [CALL-0077] [BR8-Ubuntu] 📥 RECEIVED ON PORT 6100: 10.10.207.129:30077
   stigix  | [20:12:07] [CALL-0077] [BR8-Ubuntu] ✅ COMPLETED ON PORT 6100: 10.10.207.129:30077 | Duration: 16s | Packets: 513
   ```

---

## 🖥️ Affichage Dashboard Web (`Voice.tsx`)

Dans le tableau **Inbound (Receiver)** de l'IHM Voix :
1. Si le champ `session.src_site` est extrait du payload, `Voice.tsx` l'affiche immédiatement comme **Source Site** (ex: `BR8-Ubuntu`).
2. L'IP source translatée (`10.10.207.129`) est conservée en sous-titre pour référence réseau.
3. **Fallback** : Si aucun tag `SITE:` n'est présent (ancien émetteur), le dashboard nettoie le port (`.split(':')[0]`) et effectue une correspondance IP ou sous-réseau `/24` avec les cibles répertoriées.

---

## 📊 Récapitulatif des Composants Modifiés

| Composant | Fichier | Modification Apportée |
| :--- | :--- | :--- |
| **RTP Engine** | `engines/rtp.py` | Ajout de l'argument `--site-name` et construction du tag `CID:<id>:SITE:<name>:`. |
| **Orchestrateur** | `engines/voice_orchestrator.py` | Implémentation de `get_local_site_name()` (support `.env`, `STIGIX_SITE_NAME`, `site-name.json`). |
| **Serveur d'Écho** | `engines/echo_server.py` | Extraction du tag `SITE:`, enregistrement de `src_site` et affichage `[site]` dans les logs console. |
| **Dashboard Web** | `web-dashboard/src/Voice.tsx` | Traitement prioritaire de `payloadSite` dans `getResolvedSiteName` et nettoyage des ports `:6100` dans les comparatifs d'IP. |

---

## 🔄 Guide de Mise à Jour Rapide

Pour déployer cette fonctionnalité sur vos nœuds Stigix :

```bash
git pull origin v2
docker compose build --no-cache
docker compose up -d
```
