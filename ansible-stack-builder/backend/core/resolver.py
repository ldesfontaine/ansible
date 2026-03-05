"""
Résolveur de dépendances et cohérence inter-services.
Reçoit les choix utilisateur, résout les dépendances, valide, collecte les ports UFW.
"""

from services.registry import SERVICES, get_service_by_id


class ResolutionError(Exception):
    pass


def resolve(selected_ids: list[str]) -> dict:
    """
    Résout les dépendances et retourne un contexte enrichi.

    Returns:
        {
            "enabled": set[str],        # IDs finaux activés (avec dépendances)
            "ufw_ports": list[dict],     # Ports UFW à ouvrir
            "warnings": list[str],       # Avertissements (CrowdSec désactivé, etc.)
            "docker_services": list[str], # Services Docker activés
            "errors": list[str],          # Erreurs de validation
        }
    """
    enabled = set(selected_ids)
    warnings = []
    errors = []

    # Ajouter les services locked (toujours actifs)
    for s in SERVICES:
        if s.get("locked"):
            enabled.add(s["id"])

    # Résolution des dépendances (itératif jusqu'à stabilité)
    changed = True
    max_iterations = 10
    iteration = 0
    while changed and iteration < max_iterations:
        changed = False
        iteration += 1
        for sid in list(enabled):
            svc = get_service_by_id(sid)
            if not svc:
                continue
            for dep in svc["requires"]:
                if dep not in enabled:
                    enabled.add(dep)
                    changed = True

    # Warnings pour services de sécurité désactivés
    for s in SERVICES:
        if s.get("warning_if_disabled") and s["id"] not in enabled:
            warnings.append(s["warning_if_disabled"])

    # Warning au lieu d'erreur : l'utilisateur peut résoudre en changeant les ports
    seen_conflicts = set()
    for sid in list(enabled):
        svc = get_service_by_id(sid)
        if not svc:
            continue
        for conflict_id in svc.get("conflicts_with", []):
            if conflict_id in enabled:
                pair = tuple(sorted([sid, conflict_id]))
                if pair not in seen_conflicts:
                    seen_conflicts.add(pair)
                    conflict_svc = get_service_by_id(conflict_id)
                    conflict_label = conflict_svc["label"] if conflict_svc else conflict_id
                    warnings.append(
                        f"⚠️ '{svc['label']}' et '{conflict_label}' utilisent le même port par défaut. "
                        f"Pensez à modifier le port DNS dans la configuration de l'un des deux."
                    )

    # Validation : pas de services Docker sans Docker
    docker_services = []
    for sid in enabled:
        svc = get_service_by_id(sid)
        if svc and svc["is_docker"]:
            docker_services.append(sid)
            if "docker" not in enabled:
                errors.append(
                    f"Le service '{svc['label']}' nécessite Docker mais Docker n'est pas activé."
                )

    # Grafana et Node Exporter requièrent Prometheus —
    # déjà déclaré dans "requires" du registre, résolu par la boucle ci-dessus.

    # Collecter les ports UFW
    ufw_ports = []
    seen_ports = set()
    for sid in enabled:
        svc = get_service_by_id(sid)
        if svc:
            for port_def in svc.get("ufw_ports", []):
                key = f"{port_def['port']}/{port_def['proto']}"
                if key not in seen_ports:
                    seen_ports.add(key)
                    ufw_ports.append(port_def)

    return {
        "enabled": enabled,
        "ufw_ports": ufw_ports,
        "warnings": warnings,
        "docker_services": docker_services,
        "errors": errors,
    }
