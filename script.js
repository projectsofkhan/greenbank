// ====== CONFIG ======
const MODEL_URL = "./";                     // model files are in the root
const POINTS_KEY = "greenbank.points";
const WASTE_CLASS = "Waste";                // +100
const GOOD_CLASS  = "Good Material";        // -500

const CLOUD_NAME    = "fc5nj83m";
const UPLOAD_PRESET = "ml_default";
const CLOUD_FOLDER  = "greenbank";

let model, webcam, maxPredictions;
const $ = (id) => document.getElementById(id);

// ====== POINTS ======
document.addEventListener("DOMContentLoaded", () => {
  renderPoints();

  // Wire the hidden file input once, on load
  const fileInput = $("fileInput");
  if (fileInput) {
    fileInput.addEventListener("change", onFileSelected);
  }
});

function getPoints() {
  return parseInt(localStorage.getItem(POINTS_KEY) || "0", 10);
}
function setPoints(v) {
  localStorage.setItem(POINTS_KEY, String(v));
  renderPoints();
}
function renderPoints() {
  const v = getPoints();
  $("pointsValue").textContent = v > 0 ? `+${v}` : v;
}

// ====== MODEL LOAD ======
async function ensureModel() {
  if (model) return;
  const modelURL    = MODEL_URL + "model.json";
  const metadataURL = MODEL_URL + "metadata.json";
  model = await tmImage.load(modelURL, metadataURL);
  maxPredictions = model.getTotalClasses();
}

// ====== CAMERA ======
async function startCamera() {
  try {
    await ensureModel();

    webcam = new tmImage.Webcam(300, 300, true);
    await webcam.setup();
    await webcam.play();

    const container = $("webcam-container");
    container.innerHTML = "";
    container.appendChild(webcam.canvas);

    switchState("stateCamera");
  } catch (err) {
    console.error(err);
    alert("Could not start the camera. Please allow camera access and try again.");
  }
}

async function capture() {
  webcam.update();
  const canvas = webcam.canvas;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  await handleImage(canvas, dataUrl);
}

// ====== UPLOAD ======
function triggerUpload() {
  const fileInput = $("fileInput");
  fileInput.value = "";
  fileInput.click();
}

function onFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    $("previewImg").src = reader.result;
    switchState("statePreview");
  };
  reader.readAsDataURL(file);
}

async function classifyPreview() {
  try {
    await ensureModel();

    const img = $("previewImg");
    if (!img.complete) await new Promise((r) => (img.onload = r));

    const dataUrl = img.src;
    await handleImage(img, dataUrl);
  } catch (err) {
    console.error(err);
    alert("Could not analyze this image.");
  }
}

// ====== SHARED PIPELINE ======
async function handleImage(inputEl, dataUrl) {
  const predictions = await model.predict(inputEl);
  const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
  const top = sorted[0];

  const scoresEl = $("scores");
  scoresEl.innerHTML = "";
  sorted.forEach((p) => {
    const pct = Math.round(p.probability * 100);
    const row = document.createElement("div");
    row.className = "score-row";
    row.innerHTML = `
      <span class="score-label">${p.className}</span>
      <span class="score-bar"><span class="score-fill" style="width:${pct}%"></span></span>
      <span class="score-pct">${pct}%</span>
    `;
    scoresEl.appendChild(row);
  });

  $("verdictText").textContent = `Classified as: ${top.className}`;
  const delta =
    top.className === WASTE_CLASS ? +100 :
    top.className === GOOD_CLASS  ? -500 : 0;
  setPoints(getPoints() + delta);

  const deltaEl = $("deltaText");
  deltaEl.textContent = delta > 0 ? `+${delta} points` : `${delta} points`;
  deltaEl.classList.toggle("negative", delta < 0);

  const door = $("canDoor");
  door.classList.add("open");
  setTimeout(() => door.classList.remove("open"), 900);

  switchState("stateResult");

  uploadToCloudinary(dataUrl, top.className, Math.round(top.probability * 100))
    .catch((e) => console.warn("Cloudinary upload failed:", e));
}

// ====== CLOUDINARY ======
async function uploadToCloudinary(dataUrl, label, confidence) {
  const form = new FormData();
  form.append("file", dataUrl);
  form.append("upload_preset", UPLOAD_PRESET);
  form.append("folder", CLOUD_FOLDER);
  form.append("tags", `greenbank,${label.replace(/\s+/g, "_")},conf_${confidence}`);
  form.append("context", `label=${label}|confidence=${confidence}`);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: "POST", body: form }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cloudinary ${res.status}: ${text}`);
  }
  return res.json();
}

// ====== STATE SWITCHER ======
function switchState(id) {
  ["stateIdle", "stateCamera", "statePreview", "stateResult"].forEach((s) =>
    $(s).classList.add("hidden")
  );
  $(id).classList.remove("hidden");
}

function resetApp() {
  if (webcam) {
    try { webcam.stop(); } catch (_) {}
    webcam = null;
  }
  $("webcam-container").innerHTML = "";
  $("previewImg").src = "";
  switchState("stateIdle");
}
