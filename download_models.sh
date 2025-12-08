#!/bin/bash
set -e

BASE="/app/ComfyUI/models"
ZIP_URL="https://huggingface.co/datasets/umrrrrrr/UMRGEN/resolve/main/core_models.zip"
TEMP_DIR="/tmp"
ZIP_FILE="$TEMP_DIR/core_models.zip"

echo ">>> Downloading core models from UMRGEN dataset..."

# Create the base models directory
mkdir -p "$BASE"

# Download the zip file
wget -O "$ZIP_FILE" "$ZIP_URL"

echo ">>> Extracting models to $BASE"
# The zip is expected to contain the necessary subdirectories (unet, clip, vae, etc.)
unzip -o "$ZIP_FILE" -d "$BASE"

echo ">>> Cleaning up..."
rm "$ZIP_FILE"

echo ">>> All models downloaded successfully!"