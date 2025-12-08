#!/bin/bash
set -e

echo ">>> Installing Custom ComfyUI Nodes..."

NODES_DIR="/app/ComfyUI/custom_nodes"

mkdir -p "$NODES_DIR"
cd "$NODES_DIR"

# ==============================================================================
# Impact Pack — FaceDetailer, UltralyticsDetectorProvider, SAMLoader
# (Keeping original as it succeeded prior to the failure)
# ==============================================================================
if [ ! -d "ComfyUI-Impact-Pack" ]; then
    echo ">>> Cloning ComfyUI-Impact-Pack..."
    git clone https://github.com/ltdrdata/ComfyUI-Impact-Pack.git
    cd ComfyUI-Impact-Pack
    pip3 install -r requirements.txt --break-system-packages
    # Submodules (Impact Pack needs this)
    python3 install.py
    cd ..
else
    echo ">>> ComfyUI-Impact-Pack already exists, skipping..."
fi

# ==============================================================================
# Comfyroll Custom Nodes — CR Upscale Image
# ==============================================================================
if [ ! -d "ComfyUI_Comfyroll_CustomNodes" ]; then
    echo ">>> Cloning ComfyUI_Comfyroll_CustomNodes..."
    git clone https://github.com/Suzie1/ComfyUI_Comfyroll_CustomNodes.git
else
    echo ">>> ComfyUI_Comfyroll_CustomNodes already exists, skipping..."
fi

# ==============================================================================
# CRT Post-Process Suite — CRT Post-Process Suite node
# FIX: Added --depth 1 to resolve the unexpected 'fatal: could not read Username' error
# ==============================================================================
if [ ! -d "ComfyUI-CRT" ]; then
    echo ">>> Cloning ComfyUI-CRT..."
    # Changed git clone to be shallow
    git clone --depth 1 https://github.com/blib-la/ComfyUI-CRT.git
    cd ComfyUI-CRT
    if [ -f "requirements.txt" ]; then
        pip3 install -r requirements.txt --break-system-packages
    fi
    cd ..
else
    echo ">>> ComfyUI-CRT already exists, skipping..."
fi

# ==============================================================================
# ComfyUI Manager (опционально, но полезно для отладки)
# ==============================================================================
if [ ! -d "ComfyUI-Manager" ]; then
    echo ">>> Cloning ComfyUI-Manager..."
    git clone https://github.com/ltdrdata/ComfyUI-Manager.git
else
    echo ">>> ComfyUI-Manager already exists, skipping..."
fi

echo ">>> Custom nodes installed successfully!"