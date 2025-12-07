// 🔥 ВСТАВЬ СВОЙ ENDPOINT ID:
const RUNPOD_ENDPOINT = "<YOUR_RUNPOD_ENDPOINT>";
const API_URL = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT}/run`;

// если endpoint приватный (recommended):
// const RUNPOD_API_KEY = "<YOUR_API_KEY>";

function log(msg) {
    document.getElementById("log").textContent += msg + "\n";
}

document.getElementById("generate").onclick = async () => {
    document.getElementById("log").textContent = "";
    document.getElementById("result").innerHTML = "";

    const payload = {
        prompt: document.getElementById("prompt").value,
        negative: document.getElementById("negative").value,
        width: Number(document.getElementById("width").value),
        height: Number(document.getElementById("height").value),
        loraName: document.getElementById("lora-name").value,
        loraStrength: Number(document.getElementById("lora-strength").value)
    };

    log("Sending request to RunPod...");

    const res = await fetch(API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            // "Authorization": `Bearer ${RUNPOD_API_KEY}` 
        },
        body: JSON.stringify({ input: payload })
    });

    if (!res.ok) {
        log("Error: " + res.status);
        return;
    }

    const data = await res.json();
    log("RunPod response received.");

    if (!data.output || !data.output.images) {
        log("No images in response.");
        return;
    }

    data.output.images.forEach(img => {
        const el = document.createElement("img");
        el.src = img;
        el.style.width = "100%";
        el.style.borderRadius = "10px";
        document.getElementById("result").appendChild(el);
    });

    log("Done!");
};
