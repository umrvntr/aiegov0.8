#!binbash
set -e

# стартуем ComfyUI как сервис
python3 appComfyUImain.py --listen 0.0.0.0 --port 8188 &

# даём ему пару секунд подняться
sleep 5

# стартуем runpod-handler (Node + runpod.lib)
node apphandler.mjs
