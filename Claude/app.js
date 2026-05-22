// Sprachnotiz – Frontend Logik
// Reines Vanilla-JS, ohne Frameworks.

const els = {
  dropZone: document.getElementById("drop-zone"),
  fileInput: document.getElementById("file-input"),
  preview: document.getElementById("file-preview"),
  fileName: document.getElementById("file-name"),
  fileSub: document.getElementById("file-sub"),
  audioPlayer: document.getElementById("audio-player"),
  processBtn: document.getElementById("process-btn"),
  resetBtn: document.getElementById("reset-btn"),

  uploadSection: document.getElementById("upload-section"),
  progressSection: document.getElementById("progress-section"),
  progressTitle: document.getElementById("progress-title"),
  progressSub: document.getElementById("progress-sub"),

  resultsSection: document.getElementById("results-section"),
  summaryDetailed: document.getElementById("summary-detailed"),
  summaryCompact: document.getElementById("summary-compact"),
  summaryBullets: document.getElementById("summary-bullets"),
  transcriptBody: document.getElementById("transcript-body"),
  shareBtn: document.getElementById("share-btn"),
  newBtn: document.getElementById("new-btn"),

  errorSection: document.getElementById("error-section"),
  errorBody: document.getElementById("error-body"),
  errorRetry: document.getElementById("error-retry"),

  toast: document.getElementById("toast"),
};

const state = {
  file: null,
  audioUrl: null,
  result: null,
};

// ---------- Utilities ----------

function showToast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  // force reflow so transition runs
  void els.toast.offsetWidth;
  els.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    els.toast.classList.remove("show");
    setTimeout(() => (els.toast.hidden = true), 320);
  }, 1800);
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function setSection(view) {
  els.uploadSection.hidden = view !== "upload";
  els.progressSection.hidden = view !== "progress";
  els.resultsSection.hidden = view !== "results";
  els.errorSection.hidden = view !== "error";
}

// ---------- File handling ----------

function setFile(file) {
  if (!file) return;
  if (!/^audio\//.test(file.type) && !/\.(ogg|opus|m4a|mp3|wav|aac|webm|mp4|mpga|mpeg|flac)$/i.test(file.name)) {
    showError(
      "Datei-Format nicht erkannt",
      "Bitte lade eine Audio-Datei hoch (z. B. .ogg, .m4a, .mp3, .wav)."
    );
    return;
  }

  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.file = file;
  state.audioUrl = URL.createObjectURL(file);

  els.fileName.textContent = file.name || "Sprachnachricht";
  els.fileSub.textContent = `${formatBytes(file.size)} · lädt …`;
  els.audioPlayer.src = state.audioUrl;

  els.audioPlayer.onloadedmetadata = () => {
    els.fileSub.textContent = `${formatBytes(file.size)} · ${formatDuration(els.audioPlayer.duration)}`;
  };

  els.preview.hidden = false;
  els.dropZone.style.display = "none";
  els.processBtn.disabled = false;
  els.processBtn.focus({ preventScroll: true });
}

function resetAll() {
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.file = null;
  state.audioUrl = null;
  state.result = null;
  els.fileInput.value = "";
  els.audioPlayer.removeAttribute("src");
  els.audioPlayer.load();
  els.preview.hidden = true;
  els.dropZone.style.display = "";
  setSection("upload");
}

// ---------- Drag & Drop ----------

["dragenter", "dragover"].forEach((evt) => {
  els.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((evt) => {
  els.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.dropZone.classList.remove("dragging");
  });
});

els.dropZone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) setFile(file);
});

// Drag&Drop auch global verhindern (sonst öffnet Browser die Datei)
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

// ---------- File input ----------

els.fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) setFile(file);
});

// Tap auf drop-zone öffnet picker
els.dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    els.fileInput.click();
  }
});

// ---------- Paste ----------

document.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) =>
    i.type.startsWith("audio/")
  );
  if (item) {
    const file = item.getAsFile();
    if (file) setFile(file);
  }
});

// ---------- Reset / Other File ----------

els.resetBtn.addEventListener("click", resetAll);
els.newBtn.addEventListener("click", resetAll);
els.errorRetry.addEventListener("click", () => {
  setSection(state.file ? "upload" : "upload");
});

// ---------- Process ----------

els.processBtn.addEventListener("click", async () => {
  if (!state.file) return;
  await processFile(state.file);
});

async function processFile(file) {
  setSection("progress");

  els.progressTitle.textContent = "Transkribiere …";
  els.progressSub.textContent = "Whisper hört zu";

  const formData = new FormData();
  formData.append("audio", file, file.name || "audio");

  try {
    const res = await fetch("/api/process", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      let detail = "";
      try {
        const j = await res.json();
        detail = j.error || j.message || "";
      } catch {}
      throw new Error(detail || `Verarbeitung fehlgeschlagen (HTTP ${res.status})`);
    }

    els.progressTitle.textContent = "Fasse zusammen …";
    els.progressSub.textContent = "Letzte Schritte";

    const data = await res.json();
    state.result = data;
    renderResult(data);
    setSection("results");
  } catch (err) {
    console.error(err);
    showError("Verarbeitung fehlgeschlagen", err.message || String(err));
  }
}

// ---------- Render result ----------

function renderResult(data) {
  const detailed = (data.detailed || "").trim();
  const compact = (data.compact || "").trim();
  const bullets = Array.isArray(data.bullets) ? data.bullets : [];
  const transcript = (data.transcript || "").trim();

  els.summaryDetailed.innerHTML = paragraphsToHtml(detailed);
  els.summaryCompact.innerHTML = paragraphsToHtml(compact);

  els.summaryBullets.innerHTML = "";
  bullets.slice(0, 3).forEach((b) => {
    const li = document.createElement("li");
    li.textContent = String(b).trim().replace(/^[-•·]\s*/, "");
    els.summaryBullets.appendChild(li);
  });

  els.transcriptBody.textContent = transcript;

  if (navigator.share) {
    els.shareBtn.hidden = false;
  }
}

function paragraphsToHtml(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------- Copy buttons ----------

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".copy-btn");
  if (!btn) return;

  const targetId = btn.dataset.target;
  const target = document.getElementById(targetId);
  if (!target) return;

  let text = "";
  if (target.tagName === "UL") {
    text = [...target.querySelectorAll("li")]
      .map((li) => `• ${li.textContent.trim()}`)
      .join("\n");
  } else {
    text = target.innerText.trim();
  }

  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add("copied");
    showToast("Kopiert");
    setTimeout(() => btn.classList.remove("copied"), 1400);
  } catch {
    showToast("Kopieren nicht möglich");
  }
});

// ---------- Share ----------

els.shareBtn.addEventListener("click", async () => {
  if (!state.result) return;
  const text = buildShareText(state.result);
  try {
    await navigator.share({
      title: "Sprachnotiz",
      text,
    });
  } catch (err) {
    if (err && err.name !== "AbortError") showToast("Teilen nicht möglich");
  }
});

function buildShareText(r) {
  const lines = [];
  lines.push("Zusammenfassung der Sprachnachricht");
  lines.push("");
  lines.push("Ausführlich:");
  lines.push(r.detailed || "");
  lines.push("");
  lines.push("Kompakt:");
  lines.push(r.compact || "");
  lines.push("");
  lines.push("Auf den Punkt:");
  (r.bullets || []).forEach((b) => lines.push(`• ${b}`));
  return lines.join("\n");
}

// ---------- Errors ----------

function showError(title, body) {
  els.errorBody.textContent = body || "Bitte versuche es erneut.";
  document.querySelector("#error-section .error-title").textContent = title || "Fehler";
  setSection("error");
}

// ---------- Service Worker + Share Target ----------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => console.warn("SW registration failed:", err));
  });
}

// Beim Laden prüfen, ob über Share Target eine Datei reinkam.
// Der Service-Worker legt sie im Cache "shared-audio" mit URL /__shared-audio ab.
async function checkSharedAudio() {
  const params = new URLSearchParams(location.search);
  if (params.get("shared") !== "1") return;

  try {
    const cache = await caches.open("shared-audio");
    const response = await cache.match("/__shared-audio");
    if (!response) return;

    const blob = await response.blob();
    const filename = response.headers.get("X-Filename") || "geteilte-aufnahme.audio";
    const file = new File([blob], filename, { type: blob.type || "audio/ogg" });

    // Cache leeren
    await cache.delete("/__shared-audio");

    // URL säubern
    history.replaceState({}, "", "/");

    setFile(file);
    // Automatisch starten — der typische "Teilen"-Flow
    setTimeout(() => processFile(file), 400);
  } catch (err) {
    console.warn("Shared audio konnte nicht geladen werden:", err);
  }
}

window.addEventListener("DOMContentLoaded", checkSharedAudio);
