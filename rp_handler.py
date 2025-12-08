"""
AIEGO RunPod Serverless Handler
Z-Image Turbo with FaceDetailer, Upscale, CRT Post-Processing
"""

import runpod
import json
import time
import uuid
import base64
import requests
import websocket
import threading

COMFY_HOST = "http://127.0.0.1:8188"
COMFY_WS = "ws://127.0.0.1:8188/ws"


def wait_for_comfyui(max_attempts=60, interval=1):
    """Wait for ComfyUI to be ready"""
    for i in range(max_attempts):
        try:
            r = requests.get(f"{COMFY_HOST}/system_stats", timeout=2)
            if r.ok:
                print(f"[ComfyUI] Ready after {i+1} attempts")
                return True
        except:
            pass
        time.sleep(interval)
    raise Exception("ComfyUI did not start in time")


def build_workflow(prompt, negative="bad quality, blurry", width=1024, height=1024,
                   seed=None, lora_name=None, lora_strength=0.7,
                   use_face_detailer=False, use_upscale=False, upscale_factor=1.5, pp=None):
    """Build ComfyUI workflow"""
    
    if seed is None:
        seed = int(time.time() * 1000) % 999999999999
    
    if pp is None:
        pp = {}
    
    # Ensure dimensions are multiples of 8
    width = max(512, min(2048, (width // 8) * 8))
    height = max(512, min(2048, (height // 8) * 8))
    
    workflow = {
        "1": {
            "inputs": {"unet_name": "z_image_turbo_bf16.safetensors", "weight_dtype": "default"},
            "class_type": "UNETLoader"
        },
        "2": {
            "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "lumina2", "device": "default"},
            "class_type": "CLIPLoader"
        },
        "3": {
            "inputs": {"vae_name": "ae.safetensors"},
            "class_type": "VAELoader"
        },
        "4": {
            "inputs": {"text": prompt, "clip": ["50", 1]},
            "class_type": "CLIPTextEncode"
        },
        "5": {
            "inputs": {"text": negative, "clip": ["50", 1]},
            "class_type": "CLIPTextEncode"
        },
        "50": {
            "inputs": {
                "lora_name": lora_name or "V8-zimage.safetensors",
                "strength_model": lora_strength if lora_name else 0,
                "strength_clip": 1,
                "model": ["1", 0],
                "clip": ["2", 0]
            },
            "class_type": "LoraLoader"
        },
        "11": {
            "inputs": {"width": width, "height": height, "batch_size": 1},
            "class_type": "EmptyFlux2LatentImage"
        },
        "6": {
            "inputs": {
                "seed": seed,
                "steps": 9,
                "cfg": 1,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1,
                "model": ["50", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["11", 0]
            },
            "class_type": "KSampler"
        },
        "7": {
            "inputs": {"samples": ["6", 0], "vae": ["3", 0]},
            "class_type": "VAEDecode"
        }
    }
    
    last_image_node = ["7", 0]
    
    # Upscaler
    if use_upscale:
        workflow["38"] = {
            "inputs": {
                "upscale_model": "4x_foolhardy_Remacri.pth",
                "mode": "rescale",
                "rescale_factor": upscale_factor,
                "resize_width": 1024,
                "resampling_method": "bilinear",
                "supersample": "false",
                "rounding_modulus": 8,
                "image": last_image_node
            },
            "class_type": "CR Upscale Image"
        }
        workflow["39"] = {
            "inputs": {"pixels": ["38", 0], "vae": ["3", 0]},
            "class_type": "VAEEncode"
        }
        workflow["40"] = {
            "inputs": {
                "seed": seed + 1,
                "steps": 4,
                "cfg": 1,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 0.41,
                "model": ["1", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["39", 0]
            },
            "class_type": "KSampler"
        }
        workflow["41"] = {
            "inputs": {"samples": ["40", 0], "vae": ["3", 0]},
            "class_type": "VAEDecode"
        }
        last_image_node = ["41", 0]
    
    # Face Detailer
    if use_face_detailer:
        workflow["32"] = {
            "inputs": {"model_name": "bbox/face_yolov8m.pt"},
            "class_type": "UltralyticsDetectorProvider"
        }
        workflow["33"] = {
            "inputs": {"model_name": "sam_vit_b_01ec64.pth", "device_mode": "Prefer GPU"},
            "class_type": "SAMLoader"
        }
        workflow["30"] = {
            "inputs": {
                "guide_size": 1024,
                "guide_size_for": False,
                "max_size": 1024,
                "seed": seed + 2,
                "steps": 4,
                "cfg": 1,
                "sampler_name": "dpmpp_2m",
                "scheduler": "simple",
                "denoise": 0.45,
                "feather": 5,
                "noise_mask": True,
                "force_inpaint": True,
                "bbox_threshold": 0.5,
                "bbox_dilation": 10,
                "bbox_crop_factor": 3,
                "sam_detection_hint": "center-1",
                "sam_dilation": 0,
                "sam_threshold": 0.93,
                "sam_bbox_expansion": 0,
                "sam_mask_hint_threshold": 0.7,
                "sam_mask_hint_use_negative": "False",
                "drop_size": 10,
                "wildcard": "",
                "cycle": 1,
                "inpaint_model": False,
                "noise_mask_feather": 20,
                "tiled_encode": False,
                "tiled_decode": False,
                "image": last_image_node,
                "model": ["50", 0],
                "clip": ["50", 1],
                "vae": ["3", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "bbox_detector": ["32", 0],
                "sam_model_opt": ["33", 0]
            },
            "class_type": "FaceDetailer"
        }
        last_image_node = ["30", 0]
    
    # CRT Post-Processing
    exposure = pp.get("exposure", 0)
    contrast = pp.get("contrast", 1.0)
    saturation = pp.get("saturation", 1.0)
    vibrance = pp.get("vibrance", 0)
    enable_levels = exposure != 0 or contrast != 1.0 or saturation != 1.0 or vibrance != 0
    
    temp = pp.get("temp", 0)
    tint = pp.get("tint", 0)
    enable_temp = temp != 0 or tint != 0
    
    sharp_str = pp.get("sharpness", 0)
    enable_sharp = sharp_str > 0
    
    vig_str = pp.get("vignette", 0)
    enable_vig = vig_str > 0
    
    grain_amt = pp.get("grain_amount", 0)
    enable_grain = grain_amt > 0
    
    if enable_levels or enable_temp or enable_sharp or enable_vig or enable_grain:
        workflow["20"] = {
            "inputs": {
                "image": last_image_node,
                "enable_upscale": False,
                "upscale_model_path": "4x-ClearRealityV1_Soft.pth",
                "downscale_by": 1,
                "rescale_method": "lanczos",
                "precision": "auto",
                "batch_size": 1,
                "enable_levels": enable_levels,
                "exposure": exposure,
                "contrast": contrast,
                "saturation": saturation,
                "vibrance": vibrance,
                "enable_color_wheels": False,
                "lift_r": 0, "lift_g": 0, "lift_b": 0,
                "gamma_r": 1, "gamma_g": 1, "gamma_b": 1,
                "gain_r": 1, "gain_g": 1, "gain_b": 1,
                "enable_temp_tint": enable_temp,
                "temperature": temp,
                "tint": tint,
                "enable_sharpen": enable_sharp,
                "sharpen_strength": sharp_str,
                "sharpen_radius": 1.85,
                "sharpen_threshold": 0.015,
                "enable_vignette": enable_vig,
                "vignette_strength": vig_str,
                "vignette_radius": 0.7,
                "vignette_softness": 2,
                "enable_film_grain": enable_grain,
                "grain_intensity": grain_amt,
                "grain_size": pp.get("grain_size", 0.3),
                "grain_color_amount": 0.044,
                "gamma": 1,
                "brightness": 0,
                "enable_small_glow": False,
                "small_glow_intensity": 0.1,
                "small_glow_radius": 0.1,
                "small_glow_threshold": 0.25,
                "enable_large_glow": False,
                "large_glow_intensity": 0.25,
                "large_glow_radius": 50,
                "large_glow_threshold": 0.3,
                "enable_glare": False,
                "glare_type": "star_4",
                "glare_intensity": 0.65,
                "glare_length": 1.5,
                "glare_angle": 0,
                "glare_threshold": 0.95,
                "glare_quality": 16,
                "glare_ray_width": 1,
                "enable_chromatic_aberration": False,
                "ca_strength": 0.005,
                "ca_edge_falloff": 2,
                "enable_ca_hue_shift": False,
                "ca_hue_shift_degrees": 0,
                "enable_radial_blur": False,
                "radial_blur_type": "spin",
                "radial_blur_strength": 0,
                "radial_blur_center_x": 0.5,
                "radial_blur_center_y": 0.25,
                "radial_blur_falloff": 0.05,
                "radial_blur_samples": 16,
                "enable_lens_distortion": False,
                "barrel_distortion": 0,
                "postprocess_ui": ""
            },
            "class_type": "CRT Post-Process Suite"
        }
        last_image_node = ["20", 0]
    
    # Save
    workflow["Save"] = {
        "inputs": {"filename_prefix": "AIEGO", "images": last_image_node},
        "class_type": "SaveImage"
    }
    
    return workflow


def queue_prompt(workflow):
    """Send workflow to ComfyUI queue"""
    client_id = str(uuid.uuid4())
    
    response = requests.post(
        f"{COMFY_HOST}/prompt",
        json={"prompt": workflow, "client_id": client_id},
        timeout=30
    )
    
    if not response.ok:
        raise Exception(f"Failed to queue prompt: {response.text}")
    
    data = response.json()
    
    if "error" in data:
        raise Exception(f"Workflow error: {data['error']}")
    
    return data["prompt_id"], client_id


def wait_for_completion(prompt_id, client_id, timeout=300):
    """Wait for generation to complete via WebSocket"""
    completed = False
    error = None
    
    def on_message(ws, message):
        nonlocal completed, error
        try:
            msg = json.loads(message)
            if msg.get("type") == "executing":
                if msg["data"].get("node") is None and msg["data"].get("prompt_id") == prompt_id:
                    completed = True
                    ws.close()
            elif msg.get("type") == "execution_error":
                if msg["data"].get("prompt_id") == prompt_id:
                    error = msg["data"]
                    ws.close()
        except:
            pass
    
    def on_error(ws, err):
        nonlocal error
        error = str(err)
    
    ws = websocket.WebSocketApp(
        f"{COMFY_WS}?clientId={client_id}",
        on_message=on_message,
        on_error=on_error
    )
    
    ws_thread = threading.Thread(target=ws.run_forever)
    ws_thread.daemon = True
    ws_thread.start()
    
    start_time = time.time()
    while not completed and error is None:
        if time.time() - start_time > timeout:
            ws.close()
            raise Exception(f"Generation timeout after {timeout}s")
        time.sleep(0.5)
    
    if error:
        raise Exception(f"Execution error: {error}")


def get_image(filename, subfolder="", img_type="output"):
    """Fetch generated image from ComfyUI"""
    params = {"filename": filename, "subfolder": subfolder, "type": img_type}
    response = requests.get(f"{COMFY_HOST}/view", params=params, timeout=30)
    
    if not response.ok:
        raise Exception(f"Failed to fetch image: {response.status_code}")
    
    return base64.b64encode(response.content).decode("utf-8")


def handler(job):
    """RunPod Serverless Handler"""
    start_time = time.time()
    
    job_input = job.get("input", {})
    
    # Validate input
    prompt = job_input.get("prompt")
    if not prompt or not isinstance(prompt, str) or not prompt.strip():
        return {"error": "Missing or invalid 'prompt' in input"}
    
    print(f"[Handler] Starting generation for: {prompt[:50]}...")
    
    try:
        # Wait for ComfyUI
        wait_for_comfyui()
        
        # Build workflow
        workflow = build_workflow(
            prompt=prompt,
            negative=job_input.get("negative", "bad quality, blurry"),
            width=int(job_input.get("width", 1024)),
            height=int(job_input.get("height", 1024)),
            seed=job_input.get("seed"),
            lora_name=job_input.get("loraName") or job_input.get("lora_name"),
            lora_strength=float(job_input.get("loraStrength", job_input.get("lora_strength", 0.7))),
            use_face_detailer=bool(job_input.get("useFaceDetailer") or job_input.get("use_face_detailer")),
            use_upscale=bool(job_input.get("useUpscale") or job_input.get("use_upscale")),
            upscale_factor=float(job_input.get("upscaleFactor", job_input.get("upscale_factor", 1.5))),
            pp=job_input.get("pp") or job_input.get("post_processing") or {}
        )
        
        # Queue prompt
        prompt_id, client_id = queue_prompt(workflow)
        print(f"[Handler] Queued prompt: {prompt_id}")
        
        # Wait for completion
        wait_for_completion(prompt_id, client_id)
        print("[Handler] Generation complete")
        
        # Get results
        history_response = requests.get(f"{COMFY_HOST}/history/{prompt_id}", timeout=30)
        history = history_response.json()
        outputs = history.get(prompt_id, {}).get("outputs", {})
        
        images = []
        for key, out in outputs.items():
            if "images" in out:
                for img in out["images"]:
                    b64 = get_image(img["filename"], img.get("subfolder", ""), img.get("type", "output"))
                    images.append(f"data:image/png;base64,{b64}")
        
        elapsed = round(time.time() - start_time, 2)
        print(f"[Handler] Done in {elapsed}s, returning {len(images)} image(s)")
        
        return {
            "images": images,
            "count": len(images),
            "prompt": prompt,
            "elapsed_seconds": elapsed
        }
        
    except Exception as e:
        print(f"[Handler] Error: {str(e)}")
        return {"error": str(e)}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
