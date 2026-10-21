// ====== CONFIG ======
const MODEL_URL = "./";
const POINTS_KEY = "greenbank.points";
const DEVICE_KEY = "greenbank.device";
const NAME_KEY   = "greenbank.name";
const WASTE_CLASS = "Waste";
const GOOD_CLASS  = "Good Material";

const CLOUD_NAME    = "fc5nj83m";
const UPLOAD_PRESET = "ml_default";
const CLOUD_FOLDER  = "greenbank";

let model, maxPredictions;
const $ = (id) => document.getElementById(id);

// ====== IDENTITY ======
// device id: persistent random string, generated once per browser
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2, 8) +
         Date.now().toString(36).slice(-4);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function getName() {
  return localStorage.getItem(NAME_KEY) || "";
}
function setName(name) {
  localStorage.setItem(NAME_KEY, name);
  renderIdentity();
}

// Combined identity: "Aarav-dev_ab12cd34"
function getIdentity() {
  const name = getName() || "Guest";
  return `${name}-${getDeviceId()}`;
}

function renderIdentity() {
  const nameEl = $("userName");
  const idEl = $("userId");
  if (!nameEl || !idEl) return;
  const name = getName();
  if (name) {
    nameEl.textContent = name;
    idEl.textContent = "-" + getDeviceId();
  } else {
    nameEl.textContent = "Guest";
    idEl.textContent = "-" + getDeviceId();
  }
}

// ====== BOOT ======
document.addEventListener("DOMContentLoaded", () => {
  renderPoints();
  renderIdentity();

  const fileInput = $("fileInput");
  if (fileInput) fileInput.addEventListener("change", onFileSelected);

  if (!getName()) {
    $("welcomeModal").classList.remove("hidden");
    setTimeout(() => $("nameInput")?.focus(), 150);
    $("nameInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveName();
    });
  }
});

function saveName() {
  const input = $("nameInput");
  const name = (input?.value || "").trim();
  if (!name) { input?.focus(); return; }
  setName(name);
  $("welcomeModal").classList.add("hidden");
}

// ====== POINTS ======
function getPoints() {
  return parseInt(localStorage.getItem(POINTS_KEY) || "0", 10);
}
function setPoints(v) {
  localStorage.setItem(POINTS_KEY, String(v));
  renderPoints();
  const el = document.querySelector(".points");
  if (el) {
    el.classList.add("bump");
    setTimeout(() => el.classList.remove("bump"), 300);
  }
}
function renderPoints() {
  const v = getPoints();
  $("pointsValue").textContent = v > 0 ? `+${v}` : v;
}

// ====== MODEL ======
async function ensureModel() {
  if (model) return;
  model = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
  maxPredictions = model.getTotalClasses();
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
    await handleImage(img, img.src);
  } catch (err) {
    console.error(err);
    alert("Could not analyze this image.");
  }
}

// ====== PIPELINE ======
async function handleImage(inputEl, dataUrl) {
  const predictions = await model.predict(inputEl);
  const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
  const top = sorted[0];

  const scoresEl = $("scores");
  scoresEl.innerHTML = "";
  sorted.forEach((p, i) => {
    const pct = Math.round(p.probability * 100);
    const row = document.createElement("div");
    row.className = "score-row";
    row.style.animationDelay = `${i * 60}ms`;
    row.innerHTML = `
      <span class="score-label">${p.className}</span>
      <span class="score-bar"><span class="score-fill" data-pct="${pct}"></span></span>
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

  requestAnimationFrame(() => {
    document.querySelectorAll(".score-fill").forEach((el) => {
      el.style.width = el.dataset.pct + "%";
    });
  });

  uploadToCloudinary(dataUrl, top.className, Math.round(top.probability * 100))
    .catch((e) => console.warn("Cloudinary upload failed:", e));
}

// ====== CLOUDINARY ======
async function uploadToCloudinary(dataUrl, label, confidence) {
  const name = getName() || "Guest";
  const deviceId = getDeviceId();
  const identity = getIdentity(); // "Aarav-dev_ab12cd34"

  const form = new FormData();
  form.append("file", dataUrl);
  form.append("upload_preset", UPLOAD_PRESET);
  form.append("folder", CLOUD_FOLDER);
  // identity is the human-visible tag; name + device_id kept separate too
  form.append("tags", `greenbank,${identity},${label.replace(/\s+/g, "_")},conf_${confidence}`);
  form.append("context",
    `identity=${encodeURIComponent(identity)}|name=${encodeURIComponent(name)}|device_id=${deviceId}|label=${label}|confidence=${confidence}`);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: "POST", body: form }
  );
  if (!res.ok) throw new Error(`Cloudinary ${res.status}: ${await res.text()}`);
  return res.json();
}

// ====== STATE ======
function switchState(id) {
  ["stateIdle", "statePreview", "stateResult"].forEach((s) =>
    $(s).classList.add("hidden")
  );
  $(id).classList.remove("hidden");
}

function resetApp() {
  $("previewImg").src = "";
  switchState("stateIdle");
}

// ====== INFO POPUP ======
function toggleReview() {
  $("reviewPop").classList.toggle("open");
}
document.addEventListener("click", (e) => {
  const pop = $("reviewPop");
  const btn = $("reviewBtn");
  if (!pop || !btn) return;
  if (!pop.contains(e.target) && !btn.contains(e.target)) {
    pop.classList.remove("open");
  }
});
