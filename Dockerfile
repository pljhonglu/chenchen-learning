FROM python:3.12-slim

WORKDIR /app

ENV HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/public \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY server/ /app/server/
COPY public/ /app/public/

RUN mkdir -p /data && useradd -r -u 10001 -d /app appuser \
 && chown -R appuser:appuser /app /data

USER appuser
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=3)"

CMD ["python", "-u", "/app/server/main.py"]
