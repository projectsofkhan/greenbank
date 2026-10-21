// ====== CONFIG ======
const MODEL_URL = "./";
const DEVICE_KEY = "greenbank.device";
const NAME_KEY   = "greenbank.name";

const CLOUD_NAME    = "fc5nj83m";
const UPLOAD_PRESET = "ml_default";
const CLOUD_FOLDER  = "greenbank";

const SUPABASE_URL      = "https://hfevedbqkjgwycdtranm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZXZlZGJxa2pnd3ljZHRyYW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1Mzk4MDgsImV4cCI6MjEwODExNTgwOH0.RYainvFoFqOe-cF5CcjPPtGa3NJs4PHcqtDaZOrLbHY";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let model = null;
let maxPredictions = 0;
let inFlight = null;
const $ = (id) => document.getElementById(id);

const IS_HOME = !!document.getElementById("pageHome");
const IS_LB   = !!document.getElementById("pageLeaderboard");

// ====== LABEL → POINTS ======
// Robust: matches against the label string, case-insensitive.
// Order matters: "good" wins over "waste" if both appear.
const POINT_RULES = [
  { match: /\bgood\b|\breusable\b|\bclean\b|\borganic\b|\bcompost\b/i, points: -500 },
  { match: /\bwaste\b|\btrash\b|\brubbish\b|\bgarbage\b|\brecycl/i,     points: +100 },
  { match: /\bplastic\b|\bglass\b|\bmetal\b|\bpaper\b|\bcardboard\b/i, points: +100 },
];

function pointsForLabel(label) {
  const clean = String(label || "").trim();
  if (!clean) return 0;
  for (const rule of POINT_RULES) {
    if (rule.match.test(clean)) {
      console.log(`[points] "${clean}" matched ${rule.match} → ${rule.points}`);
      return rule.points;
    }
  }
  console.warn(`[points] "${clean}" did NOT match any rule → 0`);
  return 0;
}

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
  const ins = await sb.from("users").insert({ device_id: deviceId, name });
  if (!ins.error) return true;

  if (ins.error.code === "23505") {
    const upd = await sb.from("users").update({ name }).eq("device_id", deviceId);
    return !upd.error;
  }
  console.warn("[user] insert failed", ins.error);
  return false;
}

// ====== POINTS ======
async function fetchMyTotal() {
  const { data, error } = await sb
    .from("submissions")
    .select("points")
    .eq("device_id", getDeviceId());
  if (error) { console.warn("[points] fetch failed", error); return null; }
  return (data || []).reduce((s, r) => s + (r.points || 0), 0);
}
function renderPoints(v) {
  const el = $("pointsValue"); if (!el) return;
  const val = Number(v ?? 0);
  el.textContent = val > 0 ? `+${val}` : String(val);
}
async function refreshPoints() {
  const total = await fetchMyTotal();
  if (total !== null) renderPoints(total);
  return total ?? 0;
}
function applyPointsLocally(delta) {
  const el = $("pointsValue"); if (!el) return;
  const current = parseInt(el.textContent.replace("+", ""), 10) || 0;
  renderPoints(current + delta);
  bumpChip();
}
function bumpChip() {
  const chip = document.querySelector(".points");
  if (!chip) return;
  chip.classList.add("bump");
  setTimeout(() => chip.classList.remove("bump"), 300);
}

// ====== BOOT ======
document.addEventListener("DOMContentLoaded", async () => {
  renderIdentity();
  $("footerInfo")?.addEventListener("click", openReview);

  if (IS_HOME) {
    $("fileInput")?.addEventListener("change", onFileSelected);
    $("cameraInput")?.addEventListener("change", onFileSelected);

    if (!getName()) {
      openModal("welcomeModal");
      setTimeout(() => $("nameInput")?.focus(), 200);
      $("nameInput")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") saveName();
      });
    }

    const total = await fetchMyTotal();
    if (total !== null) renderPoints(total);
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
  if (model) return model;
  model = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
  maxPredictions = model.getTotalClasses();
  return model;
}

// ====== UPLOAD ======
function triggerUpload() {
  const fileInput = $("fileInput");
  const cameraInput = $("cameraInput");
  if (!fileInput || !cameraInput) return;
  fileInput.value = "";
  cameraInput.value = "";

  if (typeof fileInput.showPicker === "function") {
    try { fileInput.showPicker(); return; } catch (_) {}
  }
  fileInput.click();
}

function onFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (inFlight) { console.warn("[upload] busy — ignoring"); return; }

  const reader = new FileReader();
  reader.onload = async () => {
    const fi = $("fileInput"); if (fi) fi.value = "";
    const ci = $("cameraInput"); if (ci) ci.value = "";

    const img = $("previewImg");
    img.onload = null;
    img.onerror = null;
    img.src = reader.result;

    await new Promise((resolve) => {
      if (img.complete && img.naturalWidth > 0) return resolve();
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });

    switchState("statePreview");
    classifyPreview();
  };
  reader.onerror = () => {
    alert("Could not read the image. Please try another one.");
    const fi = $("fileInput"); if (fi) fi.value = "";
    const ci = $("cameraInput"); if (ci) ci.value = "";
  };
  reader.readAsDataURL(file);
}

// ====== ANALYZE ======
async function classifyPreview() {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const btn = $("analyzeBtn");
    const fill = $("waveFill");
    const scanLine = $("scanLine");

    if (btn) {
      btn.classList.add("busy");
      const l = btn.querySelector(".btn-label");
      if (l) l.textContent = "Analyzing…";
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
      console.error("[analyze]", err);
      alert("Could not analyze this image. Please try again.");
    } finally {
      clearInterval(tick);
      fill?.style.setProperty("--fill", "100%");
      setTimeout(() => {
        fill?.style.setProperty("--fill", "0%");
        btn?.classList.remove("busy");
        const l = btn?.querySelector(".btn-label");
        if (l) l.textContent = "Analyze";
        scanLine?.classList.add("hidden");
      }, 350);
      inFlight = null;
    }
  })();

  return inFlight;
}

// ====== PIPELINE ======
async function handleImage(inputEl, dataUrl) {
  const model = await ensureModel();
  const predictions = await model.predict(inputEl);
  const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
  const top = sorted[0];

  console.log("[classify] top class:", JSON.stringify(top.className), "| confidence:", top.probability);

  const scoresEl = $("scores");
  if (scoresEl) {
    scoresEl.innerHTML = "";
    sorted.forEach((p, i) => {
      const pct = Math.round(p.probability * 100);
      const row = document.createElement("div");
      row.className = "score-row";
      row.style.animationDelay = `${i * 60}ms`;
      row.innerHTML = `
        <span class="score-label">${escapeHtml(p.className)}</span>
        <span class="score-bar"><span class="score-fill" data-pct="${pct}"></span></span>
        <span class="score-pct">${pct}%</span>
      `;
      scoresEl.appendChild(row);
    });
  }

  const verdictEl = $("verdictText");
  if (verdictEl) verdictEl.textContent = `Classified as: ${top.className}`;

  const delta = pointsForLabel(top.className);

  const deltaEl = $("deltaText");
  if (deltaEl) {
    if (delta === 0) {
      deltaEl.textContent = `⚠ Unrecognised label — no points.`;
      deltaEl.classList.add("negative");
    } else {
      deltaEl.textContent = delta > 0 ? `+${delta} points` : `${delta} points`;
      deltaEl.classList.toggle("negative", delta < 0);
    }
  }

  if (delta !== 0) applyPointsLocally(delta);

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

  // Cloudinary (non-blocking)
  let imageUrl = null;
  try {
    imageUrl = await uploadToCloudinary(dataUrl, top.className, confidence);
    console.log("[cloudinary] uploaded:", imageUrl);
  } catch (e) {
    console.warn("[cloudinary] failed:", e);
    const note = document.querySelector(".review-note");
    if (note) note.textContent = "⚠ Image upload failed, but your points were recorded.";
  }

  // Save to Supabase
  const saved = await saveSubmission({
    label: top.className,
    confidence,
    points: delta,
    image_url: imageUrl,
  });
  console.log("[submission] saved:", saved);

  if (saved) await refreshPoints();
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
  const { error } = await sb.from("submissions").insert({
    identity: getIdentity(),
    name: getName() || "Guest",
    device_id: getDeviceId(),
    label, confidence, points, image_url,
  });
  if (error) { console.warn("[submission] insert failed", error); return false; }
  return true;
}

// ====== LEADERBOARD ======
async function loadLeaderboard() {
  const list = $("lbList"); if (!list) return;
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
    const isMe = String(row.identity || "").endsWith(myDeviceId);
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
  if (mineBox) {
    mineBox.classList.remove("hidden");
    if (myRow) {
      $("myRank").textContent = myRank;
      $("myName").textContent = myRow.name;
      $("myPts").textContent = (myRow.total_points > 0 ? "+" : "") + myRow.total_points;
      $("mySubs").textContent = myRow.submissions + " scans";
    } else {
      $("myRank").textContent = "—";
      $("myName").textContent = getName() || "Guest";
      $("myPts").textContent = "0";
      $("mySubs").textContent = "0 scans";
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ====== STATE ======
function switchState(id) {
  ["stateIdle", "statePreview", "stateResult"].forEach((s) => {
    const el = $(s); if (el) el.classList.add("hidden");
  });
  $(id)?.classList.remove("hidden");
}
function resetApp() {
  const img = $("previewImg");
  if (img) { img.onload = null; img.onerror = null; img.src = ""; }
  const fi = $("fileInput"); if (fi) fi.value = "";
  const ci = $("cameraInput"); if (ci) ci.value = "";
  switchState("stateIdle");
}

// Expose for inline onclick
window.triggerUpload = triggerUpload;
window.classifyPreview = classifyPreview;
window.resetApp = resetApp;
window.saveName = saveName;
window.openReview = openReview;
window.closeReview = closeReview;
