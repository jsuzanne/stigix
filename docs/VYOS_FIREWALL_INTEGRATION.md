> **Last Updated:** 2026-02-03 | **Created:** 2026-02-03 (v1.1.2-patch.33.65)

# 🔥 VyOS Firewall Integration Guide - FIREWALL ONLY

## 🎯 Objectif

Ajouter **3 nouvelles commandes de contrôle firewall** au système VyOS Control existant **SANS TOUCHER** aux fonctionnalités existantes (shut/unshut, QoS/impairment).

**Commandes à ajouter** :
- `deny-traffic` → Block IP/subnet on interface (zero-config)
- `allow-traffic` → Unblock IP/subnet from interface (auto-cleanup)
- `show-denied` → List blocked IPs on interface

---

## ⚠️ RÈGLES CRITIQUES

### ❌ NE PAS MODIFIER
- ❌ Les mappings existants (interface-down, interface-up, set-qos, clear-qos)
- ❌ Les filtres de paramètres existants (isSetLatency, isSetLoss, etc.)
- ❌ Les formulaires existants dans l'UI
- ❌ Les labels existants (getActionLabel pour les anciennes commandes)
- ❌ Le formatage existant des paramètres
- ❌ Les interfaces TypeScript (VyosAction, VyosSequence, VyosRouter)
- ❌ Le scheduler (vyos-scheduler.ts)
- ❌ Les routes API

### ✅ UNIQUEMENT AJOUTER
- ✅ 3 nouveaux mappings de commandes (deny-traffic, allow-traffic, show-denied)
- ✅ 2 nouveaux mappings de flags (ip, force)
- ✅ 3 nouveaux filtres de paramètres (isDenyTraffic, isAllowTraffic, isShowDenied)
- ✅ 1 nouvelle fonction getBlocks()
- ✅ 3 nouvelles options dans le dropdown UI
- ✅ 3 nouveaux formulaires conditionnels UI
- ✅ Validation CIDR pour les nouvelles commandes
- ✅ Labels pour les 3 nouvelles commandes

---

## 📁 Fichier 1/2 : Backend (backend/vyos-manager.ts)

### Modification 1 : Ajouter mappings de commandes firewall

**LOCALISATION** : Fonction `executeAction()`, ligne ~235

**CHERCHER** :
```typescript
if (command === 'interface-down') command = 'shut';
if (command === 'interface-up') command = 'no-shut';
if (command === 'set-qos') command = 'set-qos';
if (command === 'clear-qos') command = 'clear-qos';
```

**AJOUTER APRÈS (sans modifier l'existant)** :
```typescript
// NEW: Firewall commands
if (command === 'deny-traffic') command = 'simple-block';
if (command === 'allow-traffic') command = 'simple-unblock';
if (command === 'show-denied') command = 'get-blocks';
```

---

### Modification 2 : Ajouter mappings de flags firewall

**LOCALISATION** : Fonction `executeAction()`, boucle de paramètres, ligne ~250

**CHERCHER** :
```typescript
if (key === 'latency') flag = 'ms';
if (key === 'loss') flag = 'loss';
if (key === 'corrupt') flag = 'corruption';
if (key === 'interface') flag = 'iface';
```

**AJOUTER APRÈS (sans modifier l'existant)** :
```typescript
// NEW: Firewall flags
if (key === 'ip') flag = 'ip';
if (key === 'force') flag = 'force';
```

---

### Modification 3 : Ajouter filtres de paramètres firewall

**LOCALISATION** : Fonction `executeAction()`, filtres de paramètres, ligne ~260

**CHERCHER** :
```typescript
const isSetLatency = command === 'set-latency' && flag === 'ms';
const isSetLoss = command === 'set-loss' && flag === 'percent';
const isSetCorruption = command === 'set-corruption' && flag === 'corruption';
const isSetRate = command === 'set-rate' && flag === 'rate';
const isIface = flag === 'iface';
const isQoS = command === 'set-qos';
```

**AJOUTER APRÈS (sans modifier l'existant)** :
```typescript
// NEW: Firewall filters
const isDenyTraffic = command === 'simple-block' && (flag === 'iface' || flag === 'ip' || flag === 'force');
const isAllowTraffic = command === 'simple-unblock' && (flag === 'iface' || flag === 'ip');
const isShowDenied = command === 'get-blocks' && flag === 'iface';
```

---

### Modification 4 : Étendre la condition d'ajout des arguments

**LOCALISATION** : Fonction `executeAction()`, condition if pour args.push, ligne ~270

**CHERCHER** :
```typescript
if (isQoS || isIface || isSetLatency || isSetLoss || isSetCorruption || isSetRate) {
  args.push(`--${flag}`, val.toString());
}
```

**REMPLACER PAR** :
```typescript
if (isQoS || isIface || isSetLatency || isSetLoss || isSetCorruption || isSetRate || 
    isDenyTraffic || isAllowTraffic || isShowDenied) {

  // Handle boolean flags (e.g., --force)
  if (typeof val === 'boolean') {
    if (val === true) {
      args.push(`--${flag}`);  // Only add flag if true
    }
  } else {
    args.push(`--${flag}`, val.toString());
  }
}
```

**NOTE** : Ici on MODIFIE la condition existante pour AJOUTER les 3 nouveaux cas, mais le comportement existant reste identique.

---

### Modification 5 : Ajouter nouvelle fonction getBlocks()

**LOCALISATION** : Après la fonction `testConnection()` (fin de la classe VyosManager)

**AJOUTER** :
```typescript
/**
 * Get list of denied traffic rules on an interface
 */
async getBlocks(routerId: string, iface: string): Promise<any> {
  const router = this.routers.get(routerId);
  if (!router) throw new Error('Router not found');

  const args = [
    this.pythonScriptPath,
    '--host', router.host,
    '--key', router.apiKey,
    '--version', router.version || '1.4',
    'get-blocks',
    '--iface', iface
  ];

  const scrubbedArgs = args.map(arg => (arg === router.apiKey ? '***' : arg));
  console.log(`[VYOS] Get blocks CLI: python3 ${scrubbedArgs.join(' ')}`);

  return new Promise((resolve, reject) => {
    const proc = spawn('python3', args);
    let output = '';
    let errorMsg = '';

    proc.stdout.on('data', (data) => output += data.toString());
    proc.stderr.on('data', (data) => errorMsg += data.toString());

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(new Error('Invalid JSON response'));
        }
      } else {
        reject(new Error(errorMsg.trim() || `Process exited with code ${code}`));
      }
    });
  });
}
```

---

## 📁 Fichier 2/2 : Frontend (frontend/components/Vyos.tsx)

### Modification 1 : Ajouter options firewall dans le dropdown

**LOCALISATION** : Le `<select>` qui contient les options de commandes

**CHERCHER** :
```tsx
<option value="interface-down">...</option>
<option value="interface-up">...</option>
<option value="set-qos">...</option>
<option value="clear-qos">...</option>
```

**AJOUTER APRÈS le dernier `</optgroup>` existant** :
```tsx
<optgroup label="Traffic Control">
  <option value="deny-traffic">🚫 Deny Traffic From IP/Subnet</option>
  <option value="allow-traffic">✅ Allow Traffic From IP/Subnet</option>
  <option value="show-denied">📋 Show Denied Traffic</option>
</optgroup>
```

**NOTE** : Ne pas modifier les options existantes, juste ajouter le nouveau groupe.

---

### Modification 2 : Ajouter formulaires conditionnels firewall

**LOCALISATION** : Switch case ou conditions pour `editAction?.command`

**CHERCHER** : Le bloc avec `{editAction?.command === 'set-qos' && (...)}` ou similaire

**AJOUTER APRÈS tous les blocs existants** :
```tsx
{/* NEW: Deny Traffic From IP/Subnet */}
{editAction?.command === 'deny-traffic' && (
  <div className="space-y-3">
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-2">
        IP Address or Subnet (CIDR) <span className="text-red-400">*</span>
      </label>
      <input
        type="text"
        placeholder="e.g., 8.8.8.8/32 (single IP) or 10.0.0.0/24 (subnet)"
        value={editAction.parameters?.ip || ''}
        onChange={(e) => setEditAction({
          ...editAction,
          parameters: { ...editAction.parameters, ip: e.target.value }
        })}
        className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white"
      />
      <p className="text-xs text-slate-500 mt-1">
        Use /32 for single IP, /24 for class C subnet
      </p>
    </div>

    <div className="flex items-center gap-2 p-3 bg-amber-900/20 border border-amber-600/30 rounded">
      <input
        type="checkbox"
        id="force-override"
        checked={editAction.parameters?.force || false}
        onChange={(e) => setEditAction({
          ...editAction,
          parameters: { ...editAction.parameters, force: e.target.checked }
        })}
        className="w-4 h-4"
      />
      <label htmlFor="force-override" className="text-sm text-amber-300">
        ⚠️ Override existing firewall rules
      </label>
    </div>
  </div>
)}

{/* NEW: Allow Traffic From IP/Subnet */}
{editAction?.command === 'allow-traffic' && (
  <div className="space-y-3">
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-2">
        IP Address or Subnet to Allow <span className="text-red-400">*</span>
      </label>
      <input
        type="text"
        placeholder="e.g., 8.8.8.8/32"
        value={editAction.parameters?.ip || ''}
        onChange={(e) => setEditAction({
          ...editAction,
          parameters: { ...editAction.parameters, ip: e.target.value }
        })}
        className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white"
      />
      <p className="text-xs text-slate-500 mt-1">
        Removes deny rule for this IP/subnet
      </p>
    </div>
  </div>
)}

{/* NEW: Show Denied Traffic */}
{editAction?.command === 'show-denied' && (
  <div className="p-4 bg-blue-900/20 border border-blue-600/30 rounded">
    <p className="text-sm text-blue-300">
      ℹ️ Lists all denied traffic rules on selected interface. No parameters required.
    </p>
  </div>
)}
```

---

### Modification 3 : Ajouter validation CIDR

**LOCALISATION** : Fonction de sauvegarde d'action (chercher `handleSaveAction` ou `onSaveAction` ou là où l'action est sauvegardée)

**AJOUTER AU DÉBUT de la fonction (avant la sauvegarde)** :
```typescript
// NEW: Validate firewall commands
if (editAction.command === 'deny-traffic' || editAction.command === 'allow-traffic') {
  if (!editAction.parameters?.ip) {
    alert('IP address or subnet is required');
    return;
  }

  // Validate CIDR format
  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
  if (!cidrRegex.test(editAction.parameters.ip)) {
    alert('Invalid IP format. Use CIDR notation (e.g., 8.8.8.8/32)');
    return;
  }

  // Validate IP octets (0-255)
  const octets = editAction.parameters.ip.split('/')[0].split('.');
  if (octets.some((o: string) => parseInt(o) > 255 || parseInt(o) < 0)) {
    alert('Invalid IP address. Each octet must be 0-255');
    return;
  }

  // Validate CIDR mask (0-32)
  if (editAction.parameters.ip.includes('/')) {
    const mask = parseInt(editAction.parameters.ip.split('/')[1]);
    if (mask < 0 || mask > 32) {
      alert('Invalid subnet mask. Must be 0-32');
      return;
    }
  }
}
```

---

### Modification 4 : Ajouter labels des commandes firewall

**LOCALISATION** : Fonction ou switch qui retourne les labels (chercher `getActionLabel` ou un switch avec `case 'interface-down'`)

**AJOUTER dans le switch/function** :
```typescript
case 'deny-traffic': return 'Deny Traffic From';
case 'allow-traffic': return 'Allow Traffic From';
case 'show-denied': return 'Show Denied Traffic';
```

**NOTE** : Ne pas modifier les cases existants, juste ajouter les 3 nouveaux.

---

### Modification 5 : Ajouter formatage des paramètres firewall

**LOCALISATION** : Fonction de formatage des paramètres dans l'historique (chercher `formatParameters` ou un switch avec formatage JSON)

**AJOUTER dans le switch** :
```typescript
case 'deny-traffic':
  return `${params.ip || 'N/A'}${params.force ? ' (forced)' : ''}`;
case 'allow-traffic':
  return `IP: ${params.ip || 'N/A'}`;
case 'show-denied':
  return 'Query denied traffic';
```

---

## 🔍 Ordre CRITIQUE des Arguments CLI

Le script Python **EXIGE** cet ordre exact :

```bash
python3 vyos_sdwan_ctl.py \
  --host <IP> \
  --key <API_KEY> \
  --version <1.4|1.5> \
  <COMMAND> \
  [--iface <interface>] \
  [--ip <cidr>] \
  [--force]
```

**Exemples corrects** :
```bash
# Deny traffic
python3 vyos_sdwan_ctl.py --host 192.168.1.1 --key SECRET --version 1.4 simple-block --iface eth0 --ip 8.8.8.8/32

# Allow traffic
python3 vyos_sdwan_ctl.py --host 192.168.1.1 --key SECRET --version 1.4 simple-unblock --iface eth0 --ip 8.8.8.8/32

# Show denied
python3 vyos_sdwan_ctl.py --host 192.168.1.1 --key SECRET --version 1.4 get-blocks --iface eth0

# With force flag
python3 vyos_sdwan_ctl.py --host 192.168.1.1 --key SECRET --version 1.4 simple-block --iface eth0 --ip 8.8.8.8/32 --force
```

**Le code backend respecte déjà cet ordre** grâce à la construction séquentielle du tableau `args`.

---

## ✅ Checklist de Vérification

### Backend (vyos-manager.ts)
- [ ] 3 nouveaux mappings ajoutés (deny-traffic, allow-traffic, show-denied)
- [ ] 2 nouveaux flags ajoutés (ip, force)
- [ ] 3 nouveaux filtres ajoutés (isDenyTraffic, isAllowTraffic, isShowDenied)
- [ ] Condition `if (isQoS || ...)` étendue avec les 3 nouveaux cas
- [ ] Gestion du flag boolean `--force` ajoutée
- [ ] Fonction `getBlocks()` ajoutée après `testConnection()`
- [ ] **AUCUNE** modification des mappings/filtres existants

### Frontend (Vyos.tsx)
- [ ] Nouveau groupe "Traffic Control" ajouté dans le dropdown
- [ ] 3 formulaires conditionnels ajoutés (deny-traffic, allow-traffic, show-denied)
- [ ] Validation CIDR ajoutée dans la fonction de sauvegarde
- [ ] 3 labels ajoutés dans `getActionLabel` (ou équivalent)
- [ ] 3 formatages ajoutés dans `formatParameters` (ou équivalent)
- [ ] **AUCUNE** modification des formulaires existants (set-qos, interface-down, etc.)

### Tests Manuels Post-Déploiement
- [ ] Build réussit sans erreur
- [ ] Serveur démarre sans erreur
- [ ] UI affiche les 3 nouvelles options dans le dropdown
- [ ] Création d'une action "Deny Traffic" avec IP `8.8.8.8/32`
- [ ] Validation refuse une IP invalide (`999.999.999.999`)
- [ ] Validation refuse un masque invalide (`8.8.8.8/99`)
- [ ] JSON sauvegardé contient `command: "deny-traffic"` et `parameters: { ip: "8.8.8.8/32" }`

---

## 🚫 NE PAS FAIRE

1. ❌ Ne pas modifier les commandes existantes (interface-down, set-qos, etc.)
2. ❌ Ne pas toucher aux formulaires existants dans l'UI
3. ❌ Ne pas modifier les interfaces TypeScript
4. ❌ Ne pas créer de tests automatisés (ni browser, ni unitaires)
5. ❌ Ne pas modifier package.json
6. ❌ Ne pas toucher au scheduler (vyos-scheduler.ts)
7. ❌ Ne pas modifier les routes API
8. ❌ Ne pas changer l'ordre des arguments CLI existants

---

## 📊 Résumé des Modifications

| Fichier | Lignes modifiées (approx) | Type de modification |
|---------|---------------------------|---------------------|
| `backend/vyos-manager.ts` | ~40 lignes | Ajout uniquement |
| `frontend/components/Vyos.tsx` | ~80 lignes | Ajout uniquement |
| **TOTAL** | **~120 lignes** | **0 suppression** |

---

## 🎯 Résultat Attendu

Après l'intégration, l'utilisateur pourra :

1. **Créer une séquence** avec une action "Deny Traffic From IP/Subnet"
2. **Configurer** : Interface `eth0`, IP `8.8.8.8/32`, Offset `0`
3. **Sauvegarder** et vérifier le JSON : 
   ```json
   {
     "command": "deny-traffic",
     "interface": "eth0",
     "parameters": { "ip": "8.8.8.8/32" }
   }
   ```
4. **Run manuel** de la séquence
5. **Vérifier les logs** backend :
   ```
   [08:50:15] [SEQ-0001] deny-traffic vyos-br1:eth0 | ip=8.8.8.8/32 | SUCCESS (234ms)
   ```
6. **Vérifier sur VyOS** :
   ```bash
   ssh vyos@192.168.1.1 "show configuration commands | grep SDWAN_BLOCK"
   ```
   Résultat attendu :
   ```
   set firewall name SDWAN_BLOCK_eth0 rule 100 action 'drop'
   set firewall name SDWAN_BLOCK_eth0 rule 100 source address '8.8.8.8/32'
   ```

---

## 📝 Notes Importantes

- Le script Python `vyos_sdwan_ctl.py` doit être présent dans `vyos/vyos_sdwan_ctl.py`
- La fonctionnalité firewall est **zero-config** : pas besoin de pré-configurer le firewall sur VyOS
- Le cleanup est **automatique** : quand la dernière règle est supprimée, le ruleset est supprimé
- Les règles sont **idempotentes** : bloquer 2 fois la même IP ne crée pas de doublon

---

## 🆘 En Cas de Problème

### Le dropdown ne montre pas les nouvelles options
- Vérifier que l'`<optgroup label="Traffic Control">` est bien ajouté
- Vérifier qu'il n'y a pas d'erreur de syntaxe JSX

### Erreur "Command not found" dans les logs
- Vérifier que les mappings `deny-traffic → simple-block` sont bien ajoutés
- Vérifier l'ordre des arguments : `--host --key --version COMMAND --params`

### Validation ne fonctionne pas
- Vérifier que la validation est ajoutée **avant** la sauvegarde
- Vérifier que la regex CIDR est correcte : `/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/`

### "IP already blocked" ou "IP not blocked"
- C'est **normal** : le script Python gère ces cas
- Le frontend doit juste afficher le message retourné par le backend

---

**FIN DU GUIDE**
