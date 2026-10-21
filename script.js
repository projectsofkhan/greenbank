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

const SUPABASE_URL      = "https://hfevedbqkjgwycdtranm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZXZlZGJxa2pnd3ljZHRyYW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1Mzk4MDgsImV4cCI6MjEwODExNTgwOH0.RYainvFoFqOe-cF5CcjPPtGa3NJs4PHcqtDaZOrLbHY";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let model, maxPredictions, isBusy = false;
const $ = (id) => document.getElementById(id);

// Detect which page we're on
const IS_HOME = !!document.getElementById("pageHome");
const IS_LB   = !!document.getElementById("pageLeaderboard");

// ====== IDENTITY ======
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2, 8) +
         Date.now().toString(36).slice(-4);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
function getName() { return localStorage.getItem(NAME_KEY) || ""; }
function setName(n) { localStorage.setItem(NAME_KEY, n); renderIdentity(); }
function getIdentity() { return `${getName() || "Guest"}-${getDeviceId()}`; }

function renderIdentity() {
  const nameEl = $("userName"), idEl = $("userId");
  if (!nameEl || !idEl) return;
  nameEl.textContent = getName() || "Guest";
  idEl.textContent = "-" + getDeviceId();
}

// ====== BOOT ======
document.addEventListener("DOMContentLoaded", () => {
  renderPoints();
  renderIdentity();

  // Home-only bindings
  if (IS_HOME) {
    const fileInput = $("fileInput");
    if (fileInput) fileInput.addEventListener("change", onFileSelected);

    // Show name modal on first visit
    if (!getName()) {
      $("welcomeModal").classList.remove("hidden");
      setTimeout(() => $("nameInput")?.focus(), 150);
      $("nameInput")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") saveName();
      });
    }
  }

  // Leaderboard-only binding
  if (IS_LB) {
    loadLeaderboard();
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
function getPoints() { return parseInt(localStorage.getItem(POINTS_KEY) || "0", 10); }
function setPoints(v) {
  localStorage.setItem(POINTS_KEY, String(v));
  renderPoints();
  const el = document.querySelector(".points");
  if (el) { el.classList.add("bump"); setTimeout(() => el.classList.remove("bump"), 300); }
}
function renderPoints() {
  const el = $("pointsValue");
  if (!el) return;
  const v = getPoints();
  el.textContent = v > 0 ? `+${v}` : v;
}

// ====== MODEL ======
async function ensureModel() {
  if (model) return;
  model = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
  maxPredictions = model.getTotalClasses();
}

// ====== UPLOAD TRIGGER ======
function triggerUpload() {
  const fileInput = $("fileInput");
  if (!fileInput) return;
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

// ====== ANALYZE with wave animation ======
async function classifyPreview() {
  if (isBusy) return;
  isBusy = true;

  const btn = $("analyzeBtn");
  const fill = $("waveFill");
  const scanLine = $("scanLine");
  btn.classList.add("busy");
  btn.querySelector(".btn-label").textContent = "Analyzing…";
  scanLine?.classList.remove("hidden");

  let progress = 0;
  const tick = setInterval(() => {
    progress = Math.min(progress + Math.random() * 12, 90);
    fill.style.setProperty("--fill", progress + "%");
  }, 200);

  try {
    await ensureModel();
    const img = $("previewImg");
    if (!img.complete) await new Promise((r) => (img.onload = r));
    await handleImage(img, img.src);
  } catch (err) {
    console.error(err);
    alert("Could not analyze this image.");
  } finally {
    clearInterval(tick);
    fill.style.setProperty("--fill", "100%");
    setTimeout(() => {
      fill.style.setProperty("--fill", "0%");
      btn.classList.remove("busy");
      btn.querySelector(".btn-label").textContent = "Analyze";
      scanLine?.classList.add("hidden");
      isBusy = false;
    }, 350);
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
  door?.classList.add("open");
  setTimeout(() => door?.classList.remove("open"), 900);

  switchState("stateResult");

  requestAnimationFrame(() => {
    document.querySelectorAll(".score-fill").forEach((el) => {
      el.style.width = el.dataset.pct + "%";
    });
  });

  const confidence = Math.round(top.probability * 100);
  const imageUrl = await uploadToCloudinary(dataUrl, top.className, confidence)
    .catch((e) => { console.warn("Cloudinary upload failed:", e); return null; });

  saveSubmission({
    label: top.className,
    confidence,
    points: delta,
    image_url: imageUrl,
  });
}

// ====== CLOUDINARY ======
async function uploadToCloudinary(dataUrl, label, confidence) {
  const identity = getIdentity();
  const name = getName() || "Guest";
  const deviceId = getDeviceId();

  const form = new FormData();
  form.append("file", dataUrl);
  form.append("upload_preset", UPLOAD_PRESET);
  form.append("folder", CLOUD_FOLDER);
  form.append("tags", `greenbank,${identity},${label.replace(/\s+/g, "_")},conf_${confidence}`);
  form.append("context",
    `identity=${encodeURIComponent(identity)}|name=${encodeURIComponent(name)}|device_id=${deviceId}|label=${label}|confidence=${confidence}`);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: "POST", body: form }
  );
  if (!res.ok) throw new Error(`Cloudinary ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.secure_url;
}

// ====== SUPABASE ======
async function saveSubmission({ label, confidence, points, image_url }) {
  const { error } = await sb.from("submissions").insert({
    identity: getIdentity(),
    name: getName() || "Guest",
    device_id: getDeviceId(),
    label,
    confidence,
    points,
    image_url,
  });
  if (error) console.warn("Supabase insert failed:", error);
}

async function loadLeaderboard() {
  const list = $("lbList");
  if (!list) return;
  list.innerHTML = `<p class="lb-empty">Loading…</p>`;

  const { data, error } = await sb
    .from("leaderboard")
    .select("*")
    .limit(100);

  if (error) {
    console.error(error);
    list.innerHTML = `<p class="lb-empty">Could not load leaderboard.</p>`;
    return;
  }
  if (!data || data.length === 0) {
    list.innerHTML = `<p class="lb-empty">No submissions yet. Be the first.</p>`;
    return;
  }

  list.innerHTML = "";
  data.forEach((row, i) => {
    const el = document.createElement("div");
    el.className = "lb-row";
    el.style.animationDelay = `${i * 40}ms`;
    el.innerHTML = `
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${escapeHtml(row.name)}</span>
      <span class="lb-pts">${row.total_points > 0 ? "+" : ""}${row.total_points}</span>
      <span class="lb-subs">${row.submissions} scans</span>
    `;
    list.appendChild(el);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ====== STATE ======
function switchState(id) {
  ["stateIdle", "statePreview", "stateResult"].forEach((s) => {
    const el = $(s);
    if (el) el.classList.add("hidden");
  });
  const target = $(id);
  if (target) target.classList.remove("hidden");
}
function resetApp() {
  const img = $("previewImg");
  if (img) img.src = "";
  switchState("stateIdle");
}

// ====== INFO POPUP ======
function toggleReview() {
  $("reviewPop")?.classList.toggle("open");
}
document.addEventListener("click", (e) => {
  const pop = $("reviewPop"), btn = $("reviewBtn");
  if (!pop || !btn) return;
  if (!pop.contains(e.target) && !btn.contains(e.target)) {
    pop.classList.remove("open");
  }
});
