# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src
RUN pip install .

RUN useradd --system --uid 1001 --no-create-home --shell /usr/sbin/nologin appuser
USER appuser

EXPOSE 4002
CMD ["uvicorn", "nexamail_ai.main:app", "--host", "0.0.0.0", "--port", "4002"]
