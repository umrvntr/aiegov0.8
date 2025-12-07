// ==============================================================================
// AIEGO Generator — Frontend Script
// ==============================================================================
// 
// НАСТРОЙКА:
// 1. После деплоя на RunPod скопируй свой Endpoint ID
// 2. Вставь его ниже вместо <YOUR_ENDPOINT_ID>
// 3. Если endpoint приватный — раскомментируй строку с API ключом
//
// ==============================================================================

const RUNPOD_ENDPOINT_ID = "<YOUR_ENDPOINT_ID>";

// Для приватных endpoints раскомментируй и вставь свой API ключ:
// const RUNPOD_API_KEY = "<YOUR_API_KEY>";

// ==============================================================================
// НЕ РЕДАКТИРУЙ НИЖЕ (если не знаешь что делаешь)
// ==============================================================================

const API_URL = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/run`;
const STATUS_URL = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/status`;

function log(msg) {
  const logEl = document.getElementById("log");
  const timestamp = new Date().toLocaleTimeString();
  logEl.textContent += `[${timestamp}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function clearUI() {
  document.getElementById("log").textContent = "";
  document.getElementById("result").innerHTML = "";
}

function getHeaders() {
  const headers = { "Content-Type": "application/json" };
  
  // Если задан API ключ — добавляем авторизацию
  if (typeof RUNPOD_API_KEY !== "undefined" && RUNPOD_API_KEY) {
    headers["Authorization"] = `Bearer ${RUNPOD_API_KEY}`;
  }
  
  return headers;
}

async function pollStatus(jobId) {
  const maxAttempts = 120; // 2 минуты максимум
  const pollInterval = 1000; // 1 секунда

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${STATUS_URL}/${jobId}`, {
        method: "GET",
        headers: getHeaders(),
      });

      if (!res.ok) {
        log(`⚠️ Status check failed: ${res.status}`);
        continue;
      }

      const data = await res.json();

      if (data.status === "COMPLETED") {
        return data.output;
      }

      if (data.status === "FAILED") {
        throw new Error(data.error || "Job failed");
      }

      if (data.status === "IN_PROGRESS") {
        log(`⏳ Processing... (${i + 1}s)`);
      }

      if (data.status === "IN_QUEUE") {
        log(`🕐 In queue... (${i + 1}s)`);
      }

    } catch (err) {
      log(`⚠️ Poll error: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new Error("Timeout waiting for result");
}

async function generate() {
  clearUI();

  // Проверка конфигурации
  if (RUNPOD_ENDPOINT_ID === "<YOUR_ENDPOINT_ID>") {
    log("❌ ERROR: Вставь свой RUNPOD_ENDPOINT_ID в script.js!");
    return;
  }

  const prompt = document.getElementById("prompt").value.trim();
  if (!prompt) {
    log("❌ ERROR: Введи промпт!");
    return;
  }

  const payload = {
    input: {
      prompt: prompt,
      negative: document.getElementById("negative").value || "bad quality, blurry",
      width: Number(document.getElementById("width").value) || 1024,
      height: Number(document.getElementById("height").value) || 1024,
      loraName: document.getElementById("lora-name").value || null,
      loraStrength: Number(document.getElementById("lora-strength").value) || 0.7,
    },
  };

  log(`🚀 Sending request to RunPod...`);
  log(`📝 Prompt: "${prompt.slice(0, 50)}${prompt.length > 50 ? "..." : ""}"`);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }

    const data = await res.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Если сразу вернулся результат (sync mode)
    if (data.output && data.output.images) {
      log(`✅ Done!`);
      displayImages(data.output);
      return;
    }

    // Если вернулся job ID — поллим статус (async mode)
    if (data.id) {
      log(`📋 Job ID: ${data.id}`);
      const output = await pollStatus(data.id);
      log(`✅ Done!`);
      displayImages(output);
      return;
    }

    throw new Error("Unexpected response format");

  } catch (err) {
    log(`❌ ERROR: ${err.message}`);
  }
}

function displayImages(output) {
  const container = document.getElementById("result");

  if (!output || !output.images || output.images.length === 0) {
    log("⚠️ No images in response");
    return;
  }

  log(`🖼️ Received ${output.count} image(s)`);

  if (output.elapsed_seconds) {
    log(`⏱️ Generated in ${output.elapsed_seconds}s`);
  }

  output.images.forEach((imgData, idx) => {
    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "20px";

    const img = document.createElement("img");
    img.src = imgData;
    img.alt = `Generated image ${idx + 1}`;
    img.style.width = "100%";
    img.style.borderRadius = "10px";
    img.style.cursor = "pointer";

    // Клик для скачивания
    img.onclick = () => {
      const link = document.createElement("a");
      link.href = imgData;
      link.download = `aiego_${Date.now()}_${idx + 1}.png`;
      link.click();
    };

    wrapper.appendChild(img);
    container.appendChild(wrapper);
  });
}

// Привязка к кнопке
document.getElementById("generate").onclick = generate;

// Enter в поле промпта тоже запускает генерацию
document.getElementById("prompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    generate();
  }
});
