// script.js (updated)

// -----------------------------
// Guided example: local preview
// -----------------------------
(() => {
  const fileInput = document.getElementById("guidedFileInput");
  const preview = document.getElementById("guidedPreview");
  const clearBtn = document.getElementById("guidedClearBtn");

  if (!fileInput || !preview || !clearBtn) return;

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
})();

// ---------------------------------
// Workbench: 3-file backend merge
// ---------------------------------
(() => {
  // Change this if you want to point at a different environment
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
    !projectsFile || !incomesFile || !entriesFile ||
    !runBtn || !resetBtn ||
    !statusBox || !previewMerged || !statsMerged || !downloadBtn
  ) return;

  function setStatus(msg) {
    statusBox.value = msg;
  }

  function resetAll() {
    projectsFile.value = "";
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
    const f1 = projectsFile.files?.[0];
    const f2 = incomesFile.files?.[0];
    const f3 = entriesFile.files?.[0];

    if (!f1 || !f2 || !f3) {
      setStatus("Please select all 3 files: Project CSV, Income CSV, Time entries CSV.");
      return;
    }

    downloadBtn.style.display = "none";
    downloadBtn.removeAttribute("href");

    previewMerged.value = "";
    statsMerged.value = "";
    setStatus("Uploading files…");

    const form = new FormData();
    form.append("projects_csv", f1);
    form.append("incomes_csv", f2);
    form.append("time_entries_csv", f3);

    try {
      setStatus("Running merge on backend…");

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
        previewMerged.value = (data.preview_csv ?? "").slice(0, 8000);

        // Enable download (CSV text -> Blob -> link)
        const csvText = data.download_csv ?? "";
        const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        downloadBtn.href = url;
        downloadBtn.style.display = "inline-flex";

        setStatus(
          `Merged OK. join_key_used=${data.stats?.join_key_used ?? "unknown"}`
        );
      } else {
        // cleaned_only mode
        const msg = data.message ?? "No merge performed.";
        setStatus(msg);

        const previews = data.previews ?? {};
        const combined =
          `--- projects ---\n${previews.projects_csv ?? ""}\n\n` +
          `--- incomes ---\n${previews.incomes_csv ?? ""}\n\n` +
          `--- time_entries ---\n${previews.time_entries_csv ?? ""}\n`;

        previewMerged.value = combined.slice(0, 8000);
      }
    } catch (err) {
      setStatus(`Request failed: ${err?.message ?? String(err)}`);
    }
  }

  runBtn.addEventListener("click", runMerge);
})();
