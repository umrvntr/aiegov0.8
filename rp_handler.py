import runpod
import json
import time
import uuid
import base64
import requests
import threading
import websocket # pip install websocket-client

COMFY_HOST = "http://127.0.0.1:8188"
COMFY_WS = "ws://127.0.0.1:8188/ws"

def get_image_base64(filename, subfolder, type_):
    try:
        response = requests.get(f"{COMFY_HOST}/view", params={
            "filename": filename,
            "subfolder": subfolder,
            "type": type_
        })
        return base64.b64encode(response.content).decode("utf-8")
    except Exception as e:
        print(f"Error fetching image: {e}")
        return None

def handler(job):
    job_input = job["input"]
    
    # 1. Валидация
    if "prompt" not in job_input:
        return {"error": "No prompt provided"}

    # 2. Формируем workflow (Вставь сюда свою функцию build_workflow из старого файла)
    # Я опустил её для краткости, но она обязательна.
    # workflow = build_workflow(job_input['prompt'], ...) 
    # ВМЕСТО ЭТОГО: Если пользователь шлет сырой JSON workflow (для универсальности):
    workflow = job_input.get("workflow")
    
    # Если workflow не передан, используем генератор из твоего кода:
    if not workflow:
        from rp_handler import build_workflow # Предполагая, что функция в этом же файле
        workflow = build_workflow(
            prompt=job_input.get("prompt"),
            negative=job_input.get("negative", "bad quality"),
            width=job_input.get("width", 1024),
            height=job_input.get("height", 1024),
            seed=job_input.get("seed"),
            lora_name=job_input.get("loraName"),
            lora_strength=job_input.get("loraStrength", 0.7),
            use_face_detailer=job_input.get("useFaceDetailer", False),
            use_upscale=job_input.get("useUpscale", False)
        )

    # 3. Отправка в ComfyUI
    client_id = str(uuid.uuid4())
    try:
        req = requests.post(f"{COMFY_HOST}/prompt", json={
            "prompt": workflow,
            "client_id": client_id
        })
        prompt_id = req.json()["prompt_id"]
    except Exception as e:
        return {"error": f"ComfyUI Error: {e}"}

    # 4. Ожидание через WebSocket
    ws = websocket.WebSocket()
    ws.connect(f"{COMFY_WS}?clientId={client_id}")
    
    output_images = []
    
    while True:
        out = ws.recv()
        if isinstance(out, str):
            msg = json.loads(out)
            if msg['type'] == 'executing':
                data = msg['data']
                if data['node'] is None and data['prompt_id'] == prompt_id:
                    break # Готово
        else:
            continue

    ws.close()

    # 5. Получение истории
    history = requests.get(f"{COMFY_HOST}/history/{prompt_id}").json()
    outputs = history[prompt_id]['outputs']

    result = []
    for node_id in outputs:
        node_output = outputs[node_id]
        if 'images' in node_output:
            for image in node_output['images']:
                b64 = get_image_base64(image['filename'], image['subfolder'], image['type'])
                if b64:
                    result.append(f"data:image/png;base64,{b64}")

    return {"images": result}

# Обязательно добавь функцию build_workflow внутрь файла перед запуском
# ... (код функции build_workflow из твоего загруженного файла) ...

runpod.serverless.start({"handler": handler})