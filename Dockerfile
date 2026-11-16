# FarmSmart: API (FastAPI) + website (React, built in stage 1), one service. Deploy on Render or Fly.io. Pilot results are precomputed in data/precomputed,
# so the public demo is instant; new fields are analysed on demand.
# Stage 1: build the React website (web/) with Node.
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Stage 2: the FastAPI API, which also serves the built website.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install -r requirements.txt geopandas shapely
COPY fieldshift ./fieldshift
COPY engine ./engine
COPY models ./models
COPY data/precomputed ./data/precomputed
COPY data/reference ./data/reference
COPY qc/reports ./qc/reports
COPY --from=web /web/dist ./web/dist
RUN mkdir -p data/cache alerts/outbox
EXPOSE 8000
# Secrets (EARTHDATA_TOKEN, SMTP_*) are set as environment variables in the host dashboard, never baked in.
CMD ["sh", "-c", "uvicorn fieldshift.api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
