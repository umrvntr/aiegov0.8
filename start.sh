#!/bin/bash
set -e

echo ">>> AIEGO Serverless Endpoint Starting..."

# Активируем виртуальное окружение
source /app/venv/bin/activate

# Если мы подключили Network Volume в RunPod (обычно в /runpod-volume), 
# делаем симлинки, чтобы не качать модели каждый раз
if [ -d "/runpod-volume/models" ]; then
    echo ">>> Detected Network Volume! Symlinking models..."
    rm -rf /app/ComfyUI/models
    ln -s /runpod-volume/models /app/ComfyUI/models
fi

# Запуск ComfyUI в фоновом режиме
cd /app/ComfyUI
echo ">>> Launching ComfyUI..."
python main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch &
COMFY_PID=$!

# Ждем пока ComfyUI поднимется
echo ">>> Waiting for ComfyUI to respond..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:8188/system_stats > /dev/null; then
        echo "✅ ComfyUI is up!"
        break
    fi
    sleep 2
done

# Запуск хендлера RunPod
cd /app
echo ">>> Starting RunPod Handler..."
python -u rp_handler.py

# Если хендлер упадет, убиваем и Comfy
kill $COMFY_PID