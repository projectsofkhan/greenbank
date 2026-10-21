const URL = "./my_model/";
const POINTS_KEY = "greenbank.points";
const WASTE_CLASS = "Waste";          // +100
const GOOD_CLASS = "Good Material";   // -500

let model, webcam, maxPredictions;

const $ = (id) => document.getElementById(id);

// Load points on boot
document.addEventListener("DOMContentLoaded", () => {
  renderPoints();
});

function getPoints() {
  return parseInt(localStorage.getItem(POINTS_KEY) || "0", 10);
}

function setPoints(v) {
  localStorage.setItem(POINTS_KEY, String(v));
  renderPoints();
}

function renderPoints() {
  const el = $("pointsValue");
  const v = getPoints();
  el.textContent = v > 0 ? `+${v}` : v;
}

async function startApp() {
  try {
    if (!model) {
      const modelURL = URL + "model.json";
      const metadataURL = URL + "metadata.json";
      model = await tmImage.load(modelURL, metadataURL);
      maxPredictions = model.getTotalClasses();
    }

    webcam = new tmImage.Webcam(300, 300, true);
    await webcam.setup();
    await webcam.play();

    const container = $("webcam-container");
    container.innerHTML = "";
    container.appendChild(webcam.canvas);

    $("stateIdle").classList.add("hidden");
    $("stateResult").classList.add("hidden");
    $("stateCamera").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    alert("Could not start the camera. Please allow camera access and try again.");
  }
}

async function capture() {
  webcam.update();

  const predictions = await model.predict(webcam.canvas);
  // sort desc
  const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
  const top = sorted[0];

  // Render percentages
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

  // Verdict
  $("resultTitle").textContent = "Result";
  $("verdictText").textContent = `Classified as: ${top.className}`;

  // Points
  const delta = top.className === WASTE_CLASS ? +100 :
                top.className === GOOD_CLASS ? -500 : 0;
  setPoints(getPoints() + delta);

  const deltaEl = $("deltaText");
  deltaEl.textContent = delta > 0 ? `+${delta} points` : `${delta} points`;
  deltaEl.classList.toggle("negative", delta < 0);

  // Animate the can door
  const door = $("canDoor");
  door.classList.add("open");
  setTimeout(() => door.classList.remove("open"), 900);

  // Swap state
  $("stateCamera").classList.add("hidden");
  $("stateResult").classList.remove("hidden");
}

function resetApp() {
  if (webcam) {
    try { webcam.stop(); } catch (_) {}
    webcam = null;
  }
  $("webcam-container").innerHTML = "";
  $("stateCamera").classList.add("hidden");
  $("stateResult").classList.add("hidden");
  $("stateIdle").classList.remove("hidden");
}
