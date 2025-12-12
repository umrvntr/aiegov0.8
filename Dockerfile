# Ипользуем CUDA 12.1.1 (лучшая совместимость с Torch 2.1+)
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PATH="/app/venv/bin:$PATH"

# 1. Системные зависимости
# Добавляем git, чтобы pip мог устанавливать зависимости из git-репозиториев при необходимости
RUN apt-get update && apt-get install -y \
    git \
    wget \
    curl \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    net-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 2. Установка ComfyUI
RUN git clone https://github.com/comfyanonymous/ComfyUI.git /app/ComfyUI

# 3. Создание виртуального окружения и установка зависимостей
# Это изолирует среду и предотвращает конфликты версий
RUN python3 -m venv /app/venv && \
    /app/venv/bin/pip install --upgrade pip wheel setuptools && \
    /app/venv/bin/pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 && \
    /app/venv/bin/pip install -r /app/ComfyUI/requirements.txt && \
    /app/venv/bin/pip install runpod requests websocket-client

# 4. Копирование скриптов
COPY download_models.sh /app/download_models.sh
COPY install_custom_nodes.sh /app/install_custom_nodes.sh
COPY start.sh /app/start.sh
COPY rp_handler.py /app/rp_handler.py

RUN chmod +x /app/*.sh

# 5. Установка кастомных нод и моделей (Во время сборки)
# ВАЖНО: Если модели большие (>5GB), лучше качать их при старте (в start.sh) или использовать Network Volume
RUN /app/install_custom_nodes.sh
RUN /app/download_models.sh

# 6. Запуск
CMD ["/app/start.sh"]