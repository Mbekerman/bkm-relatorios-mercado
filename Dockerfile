# Imagem oficial do Playwright: Python + Chromium e as bibliotecas do sistema para gerar o PDF.
# A versão da imagem tem de ser a mesma do playwright em requirements.txt.
FROM mcr.microsoft.com/playwright/python:v1.52.0-noble
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY servidor ./servidor
COPY web ./web
ENV PYTHONUNBUFFERED=1
WORKDIR /app/servidor
# Cloud Run define $PORT (8080). Um worker: o Chromium é aberto uma vez e reaproveitado.
CMD exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers --forwarded-allow-ips='*'
