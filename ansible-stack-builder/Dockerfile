# ============================================================================
# Dockerfile — Ansible Stack Builder
# Multi-stage : Python backend + fichiers statiques frontend
# ============================================================================

FROM python:3.12-slim

WORKDIR /app

# Installer les dépendances Python
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copier le backend
COPY backend/ ./backend/

# Copier le frontend (servi par FastAPI en statique)
COPY frontend/ ./frontend/

WORKDIR /app/backend

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
