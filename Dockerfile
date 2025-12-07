FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV COMFY_HOST=127.0.0.1:8188

# --- базовые пакеты ---
RUN apt update && apt install -y \
    git wget curl python3 python3-pip nodejs npm ffmpeg \
    && pip3 install --upgrade pip

WORKDIR /app

# --- ставим ComfyUI ---
RUN git clone https://github.com/comfyanonymous/ComfyUI.git /app/ComfyUI

# --- копируем твой код ---
COPY handler.mjs /app/handler.mjs
COPY package.json /app/package.json
COPY download_models.sh /app/download_models.sh
COPY install_custom_nodes.sh /app/install_custom_nodes.sh
COPY start.sh /app/start.sh

RUN chmod +x /app/download_models.sh /app/install_custom_nodes.sh /app/start.sh

# --- Python-зависимости ComfyUI ---
RUN pip install -r /app/ComfyUI/requirements.txt

# --- Node-зависимости (runpod, fetch, ws) ---
RUN npm install

# ==============================================================================
# ВАЖНО: Скачивание моделей
# ==============================================================================
# Для работы workflow из handler.mjs необходимы следующие модели:
#
# 1. UNET:   z_image_turbo_bf16.safetensors
#            → /app/ComfyUI/models/unet/
#
# 2. CLIP:   qwen_3_4b.safetensors
#            → /app/ComfyUI/models/clip/
#
# 3. VAE:    ae.safetensors
#            → /app/ComfyUI/models/vae/
#
# 4. LoRA:   V8-zimage.safetensors (дефолтная, опционально другие)
#            → /app/ComfyUI/models/loras/
#
# Убедись, что download_models.sh скачивает ВСЕ эти файлы в правильные папки!
# ==============================================================================
RUN /app/download_models.sh && /app/install_custom_nodes.sh

# Serverless не требует EXPOSE, порты только внутри контейнера
CMD ["bash", "/app/start.sh"]
