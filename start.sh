#!/bin/bash
set -e

echo ">>> AIEGO Endpoint — Starting..."

# Start ComfyUI in background
cd /app/ComfyUI
echo ">>> Starting ComfyUI on port 8188..."
python3 main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch &

# Wait a bit for ComfyUI to initialize
echo ">>> Waiting for ComfyUI..."
sleep 5

# Start RunPod Python handler
cd /app
echo ">>> Starting RunPod handler..."
exec python3 -u rp_handler.py
