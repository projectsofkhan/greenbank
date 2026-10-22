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
let modelPromise = null;
let inFlight = null;
let analysisAborted = false;
const $ = (id) => document.getElementById(id);

const IS_HOME = !!document.getElementById("pageHome");
const IS_LB   = !!document.getElementById("pageLeaderboard");

// ====== LABEL → POINTS (mirrors SQL trigger) ======
function normalizeLabel(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s\u00A0\u2000-\u200B]+/g, " ")
    .toLowerCase()
    .trim();
}

const WASTE_RE = /waste|trash|rubbish|garbage|recycl|plastic|glass|metal|paper|cardboard/;
const GOOD_RE  = /good|reusable|clean|organic|compost/;

function pointsForLabel(label) {
  const clean = normalizeLabel(label);
  if (!clean) return 0;
  if (WASTE_RE.test(clean)) return +100;
  if (GOOD_RE.test(clean))  return -500;
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
function getDisplayName() { return getName() || "Guest"; }
function getIdentity() { return getDeviceId(); }

function renderIdentity() {
  const nameEl = $("userName"), idEl = $("userId");
  if (nameEl) nameEl.textContent = getDisplayName();
  if (idEl) idEl.textContent = "-" + getDeviceId();
}

// ====== USER ======
async function setName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return false;
  const previous = getName();
  localStorage.setItem(NAME_KEY, trimmed);
  renderIdentity();

  const deviceId = getDeviceId();
  const { error: upsertErr } = await sb
    .from("users")
    .upsert({ device_id: deviceId, name: trimmed }, { onConflict: "device_id" });

  if (upsertErr) {
    localStorage.setItem(NAME_KEY, previous);
    renderIdentity();
    return false;
  }

  if (previous && previous !== trimmed) {
    const { error: updErr } = await sb
      .from("submissions")
      .update({ name: trimmed })
      .eq("device_id", deviceId);
    if (updErr) console.warn("[rename] submission update failed", updErr);
  }
  return true;
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

function formatPoints(v) {
  const n = Number(v);
  if (isNaN(n)) return "—";
  return n > 0 ? `+${n}` : String(n);
}

function renderPoints(v) {
  const el = $("pointsValue"); if (!el) return;
  el.textContent = formatPoints(v);
}

async function refreshPoints() {
  const total = await fetchMyTotal();
  if (total !== null) renderPoints(total);
  return total ?? 0;
}

function addToChip(delta) {
  const el = $("pointsValue"); if (!el) return;
  const raw = el.textContent.trim();
  const current = raw === "—" ? 0 : parseInt(raw.replace(/^[+]/, ""), 10);
  const next = (isNaN(current) ? 0 : current) + delta;
  renderPoints(next);
  animateChip();
}

function animateChip() {
  const chip = document.getElementById("pointsChip") || document.querySelector(".points");
  if (!chip) return;
  chip.classList.remove("bump");
  void chip.offsetWidth;
  chip.classList.add("bump");
  setTimeout(() => chip.classList.remove("bump"), 500);
}

// ====== BOOT ======
document.addEventListener("DOMContentLoaded", async () => {
  renderIdentity();
  $("footerInfo")?.addEventListener("click", openReview);

  refreshPoints();

  if (IS_HOME) {
    $("fileInput")?.addEventListener("change", onFileSelected);
    $("cameraInput")?.addEventListener("change", onFileSelected);

    if (!getName()) {
      openModal("welcomeModal");
      setTimeout(() => $("nameInput")?.focus(), 200);
      const input = $("nameInput");
      if (input) input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") saveName();
      });
    }
  }

  if (IS_LB) loadLeaderboard();

  document.querySelectorAll(".modal-backdrop").forEach((bd) => {
    bd.addEventListener("click", (e) => {
      if (e.target === bd && bd.id !== "welcomeModal") closeModal(bd.id);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop:not(.hidden)").forEach((bd) => {
        if (bd.id !== "welcomeModal") closeModal(bd.id);
      });
    }
  });
});

async function saveName() {
  const input = $("nameInput");
  const name = (input?.value || "").trim();
  if (!name) { input?.focus(); return; }
  const btn = document.querySelector("#welcomeModal .modal-btn");
  const original = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  const ok = await setName(name);
  if (btn) { btn.disabled = false; btn.textContent = original; }
  if (!ok) { alert("Could not save your name. Please try again."); return; }
  closeModal("welcomeModal");
}

function skipName() {
  if (!getName()) {
    localStorage.setItem(NAME_KEY, "Guest");
    renderIdentity();
  }
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
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    try {
      model = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
      return model;
    } catch (e) {
      modelPromise = null;
      throw e;
    }
  })();
  return modelPromise;
}

// ====== UPLOAD ======
function triggerUpload() {
  const fileInput = $("fileInput");
  if (!fileInput) return;
  // Removed fileInput.value = "" from here. 
  // Clearing it right before opening the picker causes mobile browsers to cancel.
  fileInput.click();
}

function onFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (inFlight) return;

  const reader = new FileReader();
  reader.onload = async () => {
    // NOW we clear the inputs safely
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
  analysisAborted = false;

  inFlight = (async () => {
    const btn = $("analyzeBtn");
    const fill = $("waveFill");
    const scanLine = $("scanLine");
    const pctEl = $("analyzePct");
    const labelEl = $("analyzeLabel");

    if (btn) btn.classList.add("busy");
    if (labelEl) labelEl.textContent = "Analyzing";
    if (pctEl) pctEl.textContent = "0%";
    scanLine?.classList.remove("hidden");
    fill?.style.setProperty("--fill", "0%");

    let progress = 0;
    let progressTarget = 0;
    const tick = setInterval(() => {
      if (analysisAborted) return;
      progress += Math.max(0.4, (progressTarget - progress) * 0.12);
      if (progress > progressTarget) progress = progressTarget;
      if (progress > 99) progress = 99;
      fill?.style.setProperty("--fill", progress + "%");
      if (pctEl) pctEl.textContent = Math.floor(progress) + "%";
    }, 40);

    try {
      progressTarget = 20;
      await ensureModel();
      if (analysisAborted) throw new Error("aborted");

      progressTarget = 70;
      const img = $("previewImg");
      if (!img.complete) {
        await new Promise((r) => {
          img.onload = r;
          img.onerror = r;
        });
      }
      if (analysisAborted) throw new Error("aborted");

      const predictions = await ensureModel().then((m) => m.predict(img));
      if (analysisAborted) throw new Error("aborted");

      progressTarget = 100;
      await animateTo100(fill, pctEl);
      await wait(220);

      if (analysisAborted) throw new Error("aborted");

      await revealResult(predictions, img.src);
    } catch (err) {
      if (err.message === "aborted") {
        console.log("[analyze] cancelled by user");
      } else {
        console.error("[analyze] ERROR:", err);
        alert("Could not analyze this image. Please try again.");
      }
    } finally {
      clearInterval(tick);
      setTimeout(() => {
        fill?.style.setProperty("--fill", "0%");
        if (pctEl) pctEl.textContent = "";
        if (labelEl) labelEl.textContent = "Analyze";
        btn?.classList.remove("busy");
        scanLine?.classList.add("hidden");
      }, 400);
      inFlight = null;
    }
  })();

  return inFlight;
}

function animateTo100(fill, pctEl) {
  return new Promise((resolve) => {
    let p = 70;
    const step = () => {
      p += 2.5;
      if (p >= 100) {
        fill?.style.setProperty("--fill", "100%");
        if (pctEl) pctEl.textContent = "100%";
        resolve();
        return;
      }
      fill?.style.setProperty("--fill", p + "%");
      if (pctEl) pctEl.textContent = Math.floor(p) + "%";
      setTimeout(step, 30);
    };
    step();
  });
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ====== RESULT REVEAL ======
async function revealResult(predictions, dataUrl) {
  const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
  const top = sorted[0];
  const label = String(top.className || "");
  const confidence = Math.round(top.probability * 100);
  const delta = pointsForLabel(label);

  const scoresEl = $("scores");
  if (scoresEl) {
    scoresEl.innerHTML = "";
    sorted.forEach((p, i) => {
      const pct = Math.round(p.probability * 100);
      const row = document.createElement("div");
      row.className = "score-row";
      row.style.animationDelay = `${i * 80}ms`;
      row.innerHTML = `
        <span class="score-label">${escapeHtml(p.className)}</span>
        <span class="score-bar"><span class="score-fill" data-pct="${pct}"></span></span>
        <span class="score-pct">${pct}%</span>
      `;
      scoresEl.appendChild(row);
    });
  }

  const verdictEl = $("verdictText");
  if (verdictEl) verdictEl.textContent = `Classified as: ${label}`;

  const deltaEl = $("deltaText");
  if (deltaEl) {
    deltaEl.classList.remove("negative", "positive");
    if (delta === 0) {
      deltaEl.textContent = `⚠ Unrecognised label — no points.`;
      deltaEl.classList.add("negative");
    } else {
      deltaEl.textContent = delta > 0 ? `+${delta} points` : `${delta} points`;
      deltaEl.classList.add(delta < 0 ? "negative" : "positive");
    }
  }

  animateCan();
  switchState("stateResult");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll(".score-fill").forEach((el) => {
        el.style.width = el.dataset.pct + "%";
      });
    });
  });

  if (delta !== 0) addToChip(delta);

  showSaveStatus("saving");
  let savedOk = false;
  try {
    let imageUrl = null;
    try {
      imageUrl = await uploadToCloudinary(dataUrl, label, confidence);
    } catch (e) {
      console.warn("[cloudinary] failed:", e);
    }
    savedOk = await saveSubmission({
      label,
      confidence,
      points: 0,
      image_url: imageUrl,
    });
  } catch (e) {
    console.warn("[save] failed:", e);
  }

  if (savedOk) {
    showSaveStatus("saved");
    refreshPoints();
  } else {
    showSaveStatus("error");
    if (delta !== 0) addToChip(-delta);
  }
}

function showSaveStatus(state) {
  const el = $("saveStatus");
  if (!el) return;
  el.classList.remove("hidden", "saving", "saved", "error");
  if (state === "saving") {
    el.classList.add("saving");
    el.textContent = "Saving…";
  } else if (state === "saved") {
    el.classList.add("saved");
    el.textContent = "✓ Saved";
    setTimeout(() => el.classList.add("hidden"), 1600);
  } else {
    el.classList.add("error");
    el.textContent = "⚠ Not saved — try again";
  }
}

function animateCan() {
  const can = $("can");
  if (!can) return;
  can.classList.remove("pulse");
  void can.offsetWidth;
  can.classList.add("pulse");
  setTimeout(() => can.classList.remove("pulse"), 900);

  const door = $("canDoor");
  if (!door) return;
  door.classList.add("open");
  setTimeout(() => door.classList.remove("open"), 1000);
}

// ====== CANCEL ======
function cancelAnalysis() {
  if (inFlight) {
    analysisAborted = true;
    const fill = $("waveFill");
    const pctEl = $("analyzePct");
    const labelEl = $("analyzeLabel");
    const btn = $("analyzeBtn");
    fill?.style.setProperty("--fill", "0%");
    if (pctEl) pctEl.textContent = "";
    if (labelEl) labelEl.textContent = "Analyze";
    btn?.classList.remove("busy");
    $("scanLine")?.classList.add("hidden");
  }
  resetApp();
}

// ====== CLOUDINARY ======
async function uploadToCloudinary(dataUrl, label, confidence) {
  const identity = getIdentity();
  const name = getDisplayName();
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
  const payload = {
    identity: getIdentity(),
    name: getDisplayName(),
    device_id: getDeviceId(),
    label, confidence, points, image_url,
  };
  const { error } = await sb.from("submissions").insert(payload);
  if (error) { console.warn("[submission] insert failed:", error); return false; }
  return true;
}

// ====== LEADERBOARD ======
async function loadLeaderboard() {
  const list = $("lbList"); if (!list) return;
  list.innerHTML = `<p class="lb-empty">Loading…</p>`;

  const { data, error } = await sb
    .from("leaderboard")
    .select("name, total_points, submissions")
    .order("total_points", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[lb] fetch failed", error);
    list.innerHTML = `<p class="lb-empty">Could not load leaderboard. <button class="btn ghost" onclick="loadLeaderboard()">Retry</button></p>`;
    return;
  }
  if (!data || data.length === 0) {
    list.innerHTML = `<p class="lb-empty">No submissions yet. Be the first.</p>`;
    return;
  }

  list.innerHTML = "";
  const myName = getDisplayName();
  let myRank = -1, myRow = null;

  data.forEach((row, i) => {
    const isMe = row.name === myName;
    if (isMe && myRank === -1) { myRank = i + 1; myRow = row; }

    const el = document.createElement("div");
    el.className = "lb-row";
    el.style.animationDelay = `${i * 40}ms`;
    el.innerHTML = `
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${escapeHtml(row.name)}${isMe ? ' <span style="color:var(--green-700);font-size:0.75rem;">(you)</span>' : ""}</span>
      <span class="lb-pts">${formatPoints(row.total_points)}</span>
      <span class="lb-subs">${row.submissions} ${row.submissions === 1 ? "scan" : "scans"}</span>
    `;
    list.appendChild(el);
  });

  const mineBox = $("lbMine");
  if (mineBox) {
    mineBox.classList.remove("hidden");
    if (myRow) {
      $("myRank").textContent = myRank;
      $("myName").textContent = myRow.name;
      $("myPts").textContent = formatPoints(myRow.total_points);
      $("mySubs").textContent = `${myRow.submissions} ${myRow.submissions === 1 ? "scan" : "scans"}`;
    } else {
      $("myRank").textContent = "—";
      $("myName").textContent = myName;
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
  const status = $("saveStatus"); if (status) status.classList.add("hidden");
  switchState("stateIdle");
}

// Expose for inline onclick
window.triggerUpload = triggerUpload;
window.classifyPreview = classifyPreview;
window.resetApp = resetApp;
window.cancelAnalysis = cancelAnalysis;
window.saveName = saveName;
window.skipName = skipName;
window.openReview = openReview;
window.closeReview = closeReview;
window.loadLeaderboard = loadLeaderboard;