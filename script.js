// script.js (full)
// - Guided example: local preview of a single CSV
// - Workbench: calls AutoWeave backend, renders preview/stats
// - Quick stats: row count, totals, ratios, per-project breakdowns
// - Visualisations: 3 stacked bar charts by date (income, duration, income/duration)
//   with AutoTrac Pro-style controls:
//   - pill buttons for range + grouping
//   - custom range date picker

(function () {
  // =========================================================
  // 0) Config
  // =========================================================
  // Prefer tech.html override if present
  const API_BASE = (window.AUTOWEAVE_API_BASE && String(window.AUTOWEAVE_API_BASE).trim()) || "https://autoweave-backend.onrender.com";
  const AUTH_STORAGE_KEY = "ow_auth_token";
  const AUTH_EMAIL_KEY = "ow_auth_email";
  console.log("AUTOWEAVE API_BASE =", API_BASE, "global =", window.AUTOWEAVE_API_BASE);

  // =========================================================
  // 1) Utilities
  // =========================================================
  function $(sel, root = document) {
    return root.querySelector(sel);
  }
  function $all(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function safeJsonParse(str, fallback = null) {
    try {
      return JSON.parse(str);
    } catch (e) {
      return fallback;
    }
  }

  function fmtMoney(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "0";
    return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function fmtHours(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "0";
    return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function fmtRatio(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "0";
    return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function isoDate(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseDateish(s) {
    if (!s) return null;
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) return dt;
    const m = String(s).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      const yy = Number(m[3]);
      const d2 = new Date(yy, mm - 1, dd);
      if (!Number.isNaN(d2.getTime())) return d2;
    }
    return null;
  }

  function sum(arr) {
    let t = 0;
    for (const x of arr) t += Number(x) || 0;
    return t;
  }

  function groupBy(arr, keyFn) {
    const m = new Map();
    for (const item of arr) {
      const k = keyFn(item);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(item);
    }
    return m;
  }

  function uniq(arr) {
    return Array.from(new Set(arr));
  }

  function debounce(fn, ms = 200) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // =========================================================
  // 2) Auth helpers
  // =========================================================
  function normalizeToken(raw) {
    if (!raw) return "";
    let t = String(raw).trim();

    // If token was stored as JSON string: "\"eyJ...\""
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      try { t = JSON.parse(t); } catch (e) { /* ignore */ }
      t = String(t).trim();
    }

    // If token was stored with Bearer prefix, strip it
    if (/^bearer\s+/i.test(t)) {
      t = t.replace(/^bearer\s+/i, "").trim();
    }

    return t;
  }

  function getAuthEmail() {
    try {
      return localStorage.getItem(AUTH_EMAIL_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function normalizeToken(raw) {
    if (!raw) return "";
    let t = String(raw).trim();

    // stored as "Bearer <jwt>" -> keep only jwt
    if (/^bearer\s+/i.test(t)) t = t.replace(/^bearer\s+/i, "").trim();

    // stored as a quoted JSON string -> unquote
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      try { t = JSON.parse(t); } catch (e) {}
      t = String(t).trim();
    }

    return t;
  }

  function getAuthToken() {
    try {
      return normalizeToken(localStorage.getItem(AUTH_STORAGE_KEY) || "");
    } catch (e) {
      return "";
    }
  }

  function setAuthToken(token, email) {
    try {
      const t = normalizeToken(token);

      if (t) localStorage.setItem(AUTH_STORAGE_KEY, t);
      else localStorage.removeItem(AUTH_STORAGE_KEY);

      if (email) localStorage.setItem(AUTH_EMAIL_KEY, String(email));
      else localStorage.removeItem(AUTH_EMAIL_KEY);
    } catch (e) {}
  }

  function clearAuthToken() {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(AUTH_EMAIL_KEY);
    } catch (e) {}
  }

  async function apiFetch(path, options = {}) {
    const token = getAuthToken();

    const headers = new Headers(options.headers || {});
    if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    // ✅ Always send Bearer <JWT> (cleaned)
    if (token) headers.set("Authorization", `Bearer ${token}`);

    console.log("apiFetch token length =", (token || "").length);
    console.log("apiFetch token preview =", (token || "").slice(0, 20));

    const res = await fetch(apiUrl(path), { ...options, headers });

    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const j = await res.json();
          msg = j?.detail || j?.message || msg;
        } else {
          const t = await res.text();
          if (t) msg = t;
        }
      } catch (e) {}
      const err = new Error(String(msg));
      err.status = res.status;
      throw err;
    }

    return res;
  }
  function getAuthEmail() {
    try {
      return localStorage.getItem(AUTH_EMAIL_KEY) || "";
    } catch (e) {
      return "";
    }
  }
  
  function clearAuthToken() {
    setAuthToken("", "");
  }

  function apiUrl(path) {
    const p = String(path || "");
    if (!API_BASE) return p.startsWith("/") ? p : `/${p}`;
    return `${API_BASE}${p.startsWith("/") ? "" : "/"}${p}`;
  }

  async function authRegister(email, password) {
    const res = await apiFetch("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return res.json();
  }

  async function authLogin(email, password) {
    const res = await apiFetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return res.json();
  }

  async function authForgot(email) {
    const res = await apiFetch("/api/v1/auth/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    return res.json();
  }

  async function authReset(email, token, new_password) {
    const res = await apiFetch("/api/v1/auth/reset", {
      method: "POST",
      body: JSON.stringify({ email, token, new_password }),
    });
    return res.json();
  }

  async function authVerify(email, token) {
    const res = await apiFetch("/api/v1/auth/verify", {
      method: "POST",
      body: JSON.stringify({ email, token }),
    });
    return res.json();
  }

  async function authResendVerify(email) {
    const res = await apiFetch("/api/v1/auth/resend-verify", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    return res.json();
  }

  // NEW: delete account (soft delete on backend)
  async function authDeleteAccount(email, password, confirm) {
    const res = await apiFetch("/api/v1/auth/delete-account", {
      method: "POST",
      body: JSON.stringify({ email, password, confirm }),
    });
    return res.json();
  }

  // =========================================================
  // 3) Visualisation helpers (lightweight stacked bars)
  // =========================================================
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

  function colorForProject(name, projectNames) {
    const idx = projectNames.indexOf(name);
    return PROJECT_COLORS[idx % PROJECT_COLORS.length];
  }

  function createEl(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    Object.assign(el, props);
    for (const c of children) {
      if (typeof c === "string") el.appendChild(document.createTextNode(c));
      else if (c) el.appendChild(c);
    }
    return el;
  }

  function stylePillButton(btn) {
    btn.className = "aw-pill";
    btn.style.display = "inline-flex";
    btn.style.alignItems = "center";
    btn.style.gap = "0.45rem";
    btn.style.padding = "0 12px";
    btn.style.height = "36px";
    btn.style.borderRadius = "9999px";
    btn.style.border = "1px solid rgba(15,31,23,0.14)";
    btn.style.background = "rgba(255,255,255,0.92)";
    btn.style.color = "rgba(15,31,23,0.86)";
    btn.style.fontWeight = "700";
    btn.style.letterSpacing = "0.02em";
    btn.style.textTransform = "uppercase";
    btn.style.cursor = "pointer";
    btn.style.userSelect = "none";
  }

  // NEW: danger look (still consistent with pill system)
  function stylePillDanger(btn) {
    stylePillButton(btn);
    btn.style.border = "1px solid rgba(185, 28, 28, 0.35)";
    btn.style.background = "rgba(220, 38, 38, 0.08)";
    btn.style.color = "rgba(185, 28, 28, 0.95)";
  }

  function setPillActive(btn, active) {
    if (active) {
      btn.style.background = "rgba(15,31,23,0.92)";
      btn.style.color = "white";
      btn.style.borderColor = "rgba(15,31,23,0.92)";
    } else {
      btn.style.background = "rgba(255,255,255,0.92)";
      btn.style.color = "rgba(15,31,23,0.86)";
      btn.style.borderColor = "rgba(15,31,23,0.14)";
    }
  }

  function clearEl(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }


  function ensureSharedLegend(anchorEl, projectNames) {
    try {
      const card = anchorEl ? anchorEl.closest(".aw-card") : null;
      if (!card) return;

      // Remove existing legend so we always stay in sync with current projects
      const existing = card.querySelector("#owSharedLegend");
      if (existing) existing.remove();

      // Place legend above the FIRST figure (Duration)
      const durationEl = card.querySelector("#visDuration") || card.querySelector("#visIncome") || anchorEl;

      const legend = document.createElement("div");
      legend.id = "owSharedLegend";
      legend.style.display = "flex";
      legend.style.flexWrap = "wrap";
      legend.style.gap = "10px 12px";
      legend.style.alignItems = "center";
      // Legend wrapper box removed (no border/background/padding)
      legend.style.padding = "0";
      legend.style.margin = "8px 0 12px 0";
      legend.style.border = "none";
      legend.style.borderRadius = "0";
      legend.style.background = "transparent";

      for (const p of projectNames) {
        const item = document.createElement("div");
        item.style.display = "inline-flex";
        item.style.alignItems = "center";
        item.style.gap = "8px";
        item.style.padding = "0";
        item.style.border = "none";
        item.style.background = "transparent";
        item.title = p;

        // ggplot-like key (small coloured square) + label
        const key = document.createElement("div");
        key.style.width = "10px";
        key.style.height = "10px";
        key.style.borderRadius = "2px";
        key.style.background = colorForProject(p, projectNames);
        key.style.border = "1px solid rgba(15,31,23,0.20)";

        const label = document.createElement("div");
        label.textContent = p;
        label.style.fontSize = "0.82rem";
        label.style.fontWeight = "800";
        label.style.color = "rgba(15,31,23,0.82)";
        label.style.whiteSpace = "nowrap";

        item.appendChild(key);
        item.appendChild(label);
        legend.appendChild(item);
      }

      // Insert legend once for all three figures (above Duration)
      if (durationEl && durationEl.parentElement) {
        durationEl.parentElement.insertBefore(legend, durationEl);
      } else {
        card.insertBefore(legend, card.firstChild);
      }
    } catch (e) {
      // silent
    }
  }

  function renderStackedBars(container, data, projectNames, valueKey, title) {
    clearEl(container);

    const header = createEl("div", { className: "aw-vis-header" }, [
      createEl("div", { className: "aw-vis-title", textContent: title }),
    ]);

    container.appendChild(header);

    // ggplot-like header
    try {
      header.style.margin = "0 0 8px 0";
      header.style.padding = "0";
      const t = header.querySelector(".aw-vis-title");
      if (t) {
        t.style.fontSize = "0.92rem";
        t.style.fontWeight = "900";
        t.style.letterSpacing = "0.08em";
        t.style.textTransform = "uppercase";
        t.style.color = "rgba(15,31,23,0.62)";
      }
    } catch (_) {}

    // Layout: Y-axis + chart area
    const barMaxHeight = 140; // px (kept consistent with existing scaling)
    const axisHeight = barMaxHeight + 18; // ticks align to bar panel only

    const wrap = createEl("div", { className: "aw-stacked-wrap" });
    // ggplot panel frame (light grey background, subtle border)
    wrap.style.border = "1px solid rgba(15,31,23,0.12)";
    wrap.style.borderRadius = "16px";
    wrap.style.background = "rgba(248,248,248,0.90)";
    wrap.style.boxShadow = "0 10px 24px rgba(15,31,23,0.08)";
    wrap.style.padding = "12px 12px 10px 12px";
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = "52px 1fr";
    wrap.style.gap = "10px";
    wrap.style.alignItems = "start";

    const yAxis = createEl("div", { className: "aw-y-axis" });
    yAxis.style.position = "relative";
    yAxis.style.opacity = "0.92";
    yAxis.style.height = `${axisHeight}px`;
    yAxis.style.marginTop = "8px";

    const yLine = createEl("div");
    yLine.style.position = "absolute";
    yLine.style.left = "46px";
    yLine.style.top = "0";
    yLine.style.bottom = "18px";
    yLine.style.width = "1px";
    yLine.style.background = "rgba(15,31,23,0.14)";
    yAxis.appendChild(yLine);

    // Right side = plot panel (bars) + x-axis labels (transparent)
    const plotCol = createEl("div");
    plotCol.style.display = "flex";
    plotCol.style.flexDirection = "column";
    plotCol.style.gap = "6px";

    // Bars panel (ONLY this area has the plot background/border)
    const chartArea = createEl("div", { className: "aw-stacked-chart" });
    chartArea.style.border = "1px solid rgba(15,31,23,0.10)";
    chartArea.style.borderRadius = "14px";
    chartArea.style.background = "rgba(255,255,255,0.86)";
    chartArea.style.padding = "10px 8px 8px 8px";
    chartArea.style.display = "grid";
    chartArea.style.gridTemplateColumns = `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))`;
    chartArea.style.gap = "8px";
    chartArea.style.alignItems = "end";

    // X-axis labels row (no background behind labels)
    const xAxis = createEl("div");
    xAxis.style.display = "grid";
    xAxis.style.gridTemplateColumns = `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))`;
    xAxis.style.gap = "8px";
    xAxis.style.alignItems = "end";
    xAxis.style.background = "transparent";
    xAxis.style.border = "none";
    xAxis.style.padding = "0 8px 0 8px";
    const maxTotal = Math.max(1, ...data.map(d => Number(d.total) || 0));

    // Y-axis ticks
    const ticks = [1, 0.75, 0.5, 0.25, 0];
    const fmtY = (v) => {
      if (valueKey === "count") return String(Math.round(v));
      if (valueKey === "ratio") return fmtRatio(v);
      if (valueKey === "hours") return fmtHours(v);
      return fmtMoney(v);
    };

    for (const t of ticks) {
      const v = maxTotal * t;
      const y = Math.round((1 - t) * barMaxHeight); // relative to bar area
      const tick = createEl("div");
      tick.style.position = "absolute";
      tick.style.left = "0";
      tick.style.right = "0";
      tick.style.top = `${y}px`;

      const txt = createEl("div", { textContent: fmtY(v) });
      txt.style.position = "absolute";
      txt.style.left = "0";
      txt.style.transform = "translateY(-50%)";
      txt.style.fontSize = "0.74rem";
      txt.style.fontWeight = "800";
      txt.style.color = "rgba(15,31,23,0.55)";
      txt.style.whiteSpace = "nowrap";

      const mark = createEl("div");
      mark.style.position = "absolute";
      mark.style.left = "44px";
      mark.style.width = "6px";
      mark.style.height = "1px";
      mark.style.background = "rgba(15,31,23,0.14)";
      mark.style.transform = "translateY(-50%)";

      tick.appendChild(txt);
      tick.appendChild(mark);
      yAxis.appendChild(tick);
    }

    for (const d of data) {
      const col = createEl("div", { className: "aw-bar-col" });
      col.style.display = "flex";
      col.style.flexDirection = "column";
      col.style.justifyContent = "flex-end";
      col.style.gap = "6px";
      col.style.alignItems = "center";

      const bar = createEl("div", { className: "aw-bar" });
      bar.style.width = "60%";
      bar.style.maxWidth = "24px";
      bar.style.height = `${Math.round((Number(d.total) || 0) / maxTotal * barMaxHeight)}px`;
      bar.style.borderRadius = "6px";
      bar.style.overflow = "hidden";
      bar.style.display = "flex";
      bar.style.flexDirection = "column-reverse";
      bar.style.boxShadow = "none";
      bar.style.border = "1px solid rgba(15,31,23,0.10)";
      bar.title = `${d.key}
Total: ${valueKey === "count" ? String(Math.round(Number(d.total)||0)) : (valueKey === "ratio" ? fmtRatio(d.total) : (valueKey === "hours" ? fmtHours(d.total) : fmtMoney(d.total)))}`;

      for (const p of projectNames) {
        const v = Number(d.values?.[p]) || 0;
        if (v <= 0) continue;
        const seg = createEl("div", { className: "aw-bar-seg" });
        const pct = (d.total > 0) ? (v / d.total) : 0;
        seg.style.height = `${pct * 100}%`;
        seg.style.background = colorForProject(p, projectNames);
        seg.style.opacity = "0.95"; seg.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,0.18)";
        seg.title = `${p}: ${valueKey === "count" ? String(Math.round(v)) : (valueKey === "ratio" ? fmtRatio(v) : (valueKey === "hours" ? fmtHours(v) : fmtMoney(v)))}`;
        bar.appendChild(seg);
      }

      // X-axis label (rotate 75 degrees)
      const labelBox = createEl("div");
      labelBox.style.height = "86px";
      labelBox.style.display = "flex";
      labelBox.style.alignItems = "flex-end";
      labelBox.style.justifyContent = "flex-end";
      labelBox.style.overflow = "visible";

      const label = createEl("div", { className: "aw-bar-label", textContent: d.key });
      label.style.fontSize = "0.8rem";
      label.style.textAlign = "left";
      label.style.color = "rgba(15,31,23,0.62)";
      label.style.whiteSpace = "nowrap";
      label.style.transform = "translateY(6px) rotate(-75deg)";
      label.style.transformOrigin = "bottom left";
      label.style.display = "inline-block";
      label.style.maxWidth = "160px";

      labelBox.appendChild(label);

      col.appendChild(bar);
      chartArea.appendChild(col);
      xAxis.appendChild(labelBox);
    }

    plotCol.appendChild(chartArea);
    plotCol.appendChild(xAxis);

    wrap.appendChild(yAxis);
    wrap.appendChild(plotCol);
    container.appendChild(wrap);
  }


  // =========================================================
  // 4) Parse merged CSV stats for visuals
  // =========================================================
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQ = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (inQ) {
        if (ch === '"' && next === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQ = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQ = true;
        } else if (ch === ",") {
          row.push(cur);
          cur = "";
        } else if (ch === "\n") {
          row.push(cur);
          rows.push(row);
          row = [];
          cur = "";
        } else if (ch === "\r") {
          // ignore
        } else {
          cur += ch;
        }
      }
    }
    if (cur.length > 0 || row.length > 0) {
      row.push(cur);
      rows.push(row);
    }
    return rows;
  }

  function rowsToObjects(rows) {
    if (!rows || rows.length === 0) return [];
    const header = rows[0].map(h => String(h || "").trim());
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const obj = {};
      for (let j = 0; j < header.length; j++) {
        obj[header[j]] = r[j] ?? "";
      }
      out.push(obj);
    }
    return out;
  }

  function normalizeMergedRow(obj) {
    const project = String(obj.project || obj.Project || obj.PROJECT || "").trim();
    const dateRaw = obj.work_date || obj.date || obj.workDate || obj.workDateISO || obj.workdate || "";
    const d = parseDateish(dateRaw);
    const work_date = d ? isoDate(d) : String(dateRaw || "").trim();

    const income = Number(obj.income ?? obj.Income ?? obj.amount ?? obj.Amount ?? 0) || 0;
    const duration = Number(obj.duration_hours ?? obj.duration ?? obj.hours ?? obj.Hours ?? 0) || 0;

    return { work_date, project, income, duration };
  }

  function buildQuickStatsTextFromMergedCsv(csvText) {
    const rows = parseCsv(csvText);
    const objs = rowsToObjects(rows);

    const normalized = objs
      .map(normalizeMergedRow)
      .filter(r => r.project && r.work_date);

    const totalIncome = sum(normalized.map(r => r.income));
    const totalHours = sum(normalized.map(r => r.duration));
    const ratio = totalHours > 0 ? (totalIncome / totalHours) : 0;

    const byProject = new Map();
    for (const r of normalized) {
      if (!byProject.has(r.project)) byProject.set(r.project, { income: 0, hours: 0 });
      const rec = byProject.get(r.project);
      rec.income += r.income;
      rec.hours += r.duration;
    }

    const lines = [];
    lines.push(`Total income: £${fmtMoney(totalIncome)}`);
    lines.push(`Total duration: ${fmtHours(totalHours)}`);
    lines.push(`Income / hour: £${fmtRatio(ratio)}`);
    lines.push("");
    lines.push("Project\tTotal income\tTotal duration\tIncome / hour");

    const projectsSorted = Array.from(byProject.entries())
      .sort((a, b) => (b[1].income - a[1].income) || (b[1].hours - a[1].hours) || a[0].localeCompare(b[0]));

    for (const [name, rec] of projectsSorted) {
      const pRatio = rec.hours > 0 ? (rec.income / rec.hours) : 0;
      lines.push(`${name}\t£${fmtMoney(rec.income)}\t${fmtHours(rec.hours)}\t£${fmtRatio(pRatio)}`);
    }

    return lines.join("\n");
  }

  // =========================================================
  // 4b) Quick stats (ggplot / tibble-style table render)
  //   - IMPORTANT: only remakes the Quick stats table
  //   - No other features/sections touched
  // =========================================================
  function renderQuickStatsGgTable(container, csvText) {
    if (!container) return;
    // container is a <div> (#statsMerged)
    container.innerHTML = "";

    // Parse + normalize
    const rows = parseCsv(csvText || "");
    const objs = rowsToObjects(rows);
    const normalized = objs
      .map(normalizeMergedRow)
      .filter(r => r.project && r.work_date);

    // Empty state
    if (!normalized.length) {
      const empty = document.createElement("div");
      empty.textContent = "No stats available (merged output has no parsable rows).";
      empty.style.color = "rgba(15,31,23,0.55)";
      empty.style.fontSize = "0.95rem";
      container.appendChild(empty);
      return;
    }

    const rowCount = normalized.length;
    const totalIncome = sum(normalized.map(r => r.income));
    const totalHours = sum(normalized.map(r => r.duration));
    const ratio = totalHours > 0 ? (totalIncome / totalHours) : 0;

    // Aggregate by project
    const byProject = new Map();
    for (const r of normalized) {
      if (!byProject.has(r.project)) byProject.set(r.project, { income: 0, hours: 0 });
      const rec = byProject.get(r.project);
      rec.income += r.income;
      rec.hours += r.duration;
    }

    const projectsSorted = Array.from(byProject.entries())
      .sort((a, b) => (b[1].income - a[1].income) || (b[1].hours - a[1].hours) || a[0].localeCompare(b[0]));

    // Wrapper (ggplot-like panel)
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "10px";
    wrap.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

    // Mini summary (like tibble header)
    const head = document.createElement("div");
    head.style.display = "flex";
    head.style.flexWrap = "wrap";
    head.style.gap = "10px";
    head.style.alignItems = "baseline";
    head.style.padding = "6px 8px";
    head.style.border = "1px solid rgba(15,31,23,0.10)";
    head.style.borderRadius = "12px";
    head.style.background = "rgba(255,255,255,0.72)";

    const title = document.createElement("div");
    title.textContent = "Overview";
    title.style.fontWeight = "800";
    title.style.letterSpacing = "0.02em";
    title.style.color = "rgba(15,31,23,0.86)";

    const meta = document.createElement("div");
    meta.textContent = `Number of projects: ${projectsSorted.length}  |         Number of entries: ${rowCount}`;
    meta.style.color = "rgba(15,31,23,0.62)";
    meta.style.fontWeight = "700";
    meta.style.marginLeft = "auto";

    head.appendChild(title);
    head.appendChild(meta);

    const kpis = document.createElement("div");
    kpis.style.display = "grid";
    kpis.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
    kpis.style.gap = "8px";

    function kpi(label, value) {
      const box = document.createElement("div");
      box.style.padding = "8px";
      box.style.border = "1px solid rgba(15,31,23,0.10)";
      box.style.borderRadius = "12px";
      box.style.background = "rgba(255,255,255,0.72)";
      const l = document.createElement("div");
      l.textContent = label;
      l.style.fontSize = "0.72rem";
      l.style.letterSpacing = "0.14em";
      l.style.textTransform = "uppercase";
      l.style.color = "rgba(15,31,23,0.55)";
      l.style.fontWeight = "800";
      const v = document.createElement("div");
      v.textContent = value;
      v.style.fontSize = "1.02rem";
      v.style.fontWeight = "900";
      v.style.color = "rgba(15,31,23,0.90)";
      v.style.marginTop = "3px";
      box.appendChild(l);
      box.appendChild(v);
      return box;
    }

    kpis.appendChild(kpi("Total income (£)", `${fmtMoney(totalIncome)}`));
    kpis.appendChild(kpi("Total time (h)", `${fmtHours(totalHours)}`));
    kpis.appendChild(kpi("Average ratio (£/h)", `${fmtRatio(ratio)}`));

    // Table (tibble-like)
    const tableWrap = document.createElement("div");
    tableWrap.style.border = "1px solid rgba(15,31,23,0.10)";
    tableWrap.style.borderRadius = "14px";
    tableWrap.style.background = "rgba(255,255,255,0.72)";
    tableWrap.style.overflow = "auto";

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "separate";
    table.style.borderSpacing = "0";
    table.style.fontSize = "0.92rem";

    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    const headers = [
      { t: "project", align: "left" },
      { t: "income (£)", align: "right" },
      { t: "time (h)", align: "right" },
      { t: "ratio (£/h)", align: "right" },
    ];
    for (const h of headers) {
      const th = document.createElement("th");
      th.textContent = h.t;
      th.style.position = "sticky";
      th.style.top = "0";
      th.style.background = "rgba(255,255,255,0.92)";
      th.style.borderBottom = "1px solid rgba(15,31,23,0.12)";
      th.style.padding = "10px 10px";
      th.style.textAlign = h.align;
      th.style.fontSize = "0.72rem";
      th.style.letterSpacing = "0.14em";
      th.style.textTransform = "uppercase";
      th.style.color = "rgba(15,31,23,0.55)";
      th.style.fontWeight = "900";
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    projectsSorted.forEach(([name, rec], idx) => {
      const tr = document.createElement("tr");
      tr.style.background = idx % 2 === 0 ? "rgba(15,31,23,0.02)" : "transparent";

      const pRatio = rec.hours > 0 ? (rec.income / rec.hours) : 0;

      const cells = [
        { v: name, align: "left", weight: "800", color: "rgba(15,31,23,0.86)" },
        { v: `${fmtMoney(rec.income)}`, align: "right" },
        { v: `${fmtHours(rec.hours)}`, align: "right" },
        { v: `${fmtRatio(pRatio)}`, align: "right" },
      ];

      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c.v;
        td.style.padding = "10px 10px";
        td.style.borderBottom = "1px solid rgba(15,31,23,0.08)";
        td.style.textAlign = c.align || "left";
        td.style.color = c.color || "rgba(15,31,23,0.75)";
        td.style.fontWeight = c.weight || "700";
        td.style.whiteSpace = "nowrap";
        if (c.align === "left") {
          td.style.maxWidth = "260px";
          td.style.overflow = "hidden";
          td.style.textOverflow = "ellipsis";
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);

    wrap.appendChild(head);
    wrap.appendChild(kpis);
    wrap.appendChild(tableWrap);
    container.appendChild(wrap);
  }


  function buildDailyProjectSeries(objs, group = "day") {
    const rows = objs
      .map(normalizeMergedRow)
      .filter(r => r.project && r.work_date);

    function keyForDate(iso) {
      const d = parseDateish(iso);
      if (!d) return iso;
      if (group === "year") {
        return `${d.getFullYear()}`;
      }
      if (group === "month") {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      }
      if (group === "week") {
        const dt = new Date(d);
        const day = (dt.getDay() + 6) % 7; // Monday=0
        dt.setDate(dt.getDate() - day);
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, "0");
        const dd = String(dt.getDate()).padStart(2, "0");
        return `${y}-W${m}${dd}`;
      }
      return isoDate(d);
    }

    const projectNames = uniq(rows.map(r => r.project)).sort((a, b) => a.localeCompare(b));

    const byKey = new Map();
    for (const r of rows) {
      const k = keyForDate(r.work_date);
      if (!byKey.has(k)) byKey.set(k, { key: k, valuesIncome: {}, valuesHours: {}, valuesRatio: {}, totalIncome: 0, totalHours: 0 });
      const rec = byKey.get(k);
      rec.valuesIncome[r.project] = (rec.valuesIncome[r.project] || 0) + r.income;
      rec.valuesHours[r.project] = (rec.valuesHours[r.project] || 0) + r.duration;
      rec.totalIncome += r.income;
      rec.totalHours += r.duration;
    }

    for (const rec of byKey.values()) {
      for (const p of projectNames) {
        const inc = Number(rec.valuesIncome[p] || 0);
        const hrs = Number(rec.valuesHours[p] || 0);
        rec.valuesRatio[p] = hrs > 0 ? (inc / hrs) : 0;
      }
      rec.totalRatio = rec.totalHours > 0 ? (rec.totalIncome / rec.totalHours) : 0;
    }

    const sorted = Array.from(byKey.values()).sort((a, b) => String(a.key).localeCompare(String(b.key)));
    return { projectNames, buckets: sorted };
  }

  // =========================================================
  // 5) Auth UI bar + modal
  // =========================================================
  function ensureAuthBar() {
    const workbench = document.querySelector(".aw-workbench");
    if (!workbench) return null;

    const existing = workbench.parentElement?.querySelector("#owAuthBar");
    if (existing) { try { existing.remove(); } catch (e) {} }

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
    status.style.fontWeight = "700";
    status.style.color = "rgba(15,31,23,0.75)";
    status.style.display = "inline-flex";
    status.style.alignItems = "center";
    status.style.gap = "0.5rem";

    const btnLogin = document.createElement("button");
    btnLogin.type = "button";
    stylePillButton(btnLogin);
    btnLogin.textContent = "Login";

    const btnRegister = document.createElement("button");
    btnRegister.type = "button";
    stylePillButton(btnRegister);
    btnRegister.textContent = "Register";

    const btnForgot = document.createElement("button");
    btnForgot.type = "button";
    stylePillButton(btnForgot);
    btnForgot.textContent = "Forgot password";

    const btnLogout = document.createElement("button");
    btnLogout.type = "button";
    stylePillButton(btnLogout);
    btnLogout.textContent = "Logout";

    // NEW: delete account button (danger)
    const btnDelete = document.createElement("button");
    btnDelete.type = "button";
    stylePillDanger(btnDelete);
    btnDelete.textContent = "Delete account";

    const hint = document.createElement("span");
    hint.style.fontSize = "0.95rem";
    hint.style.color = "rgba(15,31,23,0.62)";
    hint.textContent = "Sign in to securely weave your data.";

    left.appendChild(status);
    left.appendChild(hint);

    right.appendChild(btnLogin);
    right.appendChild(btnRegister);
    right.appendChild(btnForgot);
    right.appendChild(btnLogout);
    right.appendChild(btnDelete);

    bar.appendChild(left);
    bar.appendChild(right);

    workbench.parentElement?.insertBefore(bar, workbench);

    // Modal
    const modal = document.createElement("div");
    modal.id = "owAuthModal";
    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.background = "rgba(0,0,0,0.35)";
    modal.style.display = "none";
    modal.style.alignItems = "center";
    modal.style.justifyContent = "center";
    modal.style.zIndex = "9999";
    modal.style.padding = "24px";

    const panel = document.createElement("div");
    panel.style.width = "min(520px, 92vw)";
    panel.style.background = "rgba(255,255,255,0.98)";
    panel.style.border = "1px solid rgba(15,31,23,0.14)";
    panel.style.borderRadius = "18px";
    panel.style.boxShadow = "0 18px 40px rgba(0,0,0,0.15)";
    panel.style.padding = "18px";

    const head = document.createElement("div");
    head.style.display = "flex";
    head.style.justifyContent = "space-between";
    head.style.alignItems = "center";
    head.style.gap = "12px";
    head.style.marginBottom = "10px";

    const title = document.createElement("div");
    title.style.fontSize = "1.1rem";
    title.style.fontWeight = "800";
    title.style.color = "rgba(15,31,23,0.92)";
    title.textContent = "Account";

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.style.border = "none";
    close.style.background = "transparent";
    close.style.fontSize = "1.6rem";
    close.style.lineHeight = "1";
    close.style.cursor = "pointer";
    close.style.color = "rgba(15,31,23,0.70)";

    head.appendChild(title);
    head.appendChild(close);

    const msg = document.createElement("div");
    msg.style.fontSize = "0.95rem";
    msg.style.color = "rgba(15,31,23,0.70)";
    msg.style.margin = "6px 0 12px 0";

    const body = document.createElement("div");

    panel.appendChild(head);
    panel.appendChild(msg);
    panel.appendChild(body);

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

      const confirmText = document.createElement("input");
      confirmText.type = "text";
      confirmText.placeholder = 'Type DELETE to confirm';
      confirmText.style.width = "100%";
      confirmText.style.height = "42px";
      confirmText.style.borderRadius = "12px";
      confirmText.style.border = "1px solid rgba(15,31,23,0.14)";
      confirmText.style.padding = "0 12px";
      confirmText.style.marginBottom = "10px";
      confirmText.style.background = "white";

      const action = document.createElement("button");
      action.type = "button";
      stylePillButton(action);
      action.style.height = "42px";
      action.style.width = "100%";
      action.style.justifyContent = "center";

      const resend = document.createElement("button");
      resend.type = "button";
      stylePillButton(resend);
      resend.style.height = "42px";
      resend.style.width = "100%";
      resend.style.justifyContent = "center";
      resend.style.marginTop = "10px";
      resend.textContent = "Resend verification link";
      resend.style.display = "none";

      // Mode setup
      if (mode === "login") {
        title.textContent = "Login";
        action.textContent = "Login";
        msg.textContent = "Tip: verify your email first (check inbox).";
        password2.style.display = "none";
        confirmText.style.display = "none";
      } else if (mode === "register") {
        title.textContent = "Register";
        action.textContent = "Create account";
        msg.textContent = "We’ll email you a verification link.";
        confirmText.style.display = "none";
      } else if (mode === "forgot") {
        title.textContent = "Forgot password";
        action.textContent = "Send reset link";
        msg.textContent = "We’ll email you a reset link (if the account exists).";
        password.style.display = "none";
        password2.style.display = "none";
        confirmText.style.display = "none";
        resend.style.display = "inline-flex";
      } else if (mode === "reset") {
        title.textContent = "Reset password";
        action.textContent = "Set new password";
        msg.textContent = "Choose a new password (min 8 characters).";
        confirmText.style.display = "none";
      } else if (mode === "verify") {
        title.textContent = "Verify email";
        action.textContent = "Verify email";
        msg.textContent = "Confirming your email.";
        password.style.display = "none";
        password2.style.display = "none";
        confirmText.style.display = "none";
      } else if (mode === "delete") {
        title.textContent = "Delete account";
        stylePillDanger(action);
        action.style.height = "42px";
        action.style.width = "100%";
        action.style.justifyContent = "center";
        action.textContent = "DELETE MY ACCOUNT";
        msg.textContent = "This action cannot be undone. Confirm your password and type DELETE.";
        // email is shown but locked (for clarity)
        email.disabled = true;
        password2.style.display = "none";
      } else {
        title.textContent = "Account";
        password2.style.display = "none";
        confirmText.style.display = "none";
      }

      // Body layout
      if (mode === "verify") {
        const note = document.createElement("div");
        note.style.fontSize = "0.95rem";
        note.style.lineHeight = "1.35";
        note.style.marginBottom = "10px";
        note.textContent = "Confirming your email…";
        body.appendChild(note);
        if (opts.email) body.appendChild(email);
        body.appendChild(action);
      } else if (mode === "delete") {
        body.appendChild(email);
        body.appendChild(password);
        body.appendChild(confirmText);
        body.appendChild(action);
      } else {
        body.appendChild(email);
        body.appendChild(password);
        body.appendChild(password2);
        body.appendChild(action);
        if (mode === "forgot") body.appendChild(resend);
      }

      // Resend handler (scoped)
      resend.addEventListener("click", async () => {
        const em = email.value.trim();
        if (!em) {
          msg.textContent = "Please enter your email.";
          return;
        }
        try {
          resend.disabled = true;
          resend.style.opacity = "0.7";
          await authResendVerify(em);
          msg.textContent = "Verification email sent (if the account exists).";
        } catch (e) {
          msg.textContent = e?.message ? String(e.message) : String(e);
        } finally {
          resend.disabled = false;
          resend.style.opacity = "1";
        }
      });

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
            const token =
              out?.access_token ||
              out?.token ||
              out?.accessToken ||
              out?.jwt ||
              "";

            if (!token) {
              throw new Error("Login succeeded but token missing in response");
            }

            setAuthToken(token, em);
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

          } else if (mode === "verify") {
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

          } else if (mode === "delete") {
            const c = String(confirmText.value || "").trim().toUpperCase();
            if (c !== "DELETE") {
              msg.textContent = 'Please type "DELETE" to confirm.';
              return;
            }
            if (!pw) {
              msg.textContent = "Please enter your password.";
              return;
            }

            const deleteEmailInput = document.getElementById("delete-email");
            const deletePasswordInput = document.getElementById("delete-password");
            const deleteConfirmInput = document.getElementById("delete-confirm");

            deleteForm.addEventListener("submit", async (e) => {
              e.preventDefault();

              try {
                const email = deleteEmailInput.value.trim();
                const password = deletePasswordInput.value;
                const confirm = deleteConfirmInput.value;

                await authDeleteAccount(email, password, confirm);

                alert("Account deleted.");
                clearAuthToken();
                location.reload();
              } catch (err) {
                deleteError.textContent = err.message || "Delete failed";
              }
            });

            // Clear session
            clearAuthToken();
            syncAuthUi();

            msg.textContent = "Account deleted ✔";
            setTimeout(closeModal, 650);

          } else {
            msg.textContent = "Unknown action.";
          }
        } catch (e) {
          const emsg = e?.message ? String(e.message) : String(e);
          msg.textContent = emsg;

          if (mode === "login" && /verify|verification/i.test(emsg)) {
            resend.style.display = "inline-flex";
          }
        } finally {
          action.disabled = false;
          action.style.opacity = "1";
        }
      });

      if (mode === "verify" && opts.token && opts.email) {
        setTimeout(() => action.click(), 50);
      }
    }

    function closeModal() {
      modal.style.display = "none";
    }

    close.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    function syncAuthUi() {
      const token = getAuthToken();
      const email = getAuthEmail();
      const signedIn = Boolean(token);

      if (!signedIn) {
        // optional: also clear email so UI doesn't lie
        // localStorage.removeItem(AUTH_EMAIL_KEY);
      }
      const authed = !!token;

      status.textContent = authed ? `Signed in: ${email || "account"}` : "Signed out";

      btnLogin.style.display = authed ? "none" : "inline-flex";
      btnRegister.style.display = authed ? "none" : "inline-flex";
      btnForgot.style.display = authed ? "none" : "inline-flex";
      btnLogout.style.display = authed ? "inline-flex" : "none";
      btnDelete.style.display = authed ? "inline-flex" : "none";

      hint.style.display = authed ? "none" : "inline";
    }

    btnLogin.addEventListener("click", () => openModal("login"));
    btnRegister.addEventListener("click", () => openModal("register"));
    btnForgot.addEventListener("click", () => openModal("forgot"));
    btnLogout.addEventListener("click", () => {
      clearAuthToken();
      syncAuthUi();
    });

    // NEW: open delete modal (requires being logged in)
    btnDelete.addEventListener("click", () => {
      const em = getAuthEmail();
      if (!getAuthToken()) return;
      openModal("delete", { email: em, lockEmail: true });
    });

    function handleAuthLinkFromUrl() {
      const url = new URL(window.location.href);
      const mode = url.searchParams.get("mode") || "";
      const email = url.searchParams.get("email") || "";
      const token = url.searchParams.get("token") || "";

      if (mode === "verify" && email && token) {
        openModal("verify", { email, token, lockEmail: true });
      }
      if (mode === "reset" && email && token) {
        openModal("reset", { email, token, lockEmail: true });
      }
    }

    syncAuthUi();
    handleAuthLinkFromUrl();

    return bar;
  }

  // =========================================================
  // 6) Workbench wiring (upload + merge)
  // =========================================================
  function initWorkbench() {
    const incomesFile = document.getElementById("incomesFile");
    const entriesFile = document.getElementById("entriesFile");
    const projectsFile = document.getElementById("projectsFile");
    const runMergeBtn = document.getElementById("runMergeBtn");
    const resetAllBtn = document.getElementById("resetAllBtn");

    const statusBox = document.getElementById("statusBox");
    const previewMerged = document.getElementById("previewMerged");
    const statsMerged = document.getElementById("statsMerged");
    const downloadBtn = document.getElementById("downloadBtn");

    function setBoxText(el, txt) {
      if (!el) return;
      if (typeof el.value === "string") el.value = txt;
      else el.textContent = txt;
    }

    if (!incomesFile || !entriesFile ||
        !runMergeBtn || !statusBox || !previewMerged || !statsMerged || !downloadBtn) {
      return;
    }

    function setStatus(text) {
      statusBox.textContent = text || "";
    }

    function clearVisuals() {
      const visIncome = document.getElementById("visIncome");
      const visDuration = document.getElementById("visDuration");
      const visRatio = document.getElementById("visRatio");
      if (visIncome) clearEl(visIncome);
      if (visDuration) clearEl(visDuration);
      if (visRatio) clearEl(visRatio);
    }


// Keep spacing between the three figures consistent by normalising only the
// spacer elements that sit BETWEEN the figure containers (no other layout touched).
function normalizeFigureGap(cardEl, fromId, toId, gapPx) {
  if (!cardEl) return;
  const fromEl = cardEl.querySelector(`#${fromId}`);
  const toEl = cardEl.querySelector(`#${toId}`);
  if (!fromEl || !toEl) return;

  // Walk siblings between fromEl and toEl and normalise only spacer blocks.
  let node = fromEl.nextElementSibling;
  let firstSpacerSeen = false;

  while (node && node !== toEl) {
    const cls = String(node.className || "");
    const isSpacer = /\bspacer\b/i.test(cls) || /\bspacer-/.test(cls);
    if (isSpacer) {
      // Keep the first spacer at gapPx; collapse any additional spacers to avoid stacking.
      node.style.height = (firstSpacerSeen ? 0 : gapPx) + "px";
      node.style.margin = "0";
      node.style.padding = "0";
      firstSpacerSeen = true;
    }
    node = node.nextElementSibling;
  }
}

    function renderVisualsFromMergedCsv(csvText) {
      // Keep the latest merged CSV so controls can re-render without re-merging
      lastMergedCsv = String(csvText || "");

      const rows = parseCsv(lastMergedCsv);
      const objs = rowsToObjects(rows);

      // Normalize once, then filter by date range
      const normalizedAll = objs
        .map(normalizeMergedRow)
        .filter(r => r.project && r.work_date);

      // If no rows, just clear
      const visIncome = document.getElementById("visIncome");
      const visDuration = document.getElementById("visDuration");
      const visRatio = document.getElementById("visRatio");
      if (!visIncome || !visDuration || !visRatio) return;

      // Equalise the gap between figures (Duration↔Income and Income↔Ratio)
      const GAP = 32;
      visDuration.style.marginBottom = GAP + "px";
      visIncome.style.marginBottom = "0px";
      visRatio.style.marginBottom = "0px";

      // Normalise only the spacer blocks between the figure containers (if present in tech.html)
      const card = visIncome.closest(".aw-card");
      normalizeFigureGap(card, "visDuration", "visIncome", GAP);
      normalizeFigureGap(card, "visIncome", "visRatio", GAP);

      // Swap Duration/Income positions in the DOM once (no HTML changes)
      if (!_owSwappedVisOrder) {
        try {
          const pI = visIncome.parentElement;
          const pD = visDuration.parentElement;
          if (pI && pI === pD) {
            // Move duration before income
            pI.insertBefore(visDuration, visIncome);
          }
        } catch (e) {}
        _owSwappedVisOrder = true;
      }

      if (!normalizedAll.length) {
        clearEl(visIncome); clearEl(visDuration); clearEl(visRatio);
        return;
      }

      function toDate(iso) {
        const d = parseDateish(iso);
        return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null;
      }

      function maxDate(rows_) {
        let mx = null;
        for (const r of rows_) {
          const d = toDate(r.work_date);
          if (!d) continue;
          if (!mx || d.getTime() > mx.getTime()) mx = d;
        }
        return mx;
      }

      function filterByRange(rows_) {
        const mode = visState.range;

        if (!mode || mode === "all") return rows_;

        // Determine from/to
        let from = null;
        let to = null;

        if (mode === "custom") {
          from = toDate(visState.customFrom);
          to = toDate(visState.customTo);
        } else {
          const days = Number(mode) || 0; // "14" | "30" | "90"
          const mx = maxDate(rows_);
          if (!mx || !days) return rows_;
          to = mx;
          from = new Date(mx);
          from.setDate(from.getDate() - (days - 1));
        }

        if (!from && !to) return rows_;

        const fromT = from ? from.getTime() : -Infinity;
        const toT = to ? to.getTime() : Infinity;

        return rows_.filter(r => {
          const d = toDate(r.work_date);
          if (!d) return false;
          const t = d.getTime();
          return t >= fromT && t <= toT;
        });
      }

      const normalized = filterByRange(normalizedAll);

      // Grouping is driven by hidden select for backwards compatibility
      const groupSel = document.getElementById("groupBySel");
      const group = groupSel ? String(groupSel.value || "day") : "day";

      const { projectNames, buckets } = buildDailyProjectSeries(normalized, group);

      // Shared legend across all three figures
      ensureSharedLegend(visIncome, projectNames);

      // Keep mode in sync with the legacy cumulative flag (back-compat)
      visState.cumulative = (visState.mode === "cumulative");

      // Build per-bucket series (nominal default)
      let incomeSeries = buckets.map(b => ({ key: b.key, values: b.valuesIncome, total: b.totalIncome }));
      let hoursSeries = buckets.map(b => ({ key: b.key, values: b.valuesHours, total: b.totalHours }));
      let ratioSeries = buckets.map(b => ({ key: b.key, values: b.valuesRatio, total: b.totalRatio }));

      // Optional cumulative mode (income + duration; ratio derived)
      if (visState.cumulative) {
        const runIncome = {};
        const runHours = {};
        let runTotalIncome = 0;
        let runTotalHours = 0;

        incomeSeries = incomeSeries.map((b) => {
          const values = { ...b.values };
          for (const p of projectNames) {
            runIncome[p] = (runIncome[p] || 0) + (Number(values[p]) || 0);
            values[p] = runIncome[p];
          }
          runTotalIncome += Number(b.total) || 0;
          return { key: b.key, values, total: runTotalIncome };
        });

        hoursSeries = hoursSeries.map((b) => {
          const values = { ...b.values };
          for (const p of projectNames) {
            runHours[p] = (runHours[p] || 0) + (Number(values[p]) || 0);
            values[p] = runHours[p];
          }
          runTotalHours += Number(b.total) || 0;
          return { key: b.key, values, total: runTotalHours };
        });

        ratioSeries = incomeSeries.map((b, idx) => {
          const values = {};
          for (const p of projectNames) {
            const inc = Number(incomeSeries[idx]?.values?.[p]) || 0;
            const hrs = Number(hoursSeries[idx]?.values?.[p]) || 0;
            values[p] = hrs > 0 ? (inc / hrs) : 0;
          }
          const totInc = Number(incomeSeries[idx]?.total) || 0;
          const totHrs = Number(hoursSeries[idx]?.total) || 0;
          const total = totHrs > 0 ? (totInc / totHrs) : 0;
          return { key: b.key, values, total };
        });
      }

      // Render (mode-aware labels)
      if (visState.mode === "frequency") {
        renderStackedBars(visDuration, hoursSeries, projectNames, "count", "Frequency by project");
        renderStackedBars(visIncome, incomeSeries, projectNames, "count", "Frequency by project");
        renderStackedBars(visRatio, ratioSeries, projectNames, "count", "Frequency by project");
      } else {
        renderStackedBars(visDuration, hoursSeries, projectNames, "hours", "Time by project (hours)");
        renderStackedBars(visIncome, incomeSeries, projectNames, "money", "Income by project (GBP)");
        renderStackedBars(visRatio, ratioSeries, projectNames, "ratio", "Ratio by project (GBP/hour)");
      }
    }

    // ------------------------------
    // Visualisation controls wiring
    // ------------------------------
    let lastMergedCsv = "";
    const visState = {
      range: "all",          // "14" | "30" | "90" | "all" | "custom"
      customFrom: "",
      customTo: "",
      // Mode: "nominal" (default), "cumulative"
      mode: "nominal",
      // Back-compat flag used by existing logic (derived from mode)
      cumulative: false,
    };

    // Visual order: Duration first, then Income, then Ratio (swap in DOM once)
    let _owSwappedVisOrder = false;


    function getCurrentMergedCsvText() {
      return (typeof previewMerged.value === "string") ? String(previewMerged.value || "") : String(previewMerged.textContent || "");
    }

    function rerenderFromState() {
      const txt = lastMergedCsv || getCurrentMergedCsvText();
      if (txt) renderVisualsFromMergedCsv(txt);
    }

    function exportVisualsAsPng() {
      return exportVisuals("png");
    }

    function exportVisualsAsSvg() {
      return exportVisuals("svg");
    }

    function exportVisualsAsJpg() {
      return exportVisuals("jpg");
    }

    function exportVisuals(kind) {
      // Export ONLY the charts (do NOT include Range/Group/Mode/Export buttons)
      const vd = document.getElementById("visDuration");
      const vi = document.getElementById("visIncome");
      const vr = document.getElementById("visRatio");
      const card = vi?.closest(".aw-card") || null;
      if (!vi || !vd || !vr || !card) return;

      // Build an export-only container (charts + spacing)
      const exportRoot = document.createElement("div");
      exportRoot.style.background = "white";
      exportRoot.style.padding = "14px";
      exportRoot.style.boxSizing = "border-box";
      exportRoot.style.width = `${Math.max(320, card.clientWidth || card.scrollWidth || 320)}px`;

      exportRoot.appendChild(vd.cloneNode(true));
      const sp1 = document.createElement("div");
      sp1.style.height = "24px";
      exportRoot.appendChild(sp1);
      exportRoot.appendChild(vi.cloneNode(true));
      const sp2 = document.createElement("div");
      sp2.style.height = "24px";
      exportRoot.appendChild(sp2);
      exportRoot.appendChild(vr.cloneNode(true));

      // Measure by temporarily mounting off-screen (accurate height)
      const measurer = document.createElement("div");
      measurer.style.position = "fixed";
      measurer.style.left = "-99999px";
      measurer.style.top = "0";
      measurer.style.opacity = "0";
      measurer.style.pointerEvents = "none";
      measurer.appendChild(exportRoot);
      document.body.appendChild(measurer);

      const w = Math.max(300, exportRoot.scrollWidth);
      const h = Math.max(200, exportRoot.scrollHeight);

      measurer.remove();

      // Build a self-contained SVG (foreignObject)
      const xmlns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(xmlns, "svg");
      svg.setAttribute("xmlns", xmlns);
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));

      const fo = document.createElementNS(xmlns, "foreignObject");
      fo.setAttribute("x", "0");
      fo.setAttribute("y", "0");
      fo.setAttribute("width", String(w));
      fo.setAttribute("height", String(h));

      // Wrap exportRoot inside a container with a solid background (consistent export)
      const wrap = document.createElement("div");
      wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      wrap.style.width = `${w}px`;
      wrap.style.height = `${h}px`;
      wrap.style.background = "white";
      wrap.style.padding = "0";
      wrap.style.margin = "0";
      wrap.style.boxSizing = "border-box";
      wrap.appendChild(exportRoot);

      fo.appendChild(wrap);
      svg.appendChild(fo);

      const svgData = new XMLSerializer().serializeToString(svg);

      // SVG export (direct)
      if (kind === "svg") {
        const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
        const dl = document.createElement("a");
        dl.href = URL.createObjectURL(blob);
        dl.download = "autoweave_visualisations.svg";
        document.body.appendChild(dl);
        dl.click();
        dl.remove();
        setTimeout(() => URL.revokeObjectURL(dl.href), 5000);
        return;
      }

      // Raster export (PNG / JPG) via canvas
      // Use a data: URL (more reliable than blob: URL across browsers)
      const svgDataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgData);

      const img = new Image();
      // Some browsers are picky about when decoding happens for SVG foreignObject
      img.decoding = "sync";

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // For JPG, paint a white background first (JPG has no alpha)
        if (kind === "jpg") {
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        ctx.drawImage(img, 0, 0);

        const mime = (kind === "jpg") ? "image/jpeg" : "image/png";
        const ext = (kind === "jpg") ? "jpg" : "png";

        const triggerDownload = (href) => {
          const a = document.createElement("a");
          a.href = href;
          a.download = `autoweave_visualisations.${ext}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        };

        // Prefer Blob URL for large exports; fall back to data URL if toBlob is unavailable/null
        const quality = (kind === "jpg") ? 0.92 : undefined;

        if (canvas.toBlob) {
          canvas.toBlob((blob) => {
            if (blob) {
              const blobUrl = URL.createObjectURL(blob);
              triggerDownload(blobUrl);
              setTimeout(() => URL.revokeObjectURL(blobUrl), 8000);
            } else {
              // Fallback (some environments return null)
              triggerDownload(canvas.toDataURL(mime, quality));
            }
          }, mime, quality);
        } else {
          triggerDownload(canvas.toDataURL(mime, quality));
        }
      };

      img.onerror = () => {
        // If the SVG foreignObject can't be rasterised (browser limitation),
        // fall back to downloading the SVG itself (so user still gets an export).
        const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "autoweave_visualisations.svg";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 8000);
      };

      img.src = svgDataUrl;
    }

    function initVisControlsOnce() {
      const rangeWrap = document.getElementById("owRangePills");
      const groupWrap = document.getElementById("owGroupPills");
      const modeWrap = document.getElementById("owModePills");
      const modeNominalBtnId = "owModeNominal";
      const modeCumuBtnId = "owModeCumulative";
      const exportBtn = document.getElementById("owExportPng");

      // Ensure mode buttons exist (do NOT remove any existing buttons)
      function ensureModeBtn(id, label) {
        let btn = document.getElementById(id);
        if (!btn && modeWrap) {
          btn = document.createElement("button");
          btn.type = "button";
          btn.id = id;
          btn.textContent = label;
          modeWrap.insertBefore(btn, exportBtn || null);
        }
        return btn;
      }

      const modeNominalBtn = ensureModeBtn(modeNominalBtnId, "Nominal");
      const modeBtn = document.getElementById(modeCumuBtnId);

      const customBox = document.getElementById("owRangeCustomInputs");
      const fromInput = document.getElementById("owFromDate");
      const toInput = document.getElementById("owToDate");
      const applyBtn = document.getElementById("owApplyCustom");
      const groupSel = document.getElementById("groupBySel");

      // -------------------------------------------------------
      // Export option row (PNG default, plus SVG/JPG)
      // - ONLY affects export controls (does not touch mode/range/group)
      // -------------------------------------------------------
      let exportPills = document.getElementById("owExportPills");
      let exportSvgBtn = document.getElementById("owExportSvg");
      let exportJpgBtn = document.getElementById("owExportJpg");

      if (!exportPills && modeWrap && exportBtn) {
        // Find the existing MODE row and insert a new EXPORT row right after it
        const modeRow = modeWrap.closest('div[style*="justify-content:space-between"]') || null;
        if (modeRow && modeRow.parentElement) {
          const exportRow = document.createElement("div");
          exportRow.style.display = "flex";
          exportRow.style.flexWrap = "wrap";
          exportRow.style.gap = "0.5rem";
          exportRow.style.alignItems = "center";
          exportRow.style.justifyContent = "space-between";

          const exportInner = document.createElement("div");
          exportInner.style.display = "flex";
          exportInner.style.flexWrap = "wrap";
          exportInner.style.gap = "0.5rem";
          exportInner.style.alignItems = "center";

          const exportLabel = document.createElement("div");
          exportLabel.style.minWidth = "110px";
          exportLabel.style.fontSize = "0.78rem";
          exportLabel.style.letterSpacing = "0.06em";
          exportLabel.style.fontWeight = "800";
          exportLabel.style.color = "rgba(15,31,23,0.55)";
          exportLabel.style.textTransform = "uppercase";
          exportLabel.textContent = "Export";

          exportPills = document.createElement("div");
          exportPills.id = "owExportPills";
          exportPills.style.display = "flex";
          exportPills.style.flexWrap = "wrap";
          exportPills.style.gap = "0.5rem";

          // Move existing PNG button out of mode pills into export pills
          if (exportBtn.parentElement) exportBtn.parentElement.removeChild(exportBtn);
          exportBtn.textContent = "PNG";
          exportPills.appendChild(exportBtn);

          // Add SVG + JPG buttons (new)
          exportSvgBtn = document.createElement("button");
          exportSvgBtn.type = "button";
          exportSvgBtn.id = "owExportSvg";
          exportSvgBtn.textContent = "SVG";
          exportPills.appendChild(exportSvgBtn);

          exportJpgBtn = document.createElement("button");
          exportJpgBtn.type = "button";
          exportJpgBtn.id = "owExportJpg";
          exportJpgBtn.textContent = "JPG";
          exportPills.appendChild(exportJpgBtn);

          exportInner.appendChild(exportLabel);
          exportInner.appendChild(exportPills);
          exportRow.appendChild(exportInner);

          modeRow.insertAdjacentElement("afterend", exportRow);
        }
      }

      if (!rangeWrap || !groupWrap || !exportBtn || !groupSel) return;
      if (!modeNominalBtn || !modeBtn) return;

      // Prevent double-binding
      if (rangeWrap.dataset.bound === "1") return;
      rangeWrap.dataset.bound = "1";

      // Style pills (re-using existing helper)
      const rangeBtns = [
        document.getElementById("owRange14"),
        document.getElementById("owRange30"),
        document.getElementById("owRange90"),
        document.getElementById("owRangeAll"),
        document.getElementById("owRangeCustom"),
      ].filter(Boolean);

      const groupBtns = [
        document.getElementById("owGroupDay"),
        document.getElementById("owGroupWeek"),
        document.getElementById("owGroupMonth"),
        document.getElementById("owGroupYear"),
      ].filter(Boolean);

      const modeBtns = [modeNominalBtn, modeBtn].filter(Boolean);

      for (const b of [...rangeBtns, ...groupBtns, modeNominalBtn, modeBtn, exportBtn, exportSvgBtn, exportJpgBtn].filter(Boolean)) stylePillButton(b);

      function setActive(btns, activeBtn) {
        btns.forEach(b => setPillActive(b, b === activeBtn));
      }

      // Default states
      setActive(rangeBtns, document.getElementById("owRangeAll") || rangeBtns[0]);
      setActive(groupBtns, document.getElementById("owGroupDay") || groupBtns[0]);
      // Mode defaults to nominal
      if (!visState.mode) visState.mode = "nominal";
      visState.cumulative = (visState.mode === "cumulative");
      if (visState.mode === "cumulative") setActive(modeBtns, modeBtn);
      else setActive(modeBtns, modeNominalBtn);

      // Export pills: default PNG selected (no effect on rendering, only export format)
      const exportBtns = [exportBtn, exportSvgBtn, exportJpgBtn].filter(Boolean);
      function setActiveExport(activeBtn) {
        exportBtns.forEach(b => setPillActive(b, b === activeBtn));
      }

      function setRange(mode) {
        visState.range = mode;
        if (customBox) customBox.style.display = (mode === "custom") ? "flex" : "none";
        rerenderFromState();
      }

      // Range handlers
      document.getElementById("owRange14")?.addEventListener("click", () => { setActive(rangeBtns, document.getElementById("owRange14")); setRange("14"); });
      document.getElementById("owRange30")?.addEventListener("click", () => { setActive(rangeBtns, document.getElementById("owRange30")); setRange("30"); });
      document.getElementById("owRange90")?.addEventListener("click", () => { setActive(rangeBtns, document.getElementById("owRange90")); setRange("90"); });
      document.getElementById("owRangeAll")?.addEventListener("click", () => { setActive(rangeBtns, document.getElementById("owRangeAll")); setRange("all"); });
      document.getElementById("owRangeCustom")?.addEventListener("click", () => {
        setActive(rangeBtns, document.getElementById("owRangeCustom"));
        if (customBox) customBox.style.display = "flex";

        // Pre-fill custom range from data (if possible)
        const txt = lastMergedCsv || getCurrentMergedCsvText();
        if (txt) {
          const rows = parseCsv(txt);
          const objs = rowsToObjects(rows);
          const normalized = objs.map(normalizeMergedRow).filter(r => r.project && r.work_date);
          const dates = normalized.map(r => parseDateish(r.work_date)).filter(Boolean).sort((a, b) => a - b);
          if (dates.length) {
            const from = isoDate(dates[0]);
            const to = isoDate(dates[dates.length - 1]);
            if (fromInput && !fromInput.value) fromInput.value = from;
            if (toInput && !toInput.value) toInput.value = to;
          }
        }

        visState.range = "custom";
        rerenderFromState();
      });

      applyBtn?.addEventListener("click", () => {
        visState.range = "custom";
        visState.customFrom = fromInput?.value || "";
        visState.customTo = toInput?.value || "";
        rerenderFromState();
      });

      // Group handlers (drive hidden select to preserve existing logic)
      function setGroup(v, activeId) {
        groupSel.value = v;
        groupSel.dispatchEvent(new Event("change"));
        setActive(groupBtns, document.getElementById(activeId) || null);
      }
      document.getElementById("owGroupDay")?.addEventListener("click", () => setGroup("day", "owGroupDay"));
      document.getElementById("owGroupWeek")?.addEventListener("click", () => setGroup("week", "owGroupWeek"));
      document.getElementById("owGroupMonth")?.addEventListener("click", () => setGroup("month", "owGroupMonth"));
      document.getElementById("owGroupYear")?.addEventListener("click", () => setGroup("year", "owGroupYear"));

      // Mode (radio-style: Nominal (default), Cumulative)
      function setMode(mode) {
        visState.mode = mode;
        visState.cumulative = (mode === "cumulative"); // back-compat
        setActive(modeBtns, mode === "cumulative" ? modeBtn : modeNominalBtn);
        rerenderFromState();
      }

      modeNominalBtn.addEventListener("click", () => setMode("nominal"));
      modeBtn.addEventListener("click", () => setMode("cumulative"));

      // Export
      exportBtn.addEventListener("click", () => { setActiveExport(exportBtn); exportVisualsAsPng(); });
      exportSvgBtn?.addEventListener("click", () => { setActiveExport(exportSvgBtn); exportVisualsAsSvg(); });
      exportJpgBtn?.addEventListener("click", () => { setActiveExport(exportJpgBtn); exportVisualsAsJpg(); });
    }

    // Init controls once on workbench init
    initVisControlsOnce();

    function resetAll() {
      if (projectsFile) projectsFile.value = "";
      incomesFile.value = "";
      entriesFile.value = "";

      setBoxText(previewMerged, "");
      if (statsMerged) statsMerged.innerHTML = "";
      setStatus("");

      downloadBtn.style.display = "none";
      downloadBtn.removeAttribute("href");
      clearVisuals();
    }

    resetAllBtn?.addEventListener("click", resetAll);

    const groupSel = document.getElementById("groupBySel");
    if (groupSel) {
      groupSel.addEventListener("change", () => {
        const txt = (typeof previewMerged.value === "string") ? previewMerged.value : previewMerged.textContent;
        if (txt) renderVisualsFromMergedCsv(txt);
      });
    }

    runMergeBtn.addEventListener("click", async () => {
      const entries = entriesFile.files?.[0];
      const incomes = incomesFile.files?.[0];
      const projects = projectsFile?.files?.[0] || null;

      if (!entries || !incomes) {
        setStatus("Please upload both Time entries and Incomes CSVs.");
        return;
      }

      downloadBtn.style.display = "none";
      downloadBtn.removeAttribute("href");
      setBoxText(previewMerged, "");
      if (statsMerged) statsMerged.innerHTML = "";
      clearVisuals();

      setStatus("Uploading files…");

      const form = new FormData();
      form.append("time_entries_csv", entries);
      form.append("incomes_csv", incomes);
      if (projects) form.append("projects_csv", projects);

      try {
        const res = await apiFetch("/api/v1/merge/autotrac", {
          method: "POST",
          body: form,
        });

        const data = await res.json();
        const hasCsv = typeof data.download_csv === "string" && data.download_csv.length > 0;
        if (!hasCsv) {
          setStatus(`No output CSV returned.`);
          return;
        }

        const csv = data.download_csv;
        setBoxText(previewMerged, csv);

        // Quick stats: ggplot / tibble-like table
        renderQuickStatsGgTable(statsMerged, csv);

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        downloadBtn.href = url;
        downloadBtn.download = "merged.csv";
        downloadBtn.style.display = "inline-flex";

        setStatus("Merge complete ✔");
        renderVisualsFromMergedCsv(csv);

      } catch (e) {
        const msg = e?.message ? String(e.message) : String(e);
        setStatus(`Error: ${msg}`);
      }
    });
  
    // ---------------------------------------------------------
    // Auto-load sample CSVs from /assets/technology on page load
    // (only if user hasn't selected files) and run merge once
    // ---------------------------------------------------------
    async function maybeLoadDefaultSamples() {
      const hasEntries = entriesFile.files && entriesFile.files.length > 0;
      const hasIncomes = incomesFile.files && incomesFile.files.length > 0;
      const hasProjects = projectsFile && projectsFile.files && projectsFile.files.length > 0;

      // If user already provided the required files, do nothing.
      if (hasEntries && hasIncomes) return;

      async function fetchAsFile(url, filename) {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load sample: ${url} (${res.status})`);
        const blob = await res.blob();
        return new File([blob], filename, { type: "text/csv" });
      }

      function setInputFile(inputEl, file) {
        if (!inputEl || !file) return;
        const dt = new DataTransfer();
        dt.items.add(file);
        inputEl.files = dt.files;
      }

      try {
        setStatus("Loading sample files…");

        const [entriesF, incomesF] = await Promise.all([
          hasEntries ? null : fetchAsFile("/assets/technology/time_sample.csv", "time_sample.csv"),
          hasIncomes ? null : fetchAsFile("/assets/technology/income_sample.csv", "income_sample.csv"),
        ]);

        if (entriesF) setInputFile(entriesFile, entriesF);
        if (incomesF) setInputFile(incomesFile, incomesF);

        // Optional projects sample (ignore if missing)
        if (projectsFile && !hasProjects) {
          try {
            const projectsF = await fetchAsFile("/assets/technology/project_sample.csv", "project_sample.csv");
            setInputFile(projectsFile, projectsF);
          } catch (e) {
            // ignore
          }
        }

        setStatus("Sample files loaded ✔ (upload your own to replace them)");

        // Run merge once so the right-side panels populate by default.
        // This uses the existing merge flow and preserves all features.
        runMergeBtn.click();
      } catch (e) {
        const msg = e?.message ? String(e.message) : String(e);
        setStatus(`Sample auto-load failed: ${msg}`);
        console.warn("Sample auto-load failed:", e);
      }
    }

    // Kick off sample auto-load on first render
    maybeLoadDefaultSamples();
}

  // =========================================================
  // 7) Guided local preview (single CSV)
  // =========================================================
  function initGuidedExample() {
    const fileInput = document.getElementById("guidedFileInput");
    const preview = document.getElementById("guidedPreview");
    if (!fileInput || !preview) return;

    fileInput.addEventListener("change", async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      const txt = await f.text();
      preview.value = txt;
    });
  }

  // =========================================================
  // 8) Boot
  // =========================================================
  function boot() {
    ensureAuthBar();
    initGuidedExample();
    initWorkbench();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();