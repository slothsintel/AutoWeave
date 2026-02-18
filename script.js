// script.js (full)
// - Guided example: local preview of a single CSV
// - Workbench: calls AutoWeave backend, renders preview/stats
// - Enhancements (no tech.html changes required):
//   Quick stats: row count, totals, ratios, per-project breakdowns
//   Visualisations: 3 stacked bar charts by date (income, duration, income/duration)
//   Charts use user-provided color palette for project stacks

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
  // Helpers: CSV parsing + math
  // ---------------------------------

  function parseCsvLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
        continue;
      }

      cur += ch;
    }
    out.push(cur);
    return out;
  }

  function parseCsv(text) {
    const lines = text
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);

    if (lines.length === 0) return { header: [], rows: [] };

    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const row = {};
      for (let j = 0; j < header.length; j++) {
        row[header[j]] = (cols[j] ?? "").trim();
      }
      rows.push(row);
    }

    return { header, rows };
  }

  function toNumber(x) {
    if (x == null) return 0;
    const s = String(x).trim();
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function safeDiv(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
    return a / b;
  }

  function formatNumber(n, digits = 2) {
    const nf = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
    return nf.format(Number.isFinite(n) ? n : 0);
  }

  function formatInt(n) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
      Number.isFinite(n) ? n : 0
    );
  }

  function sortIsoDates(dates) {
    return [...dates].sort((a, b) => String(a).localeCompare(String(b)));
  }

  // Income metric selector:
  // prefer amount_gbp if there is any non-empty amount_gbp in dataset; otherwise use amount
  function chooseIncomeAccessor(rows) {
    const anyGbp = rows.some((r) => (r.amount_gbp ?? "").toString().trim() !== "");
    return {
      label: anyGbp ? "amount_gbp" : "amount",
      get: (r) => toNumber(anyGbp ? r.amount_gbp : r.amount),
    };
  }

  // ---------------------------------
  // Helpers: DOM injection (no HTML changes)
  // ---------------------------------

  function ensureStatsPanel(statsTextarea) {
    const formRow = statsTextarea.closest(".form-row") || statsTextarea.parentElement;
    if (!formRow) return null;

    const existing = formRow.querySelector("#owStatsPanel");
    if (existing) return existing;

    const panel = document.createElement("div");
    panel.id = "owStatsPanel";
    panel.style.display = "grid";
    panel.style.gap = "0.85rem";
    panel.style.marginBottom = "0.85rem";

    formRow.insertBefore(panel, statsTextarea);
    return panel;
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function makeSummaryGrid(items) {
    const wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = "repeat(4, minmax(0, 1fr))";
    wrap.style.gap = "0.75rem";

    for (const it of items) {
      const box = document.createElement("div");
      box.style.border = "1px solid rgba(15,31,23,0.10)";
      box.style.background = "rgba(255,255,255,0.92)";
      box.style.borderRadius = "14px";
      box.style.padding = "0.6rem 0.75rem";

      const k = document.createElement("div");
      k.textContent = it.k;
      k.style.fontSize = "0.75rem";
      k.style.letterSpacing = "0.03em";
      k.style.textTransform = "uppercase";
      k.style.opacity = "0.7";

      const v = document.createElement("div");
      v.textContent = it.v;
      v.style.marginTop = "0.25rem";
      v.style.fontSize = "1.05rem";
      v.style.fontWeight = "700";
      v.style.fontVariantNumeric = "tabular-nums";

      box.appendChild(k);
      box.appendChild(v);
      wrap.appendChild(box);
    }
    return wrap;
  }

  function makeMiniTable(title, rows, { col1 = "Project", col2 = "Value" } = {}) {
    const wrap = document.createElement("div");
    wrap.style.border = "1px solid rgba(15,31,23,0.10)";
    wrap.style.background = "rgba(255,255,255,0.92)";
    wrap.style.borderRadius = "14px";
    wrap.style.padding = "0.75rem";

    const h = document.createElement("div");
    h.textContent = title;
    h.style.fontWeight = "700";
    h.style.marginBottom = "0.5rem";
    wrap.appendChild(h);

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.fontSize = "0.9rem";

    const thead = document.createElement("thead");
    const trh = document.createElement("tr");

    const th1 = document.createElement("th");
    th1.textContent = col1;
    th1.style.textAlign = "left";
    th1.style.padding = "0.35rem 0";
    th1.style.opacity = "0.7";

    const th2 = document.createElement("th");
    th2.textContent = col2;
    th2.style.textAlign = "right";
    th2.style.padding = "0.35rem 0";
    th2.style.opacity = "0.7";

    trh.appendChild(th1);
    trh.appendChild(th2);
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    rows.forEach((r, idx) => {
      const tr = document.createElement("tr");
      if (idx > 0) tr.style.borderTop = "1px solid rgba(15,31,23,0.08)";

      const td1 = document.createElement("td");
      td1.textContent = r.name;
      td1.style.padding = "0.35rem 0";
      td1.style.maxWidth = "280px";
      td1.style.overflow = "hidden";
      td1.style.textOverflow = "ellipsis";
      td1.style.whiteSpace = "nowrap";

      const td2 = document.createElement("td");
      td2.textContent = r.value;
      td2.style.padding = "0.35rem 0";
      td2.style.textAlign = "right";
      td2.style.fontVariantNumeric = "tabular-nums";

      tr.appendChild(td1);
      tr.appendChild(td2);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function findVisualisationsCard() {
    const headings = Array.from(document.querySelectorAll(".aw-card .aw-card__title"));
    const h = headings.find(
      (x) => (x.textContent || "").trim().toLowerCase() === "visualisations"
    );
    if (!h) return null;
    return h.closest(".aw-card");
  }

  function ensureChartsArea(visCard) {
    if (!visCard) return null;

    const existing = visCard.querySelector("#owChartsArea");
    if (existing) return existing;

    const area = document.createElement("div");
    area.id = "owChartsArea";
    area.style.display = "grid";
    area.style.gap = "0.9rem";
    area.style.marginTop = "0.75rem";

    const diagram = visCard.querySelector(".hybrid-diagram");
    if (diagram && diagram.parentElement) {
      diagram.parentElement.appendChild(area);
    } else {
      visCard.appendChild(area);
    }
    return area;
  }

  function makeCanvasBlock(title) {
    const wrap = document.createElement("div");
    wrap.style.border = "1px solid rgba(15,31,23,0.10)";
    wrap.style.background = "rgba(255,255,255,0.92)";
    wrap.style.borderRadius = "14px";
    wrap.style.padding = "0.75rem";

    const h = document.createElement("div");
    h.textContent = title;
    h.style.fontWeight = "700";
    h.style.marginBottom = "0.5rem";
    wrap.appendChild(h);

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "220px";
    canvas.height = 220;
    wrap.appendChild(canvas);

    return { wrap, canvas };
  }

  // ---------------------------------
  // Charts: stacked bars with project colors
  // ---------------------------------

  const PROJECT_COLORS = [
    "#ff0000",
    "#ff6003",
    "#ffe600",
    "#1eff00",
    "#00ff9d",
    "#71ccc1",
    "#0400ff",
    "#f700ff",
    "#ff7c7c",
    "#ffb477",
    "#fbfd83",
    "#83ff83",
  ];

  function colorForProject(name) {
    const s = String(name || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return PROJECT_COLORS[h % PROJECT_COLORS.length];
  }

  function drawStackedBars(canvas, dates, seriesOrder, valuesByDateProject, opts) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cssW = canvas.clientWidth || 800;
    const cssH = canvas.clientHeight || 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, cssW, cssH);

    const padding = { l: 10, r: 10, t: 10, b: 34 };
    const w = cssW - padding.l - padding.r;
    const h = cssH - padding.t - padding.b;

    if (!dates.length || !seriesOrder.length) {
      ctx.font = "12px Space Grotesk, system-ui, sans-serif";
      ctx.fillStyle = "rgba(15,31,23,0.55)";
      ctx.fillText("No chart data available.", padding.l, padding.t + 16);
      return;
    }

    // total per date (stack height)
    const totals = dates.map((d) => {
      const perProj = valuesByDateProject.get(d) || new Map();
      let sum = 0;
      for (const p of seriesOrder) sum += (perProj.get(p) || 0);
      return sum;
    });

    const maxTotal = Math.max(...totals, 0.000001);

    const gap = 6;
    const barW = Math.max(10, (w - gap * (dates.length - 1)) / dates.length);

    // baseline
    ctx.strokeStyle = "rgba(15,31,23,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.l, padding.t + h);
    ctx.lineTo(padding.l + w, padding.t + h);
    ctx.stroke();

    // small legend text
    if (opts?.legend && opts.legend.length) {
      ctx.textAlign = "left";
      ctx.font = "11px Space Grotesk, system-ui, sans-serif";
      ctx.fillStyle = "rgba(15,31,23,0.60)";
      const legendText = `Stacked by: ${opts.legend.join(", ")}${
        opts.legendMore ? ` +${opts.legendMore} more` : ""
      }`;
      ctx.fillText(legendText, padding.l, 12);
    }

    // bars
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const perProj = valuesByDateProject.get(date) || new Map();
      const x = padding.l + i * (barW + gap);

      let yCursor = padding.t + h;

      for (let j = 0; j < seriesOrder.length; j++) {
        const p = seriesOrder[j];
        const v = perProj.get(p) || 0;
        if (v <= 0) continue;

        const segH = (v / maxTotal) * h;
        yCursor -= segH;

        ctx.fillStyle = colorForProject(p);
        ctx.fillRect(x, yCursor, barW, segH);
      }

      // x label (date)
      const label = String(date || "");
      const short = label.length > 10 ? label.slice(5) : label; // show MM-DD if YYYY-MM-DD
      ctx.font = "11px Space Grotesk, system-ui, sans-serif";
      ctx.fillStyle = "rgba(15,31,23,0.60)";
      ctx.textAlign = "center";
      ctx.fillText(short, x + barW / 2, padding.t + h + 18);
    }
  }

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

  const statsPanel = ensureStatsPanel(statsMerged);
  const visCard = findVisualisationsCard();
  const chartsArea = ensureChartsArea(visCard);

  // Create chart blocks once
  let chartIncome = null;
  let chartDuration = null;
  let chartRatio = null;

  if (chartsArea) {
    if (!chartsArea.querySelector("#owChartIncome")) {
      const a = makeCanvasBlock("Income by project (stacked, by date)");
      a.wrap.id = "owChartIncome";
      chartsArea.appendChild(a.wrap);
      chartIncome = a.canvas;

      const b = makeCanvasBlock("Duration by project (stacked, by date)");
      b.wrap.id = "owChartDuration";
      chartsArea.appendChild(b.wrap);
      chartDuration = b.canvas;

      const c = makeCanvasBlock("Income / duration by project (stacked, by date)");
      c.wrap.id = "owChartRatio";
      chartsArea.appendChild(c.wrap);
      chartRatio = c.canvas;
    } else {
      chartIncome = chartsArea.querySelector("#owChartIncome canvas");
      chartDuration = chartsArea.querySelector("#owChartDuration canvas");
      chartRatio = chartsArea.querySelector("#owChartRatio canvas");
    }
  }

  function setStatus(msg) {
    statusBox.value = msg;
  }

  function clearVisuals() {
    if (statsPanel) clearNode(statsPanel);

    [chartIncome, chartDuration, chartRatio].forEach((c) => {
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
    });
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

    clearVisuals();
  }

  resetBtn.addEventListener("click", resetAll);

  function buildStatsAndChartsFromCsv(csvText) {
    const { rows } = parseCsv(csvText);
    const rowCount = rows.length;

    const incomeAccessor = chooseIncomeAccessor(rows);
    const incomeLabel = incomeAccessor.label === "amount_gbp" ? "GBP" : "amount";

    // totals
    let totalDuration = 0;
    let totalIncome = 0;

    // per project totals
    const projMap = new Map(); // project_name -> {income, duration}

    // by date -> per project values
    const incomeByDateProject = new Map();   // date -> Map(project -> income)
    const durationByDateProject = new Map(); // date -> Map(project -> duration)
    const ratioByDateProject = new Map();    // date -> Map(project -> income/duration)

    const dateSet = new Set();

    for (const r of rows) {
      const project = (r.project_name || "(unknown)").trim() || "(unknown)";
      const date = (r.date || "").trim();
      const duration = toNumber(r.duration_hours);
      const income = incomeAccessor.get(r);

      if (date) dateSet.add(date);

      totalDuration += duration;
      totalIncome += income;

      const prev = projMap.get(project) || { income: 0, duration: 0 };
      prev.income += income;
      prev.duration += duration;
      projMap.set(project, prev);

      if (!incomeByDateProject.has(date)) incomeByDateProject.set(date, new Map());
      if (!durationByDateProject.has(date)) durationByDateProject.set(date, new Map());
      if (!ratioByDateProject.has(date)) ratioByDateProject.set(date, new Map());

      const im = incomeByDateProject.get(date);
      const dm = durationByDateProject.get(date);

      im.set(project, (im.get(project) || 0) + income);
      dm.set(project, (dm.get(project) || 0) + duration);
    }

    // compute ratio maps from income/duration sums
    for (const date of incomeByDateProject.keys()) {
      const im = incomeByDateProject.get(date) || new Map();
      const dm = durationByDateProject.get(date) || new Map();
      const rm = ratioByDateProject.get(date) || new Map();

      const projects = new Set([...im.keys(), ...dm.keys()]);
      for (const p of projects) {
        const i = im.get(p) || 0;
        const d = dm.get(p) || 0;
        rm.set(p, safeDiv(i, d));
      }
      ratioByDateProject.set(date, rm);
    }

    const overallRatio = safeDiv(totalIncome, totalDuration);

    const projArr = Array.from(projMap.entries()).map(([name, v]) => ({
      name,
      income: v.income,
      duration: v.duration,
      ratio: safeDiv(v.income, v.duration),
    }));

    const incomeByProject = [...projArr].sort((a, b) => b.income - a.income);
    const durationByProject = [...projArr].sort((a, b) => b.duration - a.duration);
    const ratioByProject = [...projArr].sort((a, b) => b.ratio - a.ratio);

    // Quick stats UI injection
    if (statsPanel) {
      clearNode(statsPanel);

      const summary = makeSummaryGrid([
        { k: "Row count", v: formatInt(rowCount) },
        { k: "Total duration (hours)", v: formatNumber(totalDuration, 2) },
        { k: `Total income (${incomeLabel})`, v: formatNumber(totalIncome, 2) },
        { k: "Income / duration", v: formatNumber(overallRatio, 2) },
      ]);
      statsPanel.appendChild(summary);

      const topN = 8;

      const t1 = makeMiniTable(
        `Income by project (${incomeLabel})`,
        incomeByProject.slice(0, topN).map((x) => ({ name: x.name, value: formatNumber(x.income, 2) })),
        { col1: "Project", col2: "Income" }
      );

      const t2 = makeMiniTable(
        "Duration by project (hours)",
        durationByProject.slice(0, topN).map((x) => ({ name: x.name, value: formatNumber(x.duration, 2) })),
        { col1: "Project", col2: "Hours" }
      );

      const t3 = makeMiniTable(
        `Income / duration by project (${incomeLabel}/hour)`,
        ratioByProject.slice(0, topN).map((x) => ({ name: x.name, value: formatNumber(x.ratio, 2) })),
        { col1: "Project", col2: "Ratio" }
      );

      const grid = document.createElement("div");
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
      grid.style.gap = "0.75rem";

      grid.appendChild(t1);
      grid.appendChild(t2);
      grid.appendChild(t3);

      statsPanel.appendChild(grid);
    }

    // Charts: limit stack projects for readability
    const maxProjects = 6;
    const topProjects = incomeByProject.slice(0, maxProjects).map((x) => x.name);
    const legendMore = Math.max(0, projArr.length - topProjects.length);

    const dates = sortIsoDates(dateSet);

    drawStackedBars(chartIncome, dates, topProjects, incomeByDateProject, {
      legend: topProjects,
      legendMore,
    });
    drawStackedBars(chartDuration, dates, topProjects, durationByDateProject, {
      legend: topProjects,
      legendMore,
    });
    drawStackedBars(chartRatio, dates, topProjects, ratioByDateProject, {
      legend: topProjects,
      legendMore,
    });
  }

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
    clearVisuals();

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

      // Always show raw backend stats JSON in the textarea
      statsMerged.value = JSON.stringify(data.stats ?? {}, null, 2);

      const hasCsv = typeof data.download_csv === "string" && data.download_csv.length > 0;
      if (!hasCsv) {
        setStatus(`No output returned. mode=${data.mode ?? "unknown"}`);
        return;
      }

      // Preview + download
      previewMerged.value = (data.preview_csv ?? "").slice(0, 8000);

      const blob = new Blob([data.download_csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      downloadBtn.href = url;
      downloadBtn.style.display = "inline-flex";

      // Build the “Quick stats” breakdown + 3 stacked charts
      buildStatsAndChartsFromCsv(data.download_csv);

      setStatus(`Done ✔ (${data.mode ?? "ok"})`);
    } catch (err) {
      setStatus(`Request failed: ${err?.message ?? String(err)}`);
    }
  }

  runBtn.addEventListener("click", runMerge);
})();
