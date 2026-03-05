"""
Générateur de stack Ansible.
Assemble les templates Jinja2 en fonction des services activés → ZIP en mémoire.

IMPORTANT : Les templates Ansible contiennent du {{ }} Jinja2 destiné à Ansible.
On utilise des délimiteurs custom (<% %> / << >>) pour le premier passage (génération),
afin de ne pas confondre avec les variables Ansible {{ }}.
"""

import io
import json
import re
import zipfile
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

TEMPLATES_DIR = Path(__file__).parent.parent / "ansible_templates"

# Regex pour noms de projet sûrs (empêche path traversal dans le ZIP)
_SAFE_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")


def _get_jinja_env() -> Environment:
    """Environnement Jinja2 avec délimiteurs custom pour ne pas entrer en conflit avec Ansible."""
    return Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        # Délimiteurs custom — le template de génération utilise <% %> et << >>
        block_start_string="<%",
        block_end_string="%>",
        variable_start_string="<<",
        variable_end_string=">>",
        comment_start_string="<#",
        comment_end_string="#>",
        keep_trailing_newline=True,
        trim_blocks=True,
        lstrip_blocks=True,
    )


def generate_zip(config: dict) -> bytes:
    """
    Génère un ZIP contenant la stack Ansible complète.

    config = {
        "services": ["ufw", "ssh_hardening", "docker", "traefik", ...],
        "variables": {
            "admin_email": "...",
            "base_domain": "...",
            "ssh_port": 22,
            "enable_https": False,
            "stack_dir": "/opt/stack",
            ...
        },
        "versions": {
            "traefik": "3.4",
            "crowdsec": "v1.6.8",
            ...
        },
        "resolved": { ... }  # Output du resolver
    }
    """
    env = _get_jinja_env()
    enabled = set(config["resolved"]["enabled"])
    variables = config.get("variables", {})
    versions = config.get("versions", {})
    project_name = variables.get("project_name", "my-stack")

    # Sécurité : empêcher path traversal dans les entrées du ZIP
    if not _SAFE_NAME_RE.match(project_name):
        project_name = "my-stack"

    # Contexte passé à tous les templates
    ctx = {
        "enabled": enabled,
        "variables": variables,
        "versions": versions,
        "project_name": project_name,
        "ufw_ports": config["resolved"]["ufw_ports"],
        "docker_services": config["resolved"]["docker_services"],
        # Raccourcis booléens pour les templates
        "enable_docker": "docker" in enabled,
        "enable_traefik": "traefik" in enabled,
        "enable_crowdsec": "crowdsec" in enabled,
        "enable_crowdsec_bouncer": "crowdsec_bouncer" in enabled,
        "enable_grafana": "grafana" in enabled,
        "enable_prometheus": "prometheus" in enabled,
        "enable_node_exporter": "node_exporter" in enabled,
        "enable_netbird": "netbird" in enabled,
        "enable_vaultwarden": "vaultwarden" in enabled,
        "enable_uptime_kuma": "uptime_kuma" in enabled,
        "enable_portainer": "portainer" in enabled,
        "enable_bentopdf": "bentopdf" in enabled,
        "enable_ufw": "ufw" in enabled,
        "enable_ssh_hardening": "ssh_hardening" in enabled,
        "enable_unattended_upgrades": "unattended_upgrades" in enabled,
        "enable_git": "git" in enabled,
        "enable_nextcloud": "nextcloud" in enabled,
        "enable_n8n": "n8n" in enabled,
        "enable_pihole": "pihole" in enabled,
        "enable_adguard_home": "adguard_home" in enabled,
    }

    # Fichiers à générer : (template_path, output_path)
    files_to_generate = [
        ("setup.yml.j2", "setup.yml"),
        ("inventory.ini.j2", "inventory.ini"),
        ("group_vars/all.yml.j2", "group_vars/all.yml"),
        ("handlers/main.yml.j2", "handlers/main.yml"),
        ("tasks/system.yml.j2", "tasks/system.yml"),
    ]

    # Tasks conditionnelles
    if "ssh_hardening" in enabled:
        files_to_generate.append(("tasks/hardening.yml.j2", "tasks/hardening.yml"))

    if "docker" in enabled:
        files_to_generate.append(("tasks/docker.yml.j2", "tasks/docker.yml"))

    if "netbird" in enabled:
        files_to_generate.append(("tasks/netbird.yml.j2", "tasks/netbird.yml"))

    if any(s in enabled for s in ["traefik", "crowdsec", "grafana", "prometheus",
                                    "node_exporter", "vaultwarden", "uptime_kuma",
                                    "portainer", "bentopdf", "nextcloud",
                                    "n8n", "pihole", "adguard_home"]):
        files_to_generate.append(("tasks/stack.yml.j2", "tasks/stack.yml"))

    if "crowdsec_bouncer" in enabled:
        files_to_generate.append(("tasks/crowdsec-bouncer.yml.j2", "tasks/crowdsec-bouncer.yml"))

    # Templates Ansible (fichiers .j2 qui seront déployés sur le serveur)
    if "traefik" in enabled:
        files_to_generate.append(("templates/traefik.yml.j2.j2", "templates/traefik.yml.j2"))
        files_to_generate.append(("templates/traefik-dynamic.yml.j2.j2", "templates/traefik-dynamic.yml.j2"))

    if "crowdsec" in enabled:
        files_to_generate.append(("templates/acquis.yaml.j2.j2", "templates/acquis.yaml.j2"))

    if "crowdsec_bouncer" in enabled:
        files_to_generate.append(("templates/crowdsec-firewall-bouncer.yaml.j2.j2", "templates/crowdsec-firewall-bouncer.yaml.j2"))

    if "prometheus" in enabled:
        files_to_generate.append(("templates/prometheus.yml.j2.j2", "templates/prometheus.yml.j2"))

    if "grafana" in enabled:
        files_to_generate.append(("templates/grafana-datasource.yml.j2.j2", "templates/grafana-datasource.yml.j2"))

    if "ssh_hardening" in enabled:
        files_to_generate.append(("templates/sshd_config.j2.j2", "templates/sshd_config.j2"))

    # Le docker-compose est toujours généré si on a des services Docker
    if config["resolved"]["docker_services"]:
        files_to_generate.append(("templates/docker-compose.yml.j2.j2", "templates/docker-compose.yml.j2"))

    # Générer le ZIP en mémoire
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for template_path, output_path in files_to_generate:
            try:
                tmpl = env.get_template(template_path)
                content = tmpl.render(**ctx)
                zf.writestr(f"{project_name}/{output_path}", content)
            except Exception as e:
                # En cas d'erreur sur un template, on ajoute un fichier d'erreur
                zf.writestr(
                    f"{project_name}/ERRORS/{output_path}.error.txt",
                    f"Erreur de génération : {e}\n",
                )

        # README
        readme = env.get_template("README.md.j2")
        zf.writestr(f"{project_name}/README.md", readme.render(**ctx))

    buf.seek(0)
    return buf.getvalue()
