#!/bin/bash
set -e

echo ">>> Installing Custom ComfyUI Nodes..."

NODES_DIR="/app/ComfyUI/custom_nodes"
# Убедись, что ссылка ведет на прямую скачку (resolve/main)
ZIP_URL="https://huggingface.co/datasets/umrrrrrrr/UMRGEN/resolve/main/custom_nodes.zip"
TEMP_ZIP="/tmp/custom_nodes.zip"

mkdir -p "$NODES_DIR"

echo ">>> Downloading custom nodes pack..."
wget -O "$TEMP_ZIP" "$ZIP_URL"

echo ">>> Extracting..."
unzip -o "$TEMP_ZIP" -d "$NODES_DIR"
rm "$TEMP_ZIP"

echo ">>> 🛠️ FIXING GIT ISSUES..."
# ЭТО ГЛАВНЫЙ ФИКС: Удаляем все скрытые папки .git внутри нод.
# Это превращает их в обычные папки и предотвращает попытки git clone/fetch, требующие пароль.
find "$NODES_DIR" -name ".git" -type d -exec rm -rf {} +

echo ">>> Installing dependencies for nodes..."

# Активируем venv для установки зависимостей
source /app/venv/bin/activate

# Проходимся по всем нодам и ставим их requirements.txt, если они есть
for d in "$NODES_DIR"/*; do
  if [ -d "$d" ] && [ -f "$d/requirements.txt" ]; then
    echo "Installing requirements for $(basename "$d")..."
    pip install -r "$d/requirements.txt" || echo "Warning: Failed to install deps for $(basename "$d")"
  fi
done

# Специфичный фикс для Impact Pack (если нужен submodule update, он не сработает без .git, 
# поэтому лучше, чтобы в ZIP архиве уже были все подмодули)
IMPACT_DIR="$NODES_DIR/ComfyUI-Impact-Pack"
if [ -d "$IMPACT_DIR" ]; then
    echo "Processing Impact Pack..."
    cd "$IMPACT_DIR"
    # Пытаемся запустить install.py, если он есть
    [ -f "install.py" ] && python install.py || true
fi

echo ">>> Custom nodes installed!"