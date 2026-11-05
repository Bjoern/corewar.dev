// cwopt web UI. Talks only to the JSON API (/api/...) and its event stream.
"use strict";

const $app = document.getElementById("app");
let cleanup = [];   // functions to run when leaving a screen

// ---------------------------------------------------------------- helpers
async function api(path, opts = {}) {
  const init = {method: opts.method || "GET", headers: {}};
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers["Content-Type"] = "application/json";
  }
  const r = await fetch("/api" + path, init);
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const e = new Error((data && data.error) || r.statusText);
    e.status = r.status; e.data = data;
    throw e;
  }
  return data;
}

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v)) ? "–" : Number(v).toFixed(d);
const fmtScore = (s, se) => s === null || s === undefined ? "–" : fmt(s, 2) + (se ? ` ± ${fmt(se, 2)}` : "");
function fmtTime(s) {
  if (s === null || s === undefined) return "–";
  s = Math.round(s);
  const hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
  return hh ? `${hh}h ${String(mm).padStart(2, "0")}m` : mm ? `${mm}m ${String(ss).padStart(2, "0")}s` : `${ss}s`;
}
function toast(msg, ms = 3500) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
const badge = (status) => h("span", {class: "badge " + (status || "")}, status || "?");
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function download(name, text) {
  const a = h("a", {href: URL.createObjectURL(new Blob([text], {type: "text/plain"})), download: name});
  document.body.append(a); a.click(); a.remove();
}

function sortableTable(columns, rows, initial) {
  // columns: [{key, label, num, render}]
  let sortKey = initial ? initial.key : columns[0].key, dir = initial ? initial.dir : 1;
  const wrap = h("div", {class: "table-wrap"});
  function draw() {
    const sorted = [...rows].sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
    const thead = h("tr", {}, columns.map(c => h("th", {
      class: "sortable" + (c.num ? " num" : ""),
      onclick: () => { if (sortKey === c.key) dir = -dir; else { sortKey = c.key; dir = c.num ? -1 : 1; } draw(); },
    }, c.label + (sortKey === c.key ? (dir > 0 ? " ▲" : " ▼") : ""))));
    const body = sorted.map(r => h("tr", {class: r._class || ""}, columns.map(c =>
      h("td", {class: c.num ? "num" : ""}, c.render ? c.render(r) : r[c.key]))));
    wrap.replaceChildren(h("table", {}, h("thead", {}, thead), h("tbody", {}, body)));
  }
  draw();
  return wrap;
}

// ---------------------------------------------------------------- router
function route() {
  cleanup.forEach(f => f()); cleanup = [];
  const hash = location.hash || "#/";
  document.querySelectorAll("[data-nav]").forEach(a =>
    a.classList.toggle("active", (a.dataset.nav === "new") === hash.startsWith("#/new") && !hash.startsWith("#/run/")));
  let m;
  if (hash.startsWith("#/new")) return newRunScreen();
  if ((m = hash.match(/^#\/run\/(.+)$/))) return runScreen(decodeURIComponent(m[1]));
  return runsScreen();
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------- runs list
async function runAction(id, action, body) {
  try {
    await api(`/runs/${encodeURIComponent(id)}/${action}`, {method: "POST", body: body || {}});
    return true;
  } catch (e) {
    if (e.status === 409 && e.data && e.data.changes) {
      const ok = confirm("The run's inputs changed since it was paused:\n\n  " + e.data.changes.join("\n  ") +
        "\n\nResume anyway? The incumbent will be re-evaluated.");
      if (ok) return runAction(id, action, Object.assign({}, body, {force: true}));
      return false;
    }
    toast(e.message);
    return false;
  }
}

function controls(run, refresh) {
  const st = run.status;
  const busy = st === "running" || st === "pausing";
  return h("div", {class: "btns"},
    h("button", {disabled: !busy || st === "pausing", onclick: async () => { await runAction(run.id, "pause"); refresh(); }}, "Pause"),
    h("button", {disabled: busy || st === "finished" || st === "failed",
      onclick: async () => { await runAction(run.id, "resume"); refresh(); }}, "Resume"),
    h("button", {class: "danger", disabled: st === "finished" || st === "failed",
      onclick: async () => { if (confirm("Stop this run? It finishes and writes its report.")) { await runAction(run.id, "stop"); refresh(); } }}, "Stop"));
}

async function runsScreen() {
  const box = h("div", {class: "card"});
  $app.replaceChildren(h("div", {class: "header-line"}, h("h1", {}, "Runs"),
    h("button", {class: "primary", onclick: () => (location.hash = "#/new")}, "New run")), box);
  async function load() {
    let runs;
    try { runs = await api("/runs"); } catch (e) { box.replaceChildren(h("div", {class: "err"}, e.message)); return; }
    if (!runs.length) {
      box.replaceChildren(h("div", {class: "empty"}, "No runs yet. ", h("a", {href: "#/new"}, "Start one.")));
      return;
    }
    runs.sort((a, b) => String(b.created).localeCompare(String(a.created)));
    box.replaceChildren(h("div", {class: "table-wrap"}, h("table", {},
      h("thead", {}, h("tr", {}, ["Run", "Hill", "Template", "State", "Best", "Evals", "Elapsed", ""].map((t, i) =>
        h("th", {class: [4, 5, 6].includes(i) ? "num" : ""}, t)))),
      h("tbody", {}, runs.map(r => h("tr", {},
        h("td", {}, h("a", {href: "#/run/" + encodeURIComponent(r.id)}, r.id)),
        h("td", {}, r.hill), h("td", {}, r.template_name || r.template),
        h("td", {}, badge(r.status), r.stale ? h("span", {class: "muted small"}, " (process gone)") : null),
        h("td", {class: "num"}, fmtScore(r.best_score, r.best_se)),
        h("td", {class: "num"}, r.evals ?? 0), h("td", {class: "num"}, fmtTime(r.elapsed)),
        h("td", {}, controls(r, load))))))));
  }
  await load();
  const t = setInterval(load, 3000);
  cleanup.push(() => clearInterval(t));
}

// ---------------------------------------------------------------- new run
const EXAMPLE = `;redcode-nano
;name My stone
;author me
;assert CORESIZE == 80
step  equ !(1..79)?coprime:37
gap   equ !(-10..10)

      spl   #0,          ![<,{]gap
loop  mov.![i,f]  bomb,  @ptr
ptr   add   #step,       ptr
      ![jmp,djn]  loop,  !
bomb  dat   0,           0
end
`;

async function newRunScreen() {
  const [hills, suggestions] = await Promise.all([api("/hills"), api("/bench").catch(() => [])]);
  let draft = {};
  try { draft = JSON.parse(localStorage.getItem("cwopt-draft") || "{}"); } catch {}
  const hillSel = h("select", {}, hills.map(x => h("option", {value: x.key, disabled: x.problems.length > 0},
    x.title + (x.problems.length ? " (not supported)" : ""))));
  hillSel.value = draft.hill || "nano";
  const hillInfo = h("div", {class: "small muted"});
  const text = h("textarea", {class: "code", spellcheck: "false"});
  text.value = draft.template || EXAMPLE;
  const mirror = h("pre", {"aria-hidden": "true"});
  const editor = h("div", {class: "editor"}, mirror, text);
  const fileInput = h("input", {type: "file", accept: ".red,.txt,.rc", style: "display:none"});
  const nameInput = h("input", {value: draft.name || "template.red"});
  const checkBox = h("div", {}, h("span", {class: "muted"}, "Checking…"));
  const benchInput = h("input", {list: "bench-list", value: draft.bench || (suggestions.find(s => /nano/i.test(s.path)) || {}).path || ""});
  const benchList = h("datalist", {id: "bench-list"}, suggestions.map(s => h("option", {value: s.path}, `${s.count} warriors`)));
  const benchInfo = h("div", {class: "small muted"});
  const pinInput = h("input", {placeholder: "optional: anchors directory", value: draft.pin || ""});
  const modeStatic = h("input", {type: "radio", name: "mode", value: "static", checked: (draft.mode || "static") === "static"});
  const modeHill = h("input", {type: "radio", name: "mode", value: "hill", checked: draft.mode === "hill"});
  const hillSize = h("input", {type: "number", min: "2", placeholder: "default", value: draft.hillSize || ""});
  const lineage = h("input", {type: "number", min: "1", value: draft.lineage || "1"});
  const fitnessSel = h("select", {}, ["auto", "exact", "sampled"].map(v => h("option", {value: v}, v)));
  fitnessSel.value = draft.fitness || "auto";
  const rounds = h("input", {type: "number", min: "2", placeholder: "hill default"});
  const timeIn = h("input", {placeholder: "e.g. 30m, 2h", value: draft.time || "10m"});
  const evalsIn = h("input", {type: "number", min: "1", placeholder: "no limit", value: draft.evals || ""});
  const patienceIn = h("input", {type: "number", min: "1", placeholder: "no limit", value: draft.patience || ""});
  const seedIn = h("input", {type: "number", placeholder: "random"});
  const authorIn = h("input", {placeholder: "for ;author if missing", value: draft.author || ""});
  const hillOpts = h("div", {class: "row"},
    h("div", {class: "field"}, h("label", {}, "Hill size"), hillSize),
    h("div", {class: "field"}, h("label", {}, "Lineage cap"), lineage),
    h("div", {class: "field", style: "flex-basis:100%"}, h("label", {}, "Pinned anchors (directory or file)"), pinInput));
  const startBtn = h("button", {class: "primary"}, "Start run");

  function saveDraft() {
    try {
      localStorage.setItem("cwopt-draft", JSON.stringify({hill: hillSel.value, template: text.value, name: nameInput.value,
        bench: benchInput.value, pin: pinInput.value, mode: modeHill.checked ? "hill" : "static", hillSize: hillSize.value,
        lineage: lineage.value, fitness: fitnessSel.value, time: timeIn.value, evals: evalsIn.value,
        patience: patienceIn.value, author: authorIn.value}));
    } catch {}
  }

  function showHill() {
    const x = hills.find(y => y.key === hillSel.value);
    if (!x) return;
    hillInfo.replaceChildren(`core ${x.coresize}, cycles ${x.cycles}, processes ${x.processes}, length ${x.length}, ` +
      `distance ${x.distance}, ${x.pspace ? "p-space " + x.pspace : "no p-space"}, ${x.rounds} rounds. `,
      h("span", {}, x.verified ? "Verified: " + x.verified : "Not verified."));
  }

  let markers = [];
  function paint() {
    const lines = text.value.split("\n");
    const out = [];
    lines.forEach((line, i) => {
      const ms = markers.filter(m => m.line === i + 1).sort((a, b) => a.col - b.col);
      let pos = 0, s = "";
      for (const m of ms) {
        s += esc(line.slice(pos, m.col - 1)) + "<mark>" + esc(line.slice(m.col - 1, m.end - 1)) + "</mark>";
        pos = m.end - 1;
      }
      out.push(s + esc(line.slice(pos)));
    });
    mirror.innerHTML = out.join("\n") + "\n";
    mirror.scrollTop = text.scrollTop; mirror.scrollLeft = text.scrollLeft;
  }
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  text.addEventListener("scroll", () => { mirror.scrollTop = text.scrollTop; mirror.scrollLeft = text.scrollLeft; });

  const runCheck = debounce(async () => {
    saveDraft();
    let r;
    try { r = await api("/check", {method: "POST", body: {hill: hillSel.value, template: text.value}}); }
    catch (e) { checkBox.replaceChildren(h("div", {class: "err"}, e.message)); return; }
    if (r.error) {
      markers = [];
      paint();
      checkBox.replaceChildren(h("div", {class: "err"}, `Line ${r.error.line}, column ${r.error.col}: ${r.error.message}`));
      return;
    }
    markers = r.markers; paint();
    const a = r.assembly;
    checkBox.replaceChildren(
      h("div", {class: "stats"},
        h("div", {class: "stat"}, h("div", {class: "v"}, r.variables.length), h("div", {class: "k"}, "variables")),
        h("div", {class: "stat"}, h("div", {class: "v"}, r.space.toExponential(2).replace("e+", "e")), h("div", {class: "k"}, "search space")),
        h("div", {class: "stat"}, h("div", {class: "v"}, r.fitness), h("div", {class: "k"}, "fitness (auto)"))),
      r.variables.length ? h("div", {class: "table-wrap"}, h("table", {style: "margin-top:10px"},
        h("thead", {}, h("tr", {}, ["Variable", "Domain", "Values", "Start"].map((t, i) => h("th", {class: i === 2 ? "num" : ""}, t)))),
        h("tbody", {}, r.variables.map(v => h("tr", {}, h("td", {}, v.name), h("td", {class: "mono"}, v.spec),
          h("td", {class: "num"}, v.size), h("td", {class: "mono"}, v.start ?? "random")))))) :
        h("div", {class: "muted"}, "No markers yet: put ! where a value should be optimised."),
      h("h2", {style: "margin-top:14px"}, a.ok ? "Start values assemble" : "Start values do not assemble"),
      r.random_start ? h("div", {class: "small muted"}, "Variables without a start value are shown with their first value here; a run starts them at random.") : null,
      a.ok ? h("pre", {class: "code"}, a.listing) : h("pre", {class: "code err"}, a.message),
      a.ok && a.warnings.length ? h("div", {class: "small muted"}, a.warnings.join("\n")) : null);
  }, 300);

  const checkBench = debounce(async () => {
    saveDraft();
    if (!benchInput.value.trim()) { benchInfo.textContent = ""; return; }
    try {
      const r = await api("/bench?path=" + encodeURIComponent(benchInput.value.trim()));
      benchInfo.textContent = `${r.count} .red files`;
    } catch (e) { benchInfo.textContent = e.message; }
  }, 300);

  text.addEventListener("input", () => { paint(); runCheck(); });
  hillSel.addEventListener("change", () => { showHill(); runCheck(); });
  benchInput.addEventListener("input", checkBench);
  [modeStatic, modeHill].forEach(r => r.addEventListener("change", () => { hillOpts.hidden = !modeHill.checked; saveDraft(); }));
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    if (!f) return;
    text.value = await f.text(); nameInput.value = f.name; paint(); runCheck();
  });

  startBtn.addEventListener("click", async () => {
    saveDraft();
    startBtn.disabled = true;
    try {
      const t = parseDuration(timeIn.value);
      const r = await api("/runs", {method: "POST", body: {
        hill: hillSel.value, template: text.value, template_name: nameInput.value,
        bench: benchInput.value, pin: modeHill.checked ? pinInput.value : "",
        mode: modeHill.checked ? "hill" : "static", hill_size: hillSize.value, lineage: lineage.value,
        fitness: fitnessSel.value, rounds: rounds.value, seed: seedIn.value, author: authorIn.value,
        limits: {time: t, evals: evalsIn.value, patience: patienceIn.value}}});
      location.hash = "#/run/" + encodeURIComponent(r.id);
    } catch (e) { toast(e.message, 6000); startBtn.disabled = false; }
  });

  hillOpts.hidden = !modeHill.checked;
  $app.replaceChildren(
    h("h1", {}, "New run"),
    h("div", {class: "grid side"},
      h("div", {},
        h("div", {class: "card"},
          h("div", {class: "header-line"}, h("h2", {}, "Template"),
            h("div", {class: "btns"}, nameInput, h("button", {onclick: () => fileInput.click()}, "Upload…"), fileInput)),
          h("p", {class: "small muted"}, "Markers: ", h("code", {}, "!"), " whole core, ", h("code", {}, "!(a..b, s)"),
            " range, ", h("code", {}, "![x, y]"), " tokens, ", h("code", {}, "?coprime ?odd ?even"), " filters, ",
            h("code", {}, ":v"), " start value. Text after ; is ignored; ", h("code", {}, "!="), " is not a marker."),
          editor),
        h("div", {class: "card"}, h("h2", {}, "Check"), checkBox)),
      h("div", {},
        h("div", {class: "card"},
          h("div", {class: "field"}, h("label", {}, "Hill"), hillSel, hillInfo),
          h("div", {class: "field"}, h("label", {}, "Benchmark directory"), benchInput, benchList, benchInfo),
          h("div", {class: "field"}, h("label", {}, "Mode"),
            h("label", {class: "radio"}, modeStatic, "Static benchmark"),
            h("label", {class: "radio"}, modeHill, "Hill (warriors can be pushed off)")),
          hillOpts,
          h("div", {class: "row"},
            h("div", {class: "field"}, h("label", {}, "Fitness"), fitnessSel),
            h("div", {class: "field"}, h("label", {}, "Rounds (sampled)"), rounds)),
          h("div", {class: "row"},
            h("div", {class: "field"}, h("label", {}, "Time limit"), timeIn),
            h("div", {class: "field"}, h("label", {}, "Evaluation limit"), evalsIn),
            h("div", {class: "field"}, h("label", {}, "Stop after no gain in"), patienceIn)),
          h("div", {class: "row"},
            h("div", {class: "field"}, h("label", {}, "Seed"), seedIn),
            h("div", {class: "field"}, h("label", {}, "Author"), authorIn)),
          startBtn))));
  showHill(); paint(); runCheck(); checkBench();
}

function parseDuration(s) {
  s = (s || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([smhd]?)$/);
  if (!m) throw new Error(`Bad time limit "${s}" (examples: 90s, 30m, 2h)`);
  return Number(m[1]) * {"": 1, s: 1, m: 60, h: 3600, d: 86400}[m[2]];
}

// ---------------------------------------------------------------- run view
function chart(trace, sampled) {
  const W = 800, H = 240, L = 46, R = 10, T = 10, B = 24;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "chart");
  svg.setAttribute("preserveAspectRatio", "none");
  if (!trace.length) return svg;
  const xs = trace.map(t => t[0]);
  const ys = trace.flatMap(t => [t[1], t[2] === null ? t[1] : t[2] + (t[3] || 0), t[2] === null ? t[1] : t[2] - (t[3] || 0)]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 1);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y1 - y0 < 1) { y0 -= 0.5; y1 += 0.5; }
  const pad = (y1 - y0) * 0.05; y0 -= pad; y1 += pad;
  const X = x => L + (x - x0) / (x1 - x0) * (W - L - R);
  const Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const el = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.append(e); return e; };
  el("line", {x1: L, y1: H - B, x2: W - R, y2: H - B, class: "axis"});
  el("line", {x1: L, y1: T, x2: L, y2: H - B, class: "axis"});
  for (let k = 0; k <= 4; k++) {
    const v = y0 + (y1 - y0) * k / 4;
    el("text", {x: L - 6, y: Y(v) + 4, "text-anchor": "end"}).textContent = v.toFixed(1);
  }
  el("text", {x: L, y: H - 6}).textContent = x0;
  el("text", {x: W - R, y: H - 6, "text-anchor": "end"}).textContent = `${x1} evaluations`;
  const best = trace.filter(t => t[2] !== null);
  if (sampled && best.length) {
    const up = best.map(t => `${X(t[0])},${Y(t[2] + (t[3] || 0))}`);
    const dn = best.map(t => `${X(t[0])},${Y(t[2] - (t[3] || 0))}`).reverse();
    el("polygon", {points: up.concat(dn).join(" "), class: "band"});
  }
  el("polyline", {points: trace.map(t => `${X(t[0])},${Y(t[1])}`).join(" "), class: "current"});
  el("polyline", {points: best.map(t => `${X(t[0])},${Y(t[2])}`).join(" "), class: "best"});
  return svg;
}

function validationLine(v) {
  if (!v || !v.best) return null;
  const part = (k) => v[k] && v[k].score !== undefined ? `${k} ${fmtScore(v[k].score, v[k].se)}` : null;
  return h("div", {style: "margin-bottom:8px"}, h("strong", {}, "Held-out check"),
    ` (${v.rounds ? v.rounds + " rounds, unseen seeds" : "exact"}): `,
    [part("best"), part("reference")].filter(Boolean).join(", "));
}

function describeEvent(e) {
  switch (e.event) {
    case "hill": return `hill: ${e.name} ${e.result}${e.rank ? ` (rank ${e.rank}, ${fmt(e.score)})` : ""}` +
      (e.pushed && e.pushed.length ? `; pushed off ${e.pushed.join(", ")}` : "");
    case "reseed": return `new placement seeds (epoch ${e.epoch}); incumbent re-evaluated`;
    case "restart": return `restart from a top result (${fmt(e.score)})`;
    case "finished": return `finished: ${e.reason}`;
    case "validation": return `held-out check: best ${fmt(e.best && e.best.score)}` +
      (e.reference && e.reference.score !== undefined ? `, reference ${fmt(e.reference.score)}` : "");
    default: return JSON.stringify(e);
  }
}

async function runScreen(id) {
  const enc = encodeURIComponent(id);
  let view = null, best = null, lastProgress = null;
  const head = h("div", {class: "card"});
  const chartBox = h("div", {class: "card"});
  const bestBox = h("div", {class: "card"});
  const varsBox = h("div", {class: "card"});
  const oppBox = h("div", {class: "card"});
  const hillBox = h("div", {});
  const eventsBox = h("div", {class: "card"});
  $app.replaceChildren(head, h("div", {class: "grid two"}, h("div", {}, chartBox, varsBox), h("div", {}, bestBox)),
    oppBox, hillBox, eventsBox);

  function drawHead() {
    const s = view.status || {};
    const c = view.config;
    const p = lastProgress || {};
    const sampled = c.fitness_mode === "sampled";
    head.replaceChildren(
      h("div", {class: "header-line"},
        h("div", {}, h("h1", {style: "margin-bottom:4px"}, c.template_name || id, " ", badge(s.status)),
          h("div", {class: "small muted"}, `${c.hill.key}: core ${c.hill.coresize}, cycles ${c.hill.cycles}, processes ${c.hill.processes}, ` +
            `length ${c.hill.length}, distance ${c.hill.distance}; ${c.options.mode} mode, ${c.fitness_mode} fitness` +
            (sampled ? `, ${c.options.rounds || c.hill.rounds} rounds` : "") + `; ${c.bench.length} benchmark warriors; seed ${c.seed}`),
          s.error ? h("div", {class: "err"}, s.error) : null,
          view.finished_reason ? h("div", {class: "small muted"}, "Finished: " + view.finished_reason) : null),
        controls({id, status: s.status}, refresh)),
      h("div", {class: "stats", style: "margin-top:12px"},
        stat(fmtScore(view.best && view.best.score, sampled && view.best && view.best.se), "best"),
        stat(fmt(p.current ?? (view.current && view.current.score)), "current"),
        stat(p.evals ?? view.evals ?? 0, "evaluations"),
        stat(s.status === "running" ? fmt(p.speed ?? s.speed, 1) : "–", "evals / s"),
        stat(fmtTime(p.elapsed ?? view.elapsed), "elapsed"),
        stat(p.phase || view.phase || "–", "phase"),
        stat(view.pairings_run ?? 0, "pairings run")));
  }
  const stat = (v, k) => h("div", {class: "stat"}, h("div", {class: "v"}, v), h("div", {class: "k"}, k));

  function drawChart() {
    const sampled = view.config.fitness_mode === "sampled";
    chartBox.replaceChildren(h("div", {class: "header-line"}, h("h2", {}, "Score over time"),
      h("div", {class: "legend"}, h("span", {}, h("i", {style: "background:var(--chart-best)"}), "best"),
        h("span", {}, h("i", {style: "background:var(--chart-current)"}), "current"),
        sampled ? h("span", {}, h("i", {style: "background:var(--chart-band);height:8px"}), "± 1 SE") : null)),
      view.trace && view.trace.length ? chart(view.trace, sampled) : h("div", {class: "empty"}, "No data yet."));
  }

  function drawVars() {
    varsBox.replaceChildren(h("h2", {}, "Variables"), h("div", {class: "table-wrap"}, h("table", {},
      h("thead", {}, h("tr", {}, ["Name", "Domain", "Values", "Current", "Best"].map((t, i) => h("th", {class: i >= 2 ? "num" : ""}, t)))),
      h("tbody", {}, view.variables.map(v => h("tr", {}, h("td", {}, v.name), h("td", {class: "mono"}, v.spec),
        h("td", {class: "num"}, v.size), h("td", {class: "num mono"}, v.current ?? "–"), h("td", {class: "num mono"}, v.best ?? "–")))))));
  }

  function drawBest() {
    if (!best) { bestBox.replaceChildren(h("h2", {}, "Best warrior"), h("div", {class: "empty"}, "No result yet.")); return; }
    const pre = h("pre", {class: "code"}, best.segments.map(s => s.var ? h("mark", {class: "val", title: s.var}, s.text) : s.text));
    bestBox.replaceChildren(
      h("div", {class: "header-line"}, h("h2", {}, `Best warrior: ${fmtScore(best.score, view.config.fitness_mode === "sampled" && best.se)}`),
        h("div", {class: "btns"},
          h("button", {onclick: async () => { await navigator.clipboard.writeText(best.red); toast("best.red copied"); }}, "Copy"),
          h("button", {onclick: () => download(best.filename + ".red", best.red)}, "Download .red"),
          h("button", {onclick: () => download(best.filename + ".template.red", best.template)}, "Download template"),
          view.finished_reason ? h("a", {class: "btn", href: `/api/runs/${enc}/report`, target: "_blank"}, "Report") : null)),
      h("div", {class: "small muted", style: "margin-bottom:8px"}, `found at evaluation ${best.evals}; highlighted values were optimised`),
      validationLine(view.validation),
      pre);
    const rows = best.per_opp.map(([name, w, t, l]) => ({name, w, t, l, score: (3 * w + t) / (w + t + l) * 100}));
    oppBox.replaceChildren(h("h2", {}, `Best warrior against each opponent (${rows.length})`),
      sortableTable([{key: "name", label: "Opponent"}, {key: "w", label: "W", num: true}, {key: "t", label: "T", num: true},
        {key: "l", label: "L", num: true}, {key: "score", label: "Score", num: true, render: r => fmt(r.score, 1)}],
        rows, {key: "score", dir: 1}));
  }

  function drawHill() {
    if (!view.hill) { hillBox.replaceChildren(); return; }
    const hs = view.hill;
    const rows = hs.standings.map(r => Object.assign({}, r, {_class: (r.pinned ? "pinned " : "") + (r.origin === "run" ? "own" : "")}));
    hillBox.replaceChildren(h("div", {class: "grid two"},
      h("div", {class: "card"}, h("h2", {}, `Hill standings (size ${hs.size}, lineage cap ${hs.lineage})`),
        rows.length ? sortableTable([{key: "rank", label: "#", num: true}, {key: "name", label: "Warrior"},
          {key: "score", label: "Score", num: true, render: r => fmt(r.score)},
          {key: "origin", label: "From", render: r => r.origin === "run" ? "this run" : (r.pinned ? "anchor" : "benchmark")}],
          rows, {key: "rank", dir: 1}) : h("div", {class: "empty"}, "Round robin in progress…")),
      h("div", {class: "card"}, h("h2", {}, `Archive: pushed off (${hs.archive.length})`),
        hs.archive.length ? h("div", {class: "table-wrap"}, h("table", {}, h("thead", {}, h("tr", {}, ["Warrior", "Left at", "Last rank", "Score"].map(t => h("th", {}, t)))),
          h("tbody", {}, hs.archive.map(m => h("tr", {}, h("td", {}, m.name), h("td", {}, m.left_step), h("td", {}, m.left_rank), h("td", {}, fmt(m.left_score))))))) :
          h("div", {class: "muted"}, "Nobody pushed off yet."))));
  }

  function drawEvents() {
    const evs = (view.events || []).slice().reverse();
    eventsBox.replaceChildren(h("h2", {}, "Events"), evs.length ? h("div", {class: "events"},
      evs.map(e => h("div", {}, h("span", {class: "muted small"}, (e.time || "").replace("T", " ") + "  "), describeEvent(e)))) :
      h("div", {class: "muted"}, "Hill events, reseeds and restarts appear here."));
  }

  async function refresh() {
    try { view = await api(`/runs/${enc}`); } catch (e) { head.replaceChildren(h("div", {class: "err"}, e.message)); return; }
    try { best = await api(`/runs/${enc}/best`); } catch { best = null; }
    drawHead(); drawChart(); drawVars(); drawBest(); drawHill(); drawEvents();
  }
  const refreshSoon = debounce(refresh, 250);

  await refresh();
  const es = new EventSource(`/api/runs/${enc}/events`);
  es.addEventListener("progress", ev => {
    lastProgress = JSON.parse(ev.data);
    if (view) { view.status = Object.assign({}, view.status, {status: "running"}); drawHead(); }
  });
  ["best", "hill", "state"].forEach(t => es.addEventListener(t, () => { lastProgress = null; refreshSoon(); }));
  const poll = setInterval(() => { if (view && (view.status || {}).status === "running") refresh(); }, 5000);
  cleanup.push(() => es.close(), () => clearInterval(poll));
}

route();
