// Mobile nav open/close + click-outside-to-close
(() => {
  const toggle = document.getElementById("navToggle");
  const closeBtn = document.getElementById("navClose");
  const panel = document.getElementById("mobileNav");

  if (!toggle || !closeBtn || !panel) return;

  function openNav() {
    panel.classList.add("is-open");
    document.body.classList.add("nav-open");
    toggle.setAttribute("aria-expanded", "true");
    panel.setAttribute("aria-hidden", "false");
  }

  function closeNav() {
    panel.classList.remove("is-open");
    document.body.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
    panel.setAttribute("aria-hidden", "true");
  }

  toggle.addEventListener("click", () => {
    const isOpen = panel.classList.contains("is-open");
    if (isOpen) closeNav();
    else openNav();
  });

  closeBtn.addEventListener("click", closeNav);

  // Close if clicking outside the panel (and not on the hamburger)
  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("is-open")) return;
    const t = e.target;
    if (panel.contains(t)) return;
    if (toggle.contains(t)) return;
    closeNav();
  });

  // Close on ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeNav();
  });

  // Close after tapping a link (nice mobile behaviour)
  panel.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", closeNav);
  });
})();

// Simple CSV demo (preview + quick stats) — browser-only
(() => {
  const fileInput = document.getElementById("fileInput");
  const preview = document.getElementById("preview");
  const stats = document.getElementById("stats");
  const clearBtn = document.getElementById("clearBtn");

  if (!fileInput || !preview || !stats || !clearBtn) return;

  function reset() {
    fileInput.value = "";
    preview.value = "";
    stats.value = "";
  }

  clearBtn.addEventListener("click", reset);

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();

    // Preview: first ~30 lines, trimmed
    const lines = text.split(/\r?\n/);
    preview.value = lines.slice(0, 30).join("\n").slice(0, 4000);

    // Quick stats: rows/cols guess (simple CSV split, not full RFC)
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    const header = nonEmpty[0] ?? "";
    const colCount = header.split(",").length;

    // Exclude header row if present
    const rowCount = Math.max(0, nonEmpty.length - 1);

    stats.value =
      `File: ${file.name}\n` +
      `Approx columns: ${colCount}\n` +
      `Approx data rows: ${rowCount}\n\n` +
      `Next: we’ll add draggable transforms + pipeline steps (still static-hosted).`;
  });
})();
