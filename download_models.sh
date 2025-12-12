#!/bin/bash
set -e

# Используем абсолютный путь
BASE="/app/ComfyUI/models"
ZIP_URL="https://huggingface.co/datasets/umrrrrrrr/UMRGEN/resolve/main/core_models.zip"
TEMP_ZIP="/tmp/core_models.zip"

echo ">>> Downloading core models..."
mkdir -p "$BASE"

wget -O "$TEMP_ZIP" "$ZIP_URL"

echo ">>> Extracting models..."
unzip -o "$TEMP_ZIP" -d "$BASE"
rm "$TEMP_ZIP"

echo ">>> Models ready."