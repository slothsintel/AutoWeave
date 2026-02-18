// script.js (full)
// - Guided example: local preview of a single CSV
// - Workbench: trim + aggregate + full join via AutoWeave backend

(() => {
  // -----------------------------
  // Guided example: local preview
  // -----------------------------
  const fileInput = document.getElementById("guidedFileInput");
  const preview = document.getElementById("guidedPreview");
  const clearBtn = document.getElementById("guidedClearBtn");

  if (fileInput && preview && clearBtn) {
    function reset() {
      fileInput.value = "";
      preview.value = "";
    }

    clearBtn.addEventListener("click", reset);

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const text = await file.text();
      const lines = text.split(/\r?\n/);
      preview.value = lines.slice(0, 30).join("\n").slice(0, 4000);
    });
  }
})();

(() => {
  // ---------------------------------
  // Workbench: backend merge
  // ---------------------------------

  const API_BASE = "https://autoweave-backend.onrender.com";

  const projectsFile = document.getElementById("projectsFile");
  const incomesFile = document.getElementById("incomesFile");
  const entriesFile = document.getElementById("entriesFile");

  const runBtn = document.getElementById("runMergeBtn");
  const resetBtn = document.getElementById("resetAllBtn");

  const statusBox = document.getElementById("statusBox");
  const previewMerged = document.getElementById("previewMerged");
  const statsMerged = document.getElementById("statsMerged");
  const downloadBtn = document.getElementById("downloadBtn");

  if (
    !incomesFile || !entriesFile ||
    !runBtn || !resetBtn ||
    !statusBox || !previewMerged || !statsMerged || !downloadBtn
  ) return;

  function setStatus(msg) {
    statusBox.value = msg;
  }

  function resetAll() {
    if (projectsFile) projectsFile.value = "";
    incomesFile.value = "";
    entriesFile.value = "";

    previewMerged.value = "";
    statsMerged.value = "";
    setStatus("");

    downloadBtn.style.display = "none";
    downloadBtn.removeAttribute("href");
  }

  resetBtn.addEventListener("click", resetAll);

  async function runMerge() {
    const entries = entriesFile.files?.[0];
    const incomes = incomesFile.files?.[0];
    const projects = projectsFile?.files?.[0];

    if (!entries || !incomes) {
      setStatus("Please select at least 2 files: Time entries CSV + Income CSV. (Projects CSV optional.)");
      return;
    }

    downloadBtn.style.display = "none";
    downloadBtn.removeAttribute("href");
    previewMerged.value = "";
    statsMerged.value = "";

    setStatus("Uploading files…");

    const form = new FormData();
    form.append("time_entries_csv", entries);
    form.append("incomes_csv", incomes);
    if (projects) form.append("projects_csv", projects);

    try {
      setStatus("Processing…");

      const res = await fetch(`${API_BASE}/api/v1/merge/autotrac`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Backend error (${res.status}): ${text}`);
        return;
      }

      const data = await res.json();

      // Always show stats
      statsMerged.value = JSON.stringify(data.stats ?? {}, null, 2);

      // ✅ SUCCESS = backend returned a CSV
      if (typeof data.download_csv === "string" && data.download_csv.length > 0) {

        previewMerged.value = (data.preview_csv ?? "").slice(0, 8000);

        const blob = new Blob([data.download_csv], {
          type: "text/csv;charset=utf-8"
        });

        const url = URL.createObjectURL(blob);

        downloadBtn.href = url;
        downloadBtn.style.display = "inline-flex";

        setStatus(`Done ✔ (${data.mode ?? "ok"})`);
      } else {
        setStatus(`No output returned. mode=${data.mode ?? "unknown"}`);
      }

    } catch (err) {
      setStatus(`Request failed: ${err?.message ?? String(err)}`);
    }
  }

  runBtn.addEventListener("click", runMerge);
})();
