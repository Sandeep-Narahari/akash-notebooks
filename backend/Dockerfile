FROM python:3.12-slim AS base

# Install tini for proper signal handling and PID 1 reaping
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app

WORKDIR /app

# ── deps layer (cached unless requirements.txt changes) ──────────────────────
FROM base AS deps
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ── final image ───────────────────────────────────────────────────────────────
FROM base AS final

# Copy installed packages from deps stage
COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# Copy application source (excludes items in .dockerignore)
COPY --chown=app:app . .

# Persistent volume for SQLite database
RUN mkdir -p /data && chown app:app /data
VOLUME ["/data"]

USER app

ENV DB_PATH=/data/akash_notebooks.db \
    HOST=0.0.0.0 \
    PORT=8000 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

# tini as init — clean signal forwarding and zombie reaping
# Single uvicorn worker: in-memory SSE event log and background deploy tasks
# cannot be shared across processes without a message broker.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--proxy-headers", \
     "--forwarded-allow-ips=*", \
     "--no-access-log"]
