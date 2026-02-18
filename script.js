// script.js (full)
// - Guided example: local preview of a single CSV
// - Workbench: trim + full join via AutoWeave backend (entries + incomes required, projects optional)

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
  // Workbench: backend trim + full join
  // ---------------------------------

  // Render backend base URL
  const API_BASE = "https://autoweave-backend.onrender.com";

  const projectsFile = document.getElementById("projectsFile"); // optional
  const incomesFile = document.getElementById("incomesFile");   // required
  const entriesFile = document.getElementById("entriesFile");   // required

  const runBtn = document.getElementById("runMergeBtn");
  const resetBtn = document.getElementById("resetAllBtn");

  const statusBox = document.getElementById("statusBox");
  const previewMerged = document.getElementById("previewMerged");
  const statsMerged = document.getElementById("statsMerged");
  const downloadBtn = document.getElementById("downloadBtn");

  // If this page doesn't have workbench elements, do nothing.
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

  function buildCombinedPreviewForCleanedOnly(previews) {
    const p = previews || {};
    const combined =
      `--- time_entries ---\n${p.time_entries_csv ?? ""}\n\n` +
      `--- incomes ---\n${p.incomes_csv ?? ""}\n\n` +
      `--- projects ---\n${p.projects_csv ?? ""}\n`;
    return combined;
  }

  async function runMerge() {
    const entries = entriesFile.files?.[0];
    const incomes = incomesFile.files?.[0];
    const projects = projectsFile?.files?.[0]; // optional

    if (!entries || !incomes) {
      setStatus("Please select at least 2 files: Time entries CSV + Income CSV. (Projects CSV is optional.)");
      return;
    }

    // Reset outputs
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
      setStatus("Running trim + full join on backend…");

      const res = await fetch(`${API_BASE}/api/v1/merge/autotrac`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Backend error (${res.status}). ${text}`);
        return;
      }

      const data = await res.json();

      // Stats
      statsMerged.value = JSON.stringify(data.stats ?? {}, null, 2);

      if (data.mode === "merged") {
        // Preview
        previewMerged.value = (data.preview_csv ?? "").slice(0, 8000);

        // Download button
        const csvText = data.download_csv ?? "";
        const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        downloadBtn.href = url;
        downloadBtn.style.display = "inline-flex";

        const joinKeyInfo =
          data.stats?.after_trim
            ? "Trim OK. Full join completed."
            : "Merge completed.";

        setStatus(joinKeyInfo);
      } else {
        // cleaned_only mode (if backend ever returns it)
        const msg = data.message ?? "No merge performed.";
        setStatus(msg);

        const combined = buildCombinedPreviewForCleanedOnly(data.previews);
        previewMerged.value = combined.slice(0, 8000);
      }
    } catch (err) {
      setStatus(`Request failed: ${err?.message ?? String(err)}`);
    }
  }

  runBtn.addEventListener("click", runMerge);
})();
