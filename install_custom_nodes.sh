#!/bin/bash
set -e

echo ">>> Installing Custom ComfyUI Nodes..."

NODES_DIR="/app/ComfyUI/custom_nodes"
ZIP_URL="https://huggingface.co/datasets/umrrrrrr/UMRGEN/resolve/main/custom_nodes.zip"
TEMP_DIR="/tmp"
ZIP_FILE="$TEMP_DIR/custom_nodes.zip"

# Create nodes directory
mkdir -p "$NODES_DIR"

echo ">>> Downloading custom nodes from UMRGEN dataset..."
wget -O "$ZIP_FILE" "$ZIP_URL"

echo ">>> Extracting custom nodes to $NODES_DIR"
# The zip is expected to contain the node folders directly (e.g., ComfyUI-Impact-Pack/)
unzip -o "$ZIP_FILE" -d "$NODES_DIR"

echo ">>> Cleaning up ZIP file..."
rm "$ZIP_FILE"

echo ">>> Installing dependencies for custom nodes..."

# ==============================================================================
# Impact Pack dependencies — FaceDetailer, UltralyticsDetectorProvider, SAMLoader
# ==============================================================================
IMPACT_PACK_DIR="$NODES_DIR/ComfyUI-Impact-Pack"
if [ -d "$IMPACT_PACK_DIR" ]; then
    echo ">>> Installing Impact Pack dependencies..."
    cd "$IMPACT_PACK_DIR"
    pip3 install -r requirements.txt --break-system-packages
    # Submodules (Impact Pack needs this)
    python3 install.py
    cd - > /dev/null # Go back to the previous directory
fi

# ==============================================================================
# ComfyUI-CRT dependencies — CRT Post-Process Suite node
# ==============================================================================
CRT_DIR="$NODES_DIR/ComfyUI-CRT"
if [ -d "$CRT_DIR" ]; then
    echo ">>> Installing ComfyUI-CRT dependencies..."
    cd "$CRT_DIR"
    if [ -f "requirements.txt" ]; then
        pip3 install -r requirements.txt --break-system-packages
    fi
    cd - > /dev/null
fi

echo ">>> Custom nodes installed successfully!"