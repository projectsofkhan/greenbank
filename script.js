// ====== CONFIG ======
const MODEL_URL = "./";
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

const IS_HOME = !!document.getElementById("pageHome");
const IS_LB   = !!document.getElementById("pageLeaderboard");

// ====== IDENTITY (local only) ======
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
function getIdentity() { return `${getName() || "Guest"}-${getDeviceId()}`; }

function renderIdentity() {
  const nameEl = $("userName"), idEl = $("userId");
  if (!nameEl || !idEl) return;
  nameEl.textContent = getName() || "Guest";
  idEl.textContent = "-" + getDeviceId();
}

// ====== USER CREATION ======
async function setName(name) {
  localStorage.setItem(NAME_KEY, name);
  renderIdentity();

  const deviceId = getDeviceId();
  console.log("[user] saving", { deviceId, name });

  const ins = await sb.from("users").insert({ device_id: deviceId, name });
  if (!ins.error) { console.log("[user] inserted", ins.data); return true; }

  if (ins.error.code === "23505") {
    const upd = await sb.from("users").update({ name }).eq("device_id", deviceId);
    if (upd.error) { console.warn("[user] update failed", upd.error); return false; }
    console.log("[user] updated", upd.data);
    return true;
  }

  console.warn("[user] insert failed", ins.error);
  return false;
}

// ====== POINTS (Supabase = source of truth) ======
async function fetchMyTotal() {
  const deviceId = getDeviceId();
  const { data, error } = await sb
    .from("submissions")
    .select("points")
    .eq("device_id", deviceId);

  if (error) { console.warn("[points] fetch failed", error); return null; }

  const total = (data || []).reduce((s, r) => s + (r.points || 0), 0);
  return total;
}

function renderPoints(v) {
  const el = $("pointsValue");
  if (!el) return;
  const val = v ?? 0;
  el.textContent = val > 0 ? `+${val}` : val;
}

async function refreshPoints() {
  const total = await fetchMyTotal();
  if (total !== null) renderPoints(total);
  return total ?? 0;
}

function bumpChip() {
  const chip = document.querySelector(".points");
  if (chip) {
    chip.classList.add("bump");
    setTimeout(() => chip.classList.remove("bump"), 300);
  }
}

// ====== BOOT ======
document.addEventListener("DOMContentLoaded", async () => {
  renderIdentity();
  renderPoints(0);

  // Footer info works on both pages
  $("footerInfo")?.addEventListener("click", openReview);

  if (IS_HOME) {
    const fileInput = $("fileInput");
    if (fileInput) fileInput.addEventListener("change", onFileSelected);

    if (!getName()) {
      openModal("welcomeModal");
      setTimeout(() => $("nameInput")?.focus(), 200);
      $("nameInput")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") saveName();
      });
    }

    // Pull points from backend on load
    await refreshPoints();
  }

  if (IS_LB) loadLeaderboard();

  document.querySelectorAll(".modal-backdrop").forEach((bd) => {
    bd.addEventListener("click", (e) => {
      if (e.target === bd) closeModal(bd.id);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop:not(.hidden)").forEach((bd) => closeModal(bd.id));
    }
  });
});

async function saveName() {
  const input = $("nameInput");
  const name = (input?.value || "").trim();
  if (!name) { input?.focus(); return; }

  const btn = document.querySelector(".modal-btn");
  const original = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  const ok = await setName(name);
  if (btn) { btn.disabled = false; btn.textContent = original; }

  if (!ok) { alert("Could not save your name. Please try again."); return; }
  closeModal("welcomeModal");
}

// ====== MODALS ======
function openModal(id) {
  const el = $(id); if (!el) return;
  el.classList.remove("hidden");
  document.body.classList.add("modal-open");
}
function closeModal(id) {
  const el = $(id); if (!el) return;
  el.classList.add("hidden");
  if (!document.querySelector(".modal-backdrop:not(.hidden)")) {
    document.body.classList.remove("modal-open");
  }
}
function openReview() { openModal("reviewModal"); }
function closeReview() { closeModal("reviewModal"); }

// ====== MODEL ======
async function ensureModel() {
  if (model) return;
  model = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
  maxPredictions = model.getTotalClasses();
}

// ====== UPLOAD → AUTO ANALYZE ======
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
  reader.onload = async () => {
    const img = $("previewImg");
    img.src = reader.result;
    switchState("statePreview");

    await new Promise((resolve) => {
      if (img.complete) return resolve();
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });

    classifyPreview();
  };
  reader.readAsDataURL(file);
}

// ====== ANALYZE ======
async function classifyPreview() {
  if (isBusy) return;
  isBusy = true;

  const btn = $("analyzeBtn");
  const fill = $("waveFill");
  const scanLine = $("scanLine");
  if (btn) {
    btn.classList.add("busy");
    btn.querySelector(".btn-label").textContent = "Analyzing…";
  }
  scanLine?.classList.remove("hidden");

  let progress = 0;
  const tick = setInterval(() => {
    progress = Math.min(progress + Math.random() * 12, 90);
    fill?.style.setProperty("--fill", progress + "%");
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
    fill?.style.setProperty("--fill", "100%");
    setTimeout(() => {
      fill?.style.setProperty("--fill", "0%");
      btn?.classList.remove("busy");
      const label = btn?.querySelector(".btn-label");
      if (label) label.textContent = "Analyze";
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

  // 1. Upload image to Cloudinary
  const confidence = Math.round(top.probability * 100);
  let imageUrl = null;
  try {
    imageUrl = await uploadToCloudinary(dataUrl, top.className, confidence);
    console.log("[cloudinary] uploaded", imageUrl);
  } catch (e) {
    console.warn("[cloudinary] failed", e);
    const note = document.querySelector(".review-note");
    if (note) note.textContent = "⚠ Upload failed — points not applied. Please try again.";
    return;
  }

  // 2. Insert into Supabase (backend owns points now)
  const saved = await saveSubmission({
    label: top.className,
    confidence,
    points: delta,
    image_url: imageUrl,
  });

  if (!saved) {
    console.warn("[supabase] submission not saved, but image is safe:", imageUrl);
    return;
  }

  // 3. Reconcile points directly from backend
  await refreshPoints();
  bumpChip();
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

// ====== SUPABASE INSERT ======
async function saveSubmission({ label, confidence, points, image_url }) {
  const { data, error } = await sb.from("submissions").insert({
    identity: getIdentity(),
    name: getName() || "Guest",
    device_id: getDeviceId(),
    label, confidence, points, image_url,
  }).select();

  if (error) { console.warn("[submission] insert failed", error); return false; }
  console.log("[submission] saved", data);
  return true;
}

// ====== LEADERBOARD (from backend) ======
async function loadLeaderboard() {
  const list = $("lbList");
  if (!list) return;
  list.innerHTML = `<p class="lb-empty">Loading…</p>`;

  const { data, error } = await sb
    .from("leaderboard")
    .select("identity, name, total_points, submissions")
    .order("total_points", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[lb] fetch failed", error);
    list.innerHTML = `<p class="lb-empty">Could not load leaderboard.</p>`;
    return;
  }
  if (!data || data.length === 0) {
    list.innerHTML = `<p class="lb-empty">No submissions yet. Be the first.</p>`;
    return;
  }

  list.innerHTML = "";
  const myDeviceId = getDeviceId();
  let myRank = -1, myRow = null;

  data.forEach((row, i) => {
    const isMe = row.identity?.endsWith(myDeviceId);
    if (isMe) { myRank = i + 1; myRow = row; }

    const el = document.createElement("div");
    el.className = "lb-row";
    el.style.animationDelay = `${i * 40}ms`;
    el.innerHTML = `
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${escapeHtml(row.name)}${isMe ? ' <span style="color:var(--green-700);font-size:0.75rem;">(you)</span>' : ""}</span>
      <span class="lb-pts">${row.total_points > 0 ? "+" : ""}${row.total_points}</span>
      <span class="lb-subs">${row.submissions} scans</span>
    `;
    list.appendChild(el);
  });

  const mineBox = $("lbMine");
  if (mineBox && myRow) {
    mineBox.classList.remove("hidden");
    $("myRank").textContent = myRank;
    $("myName").textContent = myRow.name;
    $("myPts").textContent = (myRow.total_points > 0 ? "+" : "") + myRow.total_points;
    $("mySubs").textContent = myRow.submissions + " scans";
  } else if (mineBox) {
    mineBox.classList.remove("hidden");
    $("myRank").textContent = "—";
    $("myName").textContent = getName() || "Guest";
    $("myPts").textContent = "0";
    $("mySubs").textContent = "0 scans";
  }
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
  $(id)?.classList.remove("hidden");
}
function resetApp() {
  const img = $("previewImg");
  if (img) img.src = "";
  switchState("stateIdle");
}

// Expose for inline onclick
window.triggerUpload = triggerUpload;
window.classifyPreview = classifyPreview;
window.resetApp = resetApp;
window.saveName = saveName;
window.openReview = openReview;
window.closeReview = closeReview;
