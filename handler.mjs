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

// ---------- workflow builder ----------
function buildWorkflow(input) {
  const {
    prompt,
    negative = "bad quality, blurry",
    width = 1024,
    height = 1024,
    seed = Math.floor(Math.random() * 999999999999),
    loraName = null,
    loraStrength = 0.7,
  } = input;

  // Валидация размеров (кратность 8 для latent space)
  const safeWidth = Math.max(512, Math.min(2048, Math.round(width / 8) * 8));
  const safeHeight = Math.max(512, Math.min(2048, Math.round(height / 8) * 8));

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
        steps: 9,
        cfg: 1,
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
    Save: {
      inputs: { filename_prefix: "AIEGO", images: ["7", 0] },
      class_type: "SaveImage",
    },
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
async function waitForCompletion(promptId, clientId, timeoutMs = 120000) {
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

        // Логируем прогресс (опционально)
        if (msg.type === "progress") {
          console.log(`[Progress] ${msg.data.value}/${msg.data.max}`);
        }

        // Завершение — node === null означает конец выполнения
        if (
          msg.type === "executing" &&
          msg.data.node === null &&
          msg.data.prompt_id === promptId
        ) {
          completed = true;
          clearTimeout(timeout);
          ws.close();
        }

        // Ошибка выполнения
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

  // Строим workflow
  const workflow = buildWorkflow(input);

  // Отправляем в очередь
  const { promptId, clientId } = await queuePrompt(workflow);
  console.log(`[Handler] Queued prompt: ${promptId}`);

  // Ждём завершения
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
