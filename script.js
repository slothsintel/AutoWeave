// script.js (full)
// - Guided example: local preview of a single CSV
// - Workbench: calls AutoWeave backend, renders preview/stats
// - Quick stats: row count, totals, ratios, per-project breakdowns
// - Visualisations: 3 stacked bar charts by date (income, duration, income/duration)
//   with color legend + floating tooltip (AutoTrac style)

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
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
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
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);
  }

  function sortIsoDates(dates) {
    return [...dates].sort((a, b) => String(a).localeCompare(String(b)));
  }

  // Income metric selector: prefer amount_gbp if any non-empty amount_gbp exists
  function chooseIncomeAccessor(rows) {
    const anyGbp = rows.some((r) => (r.amount_gbp ?? "").toString().trim() !== "");
    return {
      label: anyGbp ? "amount_gbp" : "amount",
      get: (r) => toNumber(anyGbp ? r.amount_gbp : r.amount),
    };
  }

  // ---------------------------------
  // Helpers: DOM injection (no tech.html changes)
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
    const h = headings.find((x) => (x.textContent || "").trim().toLowerCase() === "visualisations");
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
    if (diagram && diagram.parentElement) diagram.parentElement.appendChild(area);
    else visCard.appendChild(area);

    return area;
  }

  function makeCanvasBlock(title) {
    const wrap = document.createElement("div");
    wrap.style.border = "1px solid rgba(15,31,23,0.10)";
    wrap.style.background = "rgba(255,255,255,0.92)";
    wrap.style.borderRadius = "14px";
    wrap.style.padding = "0.75rem";
    wrap.style.position = "relative";

    const h = document.createElement("div");
    h.textContent = title;
    h.style.fontWeight = "700";
    h.style.marginBottom = "0.35rem";
    wrap.appendChild(h);

    // Legend container (chips)
    const legend = document.createElement("div");
    legend.style.display = "flex";
    legend.style.flexWrap = "wrap";
    legend.style.gap = "0.5rem 0.8rem";
    legend.style.alignItems = "center";
    legend.style.marginBottom = "0.55rem";
    legend.style.opacity = "0.85";
    wrap.appendChild(legend);

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "220px";
    canvas.height = 220;
    canvas.style.display = "block";
    canvas.style.borderRadius = "10px";
    wrap.appendChild(canvas);

    // Tooltip (floating)
    const tip = document.createElement("div");
    tip.style.position = "absolute";
    tip.style.pointerEvents = "none";
    tip.style.display = "none";
    tip.style.zIndex = "5";
    tip.style.minWidth = "180px";
    tip.style.maxWidth = "260px";
    tip.style.padding = "10px 12px";
    tip.style.borderRadius = "12px";
    tip.style.border = "1px solid rgba(15,31,23,0.18)";
    tip.style.background = "rgba(10,18,14,0.92)";
    tip.style.color = "rgba(255,255,255,0.92)";
    tip.style.boxShadow = "0 10px 30px rgba(0,0,0,0.22)";
    tip.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    tip.style.fontSize = "12px";
    tip.style.lineHeight = "1.25";
    wrap.appendChild(tip);

    return { wrap, canvas, legend, tip };
  }

  // ---------------------------------
  // Colors (your palette)
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
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PROJECT_COLORS[h % PROJECT_COLORS.length];
  }

  // ---------------------------------
  // Charts: stacked bars with legend + tooltip
  // ---------------------------------

  function setLegendChips(legendEl, projects, moreCount) {
    if (!legendEl) return;
    legendEl.innerHTML = "";

    projects.forEach((p) => {
      const chip = document.createElement("div");
      chip.style.display = "inline-flex";
      chip.style.alignItems = "center";
      chip.style.gap = "0.4rem";
      chip.style.fontSize = "12px";
      chip.style.color = "rgba(15,31,23,0.72)";

      const dot = document.createElement("span");
      dot.style.width = "10px";
      dot.style.height = "10px";
      dot.style.borderRadius = "999px";
      dot.style.display = "inline-block";
      dot.style.background = colorForProject(p);
      dot.style.boxShadow = "0 0 0 2px rgba(255,255,255,0.8)";

      const label = document.createElement("span");
      label.textContent = p;

      chip.appendChild(dot);
      chip.appendChild(label);
      legendEl.appendChild(chip);
    });

    if (moreCount > 0) {
      const more = document.createElement("span");
      more.textContent = `+${moreCount} more`;
      more.style.fontSize = "12px";
      more.style.opacity = "0.6";
      legendEl.appendChild(more);
    }
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function drawStackedBars(canvas, legendEl, tipEl, dates, seriesOrder, valuesByDateProject, opts) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw + hit regions for hover
    const hit = []; // {x,y,w,h,date,project,value}

    const cssW = canvas.clientWidth || 800;
    const cssH = canvas.clientHeight || 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const padding = { l: 10, r: 10, t: 8, b: 34 };
    const w = cssW - padding.l - padding.r;
    const h = cssH - padding.t - padding.b;

    // legend chips
    setLegendChips(legendEl, seriesOrder, opts?.legendMore || 0);

    if (!dates.length || !seriesOrder.length) {
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(15,31,23,0.55)";
      ctx.fillText("No chart data available.", padding.l, padding.t + 16);
      return;
    }

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

    // x labels: show every Nth to avoid overlap
    const maxLabels = 10;
    const step = Math.max(1, Math.ceil(dates.length / maxLabels));

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

        hit.push({ x, y: yCursor, w: barW, h: segH, date, project: p, value: v });
      }

      if (i % step === 0 || i === dates.length - 1) {
        const label = String(date || "");
        const short = label.length >= 10 ? label.slice(5) : label; // MM-DD if YYYY-MM-DD
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillStyle = "rgba(15,31,23,0.60)";
        ctx.textAlign = "center";
        ctx.fillText(short, x + barW / 2, padding.t + h + 18);
      }
    }

    // Hover tooltip (one handler per canvas)
    if (!canvas.__owHoverBound) {
      canvas.__owHoverBound = true;

      canvas.addEventListener("mousemove", (ev) => {
        if (!tipEl) return;

        const rect = canvas.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;

        // find topmost hit segment under cursor
        const seg = hit.find((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
        if (!seg) {
          tipEl.style.display = "none";
          return;
        }

        // Build tooltip: date + all project values for that date (for visible series)
        const perProj = valuesByDateProject.get(seg.date) || new Map();

        const lines = seriesOrder
          .map((p) => ({ p, v: perProj.get(p) || 0 }))
          .filter((x) => x.v > 0)
          .sort((a, b) => b.v - a.v);

        const title = `<div style="font-weight:800;font-size:13px;margin-bottom:6px;">${seg.date}</div>`;
        const body = lines
          .map(
            (x) => `
              <div style="display:flex;justify-content:space-between;gap:12px;margin:2px 0;">
                <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                  <span style="width:10px;height:10px;border-radius:999px;background:${colorForProject(x.p)};display:inline-block;"></span>
                  <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${x.p}</span>
                </div>
                <div style="font-variant-numeric:tabular-nums;font-weight:700;">${formatNumber(x.v, 2)}</div>
              </div>
            `
          )
          .join("");

        tipEl.innerHTML = title + body;

        // position tooltip within card
        const parent = tipEl.parentElement?.getBoundingClientRect();
        const tipW = 240;
        const tipH = 140;

        const px = clamp(mx + 14, 8, (parent ? parent.width : rect.width) - tipW - 8);
        const py = clamp(my + 14, 8, (parent ? parent.height : rect.height) - tipH - 8);

        tipEl.style.left = `${px}px`;
        tipEl.style.top = `${py}px`;
        tipEl.style.display = "block";
      });

      canvas.addEventListener("mouseleave", () => {
        if (tipEl) tipEl.style.display = "none";
      });
    }

    // store latest hit regions + data for handlers
    canvas.__owHit = hit;
    canvas.__owValuesByDateProject = valuesByDateProject;
    canvas.__owSeriesOrder = seriesOrder;
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

  if (!incomesFile || !entriesFile || !runBtn || !resetBtn || !statusBox || !previewMerged || !statsMerged || !downloadBtn) {
    return;
  }

  const statsPanel = ensureStatsPanel(statsMerged);

  const visCard = findVisualisationsCard();
  const chartsArea = ensureChartsArea(visCard);

  // Create chart blocks once
  let incomeBlock, durationBlock, ratioBlock;

  if (chartsArea) {
    if (!chartsArea.querySelector("#owChartIncome")) {
      incomeBlock = makeCanvasBlock("Total income by project");
      incomeBlock.wrap.id = "owChartIncome";
      chartsArea.appendChild(incomeBlock.wrap);

      durationBlock = makeCanvasBlock("Total time by project");
      durationBlock.wrap.id = "owChartDuration";
      chartsArea.appendChild(durationBlock.wrap);

      ratioBlock = makeCanvasBlock("Hourly rate by project");
      ratioBlock.wrap.id = "owChartRatio";
      chartsArea.appendChild(ratioBlock.wrap);
    } else {
      const getBlock = (id) => {
        const wrap = chartsArea.querySelector(id);
        return {
          wrap,
          canvas: wrap?.querySelector("canvas") || null,
          legend: wrap?.querySelector("div:nth-child(2)") || null, // title + legend + canvas + tip
          tip: wrap?.querySelector("div:last-child") || null,
        };
      };
      incomeBlock = getBlock("#owChartIncome");
      durationBlock = getBlock("#owChartDuration");
      ratioBlock = getBlock("#owChartRatio");
    }
  }

  function setStatus(msg) {
    statusBox.value = msg;
  }

  function clearVisuals() {
    if (statsPanel) clearNode(statsPanel);

    [incomeBlock?.canvas, durationBlock?.canvas, ratioBlock?.canvas].forEach((c) => {
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
    });

    [incomeBlock?.tip, durationBlock?.tip, ratioBlock?.tip].forEach((t) => {
      if (t) t.style.display = "none";
    });

    [incomeBlock?.legend, durationBlock?.legend, ratioBlock?.legend].forEach((l) => {
      if (l) l.innerHTML = "";
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

    let totalDuration = 0;
    let totalIncome = 0;

    const projMap = new Map(); // project -> {income, duration}

    const incomeByDateProject = new Map();
    const durationByDateProject = new Map();
    const ratioByDateProject = new Map();

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

      incomeByDateProject.get(date).set(project, (incomeByDateProject.get(date).get(project) || 0) + income);
      durationByDateProject.get(date).set(project, (durationByDateProject.get(date).get(project) || 0) + duration);
    }

    // ratio = income/duration per date/project
    for (const date of incomeByDateProject.keys()) {
      const im = incomeByDateProject.get(date) || new Map();
      const dm = durationByDateProject.get(date) || new Map();
      const rm = new Map();

      const projects = new Set([...im.keys(), ...dm.keys()]);
      for (const p of projects) rm.set(p, safeDiv(im.get(p) || 0, dm.get(p) || 0));
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

    // Quick stats UI injection (no new section)
    if (statsPanel) {
      clearNode(statsPanel);

      statsPanel.appendChild(
        makeSummaryGrid([
          { k: "Row count", v: formatInt(rowCount) },
          { k: "Total time (hours)", v: formatNumber(totalDuration, 2) },
          { k: `Total income (${incomeLabel})`, v: formatNumber(totalIncome, 2) },
          { k: "Hourly rate", v: formatNumber(overallRatio, 2) },
        ])
      );

      const topN = 8;

      const grid = document.createElement("div");
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
      grid.style.gap = "0.75rem";

      grid.appendChild(
        makeMiniTable(
          `Income by project (${incomeLabel})`,
          incomeByProject.slice(0, topN).map((x) => ({ name: x.name, value: formatNumber(x.income, 2) })),
          { col1: "Project", col2: "Amount" }
        )
      );

      grid.appendChild(
        makeMiniTable(
          "Time by project (hours)",
          durationByProject.slice(0, topN).map((x) => ({ name: x.name, value: formatNumber(x.duration, 2) })),
          { col1: "Project", col2: "Hours" }
        )
      );

      grid.appendChild(
        makeMiniTable(
          `Hourly rate by project (${incomeLabel}/hour)`,
          ratioByProject.slice(0, topN).map((x) => ({ name: x.name, value: formatNumber(x.ratio, 2) })),
          { col1: "Project", col2: "Rate" }
        )
      );

      statsPanel.appendChild(grid);
    }

    // Charts: show top N projects (readable)
    const maxProjects = 6;
    const topProjects = incomeByProject.slice(0, maxProjects).map((x) => x.name);
    const legendMore = Math.max(0, projArr.length - topProjects.length);

    const dates = sortIsoDates(dateSet);

    drawStackedBars(incomeBlock?.canvas, incomeBlock?.legend, incomeBlock?.tip, dates, topProjects, incomeByDateProject, {
      legendMore,
    });
    drawStackedBars(
      durationBlock?.canvas,
      durationBlock?.legend,
      durationBlock?.tip,
      dates,
      topProjects,
      durationByDateProject,
      { legendMore }
    );
    drawStackedBars(ratioBlock?.canvas, ratioBlock?.legend, ratioBlock?.tip, dates, topProjects, ratioByDateProject, {
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

      statsMerged.value = JSON.stringify(data.stats ?? {}, null, 2);

      const hasCsv = typeof data.download_csv === "string" && data.download_csv.length > 0;
      if (!hasCsv) {
        setStatus(`No output returned. mode=${data.mode ?? "unknown"}`);
        return;
      }

      previewMerged.value = (data.preview_csv ?? "").slice(0, 8000);

      const blob = new Blob([data.download_csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      downloadBtn.href = url;
      downloadBtn.style.display = "inline-flex";

      buildStatsAndChartsFromCsv(data.download_csv);

      setStatus(`Done ✔ (${data.mode ?? "ok"})`);
    } catch (err) {
      setStatus(`Request failed: ${err?.message ?? String(err)}`);
    }
  }

  runBtn.addEventListener("click", runMerge);
})();
