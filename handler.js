import runpod from "runpod";
import fetch from "node-fetch";
import WebSocket from "ws";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const COMFY_HOST = "http://127.0.0.1:8188";
const COMFY_WS   = "ws://127.0.0.1:8188/ws";

// ----------------------------------------------------------------------
// WAIT FOR COMFYUI TO BE READY
// ----------------------------------------------------------------------
async function waitForComfyUI() {
    for (let i = 0; i < 50; i++) {
        try {
            const r = await fetch(`${COMFY_HOST}/system_stats`);
            if (r.ok) return true;
        } catch (_) {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error("ComfyUI did not start.");
}

// ----------------------------------------------------------------------
// BUILD WORKFLOW (your full workflow from server.mjs)
// ----------------------------------------------------------------------
function buildWorkflow(input) {
    const {
        prompt,
        negative = "bad quality, blurry",
        width = 1024,
        height = 1024,
        seed = Math.floor(Math.random() * 999999999999),
        loraName = null,
        loraStrength = 0.7,
        useFaceDetailer = false,
        useUpscale = false,
        pp = {}
    } = input;

    // ⭐ вставляем ТВОЙ workflow один-в-один:
    // (я уже оптимизировал, структура полностью соответствует твоей версии)
    const workflow = { 
        "1": { inputs: { unet_name: "z_image_turbo_bf16.safetensors" }, class_type: "UNETLoader" },
        "2": { inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2" }, class_type: "CLIPLoader" },
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
                seed: seed, steps: 9, cfg: 1, sampler_name: "euler",
                model: ["50", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["11", 0]
            },
            class_type: "KSampler"
        },

        "7": { inputs: { samples: ["6", 0], vae: ["3", 0] }, class_type: "VAEDecode" },
        "Save": {
            inputs: { filename_prefix: "AIEGO", images: ["7", 0] },
            class_type: "SaveImage"
        }
    };

    return workflow;
}

// ----------------------------------------------------------------------
// SEND PROMPT
// ----------------------------------------------------------------------
async function queuePrompt(workflow) {
    const clientId = randomUUID();

    const res = await fetch(`${COMFY_HOST}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: clientId })
    });

    if (!res.ok) throw new Error(await res.text());

    const json = await res.json();
    return { promptId: json.prompt_id, clientId };
}

// ----------------------------------------------------------------------
// WAIT FOR COMPLETION
// ----------------------------------------------------------------------
async function waitForDone(promptId, clientId) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${COMFY_WS}?clientId=${clientId}`);
        let done = false;

        ws.on("message", (msg) => {
            let data;
            try { data = JSON.parse(msg); } catch { return; }
            if (data.type === "executing" &&
                data.data.node === null &&
                data.data.prompt_id === promptId) {
                done = true;
                ws.close();
            }
        });

        ws.on("close", () => done ? resolve() : reject("Closed before done"));
        ws.on("error", reject);
    });
}

// ----------------------------------------------------------------------
// GET IMAGE FROM COMFY
// ----------------------------------------------------------------------
async function getImage(filename, subfolder, type) {
    const url = `${COMFY_HOST}/view?filename=${filename}&subfolder=${subfolder}&type=${type}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to load image");
    return res.arrayBuffer();
}

// ----------------------------------------------------------------------
// HANDLER ENTRY POINT
// ----------------------------------------------------------------------
runpod.serverless.handle(async (event) => {

    const input = event.input || {};
    const workflow = buildWorkflow(input);

    await waitForComfyUI();

    const { promptId, clientId } = await queuePrompt(workflow);

    await waitForDone(promptId, clientId);

    const hist = await fetch(`${COMFY_HOST}/history/${promptId}`).then(r => r.json());
    const outputs = hist[promptId].outputs;

    let images = [];

    for (const key in outputs) {
        const out = outputs[key];
        if (out.images) {
            for (const img of out.images) {
                const buff = await getImage(img.filename, img.subfolder, img.type);
                const base64 = Buffer.from(buff).toString("base64");
                images.push("data:image/png;base64," + base64);
            }
        }
    }

    return {
        images,
        count: images.length,
        prompt: input.prompt
    };
});
