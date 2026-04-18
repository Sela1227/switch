# ── Stage 1: Build React frontend ────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python backend + compiled frontend ───────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY main.py .

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# SQLite volume will be mounted at /data
RUN mkdir -p /data

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
