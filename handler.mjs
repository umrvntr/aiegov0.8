import runpod from "runpod";
import fetch from "node-fetch";
import WebSocket from "ws";
import { randomUUID } from "crypto";

const COMFY_HTTP = "http://127.0.0.1:8188";
const COMFY_WS = "ws://127.0.0.1:8188/ws";

// ---------- helper: подождать пока ComfyUI поднимется ----------
async function waitForComfyUI(maxAttempts = 60, intervalMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await fetch(`${COMFY_HTTP}/system_stats`);
      if (r.ok) {
        console.log(`[ComfyUI] Ready after ${i + 1} attempts`);
        return;
      }
    } catch {
      // ComfyUI ещё не поднялся — ждём
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`ComfyUI did not respond after ${maxAttempts} attempts`);
}

// ---------- FULL workflow builder (matches server.mjs) ----------
function buildWorkflow(options) {
  const {
    prompt,
    negative = "bad quality, blurry",
    seed = Math.floor(Math.random() * 999999999999),
    width = 1024,
    height = 1024,
    loraName = null,
    loraStrength = 0.7,
    useFaceDetailer = false,
    useUpscale = false,
    upscaleFactor = 1.5,
    pp = {},
  } = options;

  const STEPS = 9;
  const CFG = 1;

  // Валидация размеров (кратность 8)
  const safeWidth = Math.max(512, Math.min(2048, Math.round(width / 8) * 8));
  const safeHeight = Math.max(512, Math.min(2048, Math.round(height / 8) * 8));

  // 1. INIT BASE NODES
  const workflow = {
    "1": {
      inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" },
      class_type: "UNETLoader",
    },
    "2": {
      inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" },
      class_type: "CLIPLoader",
    },
    "3": {
      inputs: { vae_name: "ae.safetensors" },
      class_type: "VAELoader",
    },
    "4": {
      inputs: { text: prompt, clip: ["50", 1] },
      class_type: "CLIPTextEncode",
    },
    "5": {
      inputs: { text: negative, clip: ["50", 1] },
      class_type: "CLIPTextEncode",
    },
    "50": {
      inputs: {
        lora_name: loraName || "V8-zimage.safetensors",
        strength_model: loraName ? loraStrength : 0,
        strength_clip: 1,
        model: ["1", 0],
        clip: ["2", 0],
      },
      class_type: "LoraLoader",
    },
    "11": {
      inputs: { width: safeWidth, height: safeHeight, batch_size: 1 },
      class_type: "EmptyFlux2LatentImage",
    },
    "6": {
      inputs: {
        seed,
        steps: STEPS,
        cfg: CFG,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1,
        model: ["50", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["11", 0],
      },
      class_type: "KSampler",
    },
    "7": {
      inputs: { samples: ["6", 0], vae: ["3", 0] },
      class_type: "VAEDecode",
    },
  };

  let lastImageNode = ["7", 0];

  // 2. UPSCALER
  if (useUpscale) {
    workflow["38"] = {
      inputs: {
        upscale_model: "4x_foolhardy_Remacri.pth",
        mode: "rescale",
        rescale_factor: upscaleFactor,
        resize_width: 1024,
        resampling_method: "bilinear",
        supersample: "false",
        rounding_modulus: 8,
        image: lastImageNode,
      },
      class_type: "CR Upscale Image",
    };
    workflow["39"] = {
      inputs: { pixels: ["38", 0], vae: ["3", 0] },
      class_type: "VAEEncode",
    };
    workflow["40"] = {
      inputs: {
        seed: seed + 1,
        steps: 4,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 0.41,
        model: ["1", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["39", 0],
      },
      class_type: "KSampler",
    };
    workflow["41"] = {
      inputs: { samples: ["40", 0], vae: ["3", 0] },
      class_type: "VAEDecode",
    };
    lastImageNode = ["41", 0];
  }

  // 3. FACE DETAILER
  if (useFaceDetailer) {
    workflow["32"] = {
      inputs: { model_name: "bbox/face_yolov8m.pt" },
      class_type: "UltralyticsDetectorProvider",
    };
    workflow["33"] = {
      inputs: { model_name: "sam_vit_b_01ec64.pth", device_mode: "Prefer GPU" },
      class_type: "SAMLoader",
    };
    workflow["30"] = {
      inputs: {
        guide_size: 1024,
        guide_size_for: false,
        max_size: 1024,
        seed: seed + 2,
        steps: 4,
        cfg: 1,
        sampler_name: "dpmpp_2m",
        scheduler: "simple",
        denoise: 0.45,
        feather: 5,
        noise_mask: true,
        force_inpaint: true,
        bbox_threshold: 0.5,
        bbox_dilation: 10,
        bbox_crop_factor: 3,
        sam_detection_hint: "center-1",
        sam_dilation: 0,
        sam_threshold: 0.93,
        sam_bbox_expansion: 0,
        sam_mask_hint_threshold: 0.7,
        sam_mask_hint_use_negative: "False",
        drop_size: 10,
        wildcard: "",
        cycle: 1,
        inpaint_model: false,
        noise_mask_feather: 20,
        tiled_encode: false,
        tiled_decode: false,
        image: lastImageNode,
        model: ["50", 0],
        clip: ["50", 1],
        vae: ["3", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        bbox_detector: ["32", 0],
        sam_model_opt: ["33", 0],
      },
      class_type: "FaceDetailer",
    };
    lastImageNode = ["30", 0];
  }

  // 4. CRT POST-PROCESS
  const exposure = pp.exposure !== undefined ? pp.exposure : 0;
  const contrast = pp.contrast !== undefined ? pp.contrast : 1.0;
  const saturation = pp.saturation !== undefined ? pp.saturation : 1.0;
  const vibrance = pp.vibrance !== undefined ? pp.vibrance : 0;
  const enableLevels = exposure !== 0 || contrast !== 1.0 || saturation !== 1.0 || vibrance !== 0;

  const temp = pp.temp || 0;
  const tint = pp.tint || 0;
  const enableTemp = temp !== 0 || tint !== 0;

  const sharpStr = pp.sharpness || 0;
  const enableSharp = sharpStr > 0;

  const vigStr = pp.vignette || 0;
  const enableVig = vigStr > 0;

  const grainAmt = pp.grain_amount || 0;
  const enableGrain = grainAmt > 0;

  // Only add CRT node if any post-processing is enabled
  if (enableLevels || enableTemp || enableSharp || enableVig || enableGrain) {
    workflow["20"] = {
      inputs: {
        image: lastImageNode,
        enable_upscale: false,
        upscale_model_path: "4x-ClearRealityV1_Soft.pth",
        downscale_by: 1,
        rescale_method: "lanczos",
        precision: "auto",
        batch_size: 1,
        enable_levels: enableLevels,
        exposure,
        contrast,
        saturation,
        vibrance,
        enable_color_wheels: false,
        lift_r: 0, lift_g: 0, lift_b: 0,
        gamma_r: 1, gamma_g: 1, gamma_b: 1,
        gain_r: 1, gain_g: 1, gain_b: 1,
        enable_temp_tint: enableTemp,
        temperature: temp,
        tint,
        enable_sharpen: enableSharp,
        sharpen_strength: sharpStr,
        sharpen_radius: 1.85,
        sharpen_threshold: 0.015,
        enable_vignette: enableVig,
        vignette_strength: vigStr,
        vignette_radius: 0.7,
        vignette_softness: 2,
        enable_film_grain: enableGrain,
        grain_intensity: grainAmt,
        grain_size: pp.grain_size || 0.3,
        grain_color_amount: 0.044,
        gamma: 1,
        brightness: 0,
        enable_small_glow: false,
        small_glow_intensity: 0.1,
        small_glow_radius: 0.1,
        small_glow_threshold: 0.25,
        enable_large_glow: false,
        large_glow_intensity: 0.25,
        large_glow_radius: 50,
        large_glow_threshold: 0.3,
        enable_glare: false,
        glare_type: "star_4",
        glare_intensity: 0.65,
        glare_length: 1.5,
        glare_angle: 0,
        glare_threshold: 0.95,
        glare_quality: 16,
        glare_ray_width: 1,
        enable_chromatic_aberration: false,
        ca_strength: 0.005,
        ca_edge_falloff: 2,
        enable_ca_hue_shift: false,
        ca_hue_shift_degrees: 0,
        enable_radial_blur: false,
        radial_blur_type: "spin",
        radial_blur_strength: 0,
        radial_blur_center_x: 0.5,
        radial_blur_center_y: 0.25,
        radial_blur_falloff: 0.05,
        radial_blur_samples: 16,
        enable_lens_distortion: false,
        barrel_distortion: 0,
        postprocess_ui: "",
      },
      class_type: "CRT Post-Process Suite",
    };
    lastImageNode = ["20", 0];
  }

  // 5. SAVE
  workflow["Save"] = {
    inputs: { filename_prefix: "AIEGO", images: lastImageNode },
    class_type: "SaveImage",
  };

  return workflow;
}

// ---------- отправка промпта в очередь ComfyUI ----------
async function queuePrompt(workflow) {
  const clientId = randomUUID();

  const resp = await fetch(`${COMFY_HTTP}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`ComfyUI prompt error: ${resp.status} — ${errorText}`);
  }

  const data = await resp.json();

  if (data.error) {
    throw new Error(`ComfyUI workflow error: ${JSON.stringify(data.error)}`);
  }

  return { promptId: data.prompt_id, clientId };
}

// ---------- ожидание завершения генерации через WebSocket ----------
async function waitForCompletion(promptId, clientId, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${COMFY_WS}?clientId=${clientId}`);
    let completed = false;

    const timeout = setTimeout(() => {
      if (!completed) {
        ws.close();
        reject(new Error(`Generation timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    ws.on("open", () => {
      console.log(`[WS] Connected, waiting for prompt ${promptId}`);
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "progress") {
          console.log(`[Progress] ${msg.data.value}/${msg.data.max}`);
        }

        if (
          msg.type === "executing" &&
          msg.data.node === null &&
          msg.data.prompt_id === promptId
        ) {
          completed = true;
          clearTimeout(timeout);
          ws.close();
        }

        if (msg.type === "execution_error" && msg.data.prompt_id === promptId) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`Execution error: ${JSON.stringify(msg.data)}`));
        }
      } catch {
        // JSON parse error — игнорируем бинарные сообщения
      }
    });

    ws.on("close", () => {
      clearTimeout(timeout);
      if (completed) {
        resolve();
      } else {
        reject(new Error("WebSocket closed before completion"));
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${err.message}`));
    });
  });
}

// ---------- получение изображения из ComfyUI ----------
async function getImage(filename, subfolder, type) {
  const params = new URLSearchParams({
    filename,
    subfolder: subfolder || "",
    type: type || "output",
  });

  const resp = await fetch(`${COMFY_HTTP}/view?${params}`);

  if (!resp.ok) {
    throw new Error(`Failed to fetch image: ${resp.status}`);
  }

  const buffer = await resp.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

// ---------- RunPod serverless handler ----------
runpod.serverless.handle(async (event) => {
  const startTime = Date.now();
  const input = event.input || {};

  // Валидация входных данных
  if (!input.prompt || typeof input.prompt !== "string" || input.prompt.trim() === "") {
    throw new Error("Missing or invalid 'prompt' in input");
  }

  console.log(`[Handler] Starting generation for prompt: "${input.prompt.slice(0, 50)}..."`);

  // Ждём готовности ComfyUI
  await waitForComfyUI();

  // Строим workflow с полными опциями
  const workflow = buildWorkflow({
    prompt: input.prompt,
    negative: input.negative || "bad quality, blurry",
    seed: input.seed || Math.floor(Math.random() * 999999999999),
    width: parseInt(input.width) || 1024,
    height: parseInt(input.height) || 1024,
    loraName: input.loraName || input.lora_name || null,
    loraStrength: parseFloat(input.loraStrength || input.lora_strength) || 0.7,
    useFaceDetailer: !!input.useFaceDetailer || !!input.use_face_detailer,
    useUpscale: !!input.useUpscale || !!input.use_upscale,
    upscaleFactor: parseFloat(input.upscaleFactor || input.upscale_factor) || 1.5,
    pp: input.pp || input.post_processing || {},
  });

  // Отправляем в очередь
  const { promptId, clientId } = await queuePrompt(workflow);
  console.log(`[Handler] Queued prompt: ${promptId}`);

  // Ждём завершения (5 минут таймаут для upscale + face detailer)
  await waitForCompletion(promptId, clientId);
  console.log(`[Handler] Generation complete`);

  // Забираем результаты из истории
  const historyResp = await fetch(`${COMFY_HTTP}/history/${promptId}`);
  if (!historyResp.ok) {
    throw new Error(`Failed to fetch history: ${historyResp.status}`);
  }

  const history = await historyResp.json();
  const outputs = history[promptId]?.outputs;

  if (!outputs) {
    throw new Error("No outputs in history");
  }

  // Собираем все изображения
  const images = [];

  for (const key in outputs) {
    const out = outputs[key];
    if (out.images && Array.isArray(out.images)) {
      for (const img of out.images) {
        const b64 = await getImage(img.filename, img.subfolder, img.type);
        images.push(`data:image/png;base64,${b64}`);
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[Handler] Done in ${elapsed}s, returning ${images.length} image(s)`);

  return {
    images,
    count: images.length,
    prompt: input.prompt,
    seed: input.seed || "random",
    elapsed_seconds: parseFloat(elapsed),
  };
});
