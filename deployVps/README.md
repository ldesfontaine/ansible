# 🚀 deployVps

Playbook Ansible **one-shot** pour déployer un serveur sécurisé en 5 minutes.

Fonctionne sur **n'importe quel VPS** (OVH, Hetzner, Scaleway, etc.) ou en **local** (VM, Raspberry Pi) sous Debian/Ubuntu.

## Ce que ça installe

```
┌──────────────────────────────────────────────────────┐
│                       HÔTE                           │
│                                                      │
│  UFW ─────────────── deny all, ports SSH/80/443 only │
│  SSH hardené ──────── clé only, root off, ciphers    │
│  sysctl ───────────── anti-spoofing, syncookies      │
│  unattended-upgrades─ patches sécurité auto          │
│  NetBird VPN ──────── mesh VPN (optionnel)           │
│                                                      │
│  crowdsec-bouncer (nftables)                         │
│       │ poll toutes les 10s                          │
│       ▼                                              │
│  ┌─── Docker ─────────────────────────────────────┐  │
│  │  Traefik       → reverse proxy (80/443)        │  │
│  │  CrowdSec      → détection intrusions (LAPI)   │  │
│  │  Prometheus     → métriques (CrowdSec+Traefik) │  │
│  │  Node Exporter  → métriques système (opt.)     │  │
│  │  Grafana        → dashboards monitoring        │  │
│  │  BentoPDF       → app exemple (opt.)           │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## Quickstart

### 1. Prérequis

- Un serveur Debian/Ubuntu avec accès SSH par **clé publique**
- Ansible sur ta machine locale : `pip install ansible`

### 2. Configurer

```bash
git clone https://github.com/VOTRE_USER/deployVps.git && cd deployVps
```

Éditer `inventory.ini` — ajouter ton serveur :

```ini
[my_vps]
203.0.113.42 ansible_user=deploy ansible_python_interpreter=/usr/bin/python3
```

Éditer `group_vars/all.yml` — les valeurs **obligatoires** à changer :

```yaml
admin_email: "your-email@example.com"
base_domain: "example.com"         # Ton domaine
enable_https: true                  # false pour du local sans domaine
crowdsec_lapi_key: "..."            # openssl rand -hex 16
grafana_admin_password: "..."       # Un vrai mot de passe
```

### 3. Déployer

```bash
ansible-playbook -i inventory.ini setup.yml
```

> **Minimal install** : si tu ne veux pas de NetBird et souhaites un déploiement épuré (voir [section ci-dessous](#minimal-install)), utilise `setup-minimal.yml` à la place.

### 4. C'est prêt

| Service       | URL par défaut                        | Variable sous-domaine     |
|---------------|---------------------------------------|---------------------------|
| BentoPDF      | `https://pdf.example.com`             | `bentopdf_subdomain`      |
| Grafana       | `https://stats.example.com`           | `grafana_subdomain`       |

Les sous-domaines sont **personnalisables** dans `group_vars/all.yml`.

---

## Variables disponibles

| Variable | Défaut | Description |
|----------|--------|-------------|
| `base_domain` | `example.com` | Domaine de base |
| `enable_https` | `false` | HTTPS avec Let's Encrypt |
| `admin_email` | — | Email Let's Encrypt |
| `ssh_port` | `22` | Port SSH |
| **Sous-domaines** | | |
| `bentopdf_subdomain` | `pdf` | Sous-domaine BentoPDF |
| `grafana_subdomain` | `stats` | Sous-domaine Grafana |
| **Services optionnels** | | |
| `enable_bentopdf` | `true` | Activer BentoPDF |
| `enable_node_exporter` | `true` | Métriques système (CPU/RAM/disque) |
| `enable_netbird` | `false` | VPN NetBird |
| **VPN NetBird** | | |
| `netbird_setup_key` | `""` | Setup key depuis netbird.io |
| `restrict_ssh_to_vpn` | `false` | Restreindre SSH au VPN |
| `netbird_vpn_network` | `100.64.0.0/10` | Réseau VPN |
| **Versions (pinnées)** | | |
| `traefik_version` | `3.4` | Version Traefik |
| `crowdsec_version` | `v1.6.8` | Version CrowdSec |
| `grafana_version` | `11.5.2` | Version Grafana |
| `prometheus_version` | `v3.2.1` | Version Prometheus |
| `node_exporter_version` | `v1.9.0` | Version Node Exporter |
| **Secrets** | | |
| `crowdsec_lapi_key` | `CHANGE_ME` | Clé API CrowdSec bouncer |
| `grafana_admin_password` | `CHANGE_ME` | Mot de passe admin Grafana |

---

## Test local (VM, Pi, etc.)

Pas besoin d'un domaine ni d'un VPS pour tester :

```yaml
# group_vars/all.yml
base_domain: "test.local"
enable_https: false
```

```ini
# inventory.ini
[my_vps]
192.168.1.50 ansible_user=lucas ansible_python_interpreter=/usr/bin/python3
```

Ajouter dans `/etc/hosts` de ta machine locale :

```
192.168.1.50  test.local pdf.test.local stats.test.local
```

Puis : `ansible-playbook -i inventory.ini setup.yml`

---

## Minimal install

`setup-minimal.yml` est un playbook allégé qui déploie uniquement l'essentiel :

**Inclut :**
- Système & firewall (UFW, mises à jour auto)
- Hardening SSH & kernel
- Docker Engine
- Stack Docker : **Traefik** (reverse proxy), CrowdSec, Prometheus, Grafana, Node Exporter (`enable_node_exporter`) / BentoPDF (`enable_bentopdf`) en option
- CrowdSec bouncer nftables (hôte)

**Exclut :**
- NetBird VPN
- Tout flux « deploy-app » (pas de clone Git, pas de Caddy, pas de healthchecks d'application, pas de métadonnées/historique de déploiement)
- Backup et settings

```bash
ansible-playbook -i inventory.ini setup-minimal.yml
```

Les mêmes variables que `setup.yml` s'appliquent (`group_vars/all.yml`).

---

## Structure du projet

```
├── inventory.ini                          # Serveur(s) cible(s)
├── setup.yml                              # Playbook complet (avec NetBird)
├── setup-minimal.yml                      # Playbook minimal (sans NetBird ni deploy-app)
├── group_vars/
│   └── all.yml                            # Variables à personnaliser
├── tasks/
│   ├── system.yml                         # APT, UFW, unattended-upgrades
│   ├── hardening.yml                      # SSH durci, sysctl kernel
│   ├── docker.yml                         # Docker Engine (repo officiel)
│   ├── netbird.yml                        # VPN NetBird (optionnel)
│   ├── stack.yml                          # Déploiement docker compose
│   └── crowdsec-bouncer.yml               # Bouncer nftables (hôte)
├── handlers/
│   └── main.yml                           # Restart services
└── templates/                             # Fichiers de config Jinja2
    ├── docker-compose.yml.j2
    ├── traefik.yml.j2
    ├── acquis.yaml.j2
    ├── crowdsec-firewall-bouncer.yaml.j2
    ├── prometheus.yml.j2
    ├── grafana-datasource.yml.j2
    └── sshd_config.j2
```

Chaque fichier est commenté — ouvre n'importe lequel pour comprendre ce qu'il fait.

---

## Comment ça marche

### Requête web normale

```
Client → UFW (port 80 OK) → Traefik → regarde Host: header → route vers le bon container
```

### Attaque détectée

```
Attaquant bruteforce SSH
    → CrowdSec lit /var/log/auth.log
    → Détecte le pattern (collection sshd)
    → Crée une décision "ban" dans la LAPI
    → Bouncer nftables poll la LAPI (toutes les 10s)
    → Injecte une règle DROP dans nftables
    → L'attaquant est bloqué au niveau kernel
```

### Pourquoi le bouncer est sur l'hôte ?

Il doit manipuler **nftables du kernel**. Un container Docker n'a pas accès au firewall de l'hôte (sauf en mode `privileged`, ce qui serait une faille de sécurité).

### Monitoring complet

```
Node Exporter → CPU/RAM/disque/réseau de l'hôte ─┐
Traefik       → requêtes HTTP, latence, erreurs  ─┼─→ Prometheus ─→ Grafana
CrowdSec      → décisions, alertes, parsers      ─┘    (scrape 15s)   (dashboards)
```

---

## Mises à jour

| Composant | Méthode | Fréquence |
|-----------|---------|-----------|
| OS + Docker Engine | `unattended-upgrades` (automatique) | Quotidien |
| Bouncer CrowdSec | `unattended-upgrades` (automatique) | Quotidien |
| Images Docker | Re-lancer le playbook | Manuel |

Pour mettre à jour les images Docker :

```bash
# Via Ansible (recommandé) — mettre à jour les versions dans all.yml puis :
ansible-playbook -i inventory.ini setup.yml

# Ou directement sur le serveur
cd /opt/stack && docker compose pull && docker compose up -d && docker image prune -f
```

---

## Ajouter des services

### Règle d'or

> **Tout passe par Ansible.** Jamais de config manuelle sur le serveur.

### Ajouter un container (ex: Nextcloud)

1. Ajouter des variables dans `group_vars/all.yml` :

```yaml
enable_nextcloud: true
nextcloud_subdomain: "cloud"
```

2. Ajouter dans `templates/docker-compose.yml.j2` :

```yaml
{% if enable_nextcloud %}
  nextcloud:
    image: nextcloud:30
    container_name: nextcloud
    restart: unless-stopped
    volumes:
      - nextcloud_data:/var/www/html
    networks:
      - web
    labels:
      - "traefik.enable=true"
{% if enable_https %}
      - "traefik.http.routers.nextcloud.rule=Host(`{{ nextcloud_subdomain }}.{{ base_domain }}`)"
      - "traefik.http.routers.nextcloud.entrypoints=websecure"
      - "traefik.http.routers.nextcloud.tls.certresolver=myresolver"
{% else %}
      - "traefik.http.routers.nextcloud.rule=Host(`{{ nextcloud_subdomain }}.{{ base_domain }}`)"
      - "traefik.http.routers.nextcloud.entrypoints=web"
{% endif %}
{% endif %}
```

2. Ajouter le volume en bas du fichier :

```yaml
volumes:
  nextcloud_data:
```

3. DNS : ajouter un enregistrement `A cloud.example.com → IP`
4. Déployer : `ansible-playbook -i inventory.ini setup.yml`

### Ajouter un service sur l'hôte (ex: FTP)

1. Créer `tasks/ftp.yml` + `templates/vsftpd.conf.j2`
2. L'inclure dans `setup.yml`
3. Ouvrir le port dans la loop UFW de `tasks/system.yml`
4. Ajouter un handler dans `handlers/main.yml`
5. Déployer : `ansible-playbook -i inventory.ini setup.yml`

---

## VPN NetBird (optionnel)

[NetBird](https://netbird.io/) crée un réseau VPN mesh. Installation et configuration automatisées par Ansible.

### Activer

```yaml
# group_vars/all.yml
enable_netbird: true
netbird_setup_key: "VOTRE_SETUP_KEY"    # Depuis https://app.netbird.io/
```

### Restreindre SSH au VPN

```yaml
restrict_ssh_to_vpn: true                # SSH uniquement via le VPN
```

> ⚠️ **Garde toujours un accès de secours** (console VPS du provider) avant de restreindre SSH. Si le VPN tombe, SSH sera inaccessible autrement.

---

## Dashboards Grafana

Après déploiement :

1. Ouvrir `https://stats.example.com` → login `admin` / mot de passe de `all.yml`
2. **+** → **Import** → Importer les dashboards recommandés :

| Dashboard | ID Grafana | Description |
|-----------|-----------|-------------|
| CrowdSec | `11585` | Décisions, alertes, scénarios |
| Node Exporter Full | `1860` | CPU, RAM, disque, réseau |
| Traefik | `17346` | Requêtes, latence, codes HTTP |

3. Sélectionner la datasource **Prometheus** → **Import**

Prometheus scrape les métriques toutes les 15s avec 30 jours de rétention.

---

## Sécurité — ce qui est en place

| Couche | Protection |
|--------|-----------|
| **Firewall** | UFW deny-all + ports explicites. Port 443 uniquement si HTTPS activé. |
| **SSH** | Clé uniquement, root interdit, 3 tentatives max, ciphers modernes, timeout agressif. |
| **Anti-bruteforce** | CrowdSec détecte + bouncer nftables bloque au niveau kernel. Mieux que fail2ban (threat intelligence communautaire). |
| **Kernel** | Syncookies, anti-spoofing, ICMP restreint, protocoles inutiles désactivés. |
| **Reverse proxy** | Containers jamais exposés directement. Socket Docker en read-only. `exposedByDefault: false`. |
| **Mises à jour** | Patches sécurité OS + Docker appliqués automatiquement chaque jour. |
| **Logs** | CrowdSec monitore SSH (`auth.log`) + tous les containers Docker. IPs bloquées loggées. |
| **Monitoring** | Prometheus scrape CrowdSec + Traefik + Node Exporter. Tout visible dans Grafana. |
| **VPN** | NetBird (optionnel) pour restreindre SSH au réseau VPN. |
| **Healthchecks** | Chaque container Docker a un healthcheck intégré. `docker compose ps` montre l'état santé. |

### ⚠️ À savoir

- **Docker contourne UFW** : ne jamais exposer un port Docker sans le préfixe `127.0.0.1:` (ex: `127.0.0.1:8080:8080`). Traefik est le seul point d'entrée public.
- **Secrets en clair** : `all.yml` contient les clés en clair. Pour de la prod, chiffrer avec `ansible-vault encrypt group_vars/all.yml`.
- **Versions pinnées** : toutes les images Docker utilisent des versions fixes pour la reproductibilité. Mettre à jour dans `all.yml` quand nécessaire.

---

## Commandes utiles

```bash
# ── CrowdSec ──
docker exec crowdsec cscli decisions list          # IPs bannies
docker exec crowdsec cscli alerts list             # Alertes détectées
docker exec crowdsec cscli decisions delete --ip 1.2.3.4  # Débannir une IP
docker exec crowdsec cscli bouncers list           # Vérifier le bouncer

# ── Bouncer nftables ──
sudo nft list table crowdsec                       # Règles nftables actives
sudo systemctl status crowdsec-firewall-bouncer    # Status du bouncer
sudo journalctl -u crowdsec-firewall-bouncer -f    # Logs du bouncer

# ── Stack Docker ──
cd /opt/stack && docker compose ps                 # Status + healthchecks
cd /opt/stack && docker compose logs -f            # Logs en temps réel
cd /opt/stack && docker compose logs traefik -f    # Logs d'un service

# ── NetBird VPN ──
sudo netbird status                                # Status VPN
sudo netbird up                                    # Connecter
sudo netbird down                                  # Déconnecter

# ── Système ──
sudo ufw status verbose                            # Règles firewall
sudo sysctl -a | grep net.ipv4                     # Paramètres kernel
```

## Licence

MIT
