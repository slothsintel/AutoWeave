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
  const API_BASE = (() => {
    // Prefer explicit global, then meta tag, then same-origin.
    // You can set window.AUTOWEAVE_API_BASE = "https://your-backend"
    if (typeof window !== "undefined" && window.AUTOWEAVE_API_BASE) return String(window.AUTOWEAVE_API_BASE).replace(/\/+$/, "");
    const meta = document.querySelector('meta[name="autoweave-api-base"]');
    if (meta && meta.content) return String(meta.content).replace(/\/+$/, "");
    return "";
  })();

  const AUTH_STORAGE_KEY = "ow_auth_token";
  const AUTH_EMAIL_KEY = "ow_auth_email";

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
    // Keep compact and readable
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
    // yyyy-mm-dd
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
    // try dd/mm/yyyy
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
  function getAuthToken() {
    try {
      return localStorage.getItem(AUTH_STORAGE_KEY) || "";
    } catch (e) {
      return "";
    }
  }
  function getAuthEmail() {
    try {
      return localStorage.getItem(AUTH_EMAIL_KEY) || "";
    } catch (e) {
      return "";
    }
  }
  function setAuthToken(token, email) {
    try {
      if (token) localStorage.setItem(AUTH_STORAGE_KEY, token);
      else localStorage.removeItem(AUTH_STORAGE_KEY);
      if (email) localStorage.setItem(AUTH_EMAIL_KEY, email);
    } catch (e) {}
  }
  function clearAuthToken() {
    setAuthToken("", "");
  }

  function apiUrl(path) {
    const p = String(path || "");
    if (!API_BASE) return p.startsWith("/") ? p : `/${p}`;
    return `${API_BASE}${p.startsWith("/") ? "" : "/"}${p}`;
  }

  async function apiFetch(path, options = {}) {
    const token = getAuthToken();
    const headers = new Headers(options.headers || {});
    if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(apiUrl(path), {
      ...options,
      headers,
    });

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

  // A simple stacked bar chart renderer using divs (no external libs)
  function renderStackedBars(container, data, projectNames, valueKey, title) {
    // data: [{ key: "2026-01-01", values: {ProjectA: 10, ProjectB: 3}, total: 13 }, ...]
    clearEl(container);

    const header = createEl("div", { className: "aw-vis-header" }, [
      createEl("div", { className: "aw-vis-title", textContent: title }),
    ]);

    container.appendChild(header);

    const chart = createEl("div", { className: "aw-stacked-chart" });
    chart.style.display = "grid";
    chart.style.gridTemplateColumns = `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))`;
    chart.style.gap = "8px";
    chart.style.alignItems = "end";
    chart.style.padding = "8px 2px 0 2px";

    const maxTotal = Math.max(1, ...data.map(d => Number(d.total) || 0));

    for (const d of data) {
      const col = createEl("div", { className: "aw-bar-col" });
      col.style.display = "flex";
      col.style.flexDirection = "column";
      col.style.justifyContent = "flex-end";
      col.style.gap = "6px";

      const bar = createEl("div", { className: "aw-bar" });
      bar.style.width = "100%";
      bar.style.height = `${Math.round((Number(d.total) || 0) / maxTotal * 140)}px`;
      bar.style.borderRadius = "12px";
      bar.style.overflow = "hidden";
      bar.style.display = "flex";
      bar.style.flexDirection = "column-reverse";
      bar.style.boxShadow = "0 10px 22px rgba(15,31,23,0.10)";
      bar.style.border = "1px solid rgba(15,31,23,0.10)";
      bar.title = `${d.key}\nTotal: ${fmtMoney(d.total)}`;

      // stack segments
      for (const p of projectNames) {
        const v = Number(d.values?.[p]) || 0;
        if (v <= 0) continue;
        const seg = createEl("div", { className: "aw-bar-seg" });
        const pct = (d.total > 0) ? (v / d.total) : 0;
        seg.style.height = `${pct * 100}%`;
        seg.style.background = colorForProject(p, projectNames);
        seg.style.opacity = "0.85";
        seg.title = `${p}: ${valueKey === "ratio" ? fmtRatio(v) : (valueKey === "hours" ? fmtHours(v) : fmtMoney(v))}`;
        bar.appendChild(seg);
      }

      const label = createEl("div", { className: "aw-bar-label", textContent: d.key });
      label.style.fontSize = "0.8rem";
      label.style.textAlign = "center";
      label.style.color = "rgba(15,31,23,0.62)";
      label.style.whiteSpace = "nowrap";
      label.style.overflow = "hidden";
      label.style.textOverflow = "ellipsis";

      col.appendChild(bar);
      col.appendChild(label);
      chart.appendChild(col);
    }

    container.appendChild(chart);
  }

  // =========================================================
  // 4) Parse merged CSV stats for visuals
  // =========================================================
  function parseCsv(text) {
    // minimal CSV parser (handles quotes)
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
    // Try best-effort mapping based on expected backend output
    // Typical columns: work_date, project, income, duration_hours
    const project = String(obj.project || obj.Project || obj.PROJECT || "").trim();
    const dateRaw = obj.work_date || obj.date || obj.workDate || obj.workDateISO || obj.workdate || "";
    const d = parseDateish(dateRaw);
    const work_date = d ? isoDate(d) : String(dateRaw || "").trim();

    const income = Number(obj.income ?? obj.Income ?? obj.amount ?? obj.Amount ?? 0) || 0;
    const duration = Number(obj.duration_hours ?? obj.duration ?? obj.hours ?? obj.Hours ?? 0) || 0;

    return { work_date, project, income, duration };
  }

  function buildDailyProjectSeries(objs, group = "day") {
    // group: day|week|month
    const rows = objs
      .map(normalizeMergedRow)
      .filter(r => r.project && r.work_date);

    // define key based on grouping
    function keyForDate(iso) {
      const d = parseDateish(iso);
      if (!d) return iso;
      if (group === "month") {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      }
      if (group === "week") {
        // ISO week-ish: year-Www
        // simple: start-of-week Monday
        const dt = new Date(d);
        const day = (dt.getDay() + 6) % 7; // Monday=0
        dt.setDate(dt.getDate() - day);
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, "0");
        const dd = String(dt.getDate()).padStart(2, "0");
        return `${y}-W${m}${dd}`; // stable key for display
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

    // ratio per project per bucket
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

    const hint = document.createElement("span");
    hint.style.fontSize = "0.95rem";
    hint.style.color = "rgba(15,31,23,0.62)";
    hint.textContent = "Sign in to merge via backend.";

    left.appendChild(status);
    left.appendChild(hint);

    right.appendChild(btnLogin);
    right.appendChild(btnRegister);
    right.appendChild(btnForgot);
    right.appendChild(btnLogout);

    bar.appendChild(left);
    bar.appendChild(right);

    // Insert bar above workbench
    workbench.parentElement?.insertBefore(bar, workbench);

    // Modal (minimal, local)
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

      const resend = document.createElement("button");
      resend.type = "button";
      stylePillButton(resend);
      resend.style.height = "42px";
      resend.style.width = "100%";
      resend.style.justifyContent = "center";
      resend.style.marginTop = "10px";
      resend.textContent = "Resend verification link";
      resend.style.display = "none";

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
        msg.textContent = "We’ll email you a reset link (if the account exists).";
        resend.style.display = "inline-flex";
      } else if (mode === "reset") {
        title.textContent = "Reset password";
        action.textContent = "Set new password";
        msg.textContent = "Choose a new password (min 8 characters).";
      } else {
        title.textContent = "Verify email";
        action.textContent = "Verify email";
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
        if (mode === "forgot") body.appendChild(resend);
      }

      // ✅ Resend handler must be inside openModal (resend is scoped here)
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
          const emsg = e?.message ? String(e.message) : String(e);
          msg.textContent = emsg;

          // If the backend says email is unverified, offer resend link
          if (mode === "login" && /verify|verification/i.test(emsg)) {
            resend.style.display = "inline-flex";
          }
        } finally {
          action.disabled = false;
          action.style.opacity = "1";
        }
      });

      // Auto-run verification when opened from a link
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
      const authed = !!token;

      status.textContent = authed ? `Signed in: ${email || "account"}` : "Signed out";

      btnLogin.style.display = authed ? "none" : "inline-flex";
      btnRegister.style.display = authed ? "none" : "inline-flex";
      btnForgot.style.display = authed ? "none" : "inline-flex";
      btnLogout.style.display = authed ? "inline-flex" : "none";

      hint.style.display = authed ? "none" : "inline";
    }

    btnLogin.addEventListener("click", () => openModal("login"));
    btnRegister.addEventListener("click", () => openModal("register"));
    btnForgot.addEventListener("click", () => openModal("forgot"));
    btnLogout.addEventListener("click", () => {
      clearAuthToken();
      syncAuthUi();
    });

    // Handle verify/reset links in URL:
    // ?mode=verify&email=...&token=...
    // ?mode=reset&email=...&token=...
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
    const mergeBtn = document.getElementById("mergeBtn");
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
        !mergeBtn || !statusBox || !previewMerged || !statsMerged || !downloadBtn) {
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

    function renderVisualsFromMergedCsv(csvText) {
      const rows = parseCsv(csvText);
      const objs = rowsToObjects(rows);
      const groupSel = document.getElementById("groupBySel");
      const group = groupSel ? String(groupSel.value || "day") : "day";

      const { projectNames, buckets } = buildDailyProjectSeries(objs, group);

      const visIncome = document.getElementById("visIncome");
      const visDuration = document.getElementById("visDuration");
      const visRatio = document.getElementById("visRatio");
      if (!visIncome || !visDuration || !visRatio) return;

      const incomeSeries = buckets.map(b => ({ key: b.key, values: b.valuesIncome, total: b.totalIncome }));
      const hoursSeries = buckets.map(b => ({ key: b.key, values: b.valuesHours, total: b.totalHours }));
      const ratioSeries = buckets.map(b => ({ key: b.key, values: b.valuesRatio, total: b.totalRatio }));

      renderStackedBars(visIncome, incomeSeries, projectNames, "money", "Income by project");
      renderStackedBars(visDuration, hoursSeries, projectNames, "hours", "Duration by project");
      renderStackedBars(visRatio, ratioSeries, projectNames, "ratio", "Income / Duration by project");
    }

    function resetAll() {
      if (projectsFile) projectsFile.value = "";
      incomesFile.value = "";
      entriesFile.value = "";

      setBoxText(previewMerged, "");
      setBoxText(statsMerged, "");
      setStatus("");

      downloadBtn.style.display = "none";

      downloadBtn.removeAttribute("href");
      clearVisuals();
    }

    resetAllBtn?.addEventListener("click", resetAll);

    // Grouping control (re-render visuals if preview exists)
    const groupSel = document.getElementById("groupBySel");
    if (groupSel) {
      groupSel.addEventListener("change", () => {
        const txt = (typeof previewMerged.value === "string") ? previewMerged.value : previewMerged.textContent;
        if (txt) renderVisualsFromMergedCsv(txt);
      });
    }

    // Merge action: call backend
    mergeBtn.addEventListener("click", async () => {
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
      setBoxText(statsMerged, "");
      clearVisuals();

      setStatus("Uploading files…");

      const form = new FormData();
      form.append("time_entries_csv", entries);
      form.append("incomes_csv", incomes);
      if (projects) form.append("projects_csv", projects);

      try {
        const res = await apiFetch("/api/v1/merge", {
          method: "POST",
          body: form,
        });

        const data = await res.json();

        setBoxText(statsMerged, JSON.stringify(data.stats ?? {}, null, 2));

        const hasCsv = typeof data.download_csv === "string" && data.download_csv.length > 0;
        if (!hasCsv) {
          setStatus(`No output CSV returned.`);
          return;
        }

        // Show preview and download
        const csv = data.download_csv;
        setBoxText(previewMerged, csv);

        // Build a blob download link
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        downloadBtn.href = url;
        downloadBtn.download = "merged.csv";
        downloadBtn.style.display = "inline-flex";

        setStatus("Merge complete ✔");

        // Render visuals
        renderVisualsFromMergedCsv(csv);

      } catch (e) {
        const msg = e?.message ? String(e.message) : String(e);
        setStatus(`Error: ${msg}`);
      }
    });
  }

  // =========================================================
  // 7) Guided local preview (single CSV)
  // =========================================================
  function initGuidedExample() {
    const fileInput = document.getElementById("guidedCsvFile");
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
