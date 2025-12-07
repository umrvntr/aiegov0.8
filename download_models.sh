#!/bin/bash
set -e

BASE="/app/ComfyUI/models"

mkdir -p "$BASE/unet"
mkdir -p "$BASE/clip"
mkdir -p "$BASE/vae"
mkdir -p "$BASE/loras"
mkdir -p "$BASE/upscale_models"
mkdir -p "$BASE/ultralytics/bbox"
mkdir -p "$BASE/sams"

echo ">>> Downloading core models..."

# ==============================================================================
# UNET — z_image_turbo (filename must match workflow: z_image_turbo_bf16.safetensors)
# ==============================================================================
if [ ! -f "$BASE/unet/z_image_turbo_bf16.safetensors" ]; then
    echo ">>> Downloading UNET: z_image_turbo_bf16.safetensors"
    wget -O "$BASE/unet/z_image_turbo_bf16.safetensors" \
        "https://huggingface.co/tewea/z_image_turbo_bf16_nsfw/resolve/main/z_image_turbo_bf16_nsfw_v2.safetensors"
else
    echo ">>> UNET already exists, skipping..."
fi

# ==============================================================================
# CLIP — Qwen text encoder
# ==============================================================================
if [ ! -f "$BASE/clip/qwen_3_4b.safetensors" ]; then
    echo ">>> Downloading CLIP: qwen_3_4b.safetensors"
    wget -O "$BASE/clip/qwen_3_4b.safetensors" \
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors"
else
    echo ">>> CLIP already exists, skipping..."
fi

# ==============================================================================
# VAE
# ==============================================================================
if [ ! -f "$BASE/vae/ae.safetensors" ]; then
    echo ">>> Downloading VAE: ae.safetensors"
    wget -O "$BASE/vae/ae.safetensors" \
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors"
else
    echo ">>> VAE already exists, skipping..."
fi

# ==============================================================================
# Default LoRA (optional, can be empty placeholder)
# ==============================================================================
# Если у тебя есть V8-zimage.safetensors — скачай сюда
# wget -O "$BASE/loras/V8-zimage.safetensors" "https://..."

# ==============================================================================
# Upscaler — 4x_foolhardy_Remacri
# ==============================================================================
if [ ! -f "$BASE/upscale_models/4x_foolhardy_Remacri.pth" ]; then
    echo ">>> Downloading Upscaler: 4x_foolhardy_Remacri.pth"
    wget -O "$BASE/upscale_models/4x_foolhardy_Remacri.pth" \
        "https://huggingface.co/FacehugmanIII/4x_foolhardy_Remacri/resolve/main/4x_foolhardy_Remacri.pth"
else
    echo ">>> Upscaler already exists, skipping..."
fi

# ==============================================================================
# YOLOv8 face detector (for FaceDetailer)
# ==============================================================================
if [ ! -f "$BASE/ultralytics/bbox/face_yolov8m.pt" ]; then
    echo ">>> Downloading YOLO: face_yolov8m.pt"
    wget -O "$BASE/ultralytics/bbox/face_yolov8m.pt" \
        "https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt"
else
    echo ">>> YOLO face detector already exists, skipping..."
fi

# ==============================================================================
# SAM model (for FaceDetailer segmentation)
# ==============================================================================
if [ ! -f "$BASE/sams/sam_vit_b_01ec64.pth" ]; then
    echo ">>> Downloading SAM: sam_vit_b_01ec64.pth"
    wget -O "$BASE/sams/sam_vit_b_01ec64.pth" \
        "https://huggingface.co/GleghornLab/sam_vit_b_01ec64.pth/resolve/main/sam_vit_b_01ec64.pth"
else
    echo ">>> SAM model already exists, skipping..."
fi

echo ">>> All models downloaded successfully!"
