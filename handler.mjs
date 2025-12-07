import runpod from "runpod";
import fetch from "node-fetch";
import WebSocket from "ws";
import { randomUUID } from "crypto";

const COMFY_HTTP = "http://127.0.0.1:8188";
const COMFY_WS = "ws://127.0.0.1:8188/ws";

// ---------- helper: подождать пока ComfyUI поднимется ----------
async function waitForComfyUI() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${COMFY_HTTP}/system_stats`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error("ComfyUI did not respond");
}

// ---------- твой workflow (сильно укорочен, потом допилим) ----------
function buildWorkflow(input) {
  const {
    prompt,
    negative = "bad quality, blurry",
    width = 1024,
    height = 1024,
    seed = Math.floor(Math.random() * 999999999999),
    loraName = null,
    loraStrength = 0.7
  } = input;

  const workflow = {
    "1": { inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" }, class_type: "UNETLoader" },
    "2": { inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" }, class_type: "CLIPLoader" },
    "3": { inputs: { vae_name: "ae.safetensors" }, class_type: "VAELoader" },
    "4": { inputs: { text: prompt, clip: ["50", 1] }, class_type: "CLIPTextEncode" },
    "5": { inputs: { text: negative, clip: ["50", 1] }, class_type: "CLIPTextEncode" },
    "50": {
      inputs: {
        lora_name: loraName || "V8-zimage.safetensors",
        strength_model: loraName ? loraStrength : 0,
        strength_clip: 1,
        model: ["1", 0],
        clip: ["2", 0],
      },
      class_type: "LoraLoader"
    },
    "11": { inputs: { width, height, batch_size: 1 }, class_type: "EmptyFlux2LatentImage" },
    "6": {
      inputs: {
        seed, steps: 9, cfg: 1,
        sampler_name: "euler", scheduler: "simple", denoise: 1,
        model: ["50", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["11", 0]
      },
      class_type: "KSampler"
    },
    "7": { inputs: { samples: ["6", 0], vae: ["3", 0] }, class_type: "VAEDecode" },
    "Save": { inputs: { filename_prefix: "AIEGO", images: ["7", 0] }, class_type: "SaveImage" }
  };

  return workflow;
}

// ---------- Comfy queue + ожидание ----------
async function queuePrompt(workflow) {
  const clientId = randomUUID();
  const resp = await fetch(`${COMFY_HTTP}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  return { promptId: data.prompt_id, clientId };
}

async function waitForCompletion(promptId, clientId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${COMFY_WS}?clientId=${clientId}`);
    let completed = false;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "executing" && msg.data.node === null && msg.data.prompt_id === promptId) {
          completed = true;
          ws.close();
        }
      } catch {}
    });

    ws.on("close", () => completed ? resolve() : reject(new Error("Closed before done")));
    ws.on("error", (err) => reject(err));
  });
}

// ---------- забрать PNG и вернуть base64 ----------
async function getImage(filename, subfolder, type) {
  const params = new URLSearchParams({ filename, subfolder: subfolder || "", type: type || "output" });
  const resp = await fetch(`${COMFY_HTTP}/view?${params}`);
  if (!resp.ok) throw new Error("Failed to get image");
  const buffer = await resp.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

// ---------- runpod handler ----------
runpod.serverless.handle(async (event) => {
  const input = event.input || {};
  if (!input.prompt) {
    throw new Error("Missing 'prompt' in input");
  }

  await waitForComfyUI();

  const workflow = buildWorkflow(input);

  const { promptId, clientId } = await queuePrompt(workflow);
  await waitForCompletion(promptId, clientId);

  const history = await fetch(`${COMFY_HTTP}/history/${promptId}`).then(r => r.json());
  const outputs = history[promptId].outputs;

  const images = [];

  for (const key in outputs) {
    const out = outputs[key];
    if (out.images) {
      for (const img of out.images) {
        const b64 = await getImage(img.filename, img.subfolder, img.type);
        images.push(`data:image/png;base64,${b64}`);
      }
    }
  }

  return {
    images,
    count: images.length,
    prompt: input.prompt,
  };
});
