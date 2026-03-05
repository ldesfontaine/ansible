# ⚡ Ansible Stack Builder

Web app pour générer des stacks Ansible personnalisées — style Ninite.

Coche tes services, configure tes variables, télécharge un ZIP prêt à déployer.

## Services disponibles

### Système
- 🖥️ UFW Firewall (requis)
- 🖥️ SSH Hardening (requis)
- 🖥️ Mises à jour automatiques

### Infrastructure
- 🏗️ Docker Engine
- 🏗️ NetBird VPN

### Reverse Proxy
- 🔀 Traefik (Let's Encrypt intégré)

### Sécurité
- 🛡️ CrowdSec (détection d'intrusions en Docker)
- 🛡️ CrowdSec Bouncer (blocage nftables sur l'hôte)

### Monitoring
- 📊 Prometheus
- 📊 Grafana
- 📊 Node Exporter

### Applications
- 📦 Vaultwarden (gestionnaire de mots de passe)
- 📦 Uptime Kuma (monitoring d'uptime)
- 📦 Portainer (gestion Docker)
- 📦 BentoPDF (convertisseur PDF)

## Développement local

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Ouvrir http://localhost:8000

## Déploiement (Docker)

```bash
docker compose up -d --build
```

L'app est accessible sur le port 8080.

## Architecture

```
├── backend/
│   ├── main.py                     # FastAPI — API + serveur de fichiers statiques
│   ├── core/
│   │   ├── resolver.py             # Résolution des dépendances inter-services
│   │   └── generator.py            # Moteur Jinja2 → ZIP en mémoire
│   ├── services/
│   │   ├── registry.py             # Catalogue des services (métadonnées, dépendances)
│   │   └── versions.json           # Versions stables connues
│   └── ansible_templates/          # Templates Jinja2 (double-passe : génération + Ansible)
├── frontend/
│   ├── index.html                  # Page unique
│   ├── style.css                   # CSS vanilla, thème sombre
│   └── app.js                      # Vanilla JS — zéro dépendance
├── Dockerfile
├── docker-compose.yml
└── README.md
```
