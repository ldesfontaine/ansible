"""
Ansible Stack Builder — API Backend
FastAPI + génération de ZIP en mémoire
"""

import json
import os
import re
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware

from core.generator import generate_zip
from core.resolver import resolve
from services.registry import SERVICES, CATEGORIES, GLOBAL_CONFIG_FIELDS, get_services_by_category, get_service_by_id

# ── Regex pour sanitiser les noms de projet ──
PROJECT_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")

# ── IDs de services valides (pour validation d'entrée) ──
VALID_SERVICE_IDS = {s["id"] for s in SERVICES}

# ── Rate limiter ──
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Ansible Stack Builder", version="1.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS — restreint aux origines configurées ──
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "").split(",")
ALLOWED_ORIGINS = [o.strip() for o in ALLOWED_ORIGINS if o.strip()]
if not ALLOWED_ORIGINS:
    # Par défaut : même origine (pas de header CORS = même origine)
    ALLOWED_ORIGINS = []

if ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )


# ── Security headers middleware ──
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.url.path.startswith("/api/"):
            response.headers["Content-Security-Policy"] = "default-src 'none'"
        else:
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
            )
        return response


app.add_middleware(SecurityHeadersMiddleware)

# ── Charger les versions par défaut ──
VERSIONS_FILE = Path(__file__).parent / "services" / "versions.json"
with open(VERSIONS_FILE) as f:
    DEFAULT_VERSIONS = json.load(f)


# ── Modèles ──
class GenerateRequest(BaseModel):
    services: list[str]
    variables: dict = {}
    versions: dict = {}

    @field_validator("services")
    @classmethod
    def validate_service_ids(cls, v: list[str]) -> list[str]:
        invalid = [s for s in v if s not in VALID_SERVICE_IDS]
        if invalid:
            raise ValueError(f"Services inconnus : {', '.join(invalid)}")
        return v

    @field_validator("variables")
    @classmethod
    def sanitize_project_name(cls, v: dict) -> dict:
        name = v.get("project_name", "my-stack")
        if not name or not PROJECT_NAME_RE.match(name):
            v["project_name"] = "my-stack"
        return v


# ── Endpoints ──

@app.get("/api/services")
async def list_services():
    """Retourne le catalogue de services groupés par catégorie."""
    return {
        "categories": get_services_by_category(),
        "default_versions": DEFAULT_VERSIONS,
        "global_config_fields": GLOBAL_CONFIG_FIELDS,
    }


def _validate_required_fields(req: GenerateRequest, resolved_enabled: set) -> list[str]:
    """Vérifie que les champs required sont renseignés. Retourne la liste d'erreurs."""
    errors = []
    variables = req.variables or {}

    # Valider les champs globaux
    for field in GLOBAL_CONFIG_FIELDS:
        if field["required"]:
            val = variables.get(field["id"], "")
            if not val or (isinstance(val, str) and not val.strip()):
                errors.append(f"Le champ « {field['label']} » est obligatoire.")

    # Valider les champs par service activé
    for sid in resolved_enabled:
        svc = get_service_by_id(sid)
        if not svc:
            continue
        for field in svc.get("config_fields", []):
            if field["required"]:
                val = variables.get(field["id"], "")
                if not val or (isinstance(val, str) and not val.strip()):
                    errors.append(
                        f"Le champ « {field['label']} » est obligatoire pour {svc['label']}."
                    )

    return errors


@app.post("/api/generate")
@limiter.limit("10/minute")
async def generate(req: GenerateRequest, request: Request):
    """Génère un ZIP contenant la stack Ansible."""
    # Résoudre les dépendances
    resolved = resolve(req.services)

    if resolved["errors"]:
        return Response(
            content=json.dumps({"errors": resolved["errors"]}),
            status_code=400,
            media_type="application/json",
        )

    # Validation des champs requis
    validation_errors = _validate_required_fields(req, resolved["enabled"])
    if validation_errors:
        return Response(
            content=json.dumps({"errors": validation_errors}),
            status_code=400,
            media_type="application/json",
        )

    # Fusionner les versions par défaut avec les overrides utilisateur
    versions = {**DEFAULT_VERSIONS, **req.versions}

    config = {
        "services": req.services,
        "variables": req.variables,
        "versions": versions,
        "resolved": {
            "enabled": list(resolved["enabled"]),
            "ufw_ports": resolved["ufw_ports"],
            "warnings": resolved["warnings"],
            "docker_services": resolved["docker_services"],
        },
    }

    zip_bytes = generate_zip(config)

    project_name = req.variables.get("project_name", "my-stack")
    # Double sécurité : re-sanitiser pour le header HTTP
    if not PROJECT_NAME_RE.match(project_name):
        project_name = "my-stack"
    safe_filename = f"{project_name}.zip"

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_filename}"',
        },
    )


@app.post("/api/resolve")
async def resolve_deps(req: GenerateRequest):
    """Résout les dépendances sans générer le ZIP (pour preview côté frontend)."""
    resolved = resolve(req.services)
    return {
        "enabled": list(resolved["enabled"]),
        "warnings": resolved["warnings"],
        "errors": resolved["errors"],
        "ufw_ports": resolved["ufw_ports"],
    }


# ── Servir le frontend statique ──
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
