FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# ==============================================================================
# 1. Install system packages
# ==============================================================================
RUN apt-get update && apt-get install -y \
    git \
    wget \
    curl \
    python3 \
    python3-pip \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# ==============================================================================
# 2. Set working directory
# ==============================================================================
WORKDIR /app

# ==============================================================================
# 3. Clone ComfyUI
# ==============================================================================
RUN git clone https://github.com/comfyanonymous/ComfyUI.git /app/ComfyUI

# ==============================================================================
# 4. Install Python dependencies
# ==============================================================================
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir \
    runpod \
    requests \
    websocket-client \
    && pip3 install --no-cache-dir -r /app/ComfyUI/requirements.txt

# ==============================================================================
# 5. Copy scripts
# ==============================================================================
COPY download_models.sh /app/download_models.sh
COPY install_custom_nodes.sh /app/install_custom_nodes.sh
COPY start.sh /app/start.sh

RUN chmod +x /app/download_models.sh /app/install_custom_nodes.sh /app/start.sh

# ==============================================================================
# 6. Download models and install custom nodes
# ==============================================================================
RUN /app/download_models.sh
RUN /app/install_custom_nodes.sh

# ==============================================================================
# 7. Copy handler
# ==============================================================================
COPY rp_handler.py /app/rp_handler.py

# ==============================================================================
# 8. Start
# ==============================================================================
CMD ["bash", "/app/start.sh"]
