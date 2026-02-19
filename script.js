// script.js (full)
// - Guided example: local preview of a single CSV
// - Workbench: calls AutoWeave backend, renders preview/stats
// - Quick stats: row count, totals, ratios, per-project breakdowns
// - Visualisations: 3 stacked bar charts by date (income, duration, income/duration)
//   with AutoTrac Pro-style controls:
//   - pill buttons for range + grouping
//   - custom range date picker
//   - smooth fade on redraw
//   - cumulative mode toggle
//   - export PNG (all charts combined)

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

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
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
  // Helpers: Dates + grouping
  // ---------------------------------

  function toDateObj(str) {
    const s = String(str || "").trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function isoWeekKey(date) {
    // ISO week year + week number
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7; // 1..7 (Mon..Sun)
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    const y = d.getUTCFullYear();
    return `${y}-W${String(weekNo).padStart(2, "0")}`;
  }

  function formatGroupKey(date, mode) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");

    if (mode === "day") return `${y}-${m}-${dd}`;
    if (mode === "month") return `${y}-${m}`;
    if (mode === "year") return `${y}`;
    if (mode === "week") return isoWeekKey(date);

    return `${y}-${m}-${dd}`;
  }

  function dateToISO(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getMinMaxDates(isoDates) {
    const parsed = isoDates.map(toDateObj).filter(Boolean);
    if (!parsed.length) return { min: null, max: null };
    parsed.sort((a, b) => a - b);
    return { min: parsed[0], max: parsed[parsed.length - 1] };
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
    area.style.marginTop = "0.6rem";

    const diagram = visCard.querySelector(".hybrid-diagram");
    if (diagram && diagram.parentElement) diagram.parentElement.appendChild(area);
    else visCard.appendChild(area);

    return area;
  }

  // ---------------------------------
  // Visualisation Controls (AutoTrac Pro-ish)
  // ---------------------------------

  function stylePillButton(btn) {
    btn.type = "button";
    btn.style.height = "36px";
    btn.style.padding = "0 12px";
    btn.style.borderRadius = "9999px";
    btn.style.border = "1px solid rgba(15,31,23,0.14)";
    btn.style.background = "rgba(255,255,255,0.92)";
    btn.style.color = "rgba(15,31,23,0.74)";
    btn.style.fontSize = "12px";
    btn.style.fontWeight = "750";
    btn.style.letterSpacing = "0.03em";
    btn.style.textTransform = "uppercase";
    btn.style.cursor = "pointer";
    btn.style.userSelect = "none";
    btn.style.boxShadow = "0 8px 18px rgba(0,0,0,0.06)";
    btn.style.transition = "transform 120ms ease, background 160ms ease, border-color 160ms ease, opacity 160ms ease";
    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "translateY(-1px)";
      btn.style.borderColor = "rgba(15,31,23,0.22)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "translateY(0)";
      btn.style.borderColor = "rgba(15,31,23,0.14)";
    });
  }

  function setPillActive(btn, isActive) {
    if (!btn) return;
    if (isActive) {
      btn.dataset.active = "1";
      btn.style.background = "rgba(15,31,23,0.92)";
      btn.style.color = "rgba(255,255,255,0.92)";
      btn.style.borderColor = "rgba(15,31,23,0.92)";
      btn.style.boxShadow = "0 12px 26px rgba(0,0,0,0.16)";
    } else {
      btn.dataset.active = "0";
      btn.style.background = "rgba(255,255,255,0.92)";
      btn.style.color = "rgba(15,31,23,0.74)";
      btn.style.borderColor = "rgba(15,31,23,0.14)";
      btn.style.boxShadow = "0 8px 18px rgba(0,0,0,0.06)";
    }
  }

  function makePillGroup(labelText) {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "0.25rem";

    const label = document.createElement("div");
    label.textContent = labelText;
    label.style.fontSize = "0.75rem";
    label.style.letterSpacing = "0.03em";
    label.style.textTransform = "uppercase";
    label.style.opacity = "0.65";

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "0.5rem";
    row.style.flexWrap = "wrap";

    wrap.appendChild(label);
    wrap.appendChild(row);

    return { wrap, row };
  }

  function ensureChartControls(visCard, chartsArea) {
    if (!visCard || !chartsArea) return null;

    const existing = visCard.querySelector("#owChartControls");
    if (existing) return existing.__owApi || null;

    const bar = document.createElement("div");
    bar.id = "owChartControls";
    bar.style.display = "flex";
    bar.style.flexWrap = "wrap";
    bar.style.gap = "0.9rem";
    bar.style.alignItems = "flex-end";
    bar.style.padding = "0.75rem";
    bar.style.borderRadius = "14px";
    bar.style.border = "1px solid rgba(15,31,23,0.10)";
    bar.style.background = "rgba(255,255,255,0.70)";
    bar.style.boxShadow = "0 12px 24px rgba(0,0,0,0.06)";
    bar.style.marginTop = "0.4rem";
    bar.style.marginBottom = "0.65rem";

    // Range group
    const range = makePillGroup("Date range");
    const rangeBtns = new Map();

    const ranges = [
      { id: "14", label: "Last 14 days" },
      { id: "30", label: "Last 30" },
      { id: "90", label: "Last 90" },
      { id: "all", label: "All time" },
      { id: "custom", label: "Custom" },
    ];

    ranges.forEach((r) => {
      const b = document.createElement("button");
      b.textContent = r.label;
      b.dataset.value = r.id;
      stylePillButton(b);
      range.row.appendChild(b);
      rangeBtns.set(r.id, b);
    });

    // Custom range pickers
    const customWrap = document.createElement("div");
    customWrap.style.display = "none";
    customWrap.style.gap = "0.6rem";
    customWrap.style.alignItems = "center";
    customWrap.style.flexWrap = "wrap";
    customWrap.style.marginTop = "0.35rem";

    const from = document.createElement("input");
    from.type = "date";
    from.id = "owCustomFrom";
    from.style.height = "36px";
    from.style.borderRadius = "10px";
    from.style.border = "1px solid rgba(15,31,23,0.14)";
    from.style.padding = "0 10px";
    from.style.background = "rgba(255,255,255,0.92)";

    const to = document.createElement("input");
    to.type = "date";
    to.id = "owCustomTo";
    to.style.height = "36px";
    to.style.borderRadius = "10px";
    to.style.border = "1px solid rgba(15,31,23,0.14)";
    to.style.padding = "0 10px";
    to.style.background = "rgba(255,255,255,0.92)";

    const apply = document.createElement("button");
    apply.textContent = "Apply";
    stylePillButton(apply);

    customWrap.appendChild(from);
    customWrap.appendChild(to);
    customWrap.appendChild(apply);
    range.wrap.appendChild(customWrap);

    // Grouping group
    const group = makePillGroup("Group");
    const groupBtns = new Map();

    const groups = [
      { id: "day", label: "Day" },
      { id: "week", label: "Week" },
      { id: "month", label: "Month" },
      { id: "year", label: "Year" },
    ];

    groups.forEach((g) => {
      const b = document.createElement("button");
      b.textContent = g.label;
      b.dataset.value = g.id;
      stylePillButton(b);
      group.row.appendChild(b);
      groupBtns.set(g.id, b);
    });

    // Toggles group
    const toggles = makePillGroup("Mode");
    const cumulativeBtn = document.createElement("button");
    cumulativeBtn.textContent = "Cumulative";
    stylePillButton(cumulativeBtn);

    toggles.row.appendChild(cumulativeBtn);

    // Export group
    const exportG = makePillGroup("Export");
    const exportBtn = document.createElement("button");
    exportBtn.textContent = "Export PNG";
    stylePillButton(exportBtn);
    exportG.row.appendChild(exportBtn);

    bar.appendChild(range.wrap);
    bar.appendChild(group.wrap);
    bar.appendChild(toggles.wrap);
    bar.appendChild(exportG.wrap);

    visCard.insertBefore(bar, chartsArea);

    const api = {
      el: bar,
      rangeBtns,
      groupBtns,
      customWrap,
      customFrom: from,
      customTo: to,
      customApply: apply,
      cumulativeBtn,
      exportBtn,
      setCustomVisible: (v) => (customWrap.style.display = v ? "flex" : "none"),
    };

    bar.__owApi = api;
    return api;
  }

  // ---------------------------------
  // Canvas blocks
  // ---------------------------------

  function makeCanvasBlock(title) {
    const wrap = document.createElement("div");
    wrap.style.border = "1px solid rgba(15,31,23,0.10)";
    wrap.style.background = "rgba(255,255,255,0.92)";
    wrap.style.borderRadius = "14px";
    wrap.style.padding = "0.75rem";
    wrap.style.position = "relative";
    wrap.style.transition = "opacity 180ms ease"; // fade on redraw

    const h = document.createElement("div");
    h.textContent = title;
    h.style.fontWeight = "800";
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

  function drawStackedBars(canvas, legendEl, tipEl, dates, seriesOrder, valuesByDateProject, opts) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cssW = canvas.clientWidth || 800;
    const cssH = canvas.clientHeight || 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const hit = []; // {x,y,w,h,date,project,value}
    const padding = { l: 10, r: 10, t: 8, b: 34 };
    const w = cssW - padding.l - padding.r;
    const h = cssH - padding.t - padding.b;

    setLegendChips(legendEl, seriesOrder, opts?.legendMore || 0);

    if (!dates.length || !seriesOrder.length) {
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(15,31,23,0.55)";
      ctx.fillText("No chart data available.", padding.l, padding.t + 16);
      canvas.__owHit = [];
      canvas.__owValuesByDateProject = valuesByDateProject;
      canvas.__owSeriesOrder = seriesOrder;
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
        let short = label;
        if (/^\d{4}-\d{2}-\d{2}$/.test(label)) short = label.slice(5);
        else if (/^\d{4}-W\d{2}$/.test(label)) short = label.slice(5);
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillStyle = "rgba(15,31,23,0.60)";
        ctx.textAlign = "center";
        ctx.fillText(short, x + barW / 2, padding.t + h + 18);
      }
    }

    // Store latest hit regions + data for handlers
    canvas.__owHit = hit;
    canvas.__owValuesByDateProject = valuesByDateProject;
    canvas.__owSeriesOrder = seriesOrder;

    // Hover tooltip (bind once per canvas)
    if (!canvas.__owHoverBound) {
      canvas.__owHoverBound = true;

      canvas.addEventListener("mousemove", (ev) => {
        if (!tipEl) return;

        const rect = canvas.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;

        const regions = canvas.__owHit || [];
        const seg = regions.find((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
        if (!seg) {
          tipEl.style.display = "none";
          return;
        }

        const valuesMap = canvas.__owValuesByDateProject || new Map();
        const series = canvas.__owSeriesOrder || [];

        const perProj = valuesMap.get(seg.date) || new Map();

        const lines = series
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
  }

  // ---------------------------------
  // Chart controller (modular)
  // ---------------------------------

  function createChartController({ visCard, chartsArea, incomeBlock, durationBlock, ratioBlock }) {
    const controls = ensureChartControls(visCard, chartsArea);

    const state = {
      range: "14", // 14|30|90|all|custom
      group: "day", // day|week|month|year
      cumulative: false,
      customFrom: "",
      customTo: "",
    };

    const data = {
      dates: [],
      topProjects: [],
      legendMore: 0,
      incomeByDateProject: new Map(),
      durationByDateProject: new Map(),
      minDate: null,
      maxDate: null,
    };

    function setRange(next) {
      state.range = next;
      for (const [k, b] of controls.rangeBtns.entries()) setPillActive(b, k === next);
      controls.setCustomVisible(next === "custom");
      requestRender();
    }

    function setGroup(next) {
      state.group = next;
      for (const [k, b] of controls.groupBtns.entries()) setPillActive(b, k === next);
      requestRender();
    }

    function setCumulative(on) {
      state.cumulative = !!on;
      setPillActive(controls.cumulativeBtn, state.cumulative);
      requestRender();
    }

    function setCustomRange(from, to) {
      state.customFrom = from || "";
      state.customTo = to || "";
      controls.customFrom.value = state.customFrom;
      controls.customTo.value = state.customTo;
      requestRender();
    }

    function setData(next) {
      data.dates = next.dates || [];
      data.topProjects = next.topProjects || [];
      data.legendMore = next.legendMore || 0;
      data.incomeByDateProject = next.incomeByDateProject || new Map();
      data.durationByDateProject = next.durationByDateProject || new Map();
      data.minDate = next.minDate || null;
      data.maxDate = next.maxDate || null;

      if (data.minDate && data.maxDate) {
        controls.customFrom.min = dateToISO(data.minDate);
        controls.customFrom.max = dateToISO(data.maxDate);
        controls.customTo.min = dateToISO(data.minDate);
        controls.customTo.max = dateToISO(data.maxDate);

        if (!state.customFrom) state.customFrom = dateToISO(data.minDate);
        if (!state.customTo) state.customTo = dateToISO(data.maxDate);
        controls.customFrom.value = state.customFrom;
        controls.customTo.value = state.customTo;
      }

      requestRender();
    }

    function computeFilteredDates() {
      const all = data.dates;
      if (!all.length) return [];

      const { max } = getMinMaxDates(all);
      const anchor = max || new Date();

      if (state.range === "all") return [...all];

      if (state.range === "custom") {
        const fromD = toDateObj(state.customFrom);
        const toD = toDateObj(state.customTo);
        if (!fromD || !toD) return [...all];
        const fromT = new Date(fromD.getFullYear(), fromD.getMonth(), fromD.getDate()).getTime();
        const toT = new Date(toD.getFullYear(), toD.getMonth(), toD.getDate()).getTime();
        const lo = Math.min(fromT, toT);
        const hi = Math.max(fromT, toT);
        return all.filter((d) => {
          const dt = toDateObj(d);
          if (!dt) return false;
          const t = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
          return t >= lo && t <= hi;
        });
      }

      const days = Number(state.range) || 14;
      const cutoff = new Date(anchor);
      cutoff.setDate(cutoff.getDate() - (days - 1));
      const cutoffT = new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate()).getTime();

      return all.filter((d) => {
        const dt = toDateObj(d);
        if (!dt) return false;
        const t = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
        return t >= cutoffT;
      });
    }

    function regroup(sourceMap, filteredDates) {
      const out = new Map();
      for (const d of filteredDates) {
        const dt = toDateObj(d);
        if (!dt) continue;

        const key = formatGroupKey(dt, state.group);
        const perProj = sourceMap.get(d) || new Map();

        if (!out.has(key)) out.set(key, new Map());
        const dest = out.get(key);

        for (const [p, v] of perProj.entries()) {
          dest.set(p, (dest.get(p) || 0) + v);
        }
      }
      return out;
    }

    function applyCumulative(groupedMap, projects) {
      const keys = sortIsoDates([...groupedMap.keys()]);
      const running = new Map(projects.map((p) => [p, 0]));
      const out = new Map();

      for (const k of keys) {
        const perProj = groupedMap.get(k) || new Map();
        const cum = new Map();
        for (const p of projects) {
          const next = (running.get(p) || 0) + (perProj.get(p) || 0);
          running.set(p, next);
          cum.set(p, next);
        }
        out.set(k, cum);
      }
      return out;
    }

    function applyCumulativeRate(incomeGrouped, durationGrouped, projects) {
      const keys = sortIsoDates([...incomeGrouped.keys()]);
      const runningIncome = new Map(projects.map((p) => [p, 0]));
      const runningDur = new Map(projects.map((p) => [p, 0]));
      const out = new Map();

      for (const k of keys) {
        const im = incomeGrouped.get(k) || new Map();
        const dm = durationGrouped.get(k) || new Map();
        const rm = new Map();

        for (const p of projects) {
          runningIncome.set(p, (runningIncome.get(p) || 0) + (im.get(p) || 0));
          runningDur.set(p, (runningDur.get(p) || 0) + (dm.get(p) || 0));
          rm.set(p, safeDiv(runningIncome.get(p) || 0, runningDur.get(p) || 0));
        }
        out.set(k, rm);
      }
      return out;
    }

    let raf = 0;
    function requestRender() {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(render);
    }

    function fadeBlocks(on) {
      const blocks = [incomeBlock?.wrap, durationBlock?.wrap, ratioBlock?.wrap].filter(Boolean);
      blocks.forEach((w) => (w.style.opacity = on ? "0.25" : "1"));
    }

    function render() {
      raf = 0;
      if (!data.dates.length || !data.topProjects.length) return;

      fadeBlocks(true);

      const filteredDates = computeFilteredDates();

      const incomeGrouped = regroup(data.incomeByDateProject, filteredDates);
      const durationGrouped = regroup(data.durationByDateProject, filteredDates);

      const ratioGrouped = (() => {
        const keys = new Set([...incomeGrouped.keys(), ...durationGrouped.keys()]);
        const out = new Map();
        for (const k of keys) {
          const im = incomeGrouped.get(k) || new Map();
          const dm = durationGrouped.get(k) || new Map();
          const rm = new Map();
          for (const p of data.topProjects) rm.set(p, safeDiv(im.get(p) || 0, dm.get(p) || 0));
          out.set(k, rm);
        }
        return out;
      })();

      let incomeFinal = incomeGrouped;
      let durationFinal = durationGrouped;
      let ratioFinal = ratioGrouped;

      if (state.cumulative) {
        incomeFinal = applyCumulative(incomeGrouped, data.topProjects);
        durationFinal = applyCumulative(durationGrouped, data.topProjects);
        ratioFinal = applyCumulativeRate(incomeGrouped, durationGrouped, data.topProjects);
      }

      const groupedDates = sortIsoDates([...incomeFinal.keys()]);

      setTimeout(() => {
        drawStackedBars(
          incomeBlock?.canvas,
          incomeBlock?.legend,
          incomeBlock?.tip,
          groupedDates,
          data.topProjects,
          incomeFinal,
          { legendMore: data.legendMore }
        );
        drawStackedBars(
          durationBlock?.canvas,
          durationBlock?.legend,
          durationBlock?.tip,
          groupedDates,
          data.topProjects,
          durationFinal,
          { legendMore: data.legendMore }
        );
        drawStackedBars(
          ratioBlock?.canvas,
          ratioBlock?.legend,
          ratioBlock?.tip,
          groupedDates,
          data.topProjects,
          ratioFinal,
          { legendMore: data.legendMore }
        );
        fadeBlocks(false);
      }, 60);
    }

    function exportPng() {
      const blocks = [
        { title: "Income", canvas: incomeBlock?.canvas },
        { title: "Duration", canvas: durationBlock?.canvas },
        { title: "Rate", canvas: ratioBlock?.canvas },
      ].filter((x) => x.canvas);

      if (!blocks.length) return;

      const widths = blocks.map((b) => b.canvas.width);
      const heights = blocks.map((b) => b.canvas.height);

      const pad = 28;
      const titleH = 34;

      const outW = Math.max(...widths);
      const outH =
        pad + blocks.length * titleH + heights.reduce((a, b) => a + b, 0) + pad + (blocks.length - 1) * 18;

      const out = document.createElement("canvas");
      out.width = outW;
      out.height = outH;
      const ctx = out.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outW, outH);

      let y = pad;

      ctx.fillStyle = "rgba(15,31,23,0.92)";
      ctx.font = "700 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText("AutoWeave — Visualisations", pad, y);
      y += 22;

      const meta =
        `Range: ${state.range === "custom" ? `${state.customFrom} → ${state.customTo}` : state.range} | ` +
        `Group: ${state.group} | ` +
        `Mode: ${state.cumulative ? "cumulative" : "daily"}`;
      ctx.fillStyle = "rgba(15,31,23,0.65)";
      ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(meta, pad, y);
      y += 22;

      blocks.forEach((b, i) => {
        ctx.fillStyle = "rgba(15,31,23,0.88)";
        ctx.font = "800 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
        ctx.fillText(b.title, pad, y + 18);

        y += titleH;

        const x = Math.floor((outW - b.canvas.width) / 2);
        ctx.drawImage(b.canvas, x, y);

        y += b.canvas.height;
        if (i !== blocks.length - 1) y += 18;
      });

      const a = document.createElement("a");
      a.download = "autoweave_visualisations.png";
      a.href = out.toDataURL("image/png");
      a.click();
    }

    // Wire events + defaults
    setRange(state.range);
    setGroup(state.group);
    setCumulative(state.cumulative);

    controls.rangeBtns.forEach((btn, key) => btn.addEventListener("click", () => setRange(key)));
    controls.groupBtns.forEach((btn, key) => btn.addEventListener("click", () => setGroup(key)));
    controls.cumulativeBtn.addEventListener("click", () => setCumulative(!state.cumulative));

    controls.customApply.addEventListener("click", () => {
      const f = controls.customFrom.value;
      const t = controls.customTo.value;
      if (f && t) setCustomRange(f, t);
    });

    controls.exportBtn.addEventListener("click", exportPng);

    return { setData, render, exportPng };
  }


  // ---------------------------------
  // Auth (reuse backends_db like AutoTrac)
  // - Adds Login / Register / Forgot password buttons above Build/See panels
  // - Stores JWT in localStorage, sends Authorization header to backend
  // - Merge endpoint can stay public; backend can enforce auth for secured uploads later
  // ---------------------------------

  const AUTH_STORAGE_KEY = "ow_auth_token";
  const AUTH_EMAIL_KEY = "ow_auth_email";

  function getAuthToken() {
    return localStorage.getItem(AUTH_STORAGE_KEY) || "";
  }
  function setAuthToken(token, email) {
    if (token) localStorage.setItem(AUTH_STORAGE_KEY, token);
    if (email) localStorage.setItem(AUTH_EMAIL_KEY, email);
  }
  function clearAuthToken() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_EMAIL_KEY);
  }
  function getAuthEmail() {
    return localStorage.getItem(AUTH_EMAIL_KEY) || "";
  }

  function ensureAuthBar() {
    const workbench = document.querySelector(".aw-workbench");
    if (!workbench) return null;

    const existing = workbench.parentElement?.querySelector("#owAuthBar");
    if (existing) return existing;

    const bar = document.createElement("div");
    bar.id = "owAuthBar";
    bar.style.display = "flex";
    bar.style.justifyContent = "space-between";
    bar.style.alignItems = "center";
    bar.style.gap = "0.75rem";
    bar.style.flexWrap = "wrap";
    bar.style.margin = "0 0 0.9rem 0";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.gap = "0.55rem";
    left.style.flexWrap = "wrap";
    left.style.alignItems = "center";

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "0.55rem";
    right.style.flexWrap = "wrap";
    right.style.alignItems = "center";

    const status = document.createElement("div");
    status.id = "owAuthStatus";
    status.style.fontSize = "0.9rem";
    status.style.opacity = "0.8";

    function pill(text) {
      const b = document.createElement("button");
      b.textContent = text;
      stylePillButton(b);
      b.style.height = "38px";
      return b;
    }

    const loginBtn = pill("Login");
    const registerBtn = pill("Register");
    const forgotBtn = pill("Forgot password");
    const logoutBtn = pill("Logout");
    logoutBtn.style.display = "none";

    left.appendChild(loginBtn);
    left.appendChild(registerBtn);
    left.appendChild(forgotBtn);

    right.appendChild(status);
    right.appendChild(logoutBtn);

    bar.appendChild(left);
    bar.appendChild(right);

    workbench.parentElement.insertBefore(bar, workbench);

    // Modal
    const modal = document.createElement("div");
    modal.id = "owAuthModal";
    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.display = "none";
    modal.style.alignItems = "center";
    modal.style.justifyContent = "center";
    modal.style.padding = "18px";
    modal.style.background = "rgba(0,0,0,0.55)";
    modal.style.zIndex = "9999";

    const panel = document.createElement("div");
    panel.style.width = "min(520px, 92vw)";
    panel.style.borderRadius = "18px";
    panel.style.border = "1px solid rgba(255,255,255,0.18)";
    panel.style.background = "rgba(255,255,255,0.96)";
    panel.style.boxShadow = "0 20px 60px rgba(0,0,0,0.35)";
    panel.style.padding = "16px 16px 14px 16px";
    panel.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

    const top = document.createElement("div");
    top.style.display = "flex";
    top.style.alignItems = "center";
    top.style.justifyContent = "space-between";
    top.style.gap = "10px";
    top.style.marginBottom = "10px";

    const title = document.createElement("div");
    title.id = "owAuthModalTitle";
    title.style.fontWeight = "900";
    title.style.fontSize = "16px";

    const close = document.createElement("button");
    close.textContent = "✕";
    close.type = "button";
    close.style.border = "none";
    close.style.background = "transparent";
    close.style.cursor = "pointer";
    close.style.fontSize = "18px";
    close.style.opacity = "0.7";

    top.appendChild(title);
    top.appendChild(close);

    const body = document.createElement("div");
    body.id = "owAuthModalBody";

    const msg = document.createElement("div");
    msg.id = "owAuthModalMsg";
    msg.style.marginTop = "10px";
    msg.style.fontSize = "12px";
    msg.style.opacity = "0.8";

    panel.appendChild(top);
    panel.appendChild(body);
    panel.appendChild(msg);
    modal.appendChild(panel);
    document.body.appendChild(modal);

    function openModal(mode, opts = {}) {
      modal.style.display = "flex";
      msg.textContent = "";
      body.innerHTML = "";

      const email = document.createElement("input");
      email.type = "email";
      email.placeholder = "Email";
      email.value = (opts.email ?? getAuthEmail());
      if (opts.lockEmail) {
        email.disabled = true;
        email.style.opacity = "0.85";
        email.style.cursor = "not-allowed";
      }
      email.style.width = "100%";
      email.style.height = "42px";
      email.style.borderRadius = "12px";
      email.style.border = "1px solid rgba(15,31,23,0.14)";
      email.style.padding = "0 12px";
      email.style.marginBottom = "10px";
      email.style.background = "white";

      const password = document.createElement("input");
      password.type = "password";
      password.placeholder = (mode === "reset") ? "New password" : "Password";
      password.style.width = "100%";
      password.style.height = "42px";
      password.style.borderRadius = "12px";
      password.style.border = "1px solid rgba(15,31,23,0.14)";
      password.style.padding = "0 12px";
      password.style.marginBottom = "10px";
      password.style.background = "white";
      if (mode === "forgot" || mode === "verify") password.style.display = "none";

      const password2 = document.createElement("input");
      password2.type = "password";
      password2.placeholder = "Confirm password";
      password2.style.width = "100%";
      password2.style.height = "42px";
      password2.style.borderRadius = "12px";
      password2.style.border = "1px solid rgba(15,31,23,0.14)";
      password2.style.padding = "0 12px";
      password2.style.marginBottom = "10px";
      password2.style.background = "white";
      if (mode !== "register" && mode !== "reset") password2.style.display = "none";

      const action = document.createElement("button");
      action.type = "button";
      stylePillButton(action);
      action.style.height = "42px";
      action.style.width = "100%";
      action.style.justifyContent = "center";

      if (mode === "login") {
        title.textContent = "Login";
        action.textContent = "Login";
        msg.textContent = "Tip: verify your email first (check inbox).";
      } else if (mode === "register") {
        title.textContent = "Register";
        action.textContent = "Create account";
        msg.textContent = "We’ll email you a verification link.";
      } else if (mode === "forgot") {
        title.textContent = "Forgot password";
        action.textContent = "Send reset link";
        msg.textContent = "We’ll email you a reset link if the account exists.";
      } else if (mode === "reset") {
        title.textContent = "Reset password";
        action.textContent = "Set new password";
        msg.textContent = "Choose a new password (min 8 characters).";
      } else {
        title.textContent = "Verify email";
        action.textContent = "Verifying…";
        msg.textContent = "Confirming your email.";
      }

      if (mode === "verify") {
        const note = document.createElement("div");
        note.style.fontSize = "0.95rem";
        note.style.lineHeight = "1.35";
        note.style.marginBottom = "10px";
        note.textContent = "Confirming your email…";
        body.appendChild(note);
        if (opts.email) body.appendChild(email);
        body.appendChild(action);
      } else {
        body.appendChild(email);
        body.appendChild(password);
        body.appendChild(password2);
        body.appendChild(action);
      }

      action.addEventListener("click", async () => {
        const em = email.value.trim();
        const pw = password.value;
        const pw2 = password2.value;
        const linkToken = (opts.token || "").trim();

        if (!em) {
          msg.textContent = "Please enter your email.";
          return;
        }

        try {
          action.disabled = true;
          action.style.opacity = "0.7";

          if (mode === "login") {
            const out = await authLogin(em, pw);
            setAuthToken(out.access_token, em);
            msg.textContent = "Logged in ✔";
            syncAuthUi();
            setTimeout(closeModal, 450);
          } else if (mode === "register") {
            if (!pw || pw.length < 8) {
              msg.textContent = "Password must be at least 8 characters.";
              return;
            }
            if (pw !== pw2) {
              msg.textContent = "Passwords do not match.";
              return;
            }
            await authRegister(em, pw);
            msg.textContent = "Account created ✔ Check your email to verify.";
            setTimeout(closeModal, 700);
          } else if (mode === "forgot") {
            await authForgot(em);
            msg.textContent = "If that email exists, a reset link has been sent.";
          } else if (mode === "reset") {
            if (!linkToken) {
              msg.textContent = "Reset token missing. Please open the link from your email again.";
              return;
            }
            if (!pw || pw.length < 8) {
              msg.textContent = "Password must be at least 8 characters.";
              return;
            }
            if (pw !== pw2) {
              msg.textContent = "Passwords do not match.";
              return;
            }
            await authReset(em, linkToken, pw);
            msg.textContent = "Password updated ✔ You can log in now.";
            setTimeout(() => {
              try { history.replaceState({}, "", window.location.pathname + window.location.hash); } catch (e) {}
              closeModal();
              openModal("login", { email: em });
            }, 650);
          } else {
            // verify
            if (!opts.email || !linkToken) {
              msg.textContent = "Verification link incomplete. Please open the link from your email again.";
              return;
            }
            await authVerify(opts.email, linkToken);
            msg.textContent = "Email verified ✔ You can log in now.";
            setTimeout(() => {
              try { history.replaceState({}, "", window.location.pathname + window.location.hash); } catch (e) {}
              closeModal();
              openModal("login", { email: opts.email });
            }, 650);
          }
        } catch (e) {
          msg.textContent = e?.message ? String(e.message) : String(e);
        } finally {
          action.disabled = false;
          action.style.opacity = "1";
        }
      });
    }

      // Auto-run verification when opened from a link
      if (mode === "verify" && opts.token && opts.email) {
        setTimeout(() => action.click(), 50);
      }

    function closeModal() {
      modal.style.display = "none";
    }

    close.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (modal.style.display !== "none" && e.key === "Escape") closeModal();
    });

    loginBtn.addEventListener("click", () => openModal("login"));
    registerBtn.addEventListener("click", () => openModal("register"));
    forgotBtn.addEventListener("click", () => openModal("forgot"));

    logoutBtn.addEventListener("click", () => {
      clearAuthToken();
      syncAuthUi();
    });

    function syncAuthUi() {
      const token = getAuthToken();
      const email = getAuthEmail();
      if (token) {
        status.textContent = email ? `Signed in: ${email}` : "Signed in";
        logoutBtn.style.display = "inline-flex";
        loginBtn.style.display = "none";
        registerBtn.style.display = "none";
        forgotBtn.style.display = "none";
      } else {
        status.textContent = "Guest mode";
        logoutBtn.style.display = "none";
        loginBtn.style.display = "inline-flex";
        registerBtn.style.display = "inline-flex";
        forgotBtn.style.display = "inline-flex";
      }
    }

    bar.__owSyncAuthUi = syncAuthUi;
    window.__owOpenAuthModal = openModal;
    syncAuthUi();

    return bar;
  }

  async function authJson(path, payload) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });

    const text = await res.text().catch(() => "");
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: text }; }

    if (!res.ok) {
      const msg = data?.detail || data?.message || `Auth error (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  async function authRegister(email, password) {
    return authJson("/api/v1/auth/register", { email, password });
  }
  async function authLogin(email, password) {
    return authJson("/api/v1/auth/login", { email, password });
  }
  async function authForgot(email) {
    return authJson("/api/v1/auth/forgot", { email });
  }
  async function authVerify(email, token) {
    return authJson("/api/v1/auth/verify", { email, token });
  }
  async function authReset(email, token, new_password) {
    return authJson("/api/v1/auth/reset", { email, token, new_password });
  }

  // ---------------------------------
  // Workbench: backend merge
  // ---------------------------------

  const API_BASE = "https://autoweave-backend.onrender.com";

  // Auth bar (Login / Register / Forgot password)
  const _owAuthBar = ensureAuthBar();

  // Handle links from emails:
  //   Verify: ...?mode=verify&email=...&token=...
  //   Reset:  ...?mode=reset&email=...&token=...
  (function handleAuthLinks() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const mode = (params.get("mode") || "").trim().toLowerCase();
      const email = (params.get("email") || "").trim();
      const token = (params.get("token") || "").trim();

      if ((mode === "verify" || mode === "reset") && email && token && typeof window.__owOpenAuthModal === "function") {
        window.__owOpenAuthModal(mode, { email, token, lockEmail: true });
      }
    } catch (e) {
      // ignore
    }
  })();

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
          legend: wrap?.querySelector("div:nth-child(2)") || null,
          tip: wrap?.querySelector("div:last-child") || null,
        };
      };
      incomeBlock = getBlock("#owChartIncome");
      durationBlock = getBlock("#owChartDuration");
      ratioBlock = getBlock("#owChartRatio");
    }
  }

  const chartController =
    visCard && chartsArea && incomeBlock && durationBlock && ratioBlock
      ? createChartController({ visCard, chartsArea, incomeBlock, durationBlock, ratioBlock })
      : null;

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

    if (statsPanel) {
      clearNode(statsPanel);

      statsPanel.appendChild(
        makeSummaryGrid([
          { k: "Row count", v: formatInt(rowCount) },
          { k: "Time (hours)", v: formatNumber(totalDuration, 2) },
          { k: `Income (${incomeLabel})`, v: formatNumber(totalIncome, 2) },
          { k: "Average rate", v: formatNumber(overallRatio, 2) },
        ])
      );

      const topN = 8;

      const grid = document.createElement("div");
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
      grid.style.gap = "0.75rem";

      grid.appendChild(
        makeMiniTable(
          `Income`,
          incomeByProject.slice(0, topN).map((x) => ({ name: x.name, value: formatNumber(x.income, 2) })),
          { col1: "Project", col2: `${incomeLabel}` }
        )
      );

      grid.appendChild(
        makeMiniTable(
          "Time",
          durationByProject.slice(0, topN).map((x) => ({ name: x.name, value: formatNumber(x.duration, 2) })),
          { col1: "Project", col2: "Hours" }
        )
      );

      grid.appendChild(
        makeMiniTable(
          `Hourly rate`,
          ratioByProject.slice(0, topN).map((x) => ({ name: x.name, value: formatNumber(x.ratio, 2) })),
          { col1: "Project", col2: `${incomeLabel}/h` }
        )
      );

      statsPanel.appendChild(grid);
    }

    const maxProjects = 6;
    const topProjects = incomeByProject.slice(0, maxProjects).map((x) => x.name);
    const legendMore = Math.max(0, projArr.length - topProjects.length);

    const dates = sortIsoDates(dateSet);
    const { min: minDate, max: maxDate } = getMinMaxDates(dates);

    if (chartController) {
      chartController.setData({
        dates,
        topProjects,
        legendMore,
        incomeByDateProject,
        durationByDateProject,
        minDate,
        maxDate,
      });
    }
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

      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/v1/merge/autotrac`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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