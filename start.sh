#!/bin/bash
set -e

echo ">>> AI EGO Endpoint – startup"

# 1) Стартуем ComfyUI
cd /app/ComfyUI
echo ">>> Starting ComfyUI on :8188"
python3 main.py --listen 0.0.0.0 --port 8188 --disable-auto-launch &

COMFY_PID=$!

# Ждём пока ComfyUI поднимется
echo ">>> Waiting for ComfyUI to initialize..."
sleep 10

# 2) Стартуем RunPod handler
cd /app
echo ">>> Starting RunPod handler..."
node handler.mjs &

NODE_PID=$!

wait $COMFY_PID $NODE_PID
