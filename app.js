import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://qhgnyldwpjitiigxvzed.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoZ255bGR3cGppdGlpZ3h2emVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1OTA1MjcsImV4cCI6MjA4OTE2NjUyN30.Vc9bz9Ntj-bMpiHHvKuNWVs8OMB6Jx329eYL7Qw25Ek";

const state = {
  session: null,
  profile: null,
  memberships: [],
  activeCompany: null,
  dailyRecords: [],
  cashInitial: { contanti: 0, pos: 0 },
  cashInitialDate: { contanti: "", pos: "" },
  customCashes: [],
  cashMovements: [],
  suppliers: [],
  supplierMovements: [],
  employees: [],
  employeeMovements: [],
  bookings: [],
  companiesAdmin: [],
};

let supabase = null;
let selectedCompanyId = null;
let selectedAlertRecord = null;
let pendingDailyRecord = null;
let editingSupplierId = null;
let editingEmployeeId = null;
let editingBookingId = null;
let editingCashMovementId = null;
let selectedSupplierDetailId = null;
let selectedEmployeeDetailId = null;
let editingSupplierMovementId = null;
let editingEmployeeMovementId = null;
let cloudSyncCheckInProgress = false;
let lastReportPayload = null;

const $ = (id) => document.getElementById(id);
const safeEl = (id) => document.getElementById(id);
const n = (v) => Number(v || 0);
function todayStr() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function nowLocalDateTimeInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function cleanDateTimeLocal(v) {
  return String(v || "").trim() || null;
}
function dateFromDateTimeOrDate(dateTime, dateStr) {
  const dt = cleanDateTimeLocal(dateTime);
  if (dt && /^\d{4}-\d{2}-\d{2}/.test(dt)) return dt.slice(0, 10);
  return dateStr || todayStr();
}
function formatDate(v) {
  if (!v) return "—";
  const raw = String(v).slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : raw;
}
function isWeekend(dateStr) {
  const d = new Date(String(dateStr || "").slice(0,10) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return false;
  return d.getDay() === 0 || d.getDay() === 6;
}
function formatDateTime(v) {
  if (!v) return "—";
  const raw = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    return raw.replace("T", " ").slice(0, 16);
  }
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString("it-IT", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
  }
  return raw.replace("T", " ").slice(0, 16);
}
function formatOperationDateTime(row) {
  if (row?.operated_at) return formatDateTime(row.operated_at);
  if (row?.data) return formatDateTime(`${row.data}T00:00`);
  return "—";
}
function formatSavedAt(row) {
  return formatDateTime(row?.saved_at || row?.created_at || row?.payload?.saved_at || row?.savedAt || "");
}
function toDateTimeLocalInput(v) {
  if (!v) return "";
  const raw = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) return raw.slice(0, 16);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.replace(" ", "T").slice(0, 16);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function normalizeMoney(v) { return Math.round(n(v) * 100) / 100; }
function roughlySameMoney(a, b) { return Math.abs(normalizeMoney(a) - normalizeMoney(b)) < 0.01; }
const euro = (v) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(v || 0));
const isSupervisor = () => state.profile?.global_role === "supervisor";

const REMEMBER_EMAIL_KEY = "gestionale_remember_email";
const REMEMBER_EMAIL_VALUE_KEY = "gestionale_remember_email_value";
const POS_SUMUP_FEE_RATE = 0.0095; // Commissione SumUp: 0,95% sugli incassi POS

function loadRememberedEmail() {
  try {
    const remembered = localStorage.getItem(REMEMBER_EMAIL_KEY) === "1";
    const email = localStorage.getItem(REMEMBER_EMAIL_VALUE_KEY) || "";
    if (safeEl("rememberEmailChk")) $("rememberEmailChk").checked = remembered;
    if (remembered && email && safeEl("loginEmail")) $("loginEmail").value = email;
  } catch (err) {
    console.error("Remember email load error:", err);
  }
}

function saveRememberedEmail() {
  try {
    const shouldRemember = !!safeEl("rememberEmailChk")?.checked;
    if (shouldRemember) {
      localStorage.setItem(REMEMBER_EMAIL_KEY, "1");
      localStorage.setItem(REMEMBER_EMAIL_VALUE_KEY, safeEl("loginEmail")?.value?.trim() || "");
    } else {
      localStorage.removeItem(REMEMBER_EMAIL_KEY);
      localStorage.removeItem(REMEMBER_EMAIL_VALUE_KEY);
    }
  } catch (err) {
    console.error("Remember email save error:", err);
  }
}


function showGlobalMessage(message, type = "ok") {
  const el = safeEl("globalFeedback");
  if (!el) return;
  el.innerHTML = `<div class="alert ${type === "ok" ? "okline" : ""}">${message}</div>`;
  setTimeout(() => { if (el) el.innerHTML = ""; }, 3500);
}
function showAuthMessage(message, isError = false) {
  const el = safeEl("authFeedback");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#fecaca" : "#bbf7d0";
}
function hideAllViews() {
  ["bootScreen","authView","companySelectorView","appView"].forEach(id => safeEl(id)?.classList.add("hidden"));
}
function seedFields() {
  ["gData","movData","fornMovData","dipMovData","banData"].forEach(id => {
    const el = safeEl(id);
    if (el && !el.value) el.value = todayStr();
  });
  const rm = safeEl("reportMonth");
  const ry = safeEl("reportYear");
  if (rm && rm.options.length === 0) {
    ["01","02","03","04","05","06","07","08","09","10","11","12"].forEach((m,i)=>{
      const op = document.createElement("option"); op.value = i + 1; op.textContent = m; rm.appendChild(op);
    });
    rm.value = new Date().getMonth() + 1;
  }
  if (ry && ry.options.length === 0) {
    [2025,2026,2027,2028].forEach(y=>{
      const op = document.createElement("option"); op.value = y; op.textContent = y; ry.appendChild(op);
    });
    ry.value = new Date().getFullYear();
  }
}
function navigate(sectionId) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  safeEl(sectionId)?.classList.add("active");
  document.querySelectorAll(".nav-btn[data-section]").forEach(btn => btn.classList.toggle("active", btn.dataset.section === sectionId));
  const meta = {
    dashboard: ["Dashboard", "Panoramica generale."],
    giornaliera: ["Scheda giornaliera", "Coperti, incassi e produzione."],
    casse: ["Casse", "Saldi iniziali, casse personalizzate e movimenti."],
    fornitori: ["Fornitori", "Schede, fatture, pagamenti e sospesi."],
    dipendenti: ["Dipendenti", "Schede, pagamenti ed extra."],
    banchetti: ["Prenotazioni / Banchetti", "Eventi e importi."],
    report: ["Report", "Riepilogo mensile base."],
  };
  if (safeEl("pageTitle")) $("pageTitle").textContent = meta[sectionId]?.[0] || "Gestionale";
  if (safeEl("pageSubtitle")) $("pageSubtitle").textContent = meta[sectionId]?.[1] || "";
}

function cashNames() {
  const custom = (state.customCashes || []).map(c => c.name).filter(Boolean);
  return ["contanti", "pos", ...custom.filter(name => !["contanti", "pos"].includes(String(name).toLowerCase()))];
}
function cashLabel(name) {
  if (name === "contanti") return "Contanti";
  if (name === "pos") return "POS";
  return name || "—";
}
function cashStartDate(name) {
  return (state.cashInitialDate && state.cashInitialDate[name]) ? String(state.cashInitialDate[name]).slice(0, 10) : "";
}
function isOnOrAfterCashStart(dateStr, cashName) {
  const start = cashStartDate(cashName);
  if (!start) return true;
  if (!dateStr) return true;
  return String(dateStr).slice(0, 10) >= start;
}
function cashStartLabel(name) {
  const start = cashStartDate(name);
  return start ? `dal ${formatDate(start)}` : "da inizio dati";
}
function isPosCash(name) {
  return String(name || "").toLowerCase() === "pos";
}
function sumupFee(amount) {
  return Math.round(n(amount) * POS_SUMUP_FEE_RATE * 100) / 100;
}
function netAmountForCash(cassa, amount) {
  const gross = n(amount);
  return isPosCash(cassa) ? Math.max(0, gross - sumupFee(gross)) : gross;
}
function legacyDailyCash(rec, cassa) {
  const rows = getAllServiceRows(rec || {});
  if (cassa === "contanti") return rows.reduce((a,row)=>a+n(row.service.contanti),0);
  if (cassa === "pos") return rows.reduce((a,row)=>a+n(row.service.pos),0);
  return 0;
}
// Importo lordo inserito nella scheda giornaliera.
function getDailyCashAmount(rec, cassa) {
  if (rec?.casse && Object.prototype.hasOwnProperty.call(rec.casse, cassa)) return n(rec.casse[cassa]);
  return legacyDailyCash(rec || {}, cassa);
}
function getDailyCashFeeAmount(rec, cassa) {
  const gross = getDailyCashAmount(rec, cassa);
  return isPosCash(cassa) ? sumupFee(gross) : 0;
}
function getDailyCashNetAmount(rec, cassa) {
  return netAmountForCash(cassa, getDailyCashAmount(rec, cassa));
}
function getDailyCashTotalGross(rec) {
  if (rec?.casse && typeof rec.casse === "object") return Object.values(rec.casse).reduce((a,b)=>a+n(b),0);
  return legacyDailyCash(rec || {}, "contanti") + legacyDailyCash(rec || {}, "pos");
}
function getDailyCashTotalFee(rec) {
  return cashNames().reduce((a,cassa)=>a+getDailyCashFeeAmount(rec, cassa), 0);
}
function getDailyCashTotalNet(rec) {
  return cashNames().reduce((a,cassa)=>a+getDailyCashNetAmount(rec, cassa), 0);
}
function getDailyCashTotal(rec) {
  return getDailyCashTotalGross(rec);
}
function getDailyTotals(rec) {
  const totalIncasso = getDailyCashTotalGross(rec);
  const totalCommissioni = getDailyCashTotalFee(rec);
  const totalIncassoNetto = getDailyCashTotalNet(rec);
  const totalCoperti = getAllServiceRows(rec || {}).reduce((a,row)=>a+n(row.service.coperti),0);
  return { totalIncasso, totalIncassoNetto, totalCommissioni, totalCoperti };
}
function getCurrentMonthPrefix() { return todayStr().slice(0, 7); }
function monthMatches(dateStr, monthPrefix) { return !monthPrefix || String(dateStr || "").startsWith(monthPrefix); }
function dailyAutoPrefix(dateStr) { return `[scheda giornaliera ${dateStr}]`; }
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch] || ch));
}
function normalizeSearchText(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
function supplierAliases(supplier) {
  const raw = supplier?.aliases;
  if (Array.isArray(raw)) return raw.map(v => String(v || "").trim()).filter(Boolean);
  if (typeof raw === "string") return raw.split(",").map(v => v.trim()).filter(Boolean);
  return [];
}
function supplierSearchLabel(supplier) {
  const aliases = supplierAliases(supplier);
  return aliases.length ? `${supplier.nome} · alias: ${aliases.join(", ")}` : supplier.nome;
}
function supplierDatalistOptions() {
  const seen = new Set();
  const opts = [];
  const addOption = (value, label) => {
    const clean = String(value || "").trim();
    if (!clean) return;
    const key = normalizeSearchText(clean);
    if (seen.has(key)) return;
    seen.add(key);
    opts.push(`<option value="${escapeHtml(clean)}" label="${escapeHtml(label || clean)}"></option>`);
  };
  (state.suppliers || []).forEach(s => {
    addOption(s.nome, supplierSearchLabel(s));
    supplierAliases(s).forEach(alias => addOption(alias, `alias di ${s.nome}`));
  });
  return opts.join("");
}
function refreshSuppliersDatalist() {
  const el = safeEl("suppliersDatalist");
  if (el) el.innerHTML = supplierDatalistOptions();
}
function findSupplierByNameOrAlias(value) {
  const needle = normalizeSearchText(value);
  if (!needle) return null;
  return (state.suppliers || []).find(s => normalizeSearchText(s.nome) === needle)
    || (state.suppliers || []).find(s => supplierAliases(s).some(alias => normalizeSearchText(alias) === needle))
    || null;
}
function supplierInputValue(row = {}) {
  if (row.supplier_search) return row.supplier_search;
  if (row.supplier_id) return (state.suppliers || []).find(s => s.id === row.supplier_id)?.nome || "";
  return "";
}
function employeeSearchLabel(employee) { return employee?.nome || ""; }
function findEmployeeByName(value) {
  const needle = normalizeSearchText(value);
  if (!needle) return null;
  return (state.employees || []).find(e => normalizeSearchText(e.nome) === needle) || null;
}
function employeeInputValue(row = {}) {
  if (row.employee_search) return row.employee_search;
  if (row.employee_id) return (state.employees || []).find(e => e.id === row.employee_id)?.nome || "";
  if (row.employee_name) return row.employee_name;
  return row.new_employee_name || "";
}
function inputNumberValue(value) {
  const num = n(value);
  return num === 0 ? "" : String(num);
}
function supplierAutocompleteItems(query = "") {
  const q = normalizeSearchText(query);
  const items = [];
  (state.suppliers || []).forEach(s => {
    const aliases = supplierAliases(s);
    const label = supplierSearchLabel(s);
    const searchable = [s.nome, ...aliases].map(normalizeSearchText);
    const score = !q ? 3 : searchable.some(x => x === q) ? 0 : searchable.some(x => x.startsWith(q)) ? 1 : searchable.some(x => x.includes(q)) ? 2 : 99;
    if (!q || score < 99) items.push({ id:s.id, value:s.nome, label, hint:aliases.length ? `alias: ${aliases.join(", ")}` : "", score });
  });
  return items.sort((a,b) => a.score - b.score || String(a.label).localeCompare(String(b.label))).slice(0, 12);
}
function employeeAutocompleteItems(query = "") {
  const q = normalizeSearchText(query);
  return (state.employees || [])
    .map(e => {
      const name = employeeSearchLabel(e);
      const key = normalizeSearchText(name);
      const score = !q ? 3 : key === q ? 0 : key.startsWith(q) ? 1 : key.includes(q) ? 2 : 99;
      return { id:e.id, value:name, label:name, hint:e.ruolo || "", score };
    })
    .filter(item => !q || item.score < 99)
    .sort((a,b) => a.score - b.score || String(a.label).localeCompare(String(b.label)))
    .slice(0, 12);
}
function setupAutocomplete(input, getItems, onPick, opts = {}) {
  if (!input || input.dataset.autocompleteReady === "1") return;
  input.dataset.autocompleteReady = "1";
  input.removeAttribute("list");
  input.setAttribute("autocomplete", "off");
  const field = input.closest(".field") || input.parentElement;
  if (field) field.classList.add("autocomplete-field");
  const menu = document.createElement("div");
  menu.className = "autocomplete-menu hidden";
  (field || input.parentElement || document.body).appendChild(menu);
  let hideTimer = null;
  const hide = () => { menu.classList.add("hidden"); };
  const show = () => {
    clearTimeout(hideTimer);
    const query = input.value || "";
    const items = getItems(query) || [];
    if (!items.length) {
      const allowNew = opts.allowNew && query.trim();
      if (!allowNew) { menu.innerHTML = `<div class="autocomplete-empty">Nessun risultato</div>`; menu.classList.remove("hidden"); return; }
      menu.innerHTML = `<button type="button" class="autocomplete-option" data-new="1"><strong>Usa/Crea nuovo</strong><small>${escapeHtml(query.trim())}</small></button>`;
      menu.classList.remove("hidden");
      menu.querySelector("button")?.addEventListener("pointerdown", ev => { ev.preventDefault(); onPick({ id:"", value:query.trim(), label:query.trim(), isNew:true }); hide(); });
      return;
    }
    menu.innerHTML = items.map((item, idx) => `<button type="button" class="autocomplete-option" data-index="${idx}"><strong>${escapeHtml(item.label || item.value)}</strong>${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ""}</button>`).join("");
    menu.classList.remove("hidden");
    menu.querySelectorAll("button[data-index]").forEach(btn => {
      const pick = (ev) => { ev.preventDefault(); const item = items[Number(btn.dataset.index)]; onPick(item); hide(); input.blur(); };
      btn.addEventListener("pointerdown", pick);
      btn.addEventListener("mousedown", pick);
      btn.addEventListener("touchstart", pick, { passive:false });
    });
  };
  input.addEventListener("input", show);
  input.addEventListener("focus", show);
  input.addEventListener("click", show);
  input.addEventListener("blur", () => { hideTimer = setTimeout(hide, 180); });
}
function setupSupplierSearchInput(input, hiddenInput, opts = {}) {
  setupAutocomplete(input, supplierAutocompleteItems, item => {
    input.value = item.value || "";
    if (hiddenInput) hiddenInput.value = item.id || "";
  }, opts);
  input?.addEventListener("input", () => { if (hiddenInput && !findSupplierByNameOrAlias(input.value)) hiddenInput.value = ""; });
}
function setupEmployeeSearchInput(input, hiddenInput, opts = {}) {
  setupAutocomplete(input, employeeAutocompleteItems, item => {
    input.value = item.value || "";
    if (hiddenInput) hiddenInput.value = item.id || "";
  }, opts);
  input?.addEventListener("input", () => { if (hiddenInput && !findEmployeeByName(input.value)) hiddenInput.value = ""; });
}
function setupGlobalSearchInputs() {
  setupSupplierSearchInput(safeEl("fornMovSearch"), safeEl("fornMovNome"), { allowNew:false });
  setupEmployeeSearchInput(safeEl("dipMovNome"), null, { allowNew:false });
}

const SERVICE_NUMBER_FIELDS = ["coperti", "contanti", "pos", "asporto", "servizio", "bancone", "pizze", "copertiRistorante", "menu", "supplementi", "portate"];
const SERVICE_METRIC_FIELDS = ["pizze", "copertiRistorante", "menu", "supplementi", "portate"];
function emptyService(extra = {}) {
  return { nome: "", coperti:0, contanti:0, pos:0, asporto:0, servizio:0, bancone:0, pizze:0, copertiRistorante:0, menu:0, supplementi:0, portate:0, ...extra };
}
function normalizeService(service = {}, key = "") {
  const out = emptyService({ nome: service?.nome || "" });
  SERVICE_NUMBER_FIELDS.forEach(field => {
    if (field === "servizio") out.servizio = n(service?.servizio ?? (key ? service?.[key] : 0));
    else out[field] = n(service?.[field]);
  });
  return out;
}
function getBanchettiList(rec = {}) {
  if (Array.isArray(rec.banchettiList)) return rec.banchettiList.map((b,i) => normalizeService({ nome: b.nome || `Banchetto ${i+1}`, ...b }, "banchetti"));
  if (rec.banchetti && Object.keys(rec.banchetti || {}).length) return [normalizeService({ nome: "Banchetto 1", ...rec.banchetti }, "banchetti")];
  return [];
}
function aggregateServiceList(list = []) {
  const out = emptyService({ nome: "Totale banchetti" });
  list.forEach(item => {
    SERVICE_NUMBER_FIELDS.forEach(field => { out[field] += n(item?.[field]); });
  });
  return out;
}
function getBanchettiAggregate(rec = {}) {
  return aggregateServiceList(getBanchettiList(rec));
}
function getService(rec = {}, key = "pranzo") {
  if (key === "banchetti") return getBanchettiAggregate(rec);
  return normalizeService(rec?.[key] || {}, key);
}
function getAllServiceRows(rec = {}) {
  return [
    { key:"pranzo", label:"Pranzo", service:getService(rec, "pranzo") },
    { key:"cena", label:"Cena", service:getService(rec, "cena") },
    ...getBanchettiList(rec).map((service, i) => ({ key:`banchetto_${i+1}`, label: service.nome || `Banchetto ${i+1}`, service }))
  ];
}
function serviceAmount(rec, key) {
  return getService(rec, key).servizio;
}
function serviceBanconeAmount(rec, key) {
  return getService(rec, key).bancone;
}
function getDailyAsportoTotal(rec) {
  return getAllServiceRows(rec).reduce((a,row)=>a+n(row.service.asporto),0);
}
function getDailyServiceTotal(rec) {
  return getAllServiceRows(rec).reduce((a,row)=>a+n(row.service.servizio),0);
}
function getDailyBanconeTotal(rec) {
  const total = getAllServiceRows(rec).reduce((a,row)=>a+n(row.service.bancone),0);
  return total > 0 ? total : n(rec?.bancone);
}
function dailyMetricTotal(rec, field) {
  const total = getAllServiceRows(rec).reduce((a,row)=>a+n(row.service[field]),0);
  return total > 0 ? total : n(rec?.[field]);
}
function serviceHasWorkData(service) {
  return SERVICE_NUMBER_FIELDS.some(field => n(service?.[field]) > 0);
}
function serviceMoneyParts(service) {
  return n(service?.asporto) + n(service?.servizio) + n(service?.bancone);
}
function servicePaymentTotal(service) {
  return n(service?.contanti) + n(service?.pos);
}
function validateDaily(rec) {
  const alerts = [];
  const totals = getDailyTotals(rec);
  const copertiTot = totals.totalCoperti;
  const copertiRistorante = dailyMetricTotal(rec, "copertiRistorante");
  const copertiPizzeria = copertiTot - copertiRistorante;
  if (copertiPizzeria < 0) alerts.push("Coperti pizzeria negativi: i coperti ristorante superano i coperti totali.");
  if (dailyMetricTotal(rec, "menu") + dailyMetricTotal(rec, "supplementi") > copertiRistorante) alerts.push("Menù + supplementi superano i coperti ristorante.");

  getAllServiceRows(rec).forEach(row => {
    const service = row.service;
    const pagamento = servicePaymentTotal(service);
    const parti = serviceMoneyParts(service);
    if (pagamento > 0 && parti <= 0) alerts.push(`${row.label}: sono presenti contanti/POS ma asporto + servizio + bancone è zero.`);
    if (Math.abs(parti - pagamento) > 0.01) {
      alerts.push(`${row.label}: asporto + servizio + bancone (${euro(parti)}) non coincide con contanti + POS (${euro(pagamento)}).`);
    }
  });

  if (totals.totalIncasso > 0 && copertiTot === 0 && getDailyAsportoTotal(rec) === 0 && getDailyServiceTotal(rec) === 0 && getDailyBanconeTotal(rec) === 0) alerts.push("Hai inserito incassi ma non risultano coperti, asporto, servizio o bancone.");
  if (totals.totalIncasso <= 0 && copertiTot > 0) alerts.push("Ci sono coperti ma l'incasso totale è zero.");
  return alerts;
}
function autoCashFromRecord(rec = {}) {
  const contanti = getAllServiceRows(rec).reduce((a,row)=>a+n(row.service.contanti),0);
  const pos = getAllServiceRows(rec).reduce((a,row)=>a+n(row.service.pos),0);
  const fallback = rec?.casse || {};
  return { contanti: contanti || n(fallback.contanti), pos: pos || n(fallback.pos) };
}
function calculateDailyCashAutoFromForm() {
  const banchetti = collectBanchettiFromForm();
  return {
    contanti: n(safeEl("pranzoContanti")?.value) + n(safeEl("cenaContanti")?.value) + banchetti.reduce((a,b)=>a+n(b.contanti),0),
    pos: n(safeEl("pranzoPos")?.value) + n(safeEl("cenaPos")?.value) + banchetti.reduce((a,b)=>a+n(b.pos),0),
  };
}
function updateDailyCashAuto() {
  const auto = calculateDailyCashAutoFromForm();
  const contantiInput = safeEl("dailyCashInputs")?.querySelector('input[data-daily-cash="contanti"]');
  const posInput = safeEl("dailyCashInputs")?.querySelector('input[data-daily-cash="pos"]');
  if (contantiInput) contantiInput.value = inputNumberValue(auto.contanti);
  if (posInput) posInput.value = inputNumberValue(auto.pos);
}
function renderDailyCashInputs(rec = null) {
  const box = safeEl("dailyCashInputs");
  if (!box) return;
  const currentValues = {};
  box.querySelectorAll("input[data-daily-cash]").forEach(input => currentValues[input.dataset.dailyCash] = input.value);
  const auto = rec ? autoCashFromRecord(rec) : calculateDailyCashAutoFromForm();
  box.innerHTML = cashNames().map(name => {
    let value = currentValues[name] ?? "";
    let readonly = "";
    let note = "";
    if (name === "contanti") { value = inputNumberValue(auto.contanti); readonly = "readonly"; note = `<small class="muted">Calcolato automaticamente dai servizi.</small>`; }
    else if (name === "pos") { value = inputNumberValue(auto.pos); readonly = "readonly"; note = `<small class="muted">POS lordo calcolato automaticamente. SumUp -0,95% nel saldo cassa.</small>`; }
    else if (rec?.casse && Object.prototype.hasOwnProperty.call(rec.casse, name)) value = inputNumberValue(rec.casse[name]);
    const label = isPosCash(name) ? "POS lordo" : cashLabel(name);
    return `<div class="field"><label>${escapeHtml(label)}</label><input data-daily-cash="${escapeHtml(name)}" type="number" step="0.01" value="${value}" ${readonly} />${note}</div>`;
  }).join("");
}
function collectDailyCashFromForm() {
  const auto = calculateDailyCashAutoFromForm();
  const values = { contanti: auto.contanti, pos: auto.pos };
  safeEl("dailyCashInputs")?.querySelectorAll("input[data-daily-cash]").forEach(input => {
    const name = input.dataset.dailyCash;
    if (!["contanti", "pos"].includes(name)) values[name] = n(input.value);
  });
  return values;
}
function cashSelectOptions(selected = "contanti") {
  return cashNames().map(name => `<option value="${escapeHtml(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(cashLabel(name))}</option>`).join("");
}
function fillCashSelect(id, selected = "contanti") {
  const el = safeEl(id);
  if (!el) return;
  const current = selected || el.value || "contanti";
  el.innerHTML = cashSelectOptions(current);
  if ([...el.options].some(o => o.value === current)) el.value = current;
}
function isSupplierPaymentType(tipo) {
  return ["pagamento", "acconto"].includes(String(tipo || "").toLowerCase());
}
function typeLabel(tipo) {
  const labels = { fattura: "Fattura", pagamento: "Pagamento", acconto: "Acconto", extra: "Extra" };
  return labels[tipo] || tipo || "—";
}
function supplierSelectOptions(selectedId = "") {
  const options = [`<option value="">Seleziona fornitore esistente</option>`].concat((state.suppliers || []).map(s => `<option value="${s.id}" ${s.id === selectedId ? "selected" : ""}>${escapeHtml(supplierSearchLabel(s))}</option>`));
  return options.join("");
}
function employeeSelectOptions(selectedId = "") {
  const options = [`<option value="">Seleziona dipendente esistente</option>`].concat((state.employees || []).map(e => `<option value="${e.id}" ${e.id === selectedId ? "selected" : ""}>${escapeHtml(e.nome)}</option>`));
  return options.join("");
}

function extractCashFromNote(text, fallback = "contanti") {
  const raw = String(text || "");
  const m = raw.match(/cassa:\s*([^·\n\r]+)/i);
  if (m && m[1]) return m[1].trim();
  const daily = raw.match(/^\[scheda giornaliera\s+\d{4}-\d{2}-\d{2}\]\s*([^·\n\r]+)/i);
  if (daily && daily[1]) return daily[1].trim();
  return fallback;
}
function cleanMovementNoteForDaily(text) {
  return String(text || "")
    .replace(/^\[scheda giornaliera\s+\d{4}-\d{2}-\d{2}\]\s*/i, "")
    .replace(/(^|·)\s*cassa:\s*[^·\n\r]+/gi, "")
    .replace(/\s*·\s*$/g, "")
    .trim();
}
function cleanMovementNoteForForm(text) {
  let out = cleanMovementNoteForDaily(text);
  const cash = normalizeSearchText(extractCashFromNote(text, ""));
  if (cash) {
    const parts = out.split("·").map(x => x.trim()).filter(Boolean);
    if (parts.length && normalizeSearchText(parts[0]) === cash) parts.shift();
    out = parts.join(" · ").trim();
  }
  return out;
}
function isDailyAutoMovement(row) {
  return !!row?.data && isDailyAutoLinkedMovement(row, row.data);
}
function isDailyAutoLinkedMovement(row, dateStr) {
  const marker = dailyAutoPrefix(dateStr);
  return String(row?.nota || row?.descrizione || "").startsWith(marker);
}
function mergeDailyRowsBySource(baseRows = [], extraRows = []) {
  const out = [];
  const seen = new Set();
  const keyOf = (r) => r.source_id ? `${r.source_kind || "mov"}:${r.source_id}` : [r.supplier_id || r.employee_id || r.new_supplier_name || r.new_employee_name || "", r.importo || 0, r.operated_at || "", r.nota || ""].join("|");
  [...(baseRows || []), ...(extraRows || [])].forEach(r => {
    const key = keyOf(r);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  });
  return out;
}
function supplierPaymentRowsFromMovements(dateStr) {
  if (!dateStr) return [];
  return (state.supplierMovements || [])
    .filter(m => m.data === dateStr && isSupplierPaymentType(m.tipo) && !isDailyAutoLinkedMovement(m, dateStr))
    .map(m => {
      const supplier = state.suppliers.find(s => s.id === m.supplier_id);
      return {
        supplier_id: m.supplier_id || "",
        supplier_search: supplier?.nome || "",
        new_supplier_name: "",
        cassa: extractCashFromNote(m.nota, "contanti"),
        importo: n(m.importo),
        operated_at: cleanDateTimeLocal(m.operated_at),
        nota: cleanMovementNoteForDaily(m.nota),
        source_kind: "supplier_movement",
        source_id: m.id || "",
      };
    });
}
function employeePaymentRowsFromMovements(dateStr) {
  if (!dateStr) return [];
  return (state.employeeMovements || [])
    .filter(m => m.data === dateStr && !isDailyAutoLinkedMovement(m, dateStr))
    .map(m => {
      return {
        employee_id: m.employee_id || "",
        new_employee_name: "",
        tipo: m.tipo || "acconto",
        cassa: extractCashFromNote(m.nota, "contanti"),
        importo: n(m.importo),
        operated_at: cleanDateTimeLocal(m.operated_at),
        nota: cleanMovementNoteForDaily(m.nota),
        source_kind: "employee_movement",
        source_id: m.id || "",
      };
    });
}
function reloadDailyFormForSelectedDate() {
  const dateStr = safeEl("gData")?.value || todayStr();
  const rec = state.dailyRecords.find(r => r.data === dateStr) || {
    data: dateStr,
    note: "",
    pranzo: emptyService(),
    cena: emptyService(),
    banchettiList: [emptyService({ nome:"Banchetto 1" })],
    casse: {},
    supplierPayments: [],
    employeePayments: []
  };
  fillDailyForm(rec);
  if (safeEl("giornalieraFeedback")) $("giornalieraFeedback").textContent = state.dailyRecords.some(r => r.data === dateStr) ? `Stai modificando la giornata ${dateStr}` : `Nuova giornata ${dateStr}`;
}

function addDailySupplierPaymentRow(row = {}) {
  const box = safeEl("dailySupplierPayments");
  if (!box) return;
  const div = document.createElement("div");
  div.className = "daily-row daily-supplier-row";
  const sourceInfo = row.source_id ? `<div class="daily-payment-source muted small">Movimento già registrato nella scheda fornitore. In questa scheda viene mostrato per data contabile e non viene duplicato.</div>` : "";
  div.innerHTML = `
    <input data-field="source_kind" type="hidden" value="${escapeHtml(row.source_kind || "")}" />
    <input data-field="source_id" type="hidden" value="${escapeHtml(row.source_id || "")}" />
    ${sourceInfo}
    <div class="field"><label>Fornitore</label><input data-field="supplier_search" value="${escapeHtml(supplierInputValue(row))}" placeholder="scrivi e scegli fornitore / alias" autocomplete="off" /><input data-field="supplier_id" type="hidden" value="${escapeHtml(row.supplier_id || "")}" /><input data-field="new_supplier_name" type="hidden" value="${escapeHtml(row.new_supplier_name || "")}" /><small class="muted">Se non esiste, scrivi il nome e verrà creato al salvataggio.</small></div>
    <div class="field"><label>Cassa</label><select data-field="cassa">${cashSelectOptions(row.cassa || "contanti")}</select></div>
    <div class="field"><label>Importo</label><input data-field="importo" type="number" step="0.01" value="${inputNumberValue(row.importo)}" /></div>
    <div class="field"><label>Data/ora pagamento</label><input data-field="operated_at" type="datetime-local" value="${escapeHtml(row.operated_at || "")}" /></div>
    <div class="field"><label>Nota</label><input data-field="nota" value="${escapeHtml(row.nota || "")}" placeholder="es. pagamento merce" /></div>
    <button class="secondary daily-row-remove" type="button">Rimuovi</button>`;
  div.querySelector(".daily-row-remove")?.addEventListener("click", () => div.remove());
  box.appendChild(div);
  setupSupplierSearchInput(div.querySelector('[data-field="supplier_search"]'), div.querySelector('[data-field="supplier_id"]'), { allowNew:true });
}
function addDailyEmployeePaymentRow(row = {}) {
  const box = safeEl("dailyEmployeePayments");
  if (!box) return;
  const div = document.createElement("div");
  div.className = "daily-row daily-employee-row";
  const sourceInfo = row.source_id ? `<div class="daily-payment-source muted small">Movimento già registrato nella scheda dipendente. In questa scheda viene mostrato per data contabile e non viene duplicato.</div>` : "";
  div.innerHTML = `
    <input data-field="source_kind" type="hidden" value="${escapeHtml(row.source_kind || "")}" />
    <input data-field="source_id" type="hidden" value="${escapeHtml(row.source_id || "")}" />
    ${sourceInfo}
    <div class="field"><label>Dipendente</label><input data-field="employee_search" value="${escapeHtml(employeeInputValue(row))}" placeholder="scrivi e scegli dipendente" autocomplete="off" /><input data-field="employee_id" type="hidden" value="${escapeHtml(row.employee_id || "")}" /><input data-field="new_employee_name" type="hidden" value="${escapeHtml(row.new_employee_name || "")}" /><small class="muted">Se non esiste, scrivi il nome e verrà creato al salvataggio.</small></div>
    <div class="field"><label>Tipo</label><select data-field="tipo"><option value="acconto" ${(row.tipo || "acconto") === "acconto" ? "selected" : ""}>Acconto</option><option value="pagamento" ${row.tipo === "pagamento" ? "selected" : ""}>Pagamento</option><option value="extra" ${row.tipo === "extra" ? "selected" : ""}>Extra</option></select></div>
    <div class="field"><label>Cassa</label><select data-field="cassa">${cashSelectOptions(row.cassa || "contanti")}</select></div>
    <div class="field"><label>Importo</label><input data-field="importo" type="number" step="0.01" value="${inputNumberValue(row.importo)}" /></div>
    <div class="field"><label>Data/ora pagamento</label><input data-field="operated_at" type="datetime-local" value="${escapeHtml(row.operated_at || "")}" /></div>
    <div class="field"><label>Nota</label><input data-field="nota" value="${escapeHtml(row.nota || "")}" placeholder="es. acconto" /></div>
    <button class="secondary daily-row-remove" type="button">Rimuovi</button>`;
  div.querySelector(".daily-row-remove")?.addEventListener("click", () => div.remove());
  box.appendChild(div);
  setupEmployeeSearchInput(div.querySelector('[data-field="employee_search"]'), div.querySelector('[data-field="employee_id"]'), { allowNew:true });
}
function renderDailySupplierPayments(rows = []) {
  const box = safeEl("dailySupplierPayments");
  if (!box) return;
  box.innerHTML = "";
  (rows || []).forEach(row => addDailySupplierPaymentRow(row));
}
function renderDailyEmployeePayments(rows = []) {
  const box = safeEl("dailyEmployeePayments");
  if (!box) return;
  box.innerHTML = "";
  (rows || []).forEach(row => addDailyEmployeePaymentRow(row));
}
function collectDailySupplierPayments() {
  return Array.from(safeEl("dailySupplierPayments")?.querySelectorAll(".daily-supplier-row") || []).map(row => {
    const supplierSearch = row.querySelector('[data-field="supplier_search"]')?.value?.trim() || "";
    const supplier = findSupplierByNameOrAlias(supplierSearch);
    const hiddenNew = row.querySelector('[data-field="new_supplier_name"]')?.value?.trim() || "";
    return {
      supplier_id: supplier?.id || row.querySelector('[data-field="supplier_id"]')?.value || "",
      supplier_search: supplierSearch,
      new_supplier_name: supplier ? "" : (hiddenNew || supplierSearch),
      cassa: row.querySelector('[data-field="cassa"]')?.value || "contanti",
      importo: n(row.querySelector('[data-field="importo"]')?.value),
      operated_at: cleanDateTimeLocal(row.querySelector('[data-field="operated_at"]')?.value),
      nota: row.querySelector('[data-field="nota"]')?.value?.trim() || "",
      source_kind: row.querySelector('[data-field="source_kind"]')?.value || "",
      source_id: row.querySelector('[data-field="source_id"]')?.value || "",
    };
  }).filter(row => (row.supplier_id || row.new_supplier_name || row.supplier_search) && row.importo > 0);
}
function collectDailyEmployeePayments() {
  return Array.from(safeEl("dailyEmployeePayments")?.querySelectorAll(".daily-employee-row") || []).map(row => {
    const employeeSearch = row.querySelector('[data-field="employee_search"]')?.value?.trim() || "";
    const employee = findEmployeeByName(employeeSearch);
    const hiddenNew = row.querySelector('[data-field="new_employee_name"]')?.value?.trim() || "";
    return {
      employee_id: employee?.id || row.querySelector('[data-field="employee_id"]')?.value || "",
      employee_search: employeeSearch,
      new_employee_name: employee ? "" : (hiddenNew || employeeSearch),
      tipo: row.querySelector('[data-field="tipo"]')?.value || "acconto",
      cassa: row.querySelector('[data-field="cassa"]')?.value || "contanti",
      importo: n(row.querySelector('[data-field="importo"]')?.value),
      operated_at: cleanDateTimeLocal(row.querySelector('[data-field="operated_at"]')?.value),
      nota: row.querySelector('[data-field="nota"]')?.value?.trim() || "",
      source_kind: row.querySelector('[data-field="source_kind"]')?.value || "",
      source_id: row.querySelector('[data-field="source_id"]')?.value || "",
    };
  }).filter(row => (row.employee_id || row.new_employee_name || row.employee_search) && row.importo > 0);
}
function collectLegacyDailyFromFormOnly() {
  return {
    pranzo: { contanti: n(safeEl("pranzoContanti")?.value), pos: n(safeEl("pranzoPos")?.value) },
    cena: { contanti: n(safeEl("cenaContanti")?.value), pos: n(safeEl("cenaPos")?.value) },
    banchetti: { contanti: collectBanchettiFromForm().reduce((a,b)=>a+n(b.contanti),0), pos: collectBanchettiFromForm().reduce((a,b)=>a+n(b.pos),0) }
  };
}
function fillService(prefix, service, key) {
  const s = normalizeService(service, key);
  const map = { Coperti:"coperti", Asporto:"asporto", Contanti:"contanti", Pos:"pos", Servizio:"servizio", Bancone:"bancone", Pizze:"pizze", CopertiRistorante:"copertiRistorante", Menu:"menu", Supplementi:"supplementi", Portate:"portate" };
  Object.entries(map).forEach(([suffix, field]) => { if (safeEl(prefix + suffix)) safeEl(prefix + suffix).value = inputNumberValue(s[field]); });
}
function collectService(prefix) {
  return normalizeService({
    coperti: n(safeEl(prefix + "Coperti")?.value),
    contanti: n(safeEl(prefix + "Contanti")?.value),
    pos: n(safeEl(prefix + "Pos")?.value),
    asporto: n(safeEl(prefix + "Asporto")?.value),
    servizio: n(safeEl(prefix + "Servizio")?.value),
    bancone: n(safeEl(prefix + "Bancone")?.value),
    pizze: n(safeEl(prefix + "Pizze")?.value),
    copertiRistorante: n(safeEl(prefix + "CopertiRistorante")?.value),
    menu: n(safeEl(prefix + "Menu")?.value),
    supplementi: n(safeEl(prefix + "Supplementi")?.value),
    portate: n(safeEl(prefix + "Portate")?.value),
  });
}
function addBanchettoRow(row = {}) {
  const box = safeEl("banchettiRows");
  if (!box) return;
  const s = normalizeService(row, "banchetti");
  const div = document.createElement("div");
  div.className = "card inner banchetto-row";
  div.innerHTML = `
    <div class="toolbar"><h4>${escapeHtml(s.nome || "Banchetto")}</h4><button class="secondary banchetto-remove-btn" type="button">Rimuovi</button></div>
    <div class="grid3">
      <div class="field"><label>Nome banchetto</label><input data-field="nome" value="${escapeHtml(s.nome || "")}" placeholder="es. Comunione / Compleanno" /></div>
      <div class="field"><label>Coperti</label><input data-field="coperti" type="number" value="${inputNumberValue(s.coperti)}" /></div>
      <div class="field"><label>Contanti</label><input data-field="contanti" type="number" step="0.01" value="${inputNumberValue(s.contanti)}" /></div>
      <div class="field"><label>POS lordo</label><input data-field="pos" type="number" step="0.01" value="${inputNumberValue(s.pos)}" /></div>
      <div class="field"><label>Asporto €</label><input data-field="asporto" type="number" step="0.01" value="${inputNumberValue(s.asporto)}" /></div>
      <div class="field"><label>Banchetti €</label><input data-field="servizio" type="number" step="0.01" value="${inputNumberValue(s.servizio)}" /></div>
      <div class="field"><label>Bancone €</label><input data-field="bancone" type="number" step="0.01" value="${inputNumberValue(s.bancone)}" /></div>
      <div class="field"><label>Pizze totali</label><input data-field="pizze" type="number" value="${inputNumberValue(s.pizze)}" /></div>
      <div class="field"><label>Coperti ristorante</label><input data-field="copertiRistorante" type="number" value="${inputNumberValue(s.copertiRistorante)}" /></div>
      <div class="field"><label>Menù</label><input data-field="menu" type="number" value="${inputNumberValue(s.menu)}" /></div>
      <div class="field"><label>Supplementi</label><input data-field="supplementi" type="number" value="${inputNumberValue(s.supplementi)}" /></div>
      <div class="field"><label>Portate</label><input data-field="portate" type="number" value="${inputNumberValue(s.portate)}" /></div>
    </div>
    <p class="muted small">Controllo: asporto + banchetti + bancone deve essere uguale a contanti + POS.</p>`;
  div.querySelector(".banchetto-remove-btn")?.addEventListener("click", () => { div.remove(); if (!safeEl("banchettiRows")?.querySelector(".banchetto-row")) addBanchettoRow({}); updateDailyCashAuto(); });
  box.appendChild(div);
}
function renderBanchettiRows(rows = []) {
  const box = safeEl("banchettiRows");
  if (!box) return;
  box.innerHTML = "";
  const list = rows.length ? rows : [emptyService({ nome:"Banchetto 1" })];
  list.forEach(row => addBanchettoRow(row));
}
function collectBanchettiFromForm() {
  return Array.from(safeEl("banchettiRows")?.querySelectorAll(".banchetto-row") || []).map((row,i) => normalizeService({
    nome: row.querySelector('[data-field="nome"]')?.value?.trim() || `Banchetto ${i+1}`,
    coperti: n(row.querySelector('[data-field="coperti"]')?.value),
    contanti: n(row.querySelector('[data-field="contanti"]')?.value),
    pos: n(row.querySelector('[data-field="pos"]')?.value),
    asporto: n(row.querySelector('[data-field="asporto"]')?.value),
    servizio: n(row.querySelector('[data-field="servizio"]')?.value),
    bancone: n(row.querySelector('[data-field="bancone"]')?.value),
    pizze: n(row.querySelector('[data-field="pizze"]')?.value),
    copertiRistorante: n(row.querySelector('[data-field="copertiRistorante"]')?.value),
    menu: n(row.querySelector('[data-field="menu"]')?.value),
    supplementi: n(row.querySelector('[data-field="supplementi"]')?.value),
    portate: n(row.querySelector('[data-field="portate"]')?.value),
  }, "banchetti")).filter(row => serviceHasWorkData(row) || row.nome);
}
function fillDailyForm(rec) {
  if (safeEl("gData")) $("gData").value = rec.data || todayStr();
  if (safeEl("gNote")) $("gNote").value = rec.note || "";
  fillService("pranzo", rec.pranzo || {}, "pranzo");
  fillService("cena", rec.cena || {}, "cena");
  renderBanchettiRows(getBanchettiList(rec));
  renderDailyCashInputs(rec);
  const supplierRows = mergeDailyRowsBySource(rec.supplierPayments || [], supplierPaymentRowsFromMovements(rec.data));
  const employeeRows = mergeDailyRowsBySource(rec.employeePayments || [], employeePaymentRowsFromMovements(rec.data));
  renderDailySupplierPayments(supplierRows);
  renderDailyEmployeePayments(employeeRows);
  updateDailyCashAuto();
}
function collectDailyFromForm() {
  const pranzo = collectService("pranzo");
  const cena = collectService("cena");
  const banchettiList = collectBanchettiFromForm();
  const banchetti = aggregateServiceList(banchettiList);
  const rec = {
    data: safeEl("gData")?.value || todayStr(),
    note: safeEl("gNote")?.value?.trim() || "",
    pranzo,
    cena,
    banchetti,
    banchettiList,
    casse: collectDailyCashFromForm(),
    supplierPayments: collectDailySupplierPayments(),
    employeePayments: collectDailyEmployeePayments()
  };
  rec.pizze = dailyMetricTotal(rec, "pizze");
  rec.copertiRistorante = dailyMetricTotal(rec, "copertiRistorante");
  rec.menu = dailyMetricTotal(rec, "menu");
  rec.supplementi = dailyMetricTotal(rec, "supplementi");
  rec.portate = dailyMetricTotal(rec, "portate");
  rec.bancone = getDailyBanconeTotal(rec);
  return rec;
}
function resetDailyForm() {
  fillDailyForm({
    data: todayStr(), note:"",
    pranzo: emptyService(),
    cena: emptyService(),
    banchettiList: [emptyService({ nome:"Banchetto 1" })],
    supplierPayments: [],
    employeePayments: [],
    casse: { contanti:0, pos:0 }
  });
}

function supplierSuspeso(supplier) {
  const moves = state.supplierMovements.filter(m => m.supplier_id === supplier.id);
  const daPagare = moves.filter(m => !isSupplierPaymentType(m.tipo)).reduce((a,b)=>a+n(b.importo),0);
  const pagamenti = moves.filter(m => isSupplierPaymentType(m.tipo)).reduce((a,b)=>a+n(b.importo),0);
  return n(supplier.sospeso_iniziale) + daPagare - pagamenti;
}
function employeePaid(employee, monthPrefix = "") {
  return state.employeeMovements
    .filter(m => m.employee_id === employee.id && monthMatches(m.data, monthPrefix))
    .reduce((a,b)=>a+n(b.importo),0);
}
function employeeMonthStatus(employee, monthPrefix = getCurrentMonthPrefix()) {
  const paid = employeePaid(employee, monthPrefix);
  const due = n(employee.dovuto_mensile);
  return { due, paid, residuo: due - paid };
}
function emptyCashBreakdownRow() {
  return { iniziale: 0, incassi: 0, lordo: 0, commissioni: 0, entrate: 0, uscite: 0, saldo: 0 };
}
function latestAccountingDate() {
  const dates = [
    ...(state.dailyRecords || []).map(r => r.data),
    ...(state.cashMovements || []).map(m => m.data),
    ...(state.supplierMovements || []).map(m => m.data),
    ...(state.employeeMovements || []).map(m => m.data),
  ].map(d => String(d || "").slice(0,10)).filter(Boolean).sort();
  return dates[dates.length - 1] || todayStr();
}
function isDateBefore(a, b) {
  if (!a || !b) return false;
  return String(a).slice(0,10) < String(b).slice(0,10);
}
function isDateAfterOrAt(a, b) {
  if (!a || !b) return true;
  return String(a).slice(0,10) >= String(b).slice(0,10);
}
function cashDeltaForDate(cashName, dateStr) {
  const row = emptyCashBreakdownRow();
  const d = String(dateStr || "").slice(0,10);
  if (!d) return row;
  (state.dailyRecords || []).forEach(rec => {
    if (String(rec?.data || "").slice(0,10) !== d) return;
    const gross = getDailyCashAmount(rec, cashName);
    const fee = getDailyCashFeeAmount(rec, cashName);
    const net = getDailyCashNetAmount(rec, cashName);
    row.lordo += gross;
    row.commissioni += fee;
    row.incassi += net;
  });
  (state.cashMovements || []).forEach(m => {
    if (String(m?.data || "").slice(0,10) !== d) return;
    const name = m.cassa || "contanti";
    if (name !== cashName) return;
    if (m.tipo === "entrata") row.entrate += n(m.importo);
    else row.uscite += n(m.importo);
  });
  row.saldo = n(row.incassi) + n(row.entrate) - n(row.uscite);
  return row;
}
function addCashRows(target, source, sign = 1) {
  target.incassi += sign * n(source.incassi);
  target.lordo += sign * n(source.lordo);
  target.commissioni += sign * n(source.commissioni);
  target.entrate += sign * n(source.entrate);
  target.uscite += sign * n(source.uscite);
  return target;
}
function accountingDatesBetween(fromDate, toDate, opts = {}) {
  const from = String(fromDate || "").slice(0,10);
  const to = String(toDate || "").slice(0,10);
  if (!from || !to) return [];
  const includeFrom = !!opts.includeFrom;
  const includeTo = opts.includeTo !== false;
  const dates = [
    ...(state.dailyRecords || []).map(r => r.data),
    ...(state.cashMovements || []).map(m => m.data),
  ].map(d => String(d || "").slice(0,10)).filter(Boolean);
  return [...new Set(dates)].filter(d => (includeFrom ? d >= from : d > from) && (includeTo ? d <= to : d < to)).sort();
}
function computeCashBreakdownUntil(toDate = "") {
  const out = {};
  const target = toDate ? String(toDate).slice(0,10) : latestAccountingDate();
  cashNames().forEach(name => { out[name] = emptyCashBreakdownRow(); });

  Object.entries(state.cashInitial || {}).forEach(([name, amount]) => {
    if (!out[name]) out[name] = emptyCashBreakdownRow();
    out[name].iniziale += n(amount);
    out[name].startDate = cashStartDate(name);
  });
  (state.customCashes || []).forEach(c => {
    if (!out[c.name]) out[c.name] = emptyCashBreakdownRow();
    out[c.name].iniziale += n(c.amount);
    out[c.name].startDate = out[c.name].startDate || "";
  });

  Object.entries(out).forEach(([name, row]) => {
    const start = cashStartDate(name);
    if (!target) return;
    if (!start) {
      accountingDatesBetween("0000-00-00", target, { includeFrom:false, includeTo:true }).forEach(d => addCashRows(row, cashDeltaForDate(name, d), 1));
    } else if (target >= start) {
      accountingDatesBetween(start, target, { includeFrom:true, includeTo:true }).forEach(d => addCashRows(row, cashDeltaForDate(name, d), 1));
    } else {
      // Saldo a ritroso: il saldo iniziale è considerato alla chiusura del giorno prima della data di partenza.
      accountingDatesBetween(target, start, { includeFrom:false, includeTo:false }).forEach(d => addCashRows(row, cashDeltaForDate(name, d), -1));
    }
    row.saldo = n(row.iniziale) + n(row.incassi) + n(row.entrate) - n(row.uscite);
  });
  return out;
}
function computeCashBreakdown() {
  return computeCashBreakdownUntil("");
}
function computeCashBalances() {
  const breakdown = computeCashBreakdown();
  return Object.fromEntries(Object.entries(breakdown).map(([name,row]) => [name, row.saldo]));
}


function parseActivityTime(v) {
  const raw = v || "";
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  return 0;
}
function businessMovementCash(m) {
  return extractCashFromNote(m?.nota || m?.descrizione || "", "contanti");
}
function movementSortValue(m) {
  const raw = m?.data ? `${m.data}T00:00:00` : (m?.operated_at || m?.saved_at || m?.created_at || "");
  const dt = m?.operated_at || raw;
  const saved = m?.saved_at || m?.created_at || "";
  return `${m?.data || "0000-00-00"}|${dt || ""}|${saved || ""}`;
}
function sortMovementsChronological(a, b) {
  return movementSortValue(a).localeCompare(movementSortValue(b));
}
function sortMovementsRecentFirst(a, b) {
  return movementSortValue(b).localeCompare(movementSortValue(a));
}
function activityAmountHtml(amount, type = "neutral") {
  if (amount === null || amount === undefined || amount === "") return "";
  const cls = type === "out" ? "bad" : type === "in" ? "ok" : "";
  const sign = type === "out" ? "-" : type === "in" ? "+" : "";
  return `<strong class="${cls}">${sign}${euro(amount)}</strong>`;
}
function buildLatestActivities(limit = 12) {
  const rows = [];
  (state.dailyRecords || []).forEach(r => {
    const totals = getDailyTotals(r);
    rows.push({
      savedAt: r.saved_at || r.created_at || "",
      data: r.data || "",
      title: `Scheda giornaliera ${r.data || ""}`,
      detail: `Incasso lordo ${euro(totals.totalIncasso)} · netto ${euro(totals.totalIncassoNetto)} · coperti ${totals.totalCoperti}`,
      amount: totals.totalIncassoNetto,
      amountType: "in",
    });
  });
  (state.supplierMovements || []).forEach(m => {
    const supplier = (state.suppliers || []).find(s => s.id === m.supplier_id);
    const isPayment = isSupplierPaymentType(m.tipo);
    rows.push({
      savedAt: m.saved_at || m.created_at || m.operated_at || m.data || "",
      data: m.data || "",
      title: `${isPayment ? "Pagamento" : "Movimento"} fornitore · ${supplier?.nome || "Fornitore"}`,
      detail: `Data contabile ${m.data || "—"} · operazione ${formatOperationDateTime(m)} · cassa ${cashLabel(businessMovementCash(m))}${isDailyAutoMovement(m) ? " · da scheda giornaliera" : ""}`,
      amount: n(m.importo),
      amountType: isPayment ? "out" : "neutral",
    });
  });
  (state.employeeMovements || []).forEach(m => {
    const employee = (state.employees || []).find(e => e.id === m.employee_id);
    rows.push({
      savedAt: m.saved_at || m.created_at || m.operated_at || m.data || "",
      data: m.data || "",
      title: `${typeLabel(m.tipo)} dipendente · ${employee?.nome || "Dipendente"}`,
      detail: `Data contabile ${m.data || "—"} · operazione ${formatOperationDateTime(m)} · cassa ${cashLabel(businessMovementCash(m))}${isDailyAutoMovement(m) ? " · da scheda giornaliera" : ""}`,
      amount: n(m.importo),
      amountType: "out",
    });
  });
  (state.cashMovements || [])
    .filter(m => !isDailyAutoLinkedMovement(m, m.data))
    .forEach(m => {
      rows.push({
        savedAt: m.saved_at || m.created_at || m.operated_at || m.data || "",
        data: m.data || "",
        title: `${m.tipo === "entrata" ? "Entrata" : "Uscita"} cassa · ${cashLabel(m.cassa || "contanti")}`,
        detail: `Data contabile ${m.data || "—"} · operazione ${formatOperationDateTime(m)} · ${m.descrizione || "movimento manuale"}`,
        amount: n(m.importo),
        amountType: m.tipo === "entrata" ? "in" : "out",
      });
    });
  return rows
    .filter(r => r.savedAt || r.data)
    .sort((a,b) => (parseActivityTime(b.savedAt) || parseActivityTime(b.data)) - (parseActivityTime(a.savedAt) || parseActivityTime(a.data)))
    .slice(0, limit);
}
function renderLatestActivity() {
  const box = safeEl("latestActivityBox");
  if (!box) return;
  const rows = buildLatestActivities(18);
  if (safeEl("latestActivityCount")) $("latestActivityCount").textContent = `${rows.length} ultime voci`;
  box.innerHTML = rows.length ? rows.map(row => `
    <div class="item activity-row">
      <div>
        <strong>${escapeHtml(row.title)}</strong>
        <small>${escapeHtml(row.detail)}</small>
        <small>Salvato/modificato il: ${formatDateTime(row.savedAt || row.data)}</small>
      </div>
      <div class="activity-amount">${activityAmountHtml(row.amount, row.amountType)}</div>
    </div>`).join("") : `<div class="alert okline">Ancora nessun movimento registrato.</div>`;
}
function getMatchingCashOutMovementsForBusiness(kind, movement) {
  const name = kind === "supplier"
    ? (state.suppliers || []).find(s => s.id === movement.supplier_id)?.nome || ""
    : (state.employees || []).find(e => e.id === movement.employee_id)?.nome || "";
  const cassa = businessMovementCash(movement);
  const needleKind = kind === "supplier" ? "fornitore" : "dipendente";
  const cleanName = normalizeSearchText(name);
  return (state.cashMovements || []).filter(c => {
    if (c.tipo !== "uscita") return false;
    if (String(c.data || "") !== String(movement.data || "")) return false;
    if (!roughlySameMoney(c.importo, movement.importo)) return false;
    if (normalizeSearchText(c.cassa || "contanti") !== normalizeSearchText(cassa || "contanti")) return false;
    const descr = normalizeSearchText(c.descrizione || "");
    if (isDailyAutoMovement(movement) && isDailyAutoLinkedMovement(c, movement.data)) {
      if (descr.includes(needleKind) && (!cleanName || descr.includes(cleanName))) return true;
      return false;
    }
    if (!descr.includes(needleKind)) return false;
    if (cleanName && !descr.includes(cleanName)) return false;
    return true;
  });
}
function findMatchingCashOutMovementForBusiness(kind, movement) {
  return getMatchingCashOutMovementsForBusiness(kind, movement).length > 0;
}
function duplicateGroups(rows, keyFn) {
  const map = new Map();
  (rows || []).forEach(row => {
    const key = keyFn(row);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return [...map.values()].filter(group => group.length > 1);
}
function cashMovementLooksBusinessRelated(c) {
  if (c?.tipo !== "uscita") return false;
  const descr = normalizeSearchText(c.descrizione || "");
  return descr.includes("fornitore") || descr.includes("dipendente") || isDailyAutoLinkedMovement(c, c.data);
}
function cashMovementHasAnyBusinessMatch(c) {
  if (!cashMovementLooksBusinessRelated(c)) return true;
  const cassa = normalizeSearchText(c.cassa || "contanti");
  const descr = normalizeSearchText(c.descrizione || "");
  const supplierMatch = (state.supplierMovements || []).some(m => {
    if (!isSupplierPaymentType(m.tipo)) return false;
    if (String(m.data || "") !== String(c.data || "")) return false;
    if (!roughlySameMoney(m.importo, c.importo)) return false;
    if (normalizeSearchText(businessMovementCash(m)) !== cassa) return false;
    const supplier = (state.suppliers || []).find(s => s.id === m.supplier_id);
    if (isDailyAutoLinkedMovement(c, c.data) && isDailyAutoMovement(m)) {
      return !supplier?.nome || descr.includes(normalizeSearchText(supplier.nome));
    }
    return descr.includes("fornitore") && (!supplier?.nome || descr.includes(normalizeSearchText(supplier.nome)));
  });
  if (supplierMatch) return true;
  const employeeMatch = (state.employeeMovements || []).some(m => {
    if (String(m.data || "") !== String(c.data || "")) return false;
    if (!roughlySameMoney(m.importo, c.importo)) return false;
    if (normalizeSearchText(businessMovementCash(m)) !== cassa) return false;
    const employee = (state.employees || []).find(e => e.id === m.employee_id);
    if (isDailyAutoLinkedMovement(c, c.data) && isDailyAutoMovement(m)) {
      return !employee?.nome || descr.includes(normalizeSearchText(employee.nome));
    }
    return descr.includes("dipendente") && (!employee?.nome || descr.includes(normalizeSearchText(employee.nome)));
  });
  return employeeMatch;
}

async function fetchCloudRawSnapshot() {
  if (!state.activeCompany?.id) return null;
  const tableNames = [
    "daily_records",
    "cash_state",
    "custom_cash_state",
    "cash_movements",
    "suppliers",
    "supplier_movements",
    "employees",
    "employee_movements",
    "bookings",
  ];
  const out = {};
  for (const table of tableNames) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("company_id", state.activeCompany.id);
    if (error) throw error;
    out[table] = data || [];
  }
  out.generated_at = new Date().toISOString();
  return out;
}
function rawDailyPayloadRows(raw = {}) {
  return (raw.daily_records || []).map(r => ({ ...(r.payload || {}), data: r.data || r.payload?.data, saved_at: r.saved_at || r.created_at || r.payload?.saved_at || null }));
}
function idsFrom(rows = [], keyFn = (r) => r.id) {
  return new Set((rows || []).map(keyFn).filter(Boolean).map(String));
}
function addTableSyncIssues(issues, tableLabel, rawRows, uiRows, rawKeyFn = (r)=>r.id, uiKeyFn = (r)=>r.id) {
  const rawIds = idsFrom(rawRows, rawKeyFn);
  const uiIds = idsFrom(uiRows, uiKeyFn);
  rawIds.forEach(id => {
    if (!uiIds.has(id)) issues.push({ level:"bad", title:`Supabase → sito: ${tableLabel}`, text:`Nel database esiste una riga che il sito non sta mostrando/caricando: ${id}. Premi “Ricarica da Supabase”.` });
  });
  uiIds.forEach(id => {
    if (!rawIds.has(id)) issues.push({ level:"bad", title:`Sito → Supabase: ${tableLabel}`, text:`Nel sito risulta una riga che non risulta più nel database: ${id}. Potrebbe essere cache/stato non aggiornato.` });
  });
}
function findDailyPayload(raw, dateStr) {
  return rawDailyPayloadRows(raw).find(r => String(r.data || "") === String(dateStr || ""));
}
function dailyRowMatchesBusinessMovement(row, movement, kind) {
  if (!row || !movement) return false;
  if (kind === "supplier") {
    if (row.source_id && String(row.source_id) === String(movement.id)) return true;
    if (row.supplier_id && String(row.supplier_id) !== String(movement.supplier_id || "")) return false;
  }
  if (kind === "employee") {
    if (row.source_id && String(row.source_id) === String(movement.id)) return true;
    if (row.employee_id && String(row.employee_id) !== String(movement.employee_id || "")) return false;
  }
  if (!roughlySameMoney(row.importo, movement.importo)) return false;
  if (cleanDateTimeLocal(row.operated_at) && cleanDateTimeLocal(movement.operated_at) && cleanDateTimeLocal(row.operated_at) !== cleanDateTimeLocal(movement.operated_at)) return false;
  return true;
}
function compareCloudRawWithUi(raw) {
  const issues = [];
  const uiDaily = state.dailyRecords || [];
  const rawDailyPayloads = rawDailyPayloadRows(raw);

  addTableSyncIssues(issues, "schede giornaliere", rawDailyPayloads, uiDaily, r => r.data, r => r.data);
  addTableSyncIssues(issues, "fornitori", raw.suppliers || [], state.suppliers || []);
  addTableSyncIssues(issues, "dipendenti", raw.employees || [], state.employees || []);
  addTableSyncIssues(issues, "movimenti fornitori", raw.supplier_movements || [], state.supplierMovements || []);
  addTableSyncIssues(issues, "movimenti dipendenti", raw.employee_movements || [], state.employeeMovements || []);
  addTableSyncIssues(issues, "movimenti cassa", raw.cash_movements || [], state.cashMovements || []);
  addTableSyncIssues(issues, "prenotazioni/banchetti", raw.bookings || [], state.bookings || []);

  const rawSupplierIds = idsFrom(raw.suppliers || []);
  const rawEmployeeIds = idsFrom(raw.employees || []);
  const rawSupplierMovementIds = idsFrom(raw.supplier_movements || []);
  const rawEmployeeMovementIds = idsFrom(raw.employee_movements || []);

  rawDailyPayloads.forEach(day => {
    (day.supplierPayments || []).forEach(row => {
      if (row.supplier_id && !rawSupplierIds.has(String(row.supplier_id))) {
        issues.push({ level:"bad", title:`Residuo scheda giornaliera ${day.data}`, text:`Nella scheda c’è un pagamento fornitore collegato a un fornitore non più presente in Supabase.` });
      }
      if (row.source_id && !rawSupplierMovementIds.has(String(row.source_id))) {
        issues.push({ level:"bad", title:`Residuo scheda giornaliera ${day.data}`, text:`Nella scheda c’è un riferimento a un movimento fornitore che non esiste più in Supabase.` });
      }
    });
    (day.employeePayments || []).forEach(row => {
      if (row.employee_id && !rawEmployeeIds.has(String(row.employee_id))) {
        issues.push({ level:"bad", title:`Residuo scheda giornaliera ${day.data}`, text:`Nella scheda c’è un pagamento dipendente collegato a un dipendente non più presente in Supabase.` });
      }
      if (row.source_id && !rawEmployeeMovementIds.has(String(row.source_id))) {
        issues.push({ level:"bad", title:`Residuo scheda giornaliera ${day.data}`, text:`Nella scheda c’è un riferimento a un movimento dipendente che non esiste più in Supabase.` });
      }
    });
  });

  (raw.supplier_movements || []).filter(m => isSupplierPaymentType(m.tipo) && isDailyAutoMovement(m)).forEach(m => {
    const day = findDailyPayload(raw, m.data);
    if (!day) {
      issues.push({ level:"bad", title:"Movimento fornitore senza scheda", text:`Esiste in Supabase un pagamento fornitore da scheda giornaliera del ${m.data}, ma la scheda giornaliera di quella data non esiste. Può scalare cassa senza essere visibile nella giornata.` });
      return;
    }
    const ok = (day.supplierPayments || []).some(row => dailyRowMatchesBusinessMovement(row, m, "supplier"));
    if (!ok) {
      issues.push({ level:"bad", title:`Movimento fornitore fuori scheda ${m.data}`, text:`Pagamento ${euro(m.importo)} presente nei movimenti fornitore ma non trovato dentro la scheda giornaliera della stessa data.` });
    }
  });

  (raw.employee_movements || []).filter(m => isDailyAutoMovement(m)).forEach(m => {
    const day = findDailyPayload(raw, m.data);
    if (!day) {
      issues.push({ level:"bad", title:"Movimento dipendente senza scheda", text:`Esiste in Supabase un movimento dipendente da scheda giornaliera del ${m.data}, ma la scheda giornaliera di quella data non esiste. Può scalare cassa senza essere visibile nella giornata.` });
      return;
    }
    const ok = (day.employeePayments || []).some(row => dailyRowMatchesBusinessMovement(row, m, "employee"));
    if (!ok) {
      issues.push({ level:"bad", title:`Movimento dipendente fuori scheda ${m.data}`, text:`Movimento ${euro(m.importo)} presente nei movimenti dipendente ma non trovato dentro la scheda giornaliera della stessa data.` });
    }
  });

  (raw.cash_movements || []).filter(c => c.tipo === "uscita" && isDailyAutoLinkedMovement(c, c.data)).forEach(c => {
    const day = findDailyPayload(raw, c.data);
    if (!day) {
      issues.push({ level:"bad", title:"Uscita cassa senza scheda", text:`Esiste in Supabase un’uscita cassa da scheda giornaliera del ${c.data}, ma la scheda giornaliera di quella data non esiste. Questa uscita può spiegare soldi mancanti.` });
    }
  });

  const rawCashInitial = { contanti:0, pos:0 };
  const rawCashInitialDate = { contanti:"", pos:"" };
  (raw.cash_state || []).forEach(r => { rawCashInitial[r.kind] = n(r.amount); if (r.reference_date) rawCashInitialDate[r.kind] = String(r.reference_date).slice(0, 10); });
  const uiCashInitial = state.cashInitial || {};
  const uiCashInitialDate = state.cashInitialDate || {};
  Object.keys(rawCashInitial).forEach(kind => {
    if (!roughlySameMoney(rawCashInitial[kind], uiCashInitial[kind]) || (rawCashInitialDate[kind] || "") !== (uiCashInitialDate[kind] || "")) {
      issues.push({ level:"bad", title:`Saldo iniziale ${cashLabel(kind)}`, text:`Supabase ha ${euro(rawCashInitial[kind])} ${rawCashInitialDate[kind] ? "dal " + formatDate(rawCashInitialDate[kind]) : ""}, il sito sta usando ${euro(uiCashInitial[kind])} ${uiCashInitialDate[kind] ? "dal " + formatDate(uiCashInitialDate[kind]) : ""}. Ricarica i dati.` });
    }
  });

  return issues;
}
function renderCloudSyncIssues(issues, statusText = "") {
  const box = safeEl("cloudSyncBox");
  const status = safeEl("cloudSyncStatus");
  if (status) status.textContent = statusText || `Ultimo controllo Supabase/sito: ${formatDateTime(new Date().toISOString())}`;
  if (!box) return;
  if (!issues.length) {
    box.innerHTML = `<div class="alert okline">Supabase e sito risultano allineati: non ci sono righe fantasma che stanno contando la cassa fuori dalla schermata.</div>`;
    return;
  }
  box.innerHTML = `<div class="alert">Trovati ${issues.length} problemi di allineamento Supabase/sito. Se il gestionale mostra meno soldi del reale, controlla soprattutto le uscite cassa indicate qui sotto.</div>` + issues.slice(0, 20).map(issue => `
    <div class="item check-row ${issue.level === "warn" ? "check-warn" : "check-bad"}">
      <div>
        <strong>${escapeHtml(issue.title)}</strong>
        <small>${escapeHtml(issue.text)}</small>
      </div>
      <div>${issue.level === "warn" ? "Attenzione" : "Errore"}</div>
    </div>`).join("") + (issues.length > 20 ? `<div class="muted small" style="margin-top:8px;">Altri ${issues.length - 20} problemi non mostrati. Scarica la diagnostica per vederli tutti.</div>` : "");
}
async function runCloudUiSyncCheck(silent = false) {
  if (cloudSyncCheckInProgress || !state.activeCompany?.id) return [];
  cloudSyncCheckInProgress = true;
  try {
    if (!silent && safeEl("cloudSyncStatus")) $("cloudSyncStatus").textContent = "Controllo in corso su Supabase...";
    const raw = await fetchCloudRawSnapshot();
    const issues = compareCloudRawWithUi(raw);
    renderCloudSyncIssues(issues);
    return issues;
  } catch (err) {
    console.error(err);
    renderCloudSyncIssues([{ level:"bad", title:"Errore controllo Supabase", text: err.message || String(err) }], "Errore durante il controllo Supabase/sito.");
    return [];
  } finally {
    cloudSyncCheckInProgress = false;
  }
}
async function forceReloadFromSupabase() {
  try {
    if (safeEl("cloudSyncStatus")) $("cloudSyncStatus").textContent = "Ricaricamento completo da Supabase...";
    await loadCompanyData();
    renderAll();
    const issues = await runCloudUiSyncCheck(true);
    showGlobalMessage(issues.length ? "Dati ricaricati, ma ci sono problemi da verificare." : "Dati ricaricati da Supabase: tutto allineato.");
  } catch (err) {
    console.error(err);
    showGlobalMessage(err.message || String(err), "error");
  }
}


function dailyCashReconciliationRows() {
  const rows = [...(state.dailyRecords || [])].sort((a,b) => String(a.data || "").localeCompare(String(b.data || ""))).map(rec => {
    const serviceContanti = normalizeMoney(legacyDailyCash(rec, "contanti"));
    const servicePos = normalizeMoney(legacyDailyCash(rec, "pos"));
    const usedContanti = normalizeMoney(getDailyCashAmount(rec, "contanti"));
    const usedPos = normalizeMoney(getDailyCashAmount(rec, "pos"));
    const diffContanti = normalizeMoney(usedContanti - serviceContanti);
    const diffPos = normalizeMoney(usedPos - servicePos);
    const usedPosNet = normalizeMoney(netAmountForCash("pos", usedPos));
    const servicePosNet = normalizeMoney(netAmountForCash("pos", servicePos));
    const hasCashObject = !!rec?.casse && typeof rec.casse === "object";
    const hasDifference = !roughlySameMoney(diffContanti, 0) || !roughlySameMoney(diffPos, 0);
    return {
      data: rec.data,
      serviceContanti,
      usedContanti,
      diffContanti,
      servicePos,
      usedPos,
      diffPos,
      servicePosNet,
      usedPosNet,
      hasCashObject,
      hasDifference,
      saved_at: rec.saved_at || rec.created_at || null,
    };
  });
  const totals = rows.reduce((acc,row) => {
    acc.serviceContanti += row.serviceContanti;
    acc.usedContanti += row.usedContanti;
    acc.diffContanti += row.diffContanti;
    acc.servicePos += row.servicePos;
    acc.usedPos += row.usedPos;
    acc.diffPos += row.diffPos;
    acc.servicePosNet += row.servicePosNet;
    acc.usedPosNet += row.usedPosNet;
    acc.differences += row.hasDifference ? 1 : 0;
    return acc;
  }, { serviceContanti:0, usedContanti:0, diffContanti:0, servicePos:0, usedPos:0, diffPos:0, servicePosNet:0, usedPosNet:0, differences:0 });
  Object.keys(totals).forEach(k => { if (k !== "differences") totals[k] = normalizeMoney(totals[k]); });
  return { rows, totals };
}
function renderDailyCashAudit() {
  const box = safeEl("dailyCashAuditBox");
  const status = safeEl("dailyCashAuditStatus");
  if (!box) return;
  const audit = dailyCashReconciliationRows();
  const rowsWithDiff = audit.rows.filter(r => r.hasDifference);
  if (status) {
    status.textContent = rowsWithDiff.length
      ? `Trovate ${rowsWithDiff.length} giornate dove i valori usati dal gestionale non coincidono con pranzo/cena/banchetti.`
      : `Tutto torna: dashboard e servizi usano gli stessi incassi. Ultimo controllo: ${formatDateTime(new Date().toISOString())}`;
  }
  const totalsHtml = `
    <div class="grid4 daily-audit-kpis">
      <div class="card inner"><strong>Contanti visibili</strong><div class="metric-value small">${euro(audit.totals.serviceContanti)}</div><small>Somma pranzo + cena + banchetti</small></div>
      <div class="card inner"><strong>Contanti usati</strong><div class="metric-value small">${euro(audit.totals.usedContanti)}</div><small>Totale usato dalla dashboard</small></div>
      <div class="card inner"><strong>Differenza contanti</strong><div class="metric-value small ${audit.totals.diffContanti < -0.01 ? "bad" : audit.totals.diffContanti > 0.01 ? "warn" : "ok"}">${euro(audit.totals.diffContanti)}</div><small>Usato - visibile</small></div>
      <div class="card inner"><strong>Differenza POS lordo</strong><div class="metric-value small ${audit.totals.diffPos < -0.01 ? "bad" : audit.totals.diffPos > 0.01 ? "warn" : "ok"}">${euro(audit.totals.diffPos)}</div><small>Usato - visibile</small></div>
    </div>`;
  const tableRows = audit.rows.map(row => {
    const cls = row.hasDifference ? "daily-audit-bad" : "";
    const statusLabel = row.hasDifference ? "Da correggere" : "OK";
    return `<tr class="${cls}">
      <td><button class="btn ghost audit-day-open-btn" data-day-date="${escapeHtml(row.data)}">${escapeHtml(row.data)}</button></td>
      <td>${euro(row.serviceContanti)}</td>
      <td>${euro(row.usedContanti)}</td>
      <td class="${Math.abs(row.diffContanti) > 0.01 ? "bad" : "ok"}">${euro(row.diffContanti)}</td>
      <td>${euro(row.servicePos)}</td>
      <td>${euro(row.usedPos)}</td>
      <td class="${Math.abs(row.diffPos) > 0.01 ? "bad" : "ok"}">${euro(row.diffPos)}</td>
      <td>${statusLabel}</td>
    </tr>`;
  }).join("");
  box.innerHTML = `${rowsWithDiff.length ? `<div class="alert">Attenzione: ci sono valori di chiusura cassa salvati che non coincidono con i campi visibili nei servizi. Puoi aprire la giornata oppure usare “Ricalcola chiusure da servizi”.</div>` : `<div class="alert okline">Nessuna differenza tra servizi visibili e valori usati dalla dashboard.</div>`}
    ${totalsHtml}
    <div class="table-wrap daily-audit-table">
      <table>
        <thead><tr><th>Data</th><th>Contanti visibili</th><th>Contanti usati</th><th>Diff.</th><th>POS lordo visibile</th><th>POS lordo usato</th><th>Diff.</th><th>Stato</th></tr></thead>
        <tbody>${tableRows || `<tr><td colspan="8">Nessuna giornata registrata.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="muted small">Nota: per il POS il confronto è sul lordo inserito; la dashboard poi applica automaticamente SumUp 0,95% per il netto.</p>`;
  document.querySelectorAll(".audit-day-open-btn").forEach(btn => btn.addEventListener("click", () => loadDailyByDate(btn.dataset.dayDate)));
}
function getDailyCashRecalculationPlan() {
  return (state.dailyRecords || []).map(rec => {
    const auto = autoCashFromRecord({ ...rec, casse: {} });
    const current = { contanti: getDailyCashAmount(rec, "contanti"), pos: getDailyCashAmount(rec, "pos") };
    return {
      rec,
      current: { contanti: normalizeMoney(current.contanti), pos: normalizeMoney(current.pos) },
      auto: { contanti: normalizeMoney(auto.contanti), pos: normalizeMoney(auto.pos) },
      diffContanti: normalizeMoney(current.contanti - auto.contanti),
      diffPos: normalizeMoney(current.pos - auto.pos),
    };
  }).filter(item => !roughlySameMoney(item.diffContanti, 0) || !roughlySameMoney(item.diffPos, 0));
}
async function recalculateDailyCashFromServices() {
  try {
    const plan = getDailyCashRecalculationPlan();
    if (!plan.length) {
      showGlobalMessage("Nessuna chiusura da ricalcolare: i valori sono già allineati ai servizi.");
      renderDailyCashAudit();
      return;
    }
    const totalDiffContanti = normalizeMoney(plan.reduce((a,p)=>a+p.diffContanti, 0));
    const totalDiffPos = normalizeMoney(plan.reduce((a,p)=>a+p.diffPos, 0));
    const preview = plan.slice(0, 8).map(p => `- ${p.rec.data}: contanti ${euro(p.current.contanti)} → ${euro(p.auto.contanti)}, POS ${euro(p.current.pos)} → ${euro(p.auto.pos)}`).join("\n");
    const more = plan.length > 8 ? `\n- altre ${plan.length - 8} giornate...` : "";
    const ok = confirm(`Ricalcolo chiusura cassa da pranzo/cena/banchetti per ${plan.length} giornate?\n\nDifferenza contanti totale: ${euro(totalDiffContanti)}\nDifferenza POS lordo totale: ${euro(totalDiffPos)}\n\n${preview}${more}\n\nNon cancella movimenti di fornitori/dipendenti: aggiorna solo i valori contanti/POS della chiusura cassa nelle schede giornaliere.`);
    if (!ok) return;
    const savedAt = new Date().toISOString();
    for (const item of plan) {
      const rec = JSON.parse(JSON.stringify(item.rec));
      rec.casse = { ...(rec.casse || {}), contanti: item.auto.contanti, pos: item.auto.pos };
      rec.saved_at = savedAt;
      const { error } = await supabase.from("daily_records").upsert({
        company_id: state.activeCompany.id,
        data: rec.data,
        payload: rec,
        saved_at: savedAt,
      }, { onConflict: "company_id,data" });
      if (error) throw error;
    }
    await refreshData(`Chiusure cassa ricalcolate da servizi: ${plan.length} giornate aggiornate.`);
    renderDailyCashAudit();
  } catch (err) {
    console.error(err);
    showGlobalMessage(err.message || String(err), "error");
  }
}

function auditSnapshot() {
  const issues = runAccountingChecks();
  return {
    generated_at: new Date().toISOString(),
    company: state.activeCompany,
    cash_initial: state.cashInitial,
    cash_initial_date: state.cashInitialDate,
    cash_breakdown: computeCashBreakdown(),
    daily_cash_audit: dailyCashReconciliationRows(),
    issues,
    counts: {
      daily_records: state.dailyRecords.length,
      suppliers: state.suppliers.length,
      supplier_movements: state.supplierMovements.length,
      employees: state.employees.length,
      employee_movements: state.employeeMovements.length,
      cash_movements: state.cashMovements.length,
    },
    recent_activities: buildLatestActivities(50),
    supplier_movements: state.supplierMovements,
    employee_movements: state.employeeMovements,
    cash_movements: state.cashMovements,
  };
}
function exportDiagnostics() {
  try {
    const data = auditSnapshot();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const safeName = (state.activeCompany?.name || "ditta").replace(/[^\w\-]+/g, "_");
    a.href = URL.createObjectURL(blob);
    a.download = `diagnostica_${safeName}_${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    showGlobalMessage(err.message || String(err), "error");
  }
}
function runAccountingChecks() {
  const issues = [];

  (state.dailyRecords || []).forEach(r => {
    validateDaily(r).forEach(text => issues.push({ level: "bad", title: `Scheda ${r.data}`, text }));
    const auto = autoCashFromRecord(r);
    const casse = r.casse || {};
    if (Object.prototype.hasOwnProperty.call(casse, "contanti") && !roughlySameMoney(casse.contanti, auto.contanti)) {
      issues.push({ level: "bad", title: `Scheda ${r.data}`, text: `Contanti chiusura ${euro(casse.contanti)} diversi dalla somma servizi ${euro(auto.contanti)}.` });
    }
    if (Object.prototype.hasOwnProperty.call(casse, "pos") && !roughlySameMoney(casse.pos, auto.pos)) {
      issues.push({ level: "bad", title: `Scheda ${r.data}`, text: `POS chiusura ${euro(casse.pos)} diverso dalla somma servizi ${euro(auto.pos)}.` });
    }
    (r.supplierPayments || []).forEach(row => {
      if (row.supplier_id && !(state.suppliers || []).some(s => s.id === row.supplier_id)) {
        issues.push({ level: "bad", title: `Scheda ${r.data}`, text: `Pagamento fornitore presente nella scheda ma il fornitore non esiste più. Possibile residuo dopo cancellazione.` });
      }
    });
    (r.employeePayments || []).forEach(row => {
      if (row.employee_id && !(state.employees || []).some(e => e.id === row.employee_id)) {
        issues.push({ level: "bad", title: `Scheda ${r.data}`, text: `Pagamento dipendente presente nella scheda ma il dipendente non esiste più. Possibile residuo dopo cancellazione.` });
      }
    });
  });

  (state.supplierMovements || []).forEach(m => {
    const supplier = (state.suppliers || []).find(s => s.id === m.supplier_id);
    if (!supplier) {
      issues.push({ level: "bad", title: "Movimento fornitore orfano", text: `Movimento ${typeLabel(m.tipo)} di ${euro(m.importo)} del ${m.data}: il fornitore collegato non esiste più.` });
      return;
    }
    if (isSupplierPaymentType(m.tipo)) {
      const matches = getMatchingCashOutMovementsForBusiness("supplier", m);
      if (!matches.length) {
        issues.push({ level: "bad", title: `Fornitore ${supplier.nome}`, text: `Pagamento ${euro(m.importo)} del ${m.data} non risulta collegato a un’uscita cassa.` });
      } else if (matches.length > 1) {
        issues.push({ level: "bad", title: `Possibile doppione fornitore ${supplier.nome}`, text: `Pagamento ${euro(m.importo)} del ${m.data}: trovate ${matches.length} uscite cassa compatibili. Potrebbe essere stato scalato più volte.` });
      }
    }
  });

  (state.employeeMovements || []).forEach(m => {
    const employee = (state.employees || []).find(e => e.id === m.employee_id);
    if (!employee) {
      issues.push({ level: "bad", title: "Movimento dipendente orfano", text: `Movimento ${typeLabel(m.tipo)} di ${euro(m.importo)} del ${m.data}: il dipendente collegato non esiste più.` });
      return;
    }
    const matches = getMatchingCashOutMovementsForBusiness("employee", m);
    if (!matches.length) {
      issues.push({ level: "bad", title: `Dipendente ${employee.nome}`, text: `Movimento ${euro(m.importo)} del ${m.data} non risulta collegato a un’uscita cassa.` });
    } else if (matches.length > 1) {
      issues.push({ level: "bad", title: `Possibile doppione dipendente ${employee.nome}`, text: `Movimento ${euro(m.importo)} del ${m.data}: trovate ${matches.length} uscite cassa compatibili. Potrebbe essere stato scalato più volte.` });
    }
  });

  duplicateGroups((state.supplierMovements || []), m => [m.supplier_id, m.data, m.tipo, normalizeMoney(m.importo), normalizeSearchText(businessMovementCash(m)), normalizeSearchText(cleanMovementNoteForForm(m.nota)), cleanDateTimeLocal(m.operated_at)].join("|")).forEach(group => {
    const supplier = (state.suppliers || []).find(s => s.id === group[0].supplier_id);
    issues.push({ level: "warn", title: `Possibile movimento fornitore duplicato`, text: `${supplier?.nome || "Fornitore"}: ${group.length} movimenti uguali il ${group[0].data} da ${euro(group[0].importo)}.` });
  });
  duplicateGroups((state.employeeMovements || []), m => [m.employee_id, m.data, m.tipo, normalizeMoney(m.importo), normalizeSearchText(businessMovementCash(m)), normalizeSearchText(cleanMovementNoteForForm(m.nota)), cleanDateTimeLocal(m.operated_at)].join("|")).forEach(group => {
    const employee = (state.employees || []).find(e => e.id === group[0].employee_id);
    issues.push({ level: "warn", title: `Possibile movimento dipendente duplicato`, text: `${employee?.nome || "Dipendente"}: ${group.length} movimenti uguali il ${group[0].data} da ${euro(group[0].importo)}.` });
  });
  duplicateGroups((state.cashMovements || []), m => [m.data, m.tipo, normalizeSearchText(m.cassa), normalizeMoney(m.importo), normalizeSearchText(m.descrizione || "")].join("|")).forEach(group => {
    issues.push({ level: "warn", title: "Possibile movimento cassa duplicato", text: `${group.length} movimenti cassa uguali il ${group[0].data}, ${cashLabel(group[0].cassa)}, ${euro(group[0].importo)}.` });
  });

  (state.cashMovements || []).forEach(c => {
    if (cashMovementLooksBusinessRelated(c) && !cashMovementHasAnyBusinessMatch(c)) {
      issues.push({ level: "bad", title: "Uscita cassa non collegata", text: `${c.data} · ${cashLabel(c.cassa)} · ${euro(c.importo)} · ${c.descrizione || "senza descrizione"}. Può spiegare perché il gestionale mostra meno soldi.` });
    }
  });

  Object.entries(computeCashBreakdown()).forEach(([name,row]) => {
    if (row.saldo < -0.01) {
      issues.push({ level: "warn", title: `Cassa ${cashLabel(name)}`, text: `Saldo previsto negativo: ${euro(row.saldo)}. Controlla entrate e uscite.` });
    }
  });
  return issues;
}


function safeSortRowsForCleanup(rows) {
  return [...(rows || [])].sort((a,b) => {
    const av = `${a.saved_at || a.created_at || ""}|${a.id || ""}`;
    const bv = `${b.saved_at || b.created_at || ""}|${b.id || ""}`;
    return av.localeCompare(bv);
  });
}
function cleanupDuplicateGroups(rows, keyFn) {
  return duplicateGroups(rows, keyFn).map(group => {
    const sorted = safeSortRowsForCleanup(group);
    return { keep: sorted[0], remove: sorted.slice(1) };
  }).filter(g => g.remove.length);
}
function getDuplicateCleanupCandidates() {
  const supplierGroups = cleanupDuplicateGroups((state.supplierMovements || []), m => [m.supplier_id, m.data, m.tipo, normalizeMoney(m.importo), normalizeSearchText(businessMovementCash(m)), normalizeSearchText(cleanMovementNoteForForm(m.nota)), cleanDateTimeLocal(m.operated_at)].join("|"));
  const employeeGroups = cleanupDuplicateGroups((state.employeeMovements || []), m => [m.employee_id, m.data, m.tipo, normalizeMoney(m.importo), normalizeSearchText(businessMovementCash(m)), normalizeSearchText(cleanMovementNoteForForm(m.nota)), cleanDateTimeLocal(m.operated_at)].join("|"));
  const cashGroups = cleanupDuplicateGroups((state.cashMovements || []), m => [m.data, m.tipo, normalizeSearchText(m.cassa), normalizeMoney(m.importo), normalizeSearchText(m.descrizione || "")].join("|"));
  return {
    supplierDuplicateIds: supplierGroups.flatMap(g => g.remove.map(x => x.id).filter(Boolean)),
    employeeDuplicateIds: employeeGroups.flatMap(g => g.remove.map(x => x.id).filter(Boolean)),
    cashDuplicateIds: cashGroups.flatMap(g => g.remove.map(x => x.id).filter(Boolean)),
    supplierDuplicateGroups: supplierGroups,
    employeeDuplicateGroups: employeeGroups,
    cashDuplicateGroups: cashGroups,
  };
}
function cashOutMatchesBusinessLoose(c, kind, movement) {
  if (!c || !movement) return false;
  if (c.tipo !== "uscita") return false;
  if (String(c.data || "") !== String(movement.data || "")) return false;
  if (!roughlySameMoney(c.importo, movement.importo)) return false;
  if (normalizeSearchText(c.cassa || "contanti") !== normalizeSearchText(businessMovementCash(movement) || "contanti")) return false;
  const descr = normalizeSearchText(c.descrizione || "");
  if (isDailyAutoMovement(movement) && isDailyAutoLinkedMovement(c, movement.data)) return true;
  return descr.includes(kind === "supplier" ? "fornitore" : "dipendente");
}
function getOrphanCleanupCandidates() {
  const supplierIds = new Set((state.suppliers || []).map(s => String(s.id)));
  const employeeIds = new Set((state.employees || []).map(e => String(e.id)));
  const orphanSupplierMovements = (state.supplierMovements || []).filter(m => m.supplier_id && !supplierIds.has(String(m.supplier_id)));
  const orphanEmployeeMovements = (state.employeeMovements || []).filter(m => m.employee_id && !employeeIds.has(String(m.employee_id)));
  const linkedCashIds = new Set();
  orphanSupplierMovements.filter(m => isSupplierPaymentType(m.tipo)).forEach(m => {
    (state.cashMovements || []).filter(c => cashOutMatchesBusinessLoose(c, "supplier", m)).forEach(c => c.id && linkedCashIds.add(c.id));
  });
  orphanEmployeeMovements.forEach(m => {
    (state.cashMovements || []).filter(c => cashOutMatchesBusinessLoose(c, "employee", m)).forEach(c => c.id && linkedCashIds.add(c.id));
  });
  const orphanCashMovements = (state.cashMovements || []).filter(c => c.id && cashMovementLooksBusinessRelated(c) && !cashMovementHasAnyBusinessMatch(c));
  orphanCashMovements.forEach(c => c.id && linkedCashIds.add(c.id));
  return {
    orphanSupplierMovementIds: orphanSupplierMovements.map(m => m.id).filter(Boolean),
    orphanEmployeeMovementIds: orphanEmployeeMovements.map(m => m.id).filter(Boolean),
    orphanCashMovementIds: [...linkedCashIds],
    orphanSupplierMovements,
    orphanEmployeeMovements,
    orphanCashMovements,
  };
}
function getDailyPayloadCleanupCandidates() {
  const supplierIds = new Set((state.suppliers || []).map(s => String(s.id)));
  const employeeIds = new Set((state.employees || []).map(e => String(e.id)));
  const supplierMovementIds = new Set((state.supplierMovements || []).map(m => String(m.id)));
  const employeeMovementIds = new Set((state.employeeMovements || []).map(m => String(m.id)));
  const updates = [];
  (state.dailyRecords || []).forEach(rec => {
    const copy = JSON.parse(JSON.stringify(rec));
    const beforeSupplier = copy.supplierPayments || [];
    const beforeEmployee = copy.employeePayments || [];
    copy.supplierPayments = beforeSupplier.filter(row => {
      if (row.supplier_id && !supplierIds.has(String(row.supplier_id))) return false;
      if (row.source_id && !supplierMovementIds.has(String(row.source_id))) return false;
      return true;
    });
    copy.employeePayments = beforeEmployee.filter(row => {
      if (row.employee_id && !employeeIds.has(String(row.employee_id))) return false;
      if (row.source_id && !employeeMovementIds.has(String(row.source_id))) return false;
      return true;
    });
    if (copy.supplierPayments.length !== beforeSupplier.length || copy.employeePayments.length !== beforeEmployee.length) updates.push(copy);
  });
  return updates;
}
function cleanupPlanSummary() {
  const d = getDuplicateCleanupCandidates();
  const o = getOrphanCleanupCandidates();
  const dailyUpdates = getDailyPayloadCleanupCandidates();
  return {
    supplierDuplicates: d.supplierDuplicateIds.length,
    employeeDuplicates: d.employeeDuplicateIds.length,
    cashDuplicates: d.cashDuplicateIds.length,
    orphanSuppliers: o.orphanSupplierMovementIds.length,
    orphanEmployees: o.orphanEmployeeMovementIds.length,
    orphanCash: o.orphanCashMovementIds.length,
    dailyRecordsToFix: dailyUpdates.length,
    duplicate: d,
    orphan: o,
    dailyUpdates,
  };
}
async function cleanupSafeDuplicates() {
  try {
    const plan = cleanupPlanSummary();
    const total = plan.supplierDuplicates + plan.employeeDuplicates + plan.cashDuplicates + plan.orphanSuppliers + plan.orphanEmployees + plan.orphanCash + plan.dailyRecordsToFix;
    if (!total) {
      showGlobalMessage("Non ci sono duplicati sicuri o residui orfani da rimuovere.");
      return;
    }
    const msg = `Pulizia controllata:\n\n` +
      `- doppioni movimenti fornitori: ${plan.supplierDuplicates}\n` +
      `- doppioni movimenti dipendenti: ${plan.employeeDuplicates}\n` +
      `- doppioni movimenti cassa: ${plan.cashDuplicates}\n` +
      `- movimenti fornitore orfani: ${plan.orphanSuppliers}\n` +
      `- movimenti dipendente orfani: ${plan.orphanEmployees}\n` +
      `- uscite cassa orfane/collegate a residui: ${plan.orphanCash}\n` +
      `- schede giornaliere da ripulire: ${plan.dailyRecordsToFix}\n\n` +
      `Verranno rimossi solo doppioni identici e residui collegati a fornitori/dipendenti eliminati. Prima assicurati di aver scaricato la diagnostica. Procedo?`;
    if (!confirm(msg)) return;

    const deleteIds = async (table, ids) => {
      const clean = [...new Set((ids || []).filter(Boolean).map(String))];
      if (!clean.length) return;
      const { error } = await supabase.from(table).delete().eq("company_id", state.activeCompany.id).in("id", clean);
      if (error) throw error;
    };

    const cashIds = [...new Set([...(plan.duplicate.cashDuplicateIds || []), ...(plan.orphan.orphanCashMovementIds || [])])];
    await deleteIds("cash_movements", cashIds);
    await deleteIds("supplier_movements", [...(plan.duplicate.supplierDuplicateIds || []), ...(plan.orphan.orphanSupplierMovementIds || [])]);
    await deleteIds("employee_movements", [...(plan.duplicate.employeeDuplicateIds || []), ...(plan.orphan.orphanEmployeeMovementIds || [])]);
    for (const rec of plan.dailyUpdates) {
      await upsertDailyRecordPayload(rec);
    }
    await refreshData("Pulizia completata. Ho ricaricato i dati da Supabase e rifatto i controlli.");
  } catch (err) {
    console.error(err);
    showGlobalMessage(err.message || String(err), "error");
  }
}
async function deleteSupplierMovementById(id) {
  const m = (state.supplierMovements || []).find(x => String(x.id) === String(id));
  if (!m) return;
  const supplier = (state.suppliers || []).find(s => s.id === m.supplier_id);
  if (!confirm(`Vuoi eliminare questo movimento fornitore?\n\n${supplier?.nome || "Fornitore"} · ${m.data} · ${typeLabel(m.tipo)} · ${euro(m.importo)}\n\nSe è un pagamento/acconto, verrà eliminata anche una uscita cassa collegata.`)) return;
  try {
    if (isSupplierPaymentType(m.tipo)) {
      const matches = getMatchingCashOutMovementsForBusiness("supplier", m).sort((a,b) => (b.saved_at || b.created_at || "").localeCompare(a.saved_at || a.created_at || ""));
      if (matches[0]?.id) await supabase.from("cash_movements").delete().eq("company_id", state.activeCompany.id).eq("id", matches[0].id);
    }
    if (isDailyAutoMovement(m)) await syncDailyPayloadAfterMovementEdit("supplier", m, {}, { keepInDaily: false });
    const { error } = await supabase.from("supplier_movements").delete().eq("company_id", state.activeCompany.id).eq("id", m.id);
    if (error) throw error;
    await refreshData("Movimento fornitore eliminato e cassa aggiornata.");
  } catch (err) { showGlobalMessage(err.message || String(err), "error"); }
}
async function deleteEmployeeMovementById(id) {
  const m = (state.employeeMovements || []).find(x => String(x.id) === String(id));
  if (!m) return;
  const employee = (state.employees || []).find(e => e.id === m.employee_id);
  if (!confirm(`Vuoi eliminare questo movimento dipendente?\n\n${employee?.nome || "Dipendente"} · ${m.data} · ${typeLabel(m.tipo)} · ${euro(m.importo)}\n\nVerrà eliminata anche una uscita cassa collegata.`)) return;
  try {
    const matches = getMatchingCashOutMovementsForBusiness("employee", m).sort((a,b) => (b.saved_at || b.created_at || "").localeCompare(a.saved_at || a.created_at || ""));
    if (matches[0]?.id) await supabase.from("cash_movements").delete().eq("company_id", state.activeCompany.id).eq("id", matches[0].id);
    if (isDailyAutoMovement(m)) await syncDailyPayloadAfterMovementEdit("employee", m, {}, { keepInDaily: false });
    const { error } = await supabase.from("employee_movements").delete().eq("company_id", state.activeCompany.id).eq("id", m.id);
    if (error) throw error;
    await refreshData("Movimento dipendente eliminato e cassa aggiornata.");
  } catch (err) { showGlobalMessage(err.message || String(err), "error"); }
}

function renderAccountingCheck() {
  const box = safeEl("accountingCheckBox");
  if (!box) return;
  const issues = runAccountingChecks();
  if (safeEl("lastVerificationAt")) $("lastVerificationAt").textContent = `Ultimo controllo: ${formatDateTime(new Date().toISOString())}`;
  if (!issues.length) {
    box.innerHTML = `<div class="alert okline">Tutto torna: entrate, uscite, schede giornaliere, doppioni e movimenti orfani risultano coerenti.</div>`;
    return;
  }
  const plan = cleanupPlanSummary();
  const cleanupTotal = plan.supplierDuplicates + plan.employeeDuplicates + plan.cashDuplicates + plan.orphanSuppliers + plan.orphanEmployees + plan.orphanCash + plan.dailyRecordsToFix;
  const cleanupBox = cleanupTotal ? `<div class="alert">Pulizia disponibile: ${cleanupTotal} elementi sicuri da correggere/rimuovere. Usa “Scarica diagnostica” prima di premere “Rimuovi duplicati sicuri”.</div>` : "";
  box.innerHTML = `<div class="alert">Trovati ${issues.length} controlli da verificare. Prima di eliminare dati, controlla le righe sotto o scarica la diagnostica.</div>` + cleanupBox + issues.slice(0, 16).map(issue => `
    <div class="item check-row ${issue.level === "warn" ? "check-warn" : "check-bad"}">
      <div>
        <strong>${escapeHtml(issue.title)}</strong>
        <small>${escapeHtml(issue.text)}</small>
      </div>
      <div>${issue.level === "warn" ? "Attenzione" : "Errore"}</div>
    </div>`).join("") + (issues.length > 16 ? `<div class="muted small" style="margin-top:8px;">Altri ${issues.length - 16} controlli da verificare.</div>` : "");
}
function renderLiveChecks() {
  renderLatestActivity();
  renderAccountingCheck();
}
function computeGlobalAlerts() {
  const alerts = [];
  state.dailyRecords.forEach(r => validateDaily(r).forEach(text => alerts.push({ title: r.data, text })));
  state.suppliers.forEach(s => {
    const sosp = supplierSuspeso(s);
    if (sosp > 0) alerts.push({ title: rLabel("Fornitore aperto"), text: `${s.nome}: ${euro(sosp)}` });
  });
  return alerts;
}
function rLabel(v){ return v; }

async function initSupabase() {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data:{ session }, error } = await supabase.auth.getSession();
    if (error) {
      hideAllViews();
      safeEl("authView")?.classList.remove("hidden");
      showAuthMessage("Errore Supabase: " + error.message, true);
      return false;
    }
    state.session = session;
    return true;
  } catch (err) {
    console.error(err);
    hideAllViews();
    safeEl("authView")?.classList.remove("hidden");
    showAuthMessage("Errore avvio app: " + (err?.message || err), true);
    return false;
  }
}
function setAuthTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.authTab === tab));
  safeEl("loginTab")?.classList.toggle("hidden", tab !== "login");
  safeEl("registerTab")?.classList.toggle("hidden", tab !== "register");
}
async function login() {
  const { error, data } = await supabase.auth.signInWithPassword({
    email: $("loginEmail").value.trim(),
    password: $("loginPassword").value.trim()
  });
  if (error) return showAuthMessage(error.message, true);
  saveRememberedEmail();
  state.session = data.session;
  await bootstrapAfterAuth();
}
async function register() {
  const companyName = $("registerCompanyName").value.trim();
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value.trim();
  const vatNumber = $("registerVatNumber").value.trim();
  const phone = $("registerPhone").value.trim();

  if (!companyName || !email || !password) return showAuthMessage("Compila almeno nome ditta, email e password.", true);

  const { data: existingCompanies, error: checkErr } = await supabase
    .from("companies")
    .select("id,name")
    .ilike("name", companyName);

  if (checkErr) {
    return showAuthMessage(checkErr.message, true);
  }

  const duplicate = (existingCompanies || []).some(c => (c.name || "").trim().toLowerCase() === companyName.toLowerCase());
  if (duplicate) {
    return showAuthMessage("Esiste già una ditta con questo nome.", true);
  }

  const { error } = await supabase.auth.signUp({
    email, password,
    options: { data: { company_name: companyName, vat_number: vatNumber, phone } }
  });

  if (error) return showAuthMessage(error.message, true);
  showAuthMessage("Account creato. Se la conferma email è disattivata, puoi fare login subito.");
  setAuthTab("login");
  $("loginEmail").value = email;
  saveRememberedEmail();
}
async function logout() {
  await supabase.auth.signOut();
  state.session = null; state.profile = null; state.memberships = []; state.activeCompany = null; selectedCompanyId = null;
  hideAllViews();
  safeEl("authView")?.classList.remove("hidden");
}
async function fetchProfileAndMemberships() {
  const { data: profile, error: pErr } = await supabase.from("profiles").select("*").eq("id", state.session.user.id).single();
  if (pErr) throw pErr;
  state.profile = profile;

  if (profile?.global_role === "supervisor") {
    const { data: companies, error: cErr } = await supabase
      .from("companies")
      .select("id,name,vat_number,status,created_at")
      .order("created_at", { ascending: true });
    if (cErr) throw cErr;
    state.companiesAdmin = companies || [];
    state.memberships = (companies || []).map(c => ({
      id: `supervisor-${c.id}`,
      role: "supervisor",
      company_id: c.id,
      companies: c
    }));
    return;
  }

  const { data: memberships, error: mErr } = await supabase
    .from("company_users")
    .select("id, role, company_id, companies(id, name, vat_number, status, created_at)")
    .order("created_at", { ascending: true });

  if (mErr) throw mErr;
  state.memberships = memberships || [];
}
function renderCompanySelector() {
  hideAllViews();
  safeEl("companySelectorView")?.classList.remove("hidden");
  if (safeEl("companyInfo")) $("companyInfo").textContent = `${state.profile?.email || ""} · ${isSupervisor() ? "supervisor" : "utente"}`;
  const grid = safeEl("companyGrid");
  if (!grid) return;
  grid.innerHTML = state.memberships.map(m => `
    <div class="card company-card ${selectedCompanyId === m.company_id ? "selected" : ""}" data-company-id="${m.company_id}">
      <div class="strong">${m.companies.name}</div>
      <div class="muted small">${m.companies.vat_number || "P.IVA non inserita"}</div>
      <div class="muted small">${m.role}</div>
    </div>`).join("");
  document.querySelectorAll(".company-card").forEach(card => card.addEventListener("click", () => {
    selectedCompanyId = card.dataset.companyId; renderCompanySelector();
  }));
}
async function bootstrapAfterAuth() {
  await fetchProfileAndMemberships();

  if (safeEl("navDitteBtn")) $("navDitteBtn").classList.toggle("hidden", !isSupervisor());

  if (state.memberships.length === 0) {
    hideAllViews();
    safeEl("authView")?.classList.remove("hidden");
    return showAuthMessage("Questo account non è collegato a nessuna ditta.", true);
  }

  if (!isSupervisor() && state.memberships.length === 1) {
    const onlyCompany = state.memberships[0]?.companies;
    const companyStatus = onlyCompany?.status || "active";
    if (companyStatus === "pending") {
      hideAllViews();
      safeEl("authView")?.classList.remove("hidden");
      return showAuthMessage("La tua ditta è in attesa di approvazione.", true);
    }
    if (companyStatus === "blocked") {
      hideAllViews();
      safeEl("authView")?.classList.remove("hidden");
      return showAuthMessage("La tua ditta è stata bloccata.", true);
    }
  }

  if (isSupervisor() || state.memberships.length > 1) {
    selectedCompanyId = selectedCompanyId || state.memberships[0].company_id;
    renderCompanySelector();
  } else {
    selectedCompanyId = state.memberships[0].company_id;
    await openCompany(selectedCompanyId);
  }
}
async function openCompany(companyId) {
  const membership = state.memberships.find(m => m.company_id === companyId);
  if (!membership) return;

  if (!isSupervisor()) {
    const status = membership.companies?.status || "active";
    if (status === "pending") return showGlobalMessage("Questa ditta è in attesa di approvazione.", "error");
    if (status === "blocked") return showGlobalMessage("Questa ditta è bloccata.", "error");
  }

  state.activeCompany = {
    id: companyId,
    name: membership.companies.name,
    role: membership.role,
  };

  if (safeEl("activeCompanyName")) $("activeCompanyName").textContent = membership.companies.name;
  if (safeEl("activeCompanyRole")) $("activeCompanyRole").textContent = `Ruolo: ${membership.role}`;

  hideAllViews();
  safeEl("appView")?.classList.remove("hidden");
  seedFields();
  resetCashMovementForm();
  await refreshData();
  resetDailyForm();
}


async function refreshCompaniesAdmin() {
  if (!isSupervisor()) return;
  const { data, error } = await supabase
    .from("companies")
    .select("id,name,vat_number,status,created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  state.companiesAdmin = data || [];
  state.memberships = state.companiesAdmin.map(c => ({
    id: `supervisor-${c.id}`,
    role: "supervisor",
    company_id: c.id,
    companies: c
  }));
}

async function setCompanyStatus(companyId, status) {
  const patch = { status };
  const { error } = await supabase
    .from("companies")
    .update(patch)
    .eq("id", companyId);

  if (error) return showGlobalMessage(error.message, "error");

  await refreshCompaniesAdmin();
  renderCompanySelector();
  renderCompaniesAdmin();
  showGlobalMessage(`Ditta aggiornata: ${status}`);
}

async function deleteCompanyAdmin(companyId) {
  const company = state.companiesAdmin.find(c => c.id === companyId);
  if (!company) return;

  const msg = `Vuoi davvero eliminare TOTALMENTE la ditta "${company.name}"?

Verranno eliminati anche dati, collegamenti e account Auth collegati se non usati da altre ditte.`;
  if (!confirm(msg)) return;

  const { data, error } = await supabase.functions.invoke("delete-company-total", {
    body: { companyId }
  });

  if (error) return showGlobalMessage(error.message || "Errore eliminazione totale", "error");
  if (data?.error) return showGlobalMessage(data.error, "error");

  if (state.activeCompany?.id === companyId) {
    state.activeCompany = null;
    selectedCompanyId = null;
  }

  await refreshCompaniesAdmin();
  renderCompanySelector();
  renderCompaniesAdmin();
  showGlobalMessage("Ditta eliminata totalmente.");
}

function renderCompaniesAdmin() {
  const table = safeEl("ditteTable");
  if (!table) return;

  if (!isSupervisor()) {
    table.innerHTML = '<tr><td colspan="5">Sezione disponibile solo per supervisor.</td></tr>';
    return;
  }

  const rows = state.companiesAdmin || [];
  table.innerHTML = rows.map(c => {
    const status = c.status || "active";
    const statusLabel = status === "active" ? '<span class="ok">active</span>' : status === "blocked" ? '<span class="bad">blocked</span>' : '<span class="warn">pending</span>';
    return `<tr>
      <td>${c.name}</td>
      <td>${c.vat_number || "—"}</td>
      <td>${statusLabel}</td>
      <td>${c.created_at ? new Date(c.created_at).toLocaleDateString("it-IT") : "—"}</td>
      <td style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn ghost company-approve-btn" data-company-id="${c.id}">Autorizza</button>
        <button class="btn ghost company-pending-btn" data-company-id="${c.id}">Rimetti in attesa</button>
        <button class="btn ghost company-block-btn" data-company-id="${c.id}">Blocca</button>
        <button class="btn ghost company-delete-btn" data-company-id="${c.id}">Elimina totale</button>
      </td>
    </tr>`;
  }).join("");

  document.querySelectorAll(".company-approve-btn").forEach(btn => btn.addEventListener("click", () => setCompanyStatus(btn.dataset.companyId, "active")));
  document.querySelectorAll(".company-pending-btn").forEach(btn => btn.addEventListener("click", () => setCompanyStatus(btn.dataset.companyId, "pending")));
  document.querySelectorAll(".company-block-btn").forEach(btn => btn.addEventListener("click", () => setCompanyStatus(btn.dataset.companyId, "blocked")));
  document.querySelectorAll(".company-delete-btn").forEach(btn => btn.addEventListener("click", () => deleteCompanyAdmin(btn.dataset.companyId)));
}

async function fetchCompanyTable(table, orderColumn="created_at", ascending=true) {
  const { data, error } = await supabase.from(table).select("*").eq("company_id", state.activeCompany.id).order(orderColumn, { ascending });
  if (error) throw error;
  return data || [];
}
async function loadCompanyData() {
  const [daily_records, cash_state, cash_movements, custom_cash_state, suppliers, supplier_movements, employees, employee_movements, bookings] = await Promise.all([
    fetchCompanyTable("daily_records", "data", true),
    fetchCompanyTable("cash_state", "kind", true),
    fetchCompanyTable("cash_movements", "data", true),
    fetchCompanyTable("custom_cash_state", "name", true).catch(()=>[]),
    fetchCompanyTable("suppliers", "nome", true),
    fetchCompanyTable("supplier_movements", "data", true),
    fetchCompanyTable("employees", "nome", true),
    fetchCompanyTable("employee_movements", "data", true),
    fetchCompanyTable("bookings", "data", true),
  ]);
  state.dailyRecords = daily_records.map(r => ({ ...(r.payload || {}), saved_at: r.saved_at || r.created_at || r.payload?.saved_at || null }));
  state.cashMovements = cash_movements;
  state.customCashes = custom_cash_state || [];
  state.suppliers = suppliers;
  state.supplierMovements = supplier_movements;
  state.employees = employees;
  state.employeeMovements = employee_movements;
  state.bookings = bookings;
  state.cashInitial = { contanti:0, pos:0 };
  state.cashInitialDate = { contanti:"", pos:"" };
  cash_state.forEach(r => {
    state.cashInitial[r.kind] = n(r.amount);
    if (r.reference_date) state.cashInitialDate[r.kind] = String(r.reference_date).slice(0, 10);
  });
}
async function refreshData(message=null) {
  try {
    if (isSupervisor()) await refreshCompaniesAdmin();
    await loadCompanyData();
    renderAll();
    runCloudUiSyncCheck(true);
    if (message) showGlobalMessage(message);
  } catch (err) {
    console.error(err);
    showGlobalMessage(err.message || "Errore caricamento dati", "error");
  }
}

async function upsertCashState(kind, amount, referenceDate = "") {
  const payload = { company_id: state.activeCompany.id, kind, amount, reference_date: referenceDate || null };
  const { error } = await supabase.from("cash_state").upsert(payload, { onConflict: "company_id,kind" });
  if (error) throw error;
}
async function saveCashInitial() {
  try {
    await Promise.all([
      upsertCashState("contanti", n(safeEl("cashInitContanti")?.value), safeEl("cashInitContantiDate")?.value || ""),
      upsertCashState("pos", n(safeEl("cashInitPos")?.value), safeEl("cashInitPosDate")?.value || ""),
    ]);
    await refreshData("Saldi iniziali con data salvati.");
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (msg.includes("reference_date")) {
      showGlobalMessage("Manca la colonna reference_date su Supabase: lancia una sola volta il file setup_cash_state_reference_date.sql e poi riprova.", "error");
    } else {
      showGlobalMessage(msg, "error");
    }
  }
}
async function saveNewCash() {
  const name = safeEl("newCashName")?.value?.trim();
  const amount = n(safeEl("newCashAmount")?.value);
  if (!name) return showGlobalMessage("Inserisci il nome della cassa.", "error");
  const { error } = await supabase.from("custom_cash_state").upsert({ company_id: state.activeCompany.id, name, amount }, { onConflict: "company_id,name" });
  if (error) return showGlobalMessage(error.message, "error");
  $("newCashName").value = ""; $("newCashAmount").value = "";
  await refreshData("Cassa personalizzata salvata.");
}
async function deleteCustomCash(name) {
  if (!confirm(`Vuoi davvero cancellare la cassa ${name}?`)) return;
  const { error } = await supabase.from("custom_cash_state").delete().eq("company_id", state.activeCompany.id).eq("name", name);
  if (error) return showGlobalMessage(error.message, "error");
  await refreshData("Cassa personalizzata cancellata.");
}

function startCashMovementEdit(movement) {
  editingCashMovementId = movement.id;
  if (safeEl("movData")) $("movData").value = movement.data || "";
  if (safeEl("movCassa")) $("movCassa").value = movement.cassa || "contanti";
  if (safeEl("movTipo")) $("movTipo").value = movement.tipo || "entrata";
  if (safeEl("movImporto")) $("movImporto").value = movement.importo ?? 0;
  if (safeEl("movOperatedAt")) $("movOperatedAt").value = movement.operated_at ? String(movement.operated_at).slice(0,16) : "";
  if (safeEl("movDescrizione")) $("movDescrizione").value = movement.descrizione || "";
  if (safeEl("saveMovBtn")) $("saveMovBtn").textContent = "Aggiorna movimento";
  navigate("casse");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function resetCashMovementForm() {
  editingCashMovementId = null;
  if (safeEl("movData")) $("movData").value = todayStr();
  if (safeEl("movCassa")) $("movCassa").value = "contanti";
  if (safeEl("movTipo")) $("movTipo").value = "entrata";
  if (safeEl("movImporto")) $("movImporto").value = "";
  if (safeEl("movOperatedAt")) $("movOperatedAt").value = "";
  if (safeEl("movDescrizione")) $("movDescrizione").value = "";
  if (safeEl("saveMovBtn")) $("saveMovBtn").textContent = "Aggiungi movimento";
}
async function deleteCashMovementById(id) {
  const movement = state.cashMovements.find(m => m.id === id);
  if (!movement) return;
  if (!confirm(`Vuoi davvero eliminare questo movimento di cassa del ${movement.data}?`)) return;
  const { error } = await supabase
    .from("cash_movements")
    .delete()
    .eq("company_id", state.activeCompany.id)
    .eq("id", id);
  if (error) return showGlobalMessage(error.message, "error");
  resetCashMovementForm();
  await refreshData("Movimento di cassa eliminato.");
}

async function saveCashMovement() {
  const payload = {
    company_id: state.activeCompany.id,
    data: safeEl("movData")?.value || dateFromDateTimeOrDate(safeEl("movOperatedAt")?.value, todayStr()),
    cassa: $("movCassa").value,
    tipo: $("movTipo").value,
    importo: n($("movImporto").value),
    operated_at: cleanDateTimeLocal(safeEl("movOperatedAt")?.value),
    saved_at: new Date().toISOString(),
    descrizione: $("movDescrizione").value.trim(),
  };
  if (!payload.data || !payload.descrizione || payload.importo <= 0) return showGlobalMessage("Compila data, descrizione e importo.", "error");

  const result = editingCashMovementId
    ? await supabase.from("cash_movements").update(payload).eq("company_id", state.activeCompany.id).eq("id", editingCashMovementId)
    : await supabase.from("cash_movements").insert(payload);

  if (result.error) return showGlobalMessage(result.error.message, "error");
  const wasEditing = !!editingCashMovementId;
  resetCashMovementForm();
  await refreshData(wasEditing ? "Movimento di cassa aggiornato." : "Movimento di cassa salvato.");
}
async function createCashOutMovement(data, cassa, importo, descrizione, operatedAt = null) {
  const payload = {
    company_id: state.activeCompany.id,
    data,
    cassa: cassa || "contanti",
    tipo: "uscita",
    importo: n(importo),
    operated_at: cleanDateTimeLocal(operatedAt),
    saved_at: new Date().toISOString(),
    descrizione,
  };
  if (!payload.data || payload.importo <= 0) return;
  const { error } = await supabase.from("cash_movements").insert(payload);
  if (error) throw error;
}
async function insertSupplierMovement({ supplierId, data, tipo, importo, nota, cassa, operated_at }) {
  const supplier = state.suppliers.find(s => s.id === supplierId);
  const cleanNota = [nota?.trim() || "", isSupplierPaymentType(tipo) ? `cassa: ${cassa || "contanti"}` : ""].filter(Boolean).join(" · ");
  const payload = {
    company_id: state.activeCompany.id,
    supplier_id: supplierId,
    data,
    tipo,
    importo: n(importo),
    operated_at: cleanDateTimeLocal(operated_at),
    saved_at: new Date().toISOString(),
    nota: cleanNota,
  };
  const { error } = await supabase.from("supplier_movements").insert(payload);
  if (error) throw error;
  if (isSupplierPaymentType(tipo)) {
    await createCashOutMovement(data, cassa, importo, `Pagamento fornitore ${supplier?.nome || ""} · ${typeLabel(tipo)}${nota ? " · " + nota : ""}`, operated_at);
  }
}
async function insertEmployeeMovement({ employeeId, data, tipo, importo, nota, cassa, operated_at }) {
  const employee = state.employees.find(e => e.id === employeeId);
  const cleanNota = [nota?.trim() || "", `cassa: ${cassa || "contanti"}`].filter(Boolean).join(" · ");
  const payload = {
    company_id: state.activeCompany.id,
    employee_id: employeeId,
    data,
    tipo,
    importo: n(importo),
    operated_at: cleanDateTimeLocal(operated_at),
    saved_at: new Date().toISOString(),
    nota: cleanNota,
  };
  const { error } = await supabase.from("employee_movements").insert(payload);
  if (error) throw error;
  await createCashOutMovement(data, cassa, importo, `${typeLabel(tipo)} dipendente ${employee?.nome || ""}${nota ? " · " + nota : ""}`, operated_at);
}

async function clearAutoLinkedMovementsForDate(dateStr) {
  const prefix = dailyAutoPrefix(dateStr);
  const cash = await supabase.from("cash_movements").delete().eq("company_id", state.activeCompany.id).like("descrizione", `${prefix}%`);
  if (cash.error) throw cash.error;
  const suppliers = await supabase.from("supplier_movements").delete().eq("company_id", state.activeCompany.id).like("nota", `${prefix}%`);
  if (suppliers.error) throw suppliers.error;
  const employees = await supabase.from("employee_movements").delete().eq("company_id", state.activeCompany.id).like("nota", `${prefix}%`);
  if (employees.error) throw employees.error;
}
async function getOrCreateSupplierFromDaily(row) {
  const searched = findSupplierByNameOrAlias(row.supplier_search);
  if (searched) return searched;
  if (row.supplier_id) return state.suppliers.find(s => s.id === row.supplier_id) || null;
  const name = String(row.new_supplier_name || row.supplier_search || "").trim();
  if (!name) return null;
  const existing = state.suppliers.find(s => normalizeSearchText(s.nome) === normalizeSearchText(name));
  if (existing) return existing;
  const { data, error } = await supabase.from("suppliers").insert({
    company_id: state.activeCompany.id,
    nome: name,
    aliases: [],
    sospeso_iniziale: 0,
  }).select("*").single();
  if (error) throw error;
  state.suppliers.push(data);
  return data;
}
async function getOrCreateEmployeeFromDaily(row) {
  if (row.employee_id) return state.employees.find(e => e.id === row.employee_id) || null;
  const name = String(row.new_employee_name || row.employee_search || "").trim();
  if (!name) return null;
  const existing = state.employees.find(e => String(e.nome || "").toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const { data, error } = await supabase.from("employees").insert({
    company_id: state.activeCompany.id,
    nome: name,
    ruolo: "",
    dovuto_mensile: 0,
  }).select("*").single();
  if (error) throw error;
  state.employees.push(data);
  return data;
}
async function syncDailyLinkedMovements(rec) {
  const prefix = dailyAutoPrefix(rec.data);
  await clearAutoLinkedMovementsForDate(rec.data);

  const supplierRows = [];
  const supplierRowsToInsert = [];
  for (const p of (rec.supplierPayments || []).filter(p => (p.supplier_id || p.new_supplier_name || p.supplier_search) && n(p.importo) > 0)) {
    if (p.source_id) {
      const supplier = state.suppliers.find(s => s.id === p.supplier_id) || findSupplierByNameOrAlias(p.supplier_search);
      if (supplier) supplierRows.push({ ...p, supplier_id: supplier.id, supplier_name: supplier.nome });
      continue;
    }
    const supplier = await getOrCreateSupplierFromDaily(p);
    if (supplier) {
      const row = { ...p, supplier_id: supplier.id, supplier_name: supplier.nome };
      supplierRows.push(row);
      supplierRowsToInsert.push(row);
    }
  }

  const employeeRows = [];
  const employeeRowsToInsert = [];
  for (const p of (rec.employeePayments || []).filter(p => (p.employee_id || p.new_employee_name || p.employee_search) && n(p.importo) > 0)) {
    if (p.source_id) {
      const employee = state.employees.find(e => e.id === p.employee_id);
      if (employee) employeeRows.push({ ...p, employee_id: employee.id, employee_name: employee.nome });
      continue;
    }
    const employee = await getOrCreateEmployeeFromDaily(p);
    if (employee) {
      const row = { ...p, employee_id: employee.id, employee_name: employee.nome };
      employeeRows.push(row);
      employeeRowsToInsert.push(row);
    }
  }

  rec.supplierPayments = supplierRows;
  rec.employeePayments = employeeRows;

  if (supplierRowsToInsert.length) {
    const supplierMovements = supplierRowsToInsert.map(p => ({
      company_id: state.activeCompany.id,
      supplier_id: p.supplier_id,
      data: rec.data,
      tipo: "pagamento",
      importo: n(p.importo),
      operated_at: cleanDateTimeLocal(p.operated_at),
      saved_at: new Date().toISOString(),
      nota: `${prefix} ${p.cassa || "contanti"}${p.nota ? " · " + p.nota : ""}`,
    }));
    const { error } = await supabase.from("supplier_movements").insert(supplierMovements);
    if (error) throw error;

    const cashMovements = supplierRowsToInsert.map(p => ({
      company_id: state.activeCompany.id,
      data: rec.data,
      cassa: p.cassa || "contanti",
      tipo: "uscita",
      importo: n(p.importo),
      operated_at: cleanDateTimeLocal(p.operated_at),
      saved_at: new Date().toISOString(),
      descrizione: `${prefix} Pagamento fornitore ${p.supplier_name || ""}${p.nota ? " · " + p.nota : ""}`,
    }));
    const cashResult = await supabase.from("cash_movements").insert(cashMovements);
    if (cashResult.error) throw cashResult.error;
  }

  if (employeeRowsToInsert.length) {
    const employeeMovements = employeeRowsToInsert.map(p => ({
      company_id: state.activeCompany.id,
      employee_id: p.employee_id,
      data: rec.data,
      tipo: p.tipo || "acconto",
      importo: n(p.importo),
      operated_at: cleanDateTimeLocal(p.operated_at),
      saved_at: new Date().toISOString(),
      nota: `${prefix} ${p.cassa || "contanti"}${p.nota ? " · " + p.nota : ""}`,
    }));
    const { error } = await supabase.from("employee_movements").insert(employeeMovements);
    if (error) throw error;

    const cashMovements = employeeRowsToInsert.map(p => ({
      company_id: state.activeCompany.id,
      data: rec.data,
      cassa: p.cassa || "contanti",
      tipo: "uscita",
      importo: n(p.importo),
      operated_at: cleanDateTimeLocal(p.operated_at),
      saved_at: new Date().toISOString(),
      descrizione: `${prefix} ${p.tipo || "acconto"} dipendente ${p.employee_name || ""}${p.nota ? " · " + p.nota : ""}`,
    }));
    const cashResult = await supabase.from("cash_movements").insert(cashMovements);
    if (cashResult.error) throw cashResult.error;
  }
}
async function persistDailyRecord(rec) {
  try {
    const savedAt = new Date().toISOString();
    rec.saved_at = savedAt;
    const first = await supabase.from("daily_records").upsert({ company_id: state.activeCompany.id, data: rec.data, payload: rec, saved_at: savedAt }, { onConflict: "company_id,data" });
    if (first.error) throw first.error;
    await syncDailyLinkedMovements(rec);
    // Risalva la scheda dopo aver creato eventuali nuovi fornitori/dipendenti dalla scheda giornaliera.
    const second = await supabase.from("daily_records").upsert({ company_id: state.activeCompany.id, data: rec.data, payload: rec, saved_at: savedAt }, { onConflict: "company_id,data" });
    if (second.error) throw second.error;
    return true;
  } catch (err) {
    showGlobalMessage(err.message || String(err), "error");
    return false;
  }
}
function openConfirmSaveModal(rec, alerts) {
  pendingDailyRecord = rec;
  if (safeEl("confirmSaveDate")) $("confirmSaveDate").textContent = `Giornata: ${rec.data}`;
  if (safeEl("confirmSaveAlerts")) $("confirmSaveAlerts").innerHTML = alerts.map(a => `<div class="item"><div><strong>Alert</strong><small>${a}</small></div></div>`).join("");
  safeEl("confirmSaveModal")?.classList.remove("hidden");
}
function closeConfirmSaveModal() { safeEl("confirmSaveModal")?.classList.add("hidden"); }
async function forceSavePendingDay() {
  if (!pendingDailyRecord) return;
  const ok = await persistDailyRecord(pendingDailyRecord);
  if (!ok) return;
  if (safeEl("giornalieraFeedback")) $("giornalieraFeedback").innerHTML = `<div class="alert">Scheda salvata con alert confermati.</div>`;
  closeConfirmSaveModal();
  pendingDailyRecord = null;
  resetDailyForm();
  await refreshData("Scheda giornaliera salvata.");
}
async function saveDaily() {
  const rec = collectDailyFromForm();
  if (!rec.data) return showGlobalMessage("Inserisci la data.", "error");
  const alerts = validateDaily(rec);
  if (alerts.length) return openConfirmSaveModal(rec, alerts);
  const ok = await persistDailyRecord(rec);
  if (!ok) return;
  resetDailyForm();
  await refreshData("Scheda giornaliera salvata.");
}
async function deleteDailyByDate(dateStr) {
  if (!confirm(`Vuoi cancellare la scheda ${dateStr}? Verranno rimossi solo la scheda e i movimenti automatici creati da quella scheda.`)) return;
  try {
    await clearAutoLinkedMovementsForDate(dateStr);
    const { error } = await supabase.from("daily_records").delete().eq("company_id", state.activeCompany.id).eq("data", dateStr);
    if (error) throw error;
    await refreshData("Scheda giornaliera cancellata con i movimenti automatici collegati.");
  } catch (err) {
    showGlobalMessage(err.message || String(err), "error");
  }
}
async function deleteWholeDayByDate(dateStr) {
  const msg = `ATTENZIONE: vuoi eliminare TUTTO il giorno ${dateStr}?

Verranno cancellati da Supabase:
- scheda giornaliera
- movimenti cassa della data
- movimenti fornitori della data
- movimenti dipendenti della data

Non verranno cancellati fornitori e dipendenti come anagrafica.

Usalo solo se vuoi reinserire quella giornata da zero.`;
  if (!confirm(msg)) return;
  if (!confirm(`Ultima conferma: eliminare davvero tutto il ${dateStr}?`)) return;
  try {
    const tables = ["cash_movements", "supplier_movements", "employee_movements", "daily_records"];
    for (const table of tables) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq("company_id", state.activeCompany.id)
        .eq("data", dateStr);
      if (error) throw error;
    }
    resetDailyForm();
    await refreshData(`Giornata ${dateStr} eliminata completamente. Ora puoi reinserirla da zero.`);
  } catch (err) {
    showGlobalMessage(err.message || String(err), "error");
  }
}
function loadDailyByDate(dateStr) {
  const rec = state.dailyRecords.find(r => r.data === dateStr);
  if (!rec) return;
  fillDailyForm(rec);
  navigate("giornaliera");
  if (safeEl("giornalieraFeedback")) $("giornalieraFeedback").textContent = `Stai modificando la giornata ${rec.data}`;
  window.scrollTo({ top:0, behavior:"smooth" });
}


function movementMatchesDailySupplierRow(row, movement) {
  const cash = extractCashFromNote(movement.nota, row.cassa || "contanti");
  const note = cleanMovementNoteForForm(movement.nota);
  return String(row.supplier_id || "") === String(movement.supplier_id || "")
    && roughlySameMoney(row.importo, movement.importo)
    && String(row.operated_at || "") === String(cleanDateTimeLocal(movement.operated_at) || "")
    && normalizeSearchText(row.cassa || "contanti") === normalizeSearchText(cash || "contanti")
    && normalizeSearchText(row.nota || "") === normalizeSearchText(note || "");
}
function movementMatchesDailyEmployeeRow(row, movement) {
  const cash = extractCashFromNote(movement.nota, row.cassa || "contanti");
  const note = cleanMovementNoteForForm(movement.nota);
  return String(row.employee_id || "") === String(movement.employee_id || "")
    && roughlySameMoney(row.importo, movement.importo)
    && String(row.operated_at || "") === String(cleanDateTimeLocal(movement.operated_at) || "")
    && normalizeSearchText(row.cassa || "contanti") === normalizeSearchText(cash || "contanti")
    && normalizeSearchText(row.nota || "") === normalizeSearchText(note || "")
    && String(row.tipo || "acconto") === String(movement.tipo || "acconto");
}
function removeFirstMatchingDailyRow(list, matcher) {
  let removed = false;
  return (list || []).filter(row => {
    if (!removed && matcher(row)) { removed = true; return false; }
    return true;
  });
}
function emptyDailyRecordForDate(dateStr) {
  return {
    data: dateStr,
    note: "",
    pranzo: emptyService(),
    cena: emptyService(),
    banchetti: emptyService({ nome:"Banchetti" }),
    banchettiList: [emptyService({ nome:"Banchetto 1" })],
    casse: { contanti:0, pos:0 },
    supplierPayments: [],
    employeePayments: []
  };
}
function getDailyRecordForUpdate(dateStr) {
  return JSON.parse(JSON.stringify(state.dailyRecords.find(r => r.data === dateStr) || emptyDailyRecordForDate(dateStr)));
}
async function upsertDailyRecordPayload(rec) {
  const savedAt = rec.saved_at || new Date().toISOString();
  rec.saved_at = savedAt;
  const { error } = await supabase.from("daily_records").upsert({
    company_id: state.activeCompany.id,
    data: rec.data,
    payload: rec,
    saved_at: savedAt
  }, { onConflict: "company_id,data" });
  if (error) throw error;
}
async function syncDailyPayloadAfterMovementEdit(kind, oldMovement, newPayload, { keepInDaily }) {
  if (!isDailyAutoMovement(oldMovement)) return;
  const oldRec = getDailyRecordForUpdate(oldMovement.data);
  if (kind === "supplier") {
    oldRec.supplierPayments = removeFirstMatchingDailyRow(oldRec.supplierPayments || [], row => movementMatchesDailySupplierRow(row, oldMovement));
  } else {
    oldRec.employeePayments = removeFirstMatchingDailyRow(oldRec.employeePayments || [], row => movementMatchesDailyEmployeeRow(row, oldMovement));
  }
  await upsertDailyRecordPayload(oldRec);

  if (!keepInDaily) return;
  const newRec = oldMovement.data === newPayload.data ? oldRec : getDailyRecordForUpdate(newPayload.data);
  if (kind === "supplier") {
    const supplier = state.suppliers.find(s => s.id === newPayload.supplier_id);
    newRec.supplierPayments = (newRec.supplierPayments || []).concat({
      supplier_id: newPayload.supplier_id,
      supplier_search: supplier?.nome || "",
      new_supplier_name: "",
      cassa: newPayload.cassa || "contanti",
      importo: n(newPayload.importo),
      operated_at: cleanDateTimeLocal(newPayload.operated_at),
      nota: newPayload.nota || ""
    });
  } else {
    newRec.employeePayments = (newRec.employeePayments || []).concat({
      employee_id: newPayload.employee_id,
      employee_search: (state.employees || []).find(e => e.id === newPayload.employee_id)?.nome || "",
      new_employee_name: "",
      tipo: newPayload.tipo || "acconto",
      cassa: newPayload.cassa || "contanti",
      importo: n(newPayload.importo),
      operated_at: cleanDateTimeLocal(newPayload.operated_at),
      nota: newPayload.nota || ""
    });
  }
  await upsertDailyRecordPayload(newRec);
}
async function deleteMatchingCashOutMovement(oldMovement, kind) {
  const oldCash = extractCashFromNote(oldMovement.nota, "contanti");
  let q = supabase.from("cash_movements")
    .delete()
    .eq("company_id", state.activeCompany.id)
    .eq("data", oldMovement.data)
    .eq("tipo", "uscita")
    .eq("cassa", oldCash)
    .eq("importo", n(oldMovement.importo));
  if (isDailyAutoMovement(oldMovement)) {
    q = q.like("descrizione", `${dailyAutoPrefix(oldMovement.data)}%`);
  } else if (kind === "supplier") {
    const supplier = state.suppliers.find(s => s.id === oldMovement.supplier_id);
    if (supplier?.nome) q = q.ilike("descrizione", `%fornitore ${supplier.nome}%`);
  } else {
    const employee = state.employees.find(e => e.id === oldMovement.employee_id);
    if (employee?.nome) q = q.ilike("descrizione", `%dipendente ${employee.nome}%`);
  }
  const { error } = await q;
  if (error) throw error;
}
function buildSupplierMovementNoteForSave({ oldMovement, data, tipo, cassa, nota }) {
  const cleanNota = String(nota || "").trim();
  if (isDailyAutoMovement(oldMovement) && isSupplierPaymentType(tipo)) {
    return `${dailyAutoPrefix(data)} ${cassa || "contanti"}${cleanNota ? " · " + cleanNota : ""}`;
  }
  return [cleanNota, isSupplierPaymentType(tipo) ? `cassa: ${cassa || "contanti"}` : ""].filter(Boolean).join(" · ");
}
function buildEmployeeMovementNoteForSave({ oldMovement, data, cassa, nota }) {
  const cleanNota = String(nota || "").trim();
  if (isDailyAutoMovement(oldMovement)) {
    return `${dailyAutoPrefix(data)} ${cassa || "contanti"}${cleanNota ? " · " + cleanNota : ""}`;
  }
  return [cleanNota, `cassa: ${cassa || "contanti"}`].filter(Boolean).join(" · ");
}
async function updateSupplierMovementFromDetail() {
  const old = state.supplierMovements.find(m => m.id === editingSupplierMovementId);
  if (!old) return showGlobalMessage("Movimento fornitore non trovato.", "error");
  const data = safeEl("supplierDetailData")?.value || dateFromDateTimeOrDate(safeEl("supplierDetailOperatedAt")?.value, todayStr());
  const tipo = safeEl("supplierDetailTipo")?.value || "pagamento";
  const cassa = safeEl("supplierDetailCassa")?.value || "contanti";
  const importo = n(safeEl("supplierDetailImporto")?.value);
  const operated_at = cleanDateTimeLocal(safeEl("supplierDetailOperatedAt")?.value);
  const notaPulita = safeEl("supplierDetailNota")?.value?.trim() || "";
  if (!data || importo <= 0) return showGlobalMessage("Controlla data e importo.", "error");

  const keepInDaily = isSupplierPaymentType(tipo);
  const nota = buildSupplierMovementNoteForSave({ oldMovement: old, data, tipo, cassa, nota: notaPulita });
  const payload = { data, tipo, importo, operated_at, saved_at: new Date().toISOString(), nota };
  const { error } = await supabase.from("supplier_movements").update(payload).eq("company_id", state.activeCompany.id).eq("id", old.id);
  if (error) throw error;

  if (isSupplierPaymentType(old.tipo)) await deleteMatchingCashOutMovement(old, "supplier");
  if (isSupplierPaymentType(tipo)) {
    const supplier = state.suppliers.find(s => s.id === old.supplier_id);
    const desc = isDailyAutoMovement(old)
      ? `${dailyAutoPrefix(data)} Pagamento fornitore ${supplier?.nome || ""}${notaPulita ? " · " + notaPulita : ""}`
      : `Pagamento fornitore ${supplier?.nome || ""} · ${typeLabel(tipo)}${notaPulita ? " · " + notaPulita : ""}`;
    await createCashOutMovement(data, cassa, importo, desc, operated_at);
  }
  await syncDailyPayloadAfterMovementEdit("supplier", old, { ...payload, supplier_id: old.supplier_id, cassa, nota: notaPulita }, { keepInDaily });
  editingSupplierMovementId = null;
  await refreshData("Movimento fornitore modificato.");
  resetSupplierDetailMovementForm(false);
}
async function updateEmployeeMovementFromDetail() {
  const old = state.employeeMovements.find(m => m.id === editingEmployeeMovementId);
  if (!old) return showGlobalMessage("Movimento dipendente non trovato.", "error");
  const data = safeEl("employeeDetailData")?.value || dateFromDateTimeOrDate(safeEl("employeeDetailOperatedAt")?.value, todayStr());
  const tipo = safeEl("employeeDetailTipo")?.value || "acconto";
  const cassa = safeEl("employeeDetailCassa")?.value || "contanti";
  const importo = n(safeEl("employeeDetailImporto")?.value);
  const operated_at = cleanDateTimeLocal(safeEl("employeeDetailOperatedAt")?.value);
  const notaPulita = safeEl("employeeDetailNota")?.value?.trim() || "";
  if (!data || importo <= 0) return showGlobalMessage("Controlla data e importo.", "error");

  const nota = buildEmployeeMovementNoteForSave({ oldMovement: old, data, cassa, nota: notaPulita });
  const payload = { data, tipo, importo, operated_at, saved_at: new Date().toISOString(), nota };
  const { error } = await supabase.from("employee_movements").update(payload).eq("company_id", state.activeCompany.id).eq("id", old.id);
  if (error) throw error;

  await deleteMatchingCashOutMovement(old, "employee");
  const employee = state.employees.find(e => e.id === old.employee_id);
  const desc = isDailyAutoMovement(old)
    ? `${dailyAutoPrefix(data)} ${tipo || "acconto"} dipendente ${employee?.nome || ""}${notaPulita ? " · " + notaPulita : ""}`
    : `${typeLabel(tipo)} dipendente ${employee?.nome || ""}${notaPulita ? " · " + notaPulita : ""}`;
  await createCashOutMovement(data, cassa, importo, desc, operated_at);
  await syncDailyPayloadAfterMovementEdit("employee", old, { ...payload, employee_id: old.employee_id, cassa, nota: notaPulita }, { keepInDaily: true });
  editingEmployeeMovementId = null;
  await refreshData("Movimento dipendente modificato.");
  resetEmployeeDetailMovementForm(false);
}
function resetSupplierDetailMovementForm(clearEditing = true) {
  if (clearEditing) editingSupplierMovementId = null;
  if (safeEl("supplierDetailData")) $("supplierDetailData").value = todayStr();
  if (safeEl("supplierDetailOperatedAt")) $("supplierDetailOperatedAt").value = "";
  if (safeEl("supplierDetailTipo")) $("supplierDetailTipo").value = "pagamento";
  if (safeEl("supplierDetailImporto")) $("supplierDetailImporto").value = "";
  if (safeEl("supplierDetailNota")) $("supplierDetailNota").value = "";
  if (safeEl("saveSupplierDetailMovBtn")) $("saveSupplierDetailMovBtn").textContent = "Aggiungi movimento";
  safeEl("cancelSupplierDetailEditBtn")?.classList.add("hidden");
  fillCashSelect("supplierDetailCassa", "contanti");
}
function resetEmployeeDetailMovementForm(clearEditing = true) {
  if (clearEditing) editingEmployeeMovementId = null;
  if (safeEl("employeeDetailData")) $("employeeDetailData").value = todayStr();
  if (safeEl("employeeDetailOperatedAt")) $("employeeDetailOperatedAt").value = "";
  if (safeEl("employeeDetailTipo")) $("employeeDetailTipo").value = "acconto";
  if (safeEl("employeeDetailImporto")) $("employeeDetailImporto").value = "";
  if (safeEl("employeeDetailNota")) $("employeeDetailNota").value = "";
  if (safeEl("saveEmployeeDetailMovBtn")) $("saveEmployeeDetailMovBtn").textContent = "Aggiungi movimento";
  safeEl("cancelEmployeeDetailEditBtn")?.classList.add("hidden");
  fillCashSelect("employeeDetailCassa", "contanti");
}
function startSupplierMovementEdit(id) {
  const m = state.supplierMovements.find(x => x.id === id);
  if (!m) return;
  selectedSupplierDetailId = m.supplier_id;
  editingSupplierMovementId = id;
  if (safeEl("supplierDetailData")) $("supplierDetailData").value = m.data || todayStr();
  if (safeEl("supplierDetailOperatedAt")) $("supplierDetailOperatedAt").value = toDateTimeLocalInput(m.operated_at || "");
  if (safeEl("supplierDetailTipo")) $("supplierDetailTipo").value = m.tipo || "pagamento";
  if (safeEl("supplierDetailImporto")) $("supplierDetailImporto").value = n(m.importo);
  if (safeEl("supplierDetailNota")) $("supplierDetailNota").value = cleanMovementNoteForForm(m.nota);
  fillCashSelect("supplierDetailCassa", extractCashFromNote(m.nota, "contanti"));
  if (safeEl("saveSupplierDetailMovBtn")) $("saveSupplierDetailMovBtn").textContent = "Salva modifica";
  safeEl("cancelSupplierDetailEditBtn")?.classList.remove("hidden");
  safeEl("supplierDetailCard")?.scrollIntoView({ behavior:"smooth", block:"start" });
}
function startEmployeeMovementEdit(id) {
  const m = state.employeeMovements.find(x => x.id === id);
  if (!m) return;
  selectedEmployeeDetailId = m.employee_id;
  editingEmployeeMovementId = id;
  if (safeEl("employeeDetailData")) $("employeeDetailData").value = m.data || todayStr();
  if (safeEl("employeeDetailOperatedAt")) $("employeeDetailOperatedAt").value = toDateTimeLocalInput(m.operated_at || "");
  if (safeEl("employeeDetailTipo")) $("employeeDetailTipo").value = m.tipo || "acconto";
  if (safeEl("employeeDetailImporto")) $("employeeDetailImporto").value = n(m.importo);
  if (safeEl("employeeDetailNota")) $("employeeDetailNota").value = cleanMovementNoteForForm(m.nota);
  fillCashSelect("employeeDetailCassa", extractCashFromNote(m.nota, "contanti"));
  if (safeEl("saveEmployeeDetailMovBtn")) $("saveEmployeeDetailMovBtn").textContent = "Salva modifica";
  safeEl("cancelEmployeeDetailEditBtn")?.classList.remove("hidden");
  safeEl("employeeDetailCard")?.scrollIntoView({ behavior:"smooth", block:"start" });
}
function startSupplierEdit(supplier) {
  editingSupplierId = supplier.id;
  $("fornNome").value = supplier.nome || "";
  $("fornAlias").value = (supplier.aliases || []).join(", ");
  $("fornSospeso").value = supplier.sospeso_iniziale ?? 0;
  $("saveFornBtn").textContent = "Aggiorna fornitore";
  safeEl("cancelFornEditBtn")?.classList.remove("hidden");
  if (safeEl("fornFormHint")) $("fornFormHint").textContent = `Stai modificando: ${supplier.nome}`;
  navigate("fornitori");
  window.scrollTo({ top:0, behavior:"smooth" });
}
function resetSupplierForm() {
  editingSupplierId = null;
  $("fornNome").value = ""; $("fornAlias").value = ""; $("fornSospeso").value = "";
  $("saveFornBtn").textContent = "Salva fornitore";
  safeEl("cancelFornEditBtn")?.classList.add("hidden");
  if (safeEl("fornFormHint")) $("fornFormHint").textContent = "Inserisci o modifica un fornitore.";
}
async function saveSupplier() {
  const payload = {
    company_id: state.activeCompany.id,
    nome: $("fornNome").value.trim(),
    aliases: $("fornAlias").value.trim() ? $("fornAlias").value.trim().split(",").map(v=>v.trim()).filter(Boolean) : [],
    sospeso_iniziale: n($("fornSospeso").value),
  };
  if (!payload.nome) return showGlobalMessage("Inserisci il nome del fornitore.", "error");
  const result = editingSupplierId
    ? await supabase.from("suppliers").update(payload).eq("id", editingSupplierId).eq("company_id", state.activeCompany.id)
    : await supabase.from("suppliers").insert(payload);
  if (result.error) return showGlobalMessage(result.error.message, "error");
  const wasEditing = !!editingSupplierId;
  resetSupplierForm();
  await refreshData(wasEditing ? "Fornitore aggiornato." : "Fornitore salvato.");
}
async function removeSupplierFromDailyPayloads(supplierId) {
  const affected = (state.dailyRecords || []).filter(r => (r.supplierPayments || []).some(p => p.supplier_id === supplierId));
  for (const rec of affected) {
    const copy = JSON.parse(JSON.stringify(rec));
    copy.supplierPayments = (copy.supplierPayments || []).filter(p => p.supplier_id !== supplierId);
    await upsertDailyRecordPayload(copy);
  }
}
async function deleteSupplierByName(name) {
  const s = state.suppliers.find(x => x.nome === name);
  if (!s) return;
  if (!confirm(`Vuoi davvero eliminare il fornitore "${name}"? Verranno eliminati anche i suoi movimenti e le uscite cassa collegate.`)) return;
  try {
    const moves = (state.supplierMovements || []).filter(m => m.supplier_id === s.id);
    for (const m of moves.filter(m => isSupplierPaymentType(m.tipo))) {
      await deleteMatchingCashOutMovement(m, "supplier");
    }
    await removeSupplierFromDailyPayloads(s.id);
    const delMoves = await supabase.from("supplier_movements").delete().eq("company_id", state.activeCompany.id).eq("supplier_id", s.id);
    if (delMoves.error) throw delMoves.error;
    const delSupp = await supabase.from("suppliers").delete().eq("company_id", state.activeCompany.id).eq("id", s.id);
    if (delSupp.error) throw delSupp.error;
    resetSupplierForm();
    await refreshData("Fornitore eliminato con movimenti e uscite cassa collegate.");
  } catch (err) {
    showGlobalMessage(err.message || String(err), "error");
  }
}
async function saveSupplierMovement() {
  const supplierSearch = safeEl("fornMovSearch")?.value || safeEl("fornMovNome")?.value || "";
  const supplier = findSupplierByNameOrAlias(supplierSearch);
  const payload = {
    supplierId: supplier?.id,
    data: safeEl("fornMovData")?.value || dateFromDateTimeOrDate(safeEl("fornMovOperatedAt")?.value, todayStr()),
    operated_at: cleanDateTimeLocal(safeEl("fornMovOperatedAt")?.value),
    tipo: $("fornMovTipo").value,
    cassa: safeEl("fornMovCassa")?.value || "contanti",
    importo: n($("fornMovImporto").value),
    nota: $("fornMovNota").value.trim(),
  };
  if (!payload.supplierId || !payload.data || payload.importo <= 0) return showGlobalMessage("Controlla fornitore, data e importo.", "error");
  try {
    await insertSupplierMovement(payload);
    if (safeEl("fornMovImporto")) $("fornMovImporto").value = "";
    if (safeEl("fornMovOperatedAt")) $("fornMovOperatedAt").value = "";
    if (safeEl("fornMovNota")) $("fornMovNota").value = "";
    await refreshData("Movimento fornitore salvato e cassa aggiornata.");
  } catch (err) {
    showGlobalMessage(err.message || String(err), "error");
  }
}
async function saveSupplierDetailMovement() {
  if (editingSupplierMovementId) {
    try { await updateSupplierMovementFromDetail(); } catch (err) { showGlobalMessage(err.message || String(err), "error"); }
    return;
  }
  if (!selectedSupplierDetailId) return showGlobalMessage("Apri prima la scheda di un fornitore.", "error");
  const payload = {
    supplierId: selectedSupplierDetailId,
    data: safeEl("supplierDetailData")?.value || dateFromDateTimeOrDate(safeEl("supplierDetailOperatedAt")?.value, todayStr()),
    operated_at: cleanDateTimeLocal(safeEl("supplierDetailOperatedAt")?.value),
    tipo: safeEl("supplierDetailTipo")?.value || "pagamento",
    cassa: safeEl("supplierDetailCassa")?.value || "contanti",
    importo: n(safeEl("supplierDetailImporto")?.value),
    nota: safeEl("supplierDetailNota")?.value?.trim() || "",
  };
  if (!payload.data || payload.importo <= 0) return showGlobalMessage("Inserisci data e importo.", "error");
  try {
    await insertSupplierMovement(payload);
    resetSupplierDetailMovementForm();
    await refreshData("Movimento aggiunto nella scheda fornitore e cassa aggiornata.");
  } catch (err) {
    showGlobalMessage(err.message || String(err), "error");
  }
}

function startEmployeeEdit(employee) {
  editingEmployeeId = employee.id;
  $("dipNome").value = employee.nome || "";
  $("dipRuolo").value = employee.ruolo || "";
  $("dipDovuto").value = employee.dovuto_mensile ?? 0;
  $("saveDipBtn").textContent = "Aggiorna dipendente";
  safeEl("cancelDipEditBtn")?.classList.remove("hidden");
  if (safeEl("dipFormHint")) $("dipFormHint").textContent = `Stai modificando: ${employee.nome}`;
  navigate("dipendenti");
  window.scrollTo({ top:0, behavior:"smooth" });
}
function resetEmployeeForm() {
  editingEmployeeId = null;
  $("dipNome").value = ""; $("dipRuolo").value = ""; $("dipDovuto").value = "";
  $("saveDipBtn").textContent = "Salva dipendente";
  safeEl("cancelDipEditBtn")?.classList.add("hidden");
  if (safeEl("dipFormHint")) $("dipFormHint").textContent = "Inserisci o modifica un dipendente.";
}
async function saveEmployee() {
  const payload = {
    company_id: state.activeCompany.id,
    nome: $("dipNome").value.trim(),
    ruolo: $("dipRuolo").value.trim(),
    dovuto_mensile: n($("dipDovuto").value),
  };
  if (!payload.nome) return showGlobalMessage("Inserisci il nome del dipendente.", "error");
  const result = editingEmployeeId
    ? await supabase.from("employees").update(payload).eq("id", editingEmployeeId).eq("company_id", state.activeCompany.id)
    : await supabase.from("employees").insert(payload);
  if (result.error) return showGlobalMessage(result.error.message, "error");
  const wasEditing = !!editingEmployeeId;
  resetEmployeeForm();
  await refreshData(wasEditing ? "Dipendente aggiornato." : "Dipendente salvato.");
}
async function removeEmployeeFromDailyPayloads(employeeId) {
  const affected = (state.dailyRecords || []).filter(r => (r.employeePayments || []).some(p => p.employee_id === employeeId));
  for (const rec of affected) {
    const copy = JSON.parse(JSON.stringify(rec));
    copy.employeePayments = (copy.employeePayments || []).filter(p => p.employee_id !== employeeId);
    await upsertDailyRecordPayload(copy);
  }
}
async function deleteEmployeeByName(name) {
  const e = state.employees.find(x => x.nome === name);
  if (!e) return;
  if (!confirm(`Vuoi davvero eliminare il dipendente "${name}"? Verranno eliminati anche i suoi movimenti e le uscite cassa collegate.`)) return;
  try {
    const moves = (state.employeeMovements || []).filter(m => m.employee_id === e.id);
    for (const m of moves) {
      await deleteMatchingCashOutMovement(m, "employee");
    }
    await removeEmployeeFromDailyPayloads(e.id);
    const delMoves = await supabase.from("employee_movements").delete().eq("company_id", state.activeCompany.id).eq("employee_id", e.id);
    if (delMoves.error) throw delMoves.error;
    const delEmp = await supabase.from("employees").delete().eq("company_id", state.activeCompany.id).eq("id", e.id);
    if (delEmp.error) throw delEmp.error;
    resetEmployeeForm();
    await refreshData("Dipendente eliminato con movimenti e uscite cassa collegate.");
  } catch (err) {
    showGlobalMessage(err.message || String(err), "error");
  }
}
async function saveEmployeeMovement() {
  const employee = findEmployeeByName($("dipMovNome").value);
  const payload = {
    employeeId: employee?.id,
    data: safeEl("dipMovData")?.value || dateFromDateTimeOrDate(safeEl("dipMovOperatedAt")?.value, todayStr()),
    operated_at: cleanDateTimeLocal(safeEl("dipMovOperatedAt")?.value),
    tipo: $("dipMovTipo").value,
    cassa: safeEl("dipMovCassa")?.value || "contanti",
    importo: n($("dipMovImporto").value),
    nota: $("dipMovNota").value.trim(),
  };
  if (!payload.employeeId || !payload.data || payload.importo <= 0) return showGlobalMessage("Controlla dipendente, data e importo.", "error");
  try {
    await insertEmployeeMovement(payload);
    if (safeEl("dipMovImporto")) $("dipMovImporto").value = "";
    if (safeEl("dipMovOperatedAt")) $("dipMovOperatedAt").value = "";
    if (safeEl("dipMovNota")) $("dipMovNota").value = "";
    await refreshData("Movimento dipendente salvato e cassa aggiornata.");
  } catch (err) {
    showGlobalMessage(err.message || String(err), "error");
  }
}
async function saveEmployeeDetailMovement() {
  if (editingEmployeeMovementId) {
    try { await updateEmployeeMovementFromDetail(); } catch (err) { showGlobalMessage(err.message || String(err), "error"); }
    return;
  }
  if (!selectedEmployeeDetailId) return showGlobalMessage("Apri prima la scheda di un dipendente.", "error");
  const payload = {
    employeeId: selectedEmployeeDetailId,
    data: safeEl("employeeDetailData")?.value || dateFromDateTimeOrDate(safeEl("employeeDetailOperatedAt")?.value, todayStr()),
    operated_at: cleanDateTimeLocal(safeEl("employeeDetailOperatedAt")?.value),
    tipo: safeEl("employeeDetailTipo")?.value || "acconto",
    cassa: safeEl("employeeDetailCassa")?.value || "contanti",
    importo: n(safeEl("employeeDetailImporto")?.value),
    nota: safeEl("employeeDetailNota")?.value?.trim() || "",
  };
  if (!payload.data || payload.importo <= 0) return showGlobalMessage("Inserisci data e importo.", "error");
  try {
    await insertEmployeeMovement(payload);
    resetEmployeeDetailMovementForm();
    await refreshData("Movimento aggiunto nella scheda dipendente e cassa aggiornata.");
  } catch (err) {
    showGlobalMessage(err.message || String(err), "error");
  }
}

function fillBookingForm(b) {
  $("banData").value = b.data || "";
  $("banNome").value = b.nome || "";
  $("banAdulti").value = b.adulti ?? 0;
  $("banBambini").value = b.bambini ?? 0;
  $("banTipo").value = b.tipo || "ristorante";
  $("banImporto").value = b.importo ?? 0;
  $("banOra").value = b.ora || "";
  $("banNote").value = b.note || "";
}
function resetBookingForm() {
  editingBookingId = null;
  $("saveBanBtn").textContent = "Salva prenotazione";
  $("banData").value = todayStr();
  $("banNome").value = ""; $("banAdulti").value = ""; $("banBambini").value = ""; $("banTipo").value = "ristorante"; $("banImporto").value = ""; $("banOra").value = ""; $("banNote").value = "";
}
function editBookingById(id) {
  const b = state.bookings.find(x => x.id === id);
  if (!b) return;
  editingBookingId = id;
  fillBookingForm(b);
  $("saveBanBtn").textContent = "Aggiorna prenotazione";
  navigate("banchetti");
  window.scrollTo({ top:0, behavior:"smooth" });
}
async function saveBooking() {
  const payload = {
    company_id: state.activeCompany.id,
    data: $("banData").value,
    nome: $("banNome").value.trim(),
    adulti: n($("banAdulti").value),
    bambini: n($("banBambini").value),
    tipo: $("banTipo").value,
    importo: n($("banImporto").value),
    ora: $("banOra").value.trim(),
    note: $("banNote").value.trim(),
  };
  if (!payload.data || !payload.nome) return showGlobalMessage("Inserisci data e nome evento.", "error");
  const query = editingBookingId
    ? supabase.from("bookings").update(payload).eq("id", editingBookingId).eq("company_id", state.activeCompany.id)
    : supabase.from("bookings").insert(payload);
  const { error } = await query;
  if (error) return showGlobalMessage(error.message, "error");
  const wasEditing = !!editingBookingId;
  resetBookingForm();
  await refreshData(wasEditing ? "Prenotazione aggiornata." : "Prenotazione salvata.");
}
async function deleteBookingById(id) {
  const b = state.bookings.find(x => x.id === id);
  if (!b) return;
  if (!confirm(`Vuoi davvero cancellare la prenotazione "${b.nome}" del ${b.data}?`)) return;
  const { error } = await supabase.from("bookings").delete().eq("id", id).eq("company_id", state.activeCompany.id);
  if (error) return showGlobalMessage(error.message, "error");
  resetBookingForm();
  await refreshData("Prenotazione cancellata.");
}

async function exportBackup() {
  const snapshot = {
    company: state.activeCompany, exported_at: new Date().toISOString(),
    dailyRecords: state.dailyRecords, cashInitial: state.cashInitial, cashInitialDate: state.cashInitialDate, customCashes: state.customCashes,
    cashMovements: state.cashMovements, suppliers: state.suppliers, supplierMovements: state.supplierMovements,
    employees: state.employees, employeeMovements: state.employeeMovements, bookings: state.bookings
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `backup_${state.activeCompany.name.replaceAll(" ","_")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!confirm(`Importare il backup nella ditta attiva: ${state.activeCompany.name}?`)) return;
    for (const rec of data.dailyRecords || []) {
      await supabase.from("daily_records").upsert({ company_id: state.activeCompany.id, data: rec.data, payload: rec }, { onConflict: "company_id,data" });
    }
    for (const [kind, amount] of Object.entries(data.cashInitial || {})) {
      await supabase.from("cash_state").upsert({ company_id: state.activeCompany.id, kind, amount, reference_date: data.cashInitialDate?.[kind] || null }, { onConflict: "company_id,kind" });
    }
    for (const c of data.customCashes || []) {
      await supabase.from("custom_cash_state").upsert({ company_id: state.activeCompany.id, name: c.name, amount: c.amount }, { onConflict: "company_id,name" });
    }
    for (const m of data.cashMovements || []) {
      await supabase.from("cash_movements").insert({ company_id: state.activeCompany.id, data:m.data, cassa:m.cassa, tipo:m.tipo, importo:m.importo, descrizione:m.descrizione || "" });
    }
    for (const s of data.suppliers || []) {
      await supabase.from("suppliers").insert({ company_id: state.activeCompany.id, nome:s.nome, aliases:s.aliases || [], sospeso_iniziale:n(s.sospeso_iniziale || 0) });
    }
    for (const e of data.employees || []) {
      await supabase.from("employees").insert({ company_id: state.activeCompany.id, nome:e.nome, ruolo:e.ruolo || "", dovuto_mensile:n(e.dovuto_mensile || 0) });
    }
    for (const b of data.bookings || []) {
      await supabase.from("bookings").insert({ company_id: state.activeCompany.id, data:b.data, nome:b.nome, adulti:b.adulti, bambini:b.bambini, tipo:b.tipo, importo:b.importo, ora:b.ora || "", note:b.note || "" });
    }
    await refreshData("Backup importato.");
  } catch (err) {
    showGlobalMessage("Backup non valido: " + err.message, "error");
  }
}

function openAlertModalByDate(dateStr) {
  const rec = state.dailyRecords.find(r => r.data === dateStr);
  if (!rec) return;
  selectedAlertRecord = rec;
  const alerts = validateDaily(rec);
  const totals = getDailyTotals(rec);
  if (safeEl("alertModalDate")) $("alertModalDate").textContent = `Giornata: ${rec.data}`;
  if (safeEl("alertReasons")) $("alertReasons").innerHTML = alerts.length ? alerts.map(a => `<div class="item"><div><strong>Alert</strong><small>${a}</small></div></div>`).join("") : `<div class="alert okline">Nessun alert attivo.</div>`;
  if (safeEl("alertQuickSummary")) $("alertQuickSummary").innerHTML = [
    ["Coperti totali", totals.totalCoperti],
    ["Coperti ristorante", dailyMetricTotal(rec, "copertiRistorante")],
    ["Pizze", dailyMetricTotal(rec, "pizze")],
    ["Incasso totale", euro(totals.totalIncasso)],
  ].map(([t,v]) => `<div class="item"><div><strong>${t}</strong></div><div>${v}</div></div>`).join("");
  safeEl("alertModal")?.classList.remove("hidden");
}
function closeAlertModal(){ safeEl("alertModal")?.classList.add("hidden"); }
function editSelectedAlertDay() {
  if (!selectedAlertRecord) return;
  fillDailyForm(selectedAlertRecord);
  closeAlertModal();
  navigate("giornaliera");
  window.scrollTo({ top:0, behavior:"smooth" });
}

function renderDashboard() {
  const last = [...state.dailyRecords].sort((a,b)=>b.data.localeCompare(a.data))[0];
  const totals = last ? getDailyTotals(last) : { totalIncasso:0, totalCoperti:0 };
  const alerts = [];
  state.dailyRecords.forEach(r => validateDaily(r).forEach(text => alerts.push({ title:r.data, text })));
  const balances = computeCashBalances();
  if (safeEl("kpiIncasso")) $("kpiIncasso").textContent = euro(totals.totalIncasso);
  if (safeEl("kpiCoperti")) $("kpiCoperti").textContent = totals.totalCoperti;
  if (safeEl("kpiFornitori")) $("kpiFornitori").textContent = state.suppliers.filter(s => supplierSuspeso(s) > 0).length;
  if (safeEl("kpiAlert")) $("kpiAlert").textContent = alerts.length;
  if (safeEl("alertsBox")) {
    $("alertsBox").innerHTML = alerts.length ? alerts.map(a => `<div class="item alert-row" data-alert-date="${a.title}" style="cursor:pointer;"><div><strong>${a.title}</strong><small>${a.text}</small></div><div>Apri</div></div>`).join("") : `<div class="alert okline">Nessun alert attivo.</div>`;
    document.querySelectorAll(".alert-row").forEach(row => row.addEventListener("click", ()=>openAlertModalByDate(row.dataset.alertDate)));
  }
  if (safeEl("cashSummary")) {
    const breakdown = computeCashBreakdown();
    $("cashSummary").innerHTML = Object.entries(breakdown).map(([k,row]) => {
      const startInfo = row.startDate ? ` (${cashStartLabel(k)})` : "";
      const detail = isPosCash(k)
        ? `iniziale ${euro(row.iniziale)}${startInfo} · incassi netti ${euro(row.incassi)} · POS lordo ${euro(row.lordo)} · commissioni SumUp ${euro(row.commissioni)} · entrate ${euro(row.entrate)} · uscite ${euro(row.uscite)}`
        : `iniziale ${euro(row.iniziale)}${startInfo} · incassi ${euro(row.incassi)} · entrate ${euro(row.entrate)} · uscite ${euro(row.uscite)}`;
      return `
      <div class="item cash-balance-row">
        <div>
          <strong>${escapeHtml(cashLabel(k))}</strong>
          <small>${detail}</small>
        </div>
        <div class="cash-balance-total">${euro(row.saldo)}</div>
      </div>`;
    }).join("") || `<div class="alert">Nessuna cassa presente.</div>`;
  }
  renderLiveChecks();
  if (safeEl("dailyCashAuditBox") && safeEl("dailyCashAuditBox").innerHTML.trim()) renderDailyCashAudit();
}

function renderDailyTable() {
  const tbody = safeEl("giorniTable");
  if (!tbody) return;
  const rows = [...state.dailyRecords].sort((a,b) => String(b.data || "").localeCompare(String(a.data || "")));
  tbody.innerHTML = rows.map(r=>{
    const totals = getDailyTotals(r);
    const alerts = validateDaily(r);
    return `<tr>
      <td><button class="btn ghost day-edit-btn" data-day-date="${r.data}">${r.data}</button></td>
      <td>${formatSavedAt(r)}</td>
      <td>${totals.totalCoperti}</td>
      <td>${euro(totals.totalIncasso)}${totals.totalCommissioni ? `<br><small>netto ${euro(totals.totalIncassoNetto)} · SumUp ${euro(totals.totalCommissioni)}</small>` : ""}</td>
      <td>${dailyMetricTotal(r, "pizze")}</td>
      <td>${dailyMetricTotal(r, "menu")} / ${dailyMetricTotal(r, "supplementi")}</td>
      <td style="display:flex;gap:8px;flex-wrap:wrap;">
        ${alerts.length ? `<button class="btn ghost day-alert-btn" data-alert-date="${r.data}">Alert</button>` : '<span class="ok">OK</span>'}
        <button class="btn ghost day-delete-btn" data-day-date="${r.data}">Cancella scheda</button>
        <button class="btn ghost danger-soft day-delete-full-btn" data-day-date="${r.data}">Elimina giorno intero</button>
      </td>
    </tr>`;
  }).join("");
  document.querySelectorAll(".day-alert-btn").forEach(btn => btn.addEventListener("click", ()=>openAlertModalByDate(btn.dataset.alertDate)));
  document.querySelectorAll(".day-edit-btn").forEach(btn => btn.addEventListener("click", ()=>loadDailyByDate(btn.dataset.dayDate)));
  document.querySelectorAll(".day-delete-btn").forEach(btn => btn.addEventListener("click", ()=>deleteDailyByDate(btn.dataset.dayDate)));
  document.querySelectorAll(".day-delete-full-btn").forEach(btn => btn.addEventListener("click", ()=>deleteWholeDayByDate(btn.dataset.dayDate)));
}
function renderCash() {
  if (safeEl("cashInitContanti")) $("cashInitContanti").value = inputNumberValue(state.cashInitial.contanti);
  if (safeEl("cashInitPos")) $("cashInitPos").value = inputNumberValue(state.cashInitial.pos);
  if (safeEl("cashInitContantiDate")) $("cashInitContantiDate").value = state.cashInitialDate?.contanti || "";
  if (safeEl("cashInitPosDate")) $("cashInitPosDate").value = state.cashInitialDate?.pos || "";
  ["movCassa", "fornMovCassa", "dipMovCassa", "supplierDetailCassa", "employeeDetailCassa"].forEach(id => fillCashSelect(id, safeEl(id)?.value || "contanti"));
  renderDailyCashInputs();
  if (safeEl("customCashTable")) {
    $("customCashTable").innerHTML = (state.customCashes || []).map(c => `<tr><td>${c.name}</td><td>${euro(c.amount)}</td><td><button class="btn ghost custom-cash-delete-btn" data-cash-name="${c.name}">Elimina totale</button></td></tr>`).join("") || '<tr><td colspan="3">Nessuna cassa personalizzata</td></tr>';
    document.querySelectorAll(".custom-cash-delete-btn").forEach(btn => btn.addEventListener("click", ()=>deleteCustomCash(btn.dataset.cashName)));
  }
  if (safeEl("movimentiTable")) {
    $("movimentiTable").innerHTML = state.cashMovements.map(m=>`<tr>
      <td>${m.data}</td>
      <td>${formatOperationDateTime(m)}</td>
      <td>${formatSavedAt(m)}</td>
      <td>${m.cassa}</td>
      <td>${m.tipo}</td>
      <td>${m.descrizione || ""}</td>
      <td>${euro(m.importo)}</td>
      <td style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn ghost cash-edit-btn" data-cash-id="${m.id}">Modifica</button>
        <button class="btn ghost cash-delete-btn" data-cash-id="${m.id}">Elimina totale</button>
      </td>
    </tr>`).join("");
    document.querySelectorAll(".cash-edit-btn").forEach(btn => btn.addEventListener("click", ()=>{
      const movement = state.cashMovements.find(m => m.id === btn.dataset.cashId);
      if (movement) startCashMovementEdit(movement);
    }));
    document.querySelectorAll(".cash-delete-btn").forEach(btn => btn.addEventListener("click", ()=>deleteCashMovementById(btn.dataset.cashId)));
  }
}
function renderSuppliers() {
  refreshSuppliersDatalist();
  setupGlobalSearchInputs();
  if (safeEl("fornMovNome") && safeEl("fornMovNome").tagName === "SELECT") {
    $("fornMovNome").innerHTML = state.suppliers.map(s => `<option value="${s.nome}">${escapeHtml(supplierSearchLabel(s))}</option>`).join("");
  }
  const table = safeEl("fornitoriTable");
  if (!table) return;
  table.innerHTML = state.suppliers.map(s=>{
    const sosp = supplierSuspeso(s);
    const last = state.supplierMovements.filter(m => m.supplier_id === s.id).slice(-1)[0];
    return `<tr>
      <td>${escapeHtml(s.nome)}</td>
      <td>${(s.aliases || []).map(escapeHtml).join(", ") || "—"}</td>
      <td>${euro(sosp)}</td>
      <td>${last ? `${last.data} · ${last.tipo} ${euro(last.importo)}` : "—"}</td>
      <td>${sosp > 0 ? '<span class="warn">Aperto</span>' : '<span class="ok">Chiuso</span>'}</td>
      <td><button class="btn ghost supplier-detail-btn" data-supplier-id="${s.id}">Apri scheda</button></td>
      <td style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn ghost supplier-edit-btn" data-supplier-name="${escapeHtml(s.nome)}">Modifica</button>
        <button class="btn ghost supplier-delete-btn" data-supplier-name="${escapeHtml(s.nome)}">Elimina totale</button>
      </td>
    </tr>`;
  }).join("");
  document.querySelectorAll(".supplier-detail-btn").forEach(btn => btn.addEventListener("click", ()=>openSupplierDetail(btn.dataset.supplierId)));
  document.querySelectorAll(".supplier-edit-btn").forEach(btn => btn.addEventListener("click", ()=>{
    const supplier = state.suppliers.find(s => s.nome === btn.dataset.supplierName);
    if (supplier) startSupplierEdit(supplier);
  }));
  document.querySelectorAll(".supplier-delete-btn").forEach(btn => btn.addEventListener("click", ()=>deleteSupplierByName(btn.dataset.supplierName)));
  renderSupplierDetail();
}
function openSupplierDetail(id) {
  selectedSupplierDetailId = id;
  if (safeEl("supplierDetailCard")) $("supplierDetailCard").classList.remove("hidden");
  renderSupplierDetail();
  navigate("fornitori");
  safeEl("supplierDetailCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderSupplierDetail() {
  const card = safeEl("supplierDetailCard");
  if (!card || !selectedSupplierDetailId) return;
  const s = state.suppliers.find(x => x.id === selectedSupplierDetailId);
  if (!s) { card.classList.add("hidden"); selectedSupplierDetailId = null; return; }
  card.classList.remove("hidden");
  const month = safeEl("supplierDetailMonth")?.value || "";
  const allMoves = state.supplierMovements.filter(m => m.supplier_id === s.id).sort(sortMovementsChronological);
  const moves = allMoves.filter(m => monthMatches(m.data, month));
  const daPagare = allMoves.filter(m => !isSupplierPaymentType(m.tipo)).reduce((a,b)=>a+n(b.importo),0);
  const pagamenti = allMoves.filter(m => isSupplierPaymentType(m.tipo)).reduce((a,b)=>a+n(b.importo),0);
  if (safeEl("supplierDetailTitle")) $("supplierDetailTitle").textContent = `Scheda fornitore · ${s.nome}`;
  if (safeEl("supplierDetailSubtitle")) $("supplierDetailSubtitle").textContent = month ? `Movimenti del mese ${month} in ordine cronologico` : "Storico completo movimenti in ordine cronologico";
  if (safeEl("supplierDetailData") && !$("supplierDetailData").value) $("supplierDetailData").value = todayStr();
  fillCashSelect("supplierDetailCassa", safeEl("supplierDetailCassa")?.value || "contanti");
  if (safeEl("supplierDetailKpis")) $("supplierDetailKpis").innerHTML = [
    `<div class="card inner"><div class="muted small">Sospeso iniziale</div><div class="metric-value small">${euro(s.sospeso_iniziale)}</div></div>`,
    `<div class="card inner"><div class="muted small">Da pagare / extra</div><div class="metric-value small">${euro(daPagare)}</div></div>`,
    `<div class="card inner"><div class="muted small">Pagamenti / acconti</div><div class="metric-value small">${euro(pagamenti)}</div></div>`,
    `<div class="card inner"><div class="muted small">Scoperto attuale</div><div class="metric-value small">${euro(supplierSuspeso(s))}</div></div>`,
  ].join("");
  if (safeEl("supplierDetailTable")) {
    $("supplierDetailTable").innerHTML = moves.map(m => `<tr>
      <td>${m.data}</td>
      <td>${formatOperationDateTime(m)}</td>
      <td>${formatSavedAt(m)}</td>
      <td>${typeLabel(m.tipo)}${isDailyAutoMovement(m) ? ' <span class="pill">scheda giornaliera</span>' : ''}${!state.suppliers.some(x => x.id === m.supplier_id) ? ' <span class="pill bad-pill">orfano</span>' : ''}</td>
      <td>${euro(m.importo)}</td>
      <td>${escapeHtml(cleanMovementNoteForForm(m.nota) || "")}</td>
      <td><div class="action-inline"><button class="btn ghost supplier-movement-edit-btn" data-movement-id="${m.id}">Modifica</button><button class="btn ghost supplier-movement-delete-btn" data-movement-id="${m.id}">Elimina</button></div></td>
    </tr>`).join("") || '<tr><td colspan="7">Nessun movimento</td></tr>';
    document.querySelectorAll(".supplier-movement-edit-btn").forEach(btn => btn.addEventListener("click", () => startSupplierMovementEdit(btn.dataset.movementId)));
    document.querySelectorAll(".supplier-movement-delete-btn").forEach(btn => btn.addEventListener("click", () => deleteSupplierMovementById(btn.dataset.movementId)));
  }
}
function renderEmployees() {
  const empList = safeEl("employeesDatalist");
  if (empList) empList.innerHTML = (state.employees || []).map(e => `<option value="${escapeHtml(e.nome)}"></option>`).join("");
  setupGlobalSearchInputs();
  const table = safeEl("dipendentiTable");
  if (!table) return;
  const month = getCurrentMonthPrefix();
  table.innerHTML = state.employees.map(e=>{
    const status = employeeMonthStatus(e, month);
    return `<tr>
      <td>${escapeHtml(e.nome)}</td>
      <td>${escapeHtml(e.ruolo || "—")}</td>
      <td>${euro(status.due)}</td>
      <td>${euro(status.paid)}</td>
      <td>${status.residuo > 0 ? `<span class="warn">${euro(status.residuo)}</span>` : `<span class="ok">${euro(status.residuo)}</span>`}</td>
      <td><button class="btn ghost employee-detail-btn" data-employee-id="${e.id}">Apri scheda</button></td>
      <td style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn ghost employee-edit-btn" data-employee-name="${escapeHtml(e.nome)}">Modifica</button>
        <button class="btn ghost employee-delete-btn" data-employee-name="${escapeHtml(e.nome)}">Elimina totale</button>
      </td>
    </tr>`;
  }).join("");
  document.querySelectorAll(".employee-detail-btn").forEach(btn => btn.addEventListener("click", ()=>openEmployeeDetail(btn.dataset.employeeId)));
  document.querySelectorAll(".employee-edit-btn").forEach(btn => btn.addEventListener("click", ()=>{
    const employee = state.employees.find(e => e.nome === btn.dataset.employeeName);
    if (employee) startEmployeeEdit(employee);
  }));
  document.querySelectorAll(".employee-delete-btn").forEach(btn => btn.addEventListener("click", ()=>deleteEmployeeByName(btn.dataset.employeeName)));
  renderEmployeeDetail();
}
function openEmployeeDetail(id) {
  selectedEmployeeDetailId = id;
  if (safeEl("employeeDetailCard")) $("employeeDetailCard").classList.remove("hidden");
  renderEmployeeDetail();
  navigate("dipendenti");
  safeEl("employeeDetailCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderEmployeeDetail() {
  const card = safeEl("employeeDetailCard");
  if (!card || !selectedEmployeeDetailId) return;
  const e = state.employees.find(x => x.id === selectedEmployeeDetailId);
  if (!e) { card.classList.add("hidden"); selectedEmployeeDetailId = null; return; }
  card.classList.remove("hidden");
  const month = safeEl("employeeDetailMonth")?.value || "";
  const allMoves = state.employeeMovements.filter(m => m.employee_id === e.id).sort(sortMovementsChronological);
  const moves = allMoves.filter(m => monthMatches(m.data, month));
  const statusMonth = month || getCurrentMonthPrefix();
  const status = employeeMonthStatus(e, statusMonth);
  const paidAll = employeePaid(e, "");
  if (safeEl("employeeDetailTitle")) $("employeeDetailTitle").textContent = `Scheda dipendente · ${e.nome}`;
  if (safeEl("employeeDetailSubtitle")) $("employeeDetailSubtitle").textContent = month ? `Mese ${month} · movimenti in ordine cronologico` : "Storico completo movimenti in ordine cronologico";
  if (safeEl("employeeDetailData") && !$("employeeDetailData").value) $("employeeDetailData").value = todayStr();
  fillCashSelect("employeeDetailCassa", safeEl("employeeDetailCassa")?.value || "contanti");
  if (safeEl("employeeDetailKpis")) $("employeeDetailKpis").innerHTML = [
    `<div class="card inner"><div class="muted small">Dovuto mese ${statusMonth}</div><div class="metric-value small">${euro(status.due)}</div></div>`,
    `<div class="card inner"><div class="muted small">Dato nel mese ${statusMonth}</div><div class="metric-value small">${euro(status.paid)}</div></div>`,
    `<div class="card inner"><div class="muted small">Manca nel mese ${statusMonth}</div><div class="metric-value small">${euro(status.residuo)}</div></div>`,
    `<div class="card inner"><div class="muted small">Dato totale storico</div><div class="metric-value small">${euro(paidAll)}</div></div>`,
  ].join("");
  if (safeEl("employeeDetailTable")) {
    $("employeeDetailTable").innerHTML = moves.map(m => `<tr>
      <td>${m.data}</td>
      <td>${formatOperationDateTime(m)}</td>
      <td>${formatSavedAt(m)}</td>
      <td>${typeLabel(m.tipo)}${isDailyAutoMovement(m) ? ' <span class="pill">scheda giornaliera</span>' : ''}${!state.employees.some(x => x.id === m.employee_id) ? ' <span class="pill bad-pill">orfano</span>' : ''}</td>
      <td>${euro(m.importo)}</td>
      <td>${escapeHtml(cleanMovementNoteForForm(m.nota) || "")}</td>
      <td><div class="action-inline"><button class="btn ghost employee-movement-edit-btn" data-movement-id="${m.id}">Modifica</button><button class="btn ghost employee-movement-delete-btn" data-movement-id="${m.id}">Elimina</button></div></td>
    </tr>`).join("") || '<tr><td colspan="7">Nessun movimento</td></tr>';
    document.querySelectorAll(".employee-movement-edit-btn").forEach(btn => btn.addEventListener("click", () => startEmployeeMovementEdit(btn.dataset.movementId)));
    document.querySelectorAll(".employee-movement-delete-btn").forEach(btn => btn.addEventListener("click", () => deleteEmployeeMovementById(btn.dataset.movementId)));
  }
}
function renderBookings() {
  const table = safeEl("banchettiTable");
  if (!table) return;
  table.innerHTML = state.bookings.map(b=>`<tr>
    <td>${b.data}</td>
    <td>${b.nome}</td>
    <td>${b.adulti}+${b.bambini}</td>
    <td>${b.tipo}</td>
    <td>${euro(b.importo)}</td>
    <td>${[b.ora, b.note].filter(Boolean).join(" · ") || "—"}</td>
    <td style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn ghost booking-edit-btn" data-booking-id="${b.id}">Modifica</button>
      <button class="btn ghost booking-delete-btn" data-booking-id="${b.id}">Cancella</button>
    </td>
  </tr>`).join("");
  document.querySelectorAll(".booking-edit-btn").forEach(btn => btn.addEventListener("click", ()=>editBookingById(btn.dataset.bookingId)));
  document.querySelectorAll(".booking-delete-btn").forEach(btn => btn.addEventListener("click", ()=>deleteBookingById(btn.dataset.bookingId)));
}
function reportDateRange(from, to) {
  const allDates = [
    ...state.dailyRecords.map(r => r.data),
    ...state.supplierMovements.map(m => m.data),
    ...state.employeeMovements.map(m => m.data),
    ...state.cashMovements.map(m => m.data),
  ].filter(Boolean).sort();
  const earliest = allDates[0] || "";
  const latest = allDates[allDates.length - 1] || "";
  return { from: from || earliest, to: to || latest };
}
function dateInRange(dateStr, range) {
  return (!range.from || dateStr >= range.from) && (!range.to || dateStr <= range.to);
}
function recordsInRange(from, to) {
  const range = reportDateRange(from, to);
  return state.dailyRecords.filter(r => (!range.from || r.data >= range.from) && (!range.to || r.data <= range.to));
}
function lastDayOfMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}
function cashMovementSumsForDate(dateStr, cassa) {
  const rows = (state.cashMovements || []).filter(m => String(m.data || "") === String(dateStr || "") && String(m.cassa || "contanti") === String(cassa || "contanti"));
  return {
    entrate: rows.filter(m => m.tipo === "entrata").reduce((a,b)=>a+n(b.importo),0),
    uscite: rows.filter(m => m.tipo !== "entrata").reduce((a,b)=>a+n(b.importo),0),
    count: rows.length,
  };
}
function businessOutSumsForDate(dateStr) {
  const d = String(dateStr || "").slice(0,10);
  const out = {
    suppliers: 0,
    employees: 0,
    suppliersContanti: 0,
    suppliersPos: 0,
    employeesContanti: 0,
    employeesPos: 0,
    supplierCount: 0,
    employeeCount: 0,
  };
  (state.supplierMovements || []).filter(m => String(m.data || "").slice(0,10) === d && isSupplierPaymentType(m.tipo)).forEach(m => {
    const amount = n(m.importo);
    const cash = normalizeSearchText(extractCashFromNote(m.nota || "", "contanti"));
    out.suppliers += amount; out.supplierCount += 1;
    if (cash === "pos") out.suppliersPos += amount; else out.suppliersContanti += amount;
  });
  (state.employeeMovements || []).filter(m => String(m.data || "").slice(0,10) === d).forEach(m => {
    const amount = n(m.importo);
    const cash = normalizeSearchText(extractCashFromNote(m.nota || "", "contanti"));
    out.employees += amount; out.employeeCount += 1;
    if (cash === "pos") out.employeesPos += amount; else out.employeesContanti += amount;
  });
  return out;
}
function countRealBanchetti(rec) {
  return (getBanchettiList(rec) || []).filter(b => {
    return SERVICE_NUMBER_FIELDS.some(f => n(b?.[f]) !== 0) || String(b?.nome || "").trim().replace(/^Banchetto\s*\d+$/i, "");
  }).length;
}
function buildReportRows(records, range) {
  return [...(records || [])].sort((a,b)=>String(a.data || "").localeCompare(String(b.data || ""))).map(r => {
    const pranzo = getService(r, "pranzo");
    const cena = getService(r, "cena");
    const banchetti = getBanchettiAggregate(r);
    const contanti = getDailyCashAmount(r, "contanti");
    const posLordo = getDailyCashAmount(r, "pos");
    const posCommissioni = getDailyCashFeeAmount(r, "pos");
    const posNetto = getDailyCashNetAmount(r, "pos");
    const contantiCash = cashMovementSumsForDate(r.data, "contanti");
    const posCash = cashMovementSumsForDate(r.data, "pos");
    const businessOut = businessOutSumsForDate(r.data);
    const saldoFine = computeCashBreakdownUntil(r.data);
    return {
      data: r.data,
      coperti: dailyMetricTotal(r, "coperti") || getDailyTotals(r).totalCoperti,
      copertiPranzoCena: n(pranzo.coperti) + n(cena.coperti),
      banchettiCount: countRealBanchetti(r),
      banchettiCoperti: n(banchetti.coperti),
      copertiRistorante: dailyMetricTotal(r, "copertiRistorante"),
      menu: dailyMetricTotal(r, "menu"),
      pizze: dailyMetricTotal(r, "pizze"),
      supplementi: dailyMetricTotal(r, "supplementi"),
      portate: dailyMetricTotal(r, "portate"),
      asporto: getDailyAsportoTotal(r),
      pranzoEuro: n(pranzo.servizio),
      cenaEuro: n(cena.servizio),
      banchettiEuro: n(banchetti.servizio),
      bancone: getDailyBanconeTotal(r),
      contanti,
      posLordo,
      posCommissioni,
      posNetto,
      entrateContanti: contantiCash.entrate,
      usciteContanti: contantiCash.uscite,
      entratePos: posCash.entrate,
      uscitePos: posCash.uscite,
      usciteFornitori: businessOut.suppliers,
      usciteDipendenti: businessOut.employees,
      usciteFornitoriContanti: businessOut.suppliersContanti,
      usciteFornitoriPos: businessOut.suppliersPos,
      usciteDipendentiContanti: businessOut.employeesContanti,
      usciteDipendentiPos: businessOut.employeesPos,
      saldoContanti: saldoFine.contanti?.saldo || 0,
      saldoPos: saldoFine.pos?.saldo || 0,
    };
  });
}
function buildReportTotals(records, rangeOverride = null) {
  const servizioTotali = {
    pranzo: emptyService(),
    cena: emptyService(),
    banchetti: emptyService(),
    totale: emptyService()
  };
  let incasso=0, incassoNetto=0, commissioni=0, asporto=0, bancone=0, servizioPranzo=0, servizioCena=0, servizioBanchetti=0;
  const cashTotals = {};
  const cashGrossTotals = {};
  const cashFees = {};
  cashNames().forEach(c => { cashTotals[c] = 0; cashGrossTotals[c] = 0; cashFees[c] = 0; });
  const reportRange = rangeOverride || reportDateRange(records[0]?.data || "", records[records.length - 1]?.data || "");
  const supplierOutRows = (state.supplierMovements || []).filter(m => isSupplierPaymentType(m.tipo) && dateInRange(m.data, reportRange));
  const employeeOutRows = (state.employeeMovements || []).filter(m => dateInRange(m.data, reportRange));
  const supplierOut = supplierOutRows.reduce((a,b)=>a+n(b.importo),0);
  const employeeOut = employeeOutRows.reduce((a,b)=>a+n(b.importo),0);
  const totalOut = supplierOut + employeeOut;
  const cashOutRows = (state.cashMovements || []).filter(m => m.tipo === "uscita" && dateInRange(m.data, reportRange));
  const cashOutTotal = cashOutRows.reduce((a,b)=>a+n(b.importo),0);
  const unlinkedCashOutRows = cashOutRows.filter(m => cashMovementLooksBusinessRelated(m) && !cashMovementHasAnyBusinessMatch(m));
  const unlinkedCashOutTotal = unlinkedCashOutRows.reduce((a,b)=>a+n(b.importo),0);

  function addToServiceBucket(bucket, service) {
    SERVICE_NUMBER_FIELDS.forEach(field => { bucket[field] += n(service?.[field]); servizioTotali.totale[field] += n(service?.[field]); });
  }

  records.forEach(r => {
    const pranzo = getService(r, "pranzo");
    const cena = getService(r, "cena");
    const banchetti = getBanchettiAggregate(r);
    addToServiceBucket(servizioTotali.pranzo, pranzo);
    addToServiceBucket(servizioTotali.cena, cena);
    addToServiceBucket(servizioTotali.banchetti, banchetti);

    servizioPranzo += pranzo.servizio;
    servizioCena += cena.servizio;
    servizioBanchetti += banchetti.servizio;
    const totals = getDailyTotals(r);
    incasso += totals.totalIncasso;
    incassoNetto += totals.totalIncassoNetto;
    commissioni += totals.totalCommissioni;
    asporto += getDailyAsportoTotal(r);
    bancone += getDailyBanconeTotal(r);
    cashNames().forEach(c => {
      cashTotals[c] = n(cashTotals[c]) + getDailyCashNetAmount(r, c);
      cashGrossTotals[c] = n(cashGrossTotals[c]) + getDailyCashAmount(r, c);
      cashFees[c] = n(cashFees[c]) + getDailyCashFeeAmount(r, c);
    });
  });

  const endBreakdown = computeCashBreakdownUntil(reportRange.to || "");
  const dayRows = buildReportRows(records, reportRange);
  return {
    range: reportRange,
    servizioTotali,
    incasso,
    incassoNetto,
    commissioni,
    asporto,
    bancone,
    servizioPranzo,
    servizioCena,
    servizioBanchetti,
    cashTotals,
    cashGrossTotals,
    cashFees,
    supplierOutRows,
    employeeOutRows,
    supplierOut,
    employeeOut,
    totalOut,
    cashOutRows,
    cashOutTotal,
    unlinkedCashOutRows,
    unlinkedCashOutTotal,
    endBreakdown,
    dayRows,
  };
}
function renderReportDayRows(dayRows = []) {
  const box = safeEl("reportDailyDetail");
  if (!box) return;
  if (!dayRows.length) {
    box.innerHTML = `<div class="alert">Nessuna giornata nel periodo scelto.</div>`;
    return;
  }
  box.innerHTML = `<div class="table-wrap report-table-wrap"><table class="report-table"><thead><tr>
    <th>Data</th><th>Coperti P+C</th><th>Banchetti</th><th>Cop. banchetti</th><th>Menù</th><th>Pizze</th><th>Portate</th>
    <th>Contanti inc.</th><th>POS lordo</th><th>SumUp</th><th>POS netto</th>
    <th>Uscite fornitori</th><th>Uscite dipendenti</th><th>Uscite cont.</th><th>Uscite POS</th><th>Saldo cont. fine giorno</th><th>Saldo POS netto fine giorno</th>
  </tr></thead><tbody>${dayRows.map((row, idx) => `<tr class="${isWeekend(row.data) ? 'weekend-row' : (idx % 2 ? 'alt-row' : '')}">
    <td>${formatDate(row.data)}</td><td>${row.copertiPranzoCena}</td><td>${row.banchettiCount}</td><td>${row.banchettiCoperti}</td><td>${row.menu}</td><td>${row.pizze}</td><td>${row.portate}</td>
    <td>${euro(row.contanti)}</td><td>${euro(row.posLordo)}</td><td>${euro(row.posCommissioni)}</td><td>${euro(row.posNetto)}</td>
    <td>${euro(row.usciteFornitori)}</td><td>${euro(row.usciteDipendenti)}</td><td>${euro(row.usciteContanti)}</td><td>${euro(row.uscitePos)}</td><td>${euro(row.saldoContanti)}</td><td>${euro(row.saldoPos)}</td>
  </tr>`).join("")}</tbody></table></div>`;
}
function renderReportFromRecords(records, label = "", rangeOverride = null) {
  const reportRange = rangeOverride || reportDateRange(records[0]?.data || "", records[records.length - 1]?.data || "");
  const totals = buildReportTotals(records, reportRange);
  const servizioTotali = totals.servizioTotali;
  lastReportPayload = { label: label || "Periodo", records: [...records], ...totals };

  if (safeEl("rCopPranzo")) $("rCopPranzo").textContent = servizioTotali.pranzo.coperti;
  if (safeEl("rCopCena")) $("rCopCena").textContent = servizioTotali.cena.coperti;
  if (safeEl("rCopBanchetti")) $("rCopBanchetti").textContent = servizioTotali.banchetti.coperti;
  if (safeEl("rIncasso")) $("rIncasso").textContent = euro(totals.incasso);

  const metricCards = [];
  const names = [
    ["pizze", "Pizze"],
    ["copertiRistorante", "Coperti ristorante"],
    ["menu", "Menù"],
    ["supplementi", "Supplementi"],
    ["portate", "Portate"]
  ];
  names.forEach(([field, title]) => {
    metricCards.push(`<div class="card inner"><strong>${title} totali</strong><div>${servizioTotali.totale[field]}</div><small>Pranzo ${servizioTotali.pranzo[field]} · Cena ${servizioTotali.cena[field]} · Banchetti ${servizioTotali.banchetti[field]}</small></div>`);
  });

  const rangeText = reportRange.from || reportRange.to ? `${formatDate(reportRange.from)} → ${formatDate(reportRange.to)}` : "Tutto l’archivio";
  const endCards = Object.entries(totals.endBreakdown).map(([name,row]) => {
    const title = isPosCash(name) ? "Saldo POS netto a fine periodo" : `Saldo ${cashLabel(name)} a fine periodo`;
    const details = isPosCash(name)
      ? `iniziale ${euro(row.iniziale)} · incassi netti ${euro(row.incassi)} · lordo ${euro(row.lordo)} · commissioni ${euro(row.commissioni)} · uscite ${euro(row.uscite)}`
      : `iniziale ${euro(row.iniziale)} · incassi ${euro(row.incassi)} · uscite ${euro(row.uscite)}`;
    return `<div class="card inner highlight-card"><strong>${escapeHtml(title)}</strong><div>${euro(row.saldo)}</div><small>${details}</small></div>`;
  });

  if (safeEl("reportSummary")) $("reportSummary").innerHTML = [
    `<div class="card inner"><strong>${escapeHtml(label || "Periodo")}</strong><div>${records.length} giornate</div><small>${rangeText}</small></div>`,
    `<div class="card inner"><strong>Coperti complessivi</strong><div>${servizioTotali.totale.coperti}</div><small>Pranzo ${servizioTotali.pranzo.coperti} · Cena ${servizioTotali.cena.coperti} · Banchetti ${servizioTotali.banchetti.coperti}</small></div>`,
    `<div class="card inner"><strong>Incasso lordo</strong><div>${euro(totals.incasso)}</div></div>`,
    `<div class="card inner"><strong>Incasso netto dopo SumUp</strong><div>${euro(totals.incassoNetto)}</div></div>`,
    `<div class="card inner"><strong>Commissioni SumUp POS</strong><div>${euro(totals.commissioni)}</div></div>`,
    `<div class="card inner"><strong>Asporto totale</strong><div>${euro(totals.asporto)}</div></div>`,
    `<div class="card inner"><strong>Pranzo €</strong><div>${euro(totals.servizioPranzo)}</div></div>`,
    `<div class="card inner"><strong>Cena €</strong><div>${euro(totals.servizioCena)}</div></div>`,
    `<div class="card inner"><strong>Banchetti €</strong><div>${euro(totals.servizioBanchetti)}</div></div>`,
    `<div class="card inner"><strong>Bancone totale</strong><div>${euro(totals.bancone)}</div></div>`,
    `<div class="card inner"><strong>Uscite fornitori</strong><div>${euro(totals.supplierOut)}</div><small>${totals.supplierOutRows.length} movimenti</small></div>`,
    `<div class="card inner"><strong>Uscite dipendenti</strong><div>${euro(totals.employeeOut)}</div><small>${totals.employeeOutRows.length} movimenti</small></div>`,
    `<div class="card inner"><strong>Uscite fornitori + dipendenti</strong><div>${euro(totals.totalOut)}</div></div>`,
    `<div class="card inner"><strong>Uscite cassa registrate</strong><div>${euro(totals.cashOutTotal)}</div><small>${totals.cashOutRows.length} movimenti cassa in uscita</small></div>`,
    `<div class="card inner"><strong>Uscite cassa sospette/non collegate</strong><div>${euro(totals.unlinkedCashOutTotal)}</div><small>${totals.unlinkedCashOutRows.length} da verificare</small></div>`,
    `<div class="card inner"><strong>Incasso netto - uscite cassa</strong><div>${euro(totals.incassoNetto - totals.cashOutTotal)}</div></div>`,
    ...metricCards,
    ...Object.entries(totals.cashTotals).map(([name,total]) => {
      const extra = isPosCash(name) ? `<small>lordo ${euro(totals.cashGrossTotals[name])} · commissioni ${euro(totals.cashFees[name])}</small>` : "";
      return `<div class="card inner"><strong>${escapeHtml(isPosCash(name) ? "POS netto incassato nel periodo" : cashLabel(name) + " incassati nel periodo")}</strong><div>${euro(total)}</div>${extra}</div>`;
    }),
    ...endCards,
  ].join("");
  renderReportDayRows(totals.dayRows);
}
function buildReportPrintHtml(payload) {
  if (!payload) return "";
  const rangeText = payload.range?.from || payload.range?.to ? `${formatDate(payload.range.from)} → ${formatDate(payload.range.to)}` : "Tutto l’archivio";
  const endRows = Object.entries(payload.endBreakdown || {}).map(([name,row]) => `<tr><td>${escapeHtml(cashLabel(name))}</td><td>${euro(row.iniziale)}</td><td>${euro(row.incassi)}</td><td>${euro(row.lordo)}</td><td>${euro(row.commissioni)}</td><td>${euro(row.uscite)}</td><td><strong>${euro(row.saldo)}</strong></td></tr>`).join("");
  const dayRows = (payload.dayRows || []).map(row => `<tr>
    <td>${formatDate(row.data)}</td><td>${row.coperti}</td><td>${row.copertiRistorante}</td><td>${row.menu}</td><td>${row.pizze}</td><td>${row.supplementi}</td><td>${row.portate}</td>
    <td>${euro(row.asporto)}</td><td>${euro(row.pranzoEuro)}</td><td>${euro(row.cenaEuro)}</td><td>${euro(row.banchettiEuro)}</td><td>${euro(row.bancone)}</td>
    <td>${euro(row.contanti)}</td><td>${euro(row.posLordo)}</td><td>${euro(row.posCommissioni)}</td><td>${euro(row.posNetto)}</td>
    <td>${euro(row.usciteContanti)}</td><td>${euro(row.uscitePos)}</td><td>${euro(row.saldoContanti)}</td><td>${euro(row.saldoPos)}</td>
  </tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(payload.label)}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#111;margin:24px;font-size:12px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 8px}.muted{color:#555}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.card{border:1px solid #ddd;border-radius:10px;padding:10px}.card strong{display:block}.value{font-size:18px;font-weight:700;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #ddd;padding:5px;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#f1f1f1}.page-break{page-break-before:always}@media print{@page{size:A4 landscape;margin:8mm}body{margin:0}.no-print{display:none}}
  </style></head><body>
    <button class="no-print" onclick="window.print()" style="padding:10px 14px;margin-bottom:14px">Stampa / salva PDF</button>
    <h1>${escapeHtml(payload.label || "Report")}</h1><div class="muted">Periodo: ${rangeText} · generato il ${formatDateTime(new Date().toISOString())}</div>
    <div class="grid">
      <div class="card"><strong>Giornate</strong><div class="value">${payload.records.length}</div></div>
      <div class="card"><strong>Incasso lordo</strong><div class="value">${euro(payload.incasso)}</div></div>
      <div class="card"><strong>Incasso netto</strong><div class="value">${euro(payload.incassoNetto)}</div></div>
      <div class="card"><strong>Commissioni SumUp</strong><div class="value">${euro(payload.commissioni)}</div></div>
      <div class="card"><strong>Coperti</strong><div class="value">${payload.servizioTotali.totale.coperti}</div></div>
      <div class="card"><strong>Menù</strong><div class="value">${payload.servizioTotali.totale.menu}</div></div>
      <div class="card"><strong>Pizze</strong><div class="value">${payload.servizioTotali.totale.pizze}</div></div>
      <div class="card"><strong>Portate</strong><div class="value">${payload.servizioTotali.totale.portate}</div></div>
    </div>
    <h2>Saldi casse a fine periodo</h2>
    <table><thead><tr><th>Cassa</th><th>Iniziale</th><th>Incassi netti</th><th>Lordo</th><th>Commissioni</th><th>Uscite</th><th>Saldo finale</th></tr></thead><tbody>${endRows}</tbody></table>
    <h2 class="page-break">Dettaglio giorno per giorno</h2>
    <table><thead><tr><th>Data</th><th>Cop.</th><th>Cop. rist.</th><th>Menù</th><th>Pizze</th><th>Suppl.</th><th>Portate</th><th>Asporto</th><th>Pranzo</th><th>Cena</th><th>Banchetti</th><th>Bancone</th><th>Contanti inc.</th><th>POS lordo</th><th>SumUp</th><th>POS netto</th><th>Uscite cont.</th><th>Uscite POS</th><th>Saldo cont.</th><th>Saldo POS</th></tr></thead><tbody>${dayRows}</tbody></table>
  </body></html>`;
}
function pdfCleanText(value) {
  return String(value ?? "")
    .replace(/€/g, "EUR")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function pdfMoney(value) {
  return pdfCleanText(euro(value));
}
function pdfEscape(value) {
  return pdfCleanText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function buildReportPdfDocument(payload, mode = "simple") {
  const W = 842; // A4 landscape
  const H = 595;
  const margin = 20;
  const pages = [];
  let ops = [];
  function addPage() { ops = []; pages.push(ops); }
  function py(y) { return H - y; }
  function color(hex) {
    const clean = String(hex || "#ffffff").replace("#", "");
    const r = parseInt(clean.slice(0,2), 16) / 255;
    const g = parseInt(clean.slice(2,4), 16) / 255;
    const b = parseInt(clean.slice(4,6), 16) / 255;
    return [r,g,b].map(v => Number.isFinite(v) ? v.toFixed(3) : "0").join(" ");
  }
  function fillRect(x, y, w, h, hex) {
    ops.push(`${color(hex)} rg ${x.toFixed(2)} ${py(y + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 0 0 rg`);
  }
  function line(x1, y1, x2, y2, hex = "#d4d4d8") {
    ops.push(`${color(hex)} RG ${x1.toFixed(2)} ${py(y1).toFixed(2)} m ${x2.toFixed(2)} ${py(y2).toFixed(2)} l S 0 0 0 RG`);
  }
  function text(x, y, str, size = 7, bold = false, align = "left", maxChars = 0) {
    let clean = pdfEscape(str);
    if (maxChars && clean.length > maxChars) clean = clean.slice(0, Math.max(0, maxChars - 1)) + "…";
    const approxWidth = clean.length * size * 0.46;
    const tx = align === "right" ? Math.max(margin, x - approxWidth) : x;
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${tx.toFixed(2)} ${py(y).toFixed(2)} Td (${clean}) Tj ET`);
  }
  function ensureSpace(y, needed, title) {
    if (y + needed <= H - margin) return y;
    addPage();
    let ny = margin;
    if (title) { text(margin, ny, title, 13, true); ny += 15; line(margin, ny, W - margin, ny); ny += 9; }
    return ny;
  }
  function dayBg(dateStr, idx) { return isWeekend(dateStr) ? "#fee2e2" : (idx % 2 ? "#f4f4f5" : "#ffffff"); }
  function headerFill(x, y, w, h) { fillRect(x, y, w, h, "#e5e7eb"); }
  function labelForMode() { return mode === "detailed" ? "PDF dettagliato" : "PDF semplificato"; }
  const rangeText = payload.range?.from || payload.range?.to ? `${formatDate(payload.range.from)} - ${formatDate(payload.range.to)}` : "Tutto l'archivio";

  addPage();
  let y = margin;
  text(margin, y, `${payload.label || "Report"} - ${labelForMode()}`, 17, true); y += 15;
  text(margin, y, `Periodo: ${rangeText} - generato il ${formatDateTime(new Date().toISOString())}`, 8); y += 13;
  line(margin, y, W - margin, y); y += 10;

  const summary = [
    ["Giornate", payload.records?.length || 0],
    ["Incasso lordo", pdfMoney(payload.incasso)],
    ["Incasso netto", pdfMoney(payload.incassoNetto)],
    ["Commissioni SumUp", pdfMoney(payload.commissioni)],
    ["Coperti totali", payload.servizioTotali?.totale?.coperti || 0],
    ["Menu", payload.servizioTotali?.totale?.menu || 0],
    ["Pizze", payload.servizioTotali?.totale?.pizze || 0],
    ["Portate", payload.servizioTotali?.totale?.portate || 0],
    ["Uscite fornitori", pdfMoney(payload.supplierOut)],
    ["Uscite dipendenti", pdfMoney(payload.employeeOut)],
    ["Asporto", pdfMoney(payload.asporto)],
    ["Bancone", pdfMoney(payload.bancone)],
  ];
  const cardW = (W - margin * 2 - 18) / 4;
  summary.forEach((item, idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const x = margin + col * (cardW + 6);
    const yy = y + row * 34;
    fillRect(x, yy, cardW, 28, "#f8fafc");
    line(x, yy, x + cardW, yy, "#cbd5e1"); line(x, yy + 28, x + cardW, yy + 28, "#cbd5e1");
    text(x + 5, yy + 10, item[0], 6.5, false, "left", 28);
    text(x + 5, yy + 22, item[1], 9, true, "left", 28);
  });
  y += Math.ceil(summary.length / 4) * 34 + 8;

  y = ensureSpace(y, 70, "Saldi casse a fine periodo");
  text(margin, y, "Saldi casse a fine periodo", 12, true); y += 12;
  const cashCols = [["Cassa", 90], ["Iniziale", 70], ["Incassi netti", 85], ["Lordo", 70], ["Commissioni", 70], ["Uscite", 75], ["Saldo finale", 85]];
  headerFill(margin, y - 8, cashCols.reduce((a,c)=>a+c[1],0), 13);
  let x = margin;
  cashCols.forEach(([h,w], i) => { text(i === 0 ? x + 2 : x + w - 3, y, h, 6.5, true, i === 0 ? "left" : "right"); x += w; });
  y += 8; line(margin, y, W - margin, y); y += 7;
  Object.entries(payload.endBreakdown || {}).forEach(([name,row], idx) => {
    y = ensureSpace(y, 11, "Saldi casse a fine periodo");
    fillRect(margin, y - 7, cashCols.reduce((a,c)=>a+c[1],0), 11, idx % 2 ? "#f4f4f5" : "#ffffff");
    let cx = margin;
    const vals = [cashLabel(name), pdfMoney(row.iniziale), pdfMoney(row.incassi), pdfMoney(row.lordo), pdfMoney(row.commissioni), pdfMoney(row.uscite), pdfMoney(row.saldo)];
    cashCols.forEach(([_,w], i) => { text(i === 0 ? cx + 2 : cx + w - 3, y, vals[i], 6.5, i === 6, i === 0 ? "left" : "right", i === 0 ? 18 : 14); cx += w; });
    y += 10;
  });
  y += 6;

  if (mode === "detailed") {
    y = ensureSpace(y, 32, "Dettaglio giornaliero completo");
    text(margin, y, "Dettaglio giornaliero completo", 12, true); y += 14;
    const serviceCols = [
      ["Servizio", 70], ["Cop.", 26], ["Contanti", 54], ["POS lordo", 56], ["SumUp", 42], ["POS netto", 54],
      ["Asporto", 52], ["Servizio EUR", 58], ["Bancone", 48], ["Pizze", 30], ["Cop.rist", 38], ["Menu", 30], ["Suppl.", 32], ["Portate", 34]
    ];
    const tableW = serviceCols.reduce((a,c)=>a+c[1],0);
    function renderServiceHeader() {
      headerFill(margin, y - 8, tableW, 13);
      let hx = margin;
      serviceCols.forEach(([h,w], i) => { text(i === 0 ? hx + 2 : hx + w - 2, y, h, 5.8, true, i === 0 ? "left" : "right", 12); hx += w; });
      y += 8; line(margin, y, margin + tableW, y); y += 7;
    }
    function renderServiceRow(label, svc, idx, bg) {
      const posLordo = n(svc.pos);
      const fee = sumupFee(posLordo);
      const posNetto = Math.max(0, posLordo - fee);
      fillRect(margin, y - 7, tableW, 11, bg || (idx % 2 ? "#f4f4f5" : "#ffffff"));
      let sx = margin;
      const vals = [label, n(svc.coperti), pdfMoney(svc.contanti), pdfMoney(posLordo), pdfMoney(fee), pdfMoney(posNetto), pdfMoney(svc.asporto), pdfMoney(svc.servizio), pdfMoney(svc.bancone), n(svc.pizze), n(svc.copertiRistorante), n(svc.menu), n(svc.supplementi), n(svc.portate)];
      serviceCols.forEach(([_,w], i) => { text(i === 0 ? sx + 2 : sx + w - 2, y, vals[i], 5.8, false, i === 0 ? "left" : "right", i === 0 ? 18 : 12); sx += w; });
      y += 10;
    }
    (payload.records || []).sort((a,b)=>String(a.data||"").localeCompare(String(b.data||""))).forEach((rec, dayIdx) => {
      const row = (payload.dayRows || []).find(r => r.data === rec.data) || {};
      y = ensureSpace(y, 64, "Dettaglio giornaliero completo");
      const bg = dayBg(rec.data, dayIdx);
      fillRect(margin, y - 8, W - margin * 2, 18, bg);
      text(margin + 4, y + 3, `${formatDate(rec.data)}${isWeekend(rec.data) ? "  (sabato/domenica)" : ""}`, 9, true);
      text(W - margin - 4, y + 3, `Fornitori ${pdfMoney(row.usciteFornitori)} · Dipendenti ${pdfMoney(row.usciteDipendenti)} · Saldo cont. ${pdfMoney(row.saldoContanti)} · Saldo POS ${pdfMoney(row.saldoPos)}`, 7, true, "right", 95);
      y += 18;
      renderServiceHeader();
      renderServiceRow("Pranzo", getService(rec, "pranzo"), 0, "#ffffff");
      renderServiceRow("Cena", getService(rec, "cena"), 1, "#f8fafc");
      const banchetti = (getBanchettiList(rec) || []).filter(b => SERVICE_NUMBER_FIELDS.some(f => n(b?.[f]) !== 0) || String(b?.nome || "").trim().replace(/^Banchetto\s*\d+$/i, ""));
      if (banchetti.length) banchetti.forEach((b, idx) => renderServiceRow(b.nome || `Banchetto ${idx + 1}`, b, idx + 2, idx % 2 ? "#fff7ed" : "#fffbeb"));
      y += 4;
    });
  } else {
    y = ensureSpace(y, 40, "Report semplificato giorno per giorno");
    text(margin, y, "Report semplificato giorno per giorno", 12, true); y += 14;
    const dayCols = [
      ["Data", 52], ["Cop.P+C", 36], ["Contanti", 58], ["POS lordo", 58], ["POS netto", 58], ["Banchetti", 42], ["Cop.banq", 42],
      ["Fornitori", 58], ["Dipendenti", 58], ["Saldo cont.", 70], ["Saldo POS", 70]
    ];
    const tableW = dayCols.reduce((a,c)=>a+c[1],0);
    function renderDayHeader() {
      headerFill(margin, y - 8, tableW, 13);
      let hx = margin;
      dayCols.forEach(([h,w], i) => { text(i === 0 ? hx + 2 : hx + w - 3, y, h, 6.2, true, i === 0 ? "left" : "right", 12); hx += w; });
      y += 8; line(margin, y, margin + tableW, y); y += 7;
    }
    renderDayHeader();
    (payload.dayRows || []).forEach((row, idx) => {
      if (y + 12 > H - margin) { addPage(); y = margin; text(margin, y, "Report semplificato giorno per giorno", 12, true); y += 14; renderDayHeader(); }
      fillRect(margin, y - 7, tableW, 11, dayBg(row.data, idx));
      let dx = margin;
      const vals = [formatDate(row.data), row.copertiPranzoCena, pdfMoney(row.contanti), pdfMoney(row.posLordo), pdfMoney(row.posNetto), row.banchettiCount, row.banchettiCoperti, pdfMoney(row.usciteFornitori), pdfMoney(row.usciteDipendenti), pdfMoney(row.saldoContanti), pdfMoney(row.saldoPos)];
      dayCols.forEach(([_,w], i) => { text(i === 0 ? dx + 2 : dx + w - 3, y, vals[i], 6.2, false, i === 0 ? "left" : "right", i === 0 ? 11 : 12); dx += w; });
      y += 10;
    });
  }

  const objects = [];
  function addObj(content) { objects.push(content); return objects.length; }
  addObj("<< /Type /Catalog /Pages 2 0 R >>");
  addObj("PAGES_PLACEHOLDER");
  addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds = [];
  pages.forEach(pageOps => {
    const content = pageOps.join("\n");
    const contentId = addObj(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageId = addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return pdf;
}
function downloadReportPdf(payload, mode = "simple") {
  const pdf = buildReportPdfDocument(payload, mode);
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const base = pdfCleanText(payload.label || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
  a.href = url;
  a.download = `${base}-${mode === "detailed" ? "dettagliato" : "semplificato"}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function exportCurrentReportPdf(mode = "simple") {
  if (!lastReportPayload) {
    showGlobalMessage("Genera prima un report.", "error");
    return;
  }
  try {
    downloadReportPdf(lastReportPayload, mode);
    showGlobalMessage(mode === "detailed" ? "PDF dettagliato scaricato." : "PDF semplificato scaricato.", "ok");
  } catch (err) {
    console.error(err);
    showGlobalMessage("Non sono riuscito a creare il PDF. Prova a rigenerare il report e riprovare.", "error");
  }
}
function runMonthlyReport() {
  const month = String($("reportMonth").value).padStart(2,"0");
  const year = String($("reportYear").value);
  const prefix = `${year}-${month}`;
  const to = `${prefix}-${String(lastDayOfMonth(year, Number(month))).padStart(2,"0")}`;
  const records = state.dailyRecords.filter(r => r.data.startsWith(prefix));
  renderReportFromRecords(records, `Report ${month}/${year}`, { from: `${prefix}-01`, to });
}
function runPeriodReport() {
  const from = safeEl("reportFromDate")?.value || "";
  const to = safeEl("reportToDate")?.value || "";
  let records;
  let label;
  let range;
  if (from && !to) { range = reportDateRange(from, ""); records = recordsInRange(from, ""); label = `Dal ${formatDate(from)} all’ultimo dato`; }
  else if (!from && to) { range = reportDateRange("", to); records = recordsInRange("", to); label = `Dall’inizio al ${formatDate(to)}`; }
  else if (from && to) { range = reportDateRange(from, to); records = recordsInRange(from, to); label = from === to ? `Giorno ${formatDate(from)}` : `${formatDate(from)} → ${formatDate(to)}`; }
  else { range = reportDateRange("", ""); records = recordsInRange("", ""); label = "Tutto l’archivio"; }
  renderReportFromRecords(records, label, range);
}
function renderAll() {
  if (safeEl("navDitteBtn")) $("navDitteBtn").classList.toggle("hidden", !isSupervisor());
  renderDashboard();
  renderDailyTable();
  renderCash();
  renderSuppliers();
  renderEmployees();
  renderBookings();
  renderCompaniesAdmin();
  runMonthlyReport();
}

function bindEvents() {
  document.querySelectorAll(".nav-btn[data-section]").forEach(btn => btn.addEventListener("click", ()=>navigate(btn.dataset.section)));
  document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", ()=>setAuthTab(btn.dataset.authTab)));
  safeEl("loginBtn")?.addEventListener("click", login);
  safeEl("rememberEmailChk")?.addEventListener("change", saveRememberedEmail);
  safeEl("loginEmail")?.addEventListener("input", () => { if (safeEl("rememberEmailChk")?.checked) saveRememberedEmail(); });
  safeEl("rememberEmailChk")?.addEventListener("change", saveRememberedEmail);
  safeEl("loginEmail")?.addEventListener("input", () => { if (safeEl("rememberEmailChk")?.checked) saveRememberedEmail(); });
  safeEl("registerBtn")?.addEventListener("click", register);
  safeEl("logoutBtn")?.addEventListener("click", logout);
  safeEl("selectorLogoutBtn")?.addEventListener("click", logout);
  safeEl("enterCompanyBtn")?.addEventListener("click", async ()=>{ if(!selectedCompanyId) return alert("Seleziona una ditta."); await openCompany(selectedCompanyId); });
  safeEl("switchCompanyBtn")?.addEventListener("click", ()=>{ if(isSupervisor() || state.memberships.length > 1) renderCompanySelector(); });
  safeEl("saveDayBtn")?.addEventListener("click", saveDaily);
  safeEl("gData")?.addEventListener("change", reloadDailyFormForSelectedDate);
  safeEl("saveCashInitBtn")?.addEventListener("click", saveCashInitial);
  safeEl("saveNewCashBtn")?.addEventListener("click", saveNewCash);
  safeEl("saveMovBtn")?.addEventListener("click", saveCashMovement);
  safeEl("saveFornBtn")?.addEventListener("click", saveSupplier);
  safeEl("cancelFornEditBtn")?.addEventListener("click", resetSupplierForm);
  safeEl("saveFornMovBtn")?.addEventListener("click", saveSupplierMovement);
  safeEl("saveSupplierDetailMovBtn")?.addEventListener("click", saveSupplierDetailMovement);
  safeEl("cancelSupplierDetailEditBtn")?.addEventListener("click", () => resetSupplierDetailMovementForm());
  safeEl("saveDipBtn")?.addEventListener("click", saveEmployee);
  safeEl("cancelDipEditBtn")?.addEventListener("click", resetEmployeeForm);
  safeEl("saveDipMovBtn")?.addEventListener("click", saveEmployeeMovement);
  safeEl("saveEmployeeDetailMovBtn")?.addEventListener("click", saveEmployeeDetailMovement);
  safeEl("cancelEmployeeDetailEditBtn")?.addEventListener("click", () => resetEmployeeDetailMovementForm());
  safeEl("saveBanBtn")?.addEventListener("click", saveBooking);
  safeEl("runReportBtn")?.addEventListener("click", runMonthlyReport);
  safeEl("runPeriodReportBtn")?.addEventListener("click", runPeriodReport);
  safeEl("exportReportPdfBtn")?.addEventListener("click", () => exportCurrentReportPdf("simple"));
  safeEl("exportReportPdfSimpleBtn")?.addEventListener("click", () => exportCurrentReportPdf("simple"));
  safeEl("exportReportPdfDetailedBtn")?.addEventListener("click", () => exportCurrentReportPdf("detailed"));
  safeEl("addBanchettoRowBtn")?.addEventListener("click", ()=>{ addBanchettoRow({}); updateDailyCashAuto(); });
  safeEl("giornaliera")?.addEventListener("input", () => updateDailyCashAuto());
  safeEl("addDailySupplierPaymentBtn")?.addEventListener("click", ()=>addDailySupplierPaymentRow({}));
  safeEl("addDailyEmployeePaymentBtn")?.addEventListener("click", ()=>addDailyEmployeePaymentRow({}));
  setupGlobalSearchInputs();
  safeEl("supplierDetailMonth")?.addEventListener("change", renderSupplierDetail);
  safeEl("employeeDetailMonth")?.addEventListener("change", renderEmployeeDetail);
  safeEl("refreshBtn")?.addEventListener("click", ()=>refreshData("Dati aggiornati dal cloud."));
  safeEl("exportDiagnosticsBtn")?.addEventListener("click", exportDiagnostics);
  safeEl("cleanupSafeBtn")?.addEventListener("click", cleanupSafeDuplicates);
  safeEl("runCloudSyncBtn")?.addEventListener("click", () => runCloudUiSyncCheck(false));
  safeEl("forceCloudReloadBtn")?.addEventListener("click", forceReloadFromSupabase);
  safeEl("renderDailyCashAuditBtn")?.addEventListener("click", renderDailyCashAudit);
  safeEl("recalculateDailyCashBtn")?.addEventListener("click", recalculateDailyCashFromServices);
  safeEl("backupBtn")?.addEventListener("click", exportBackup);
  safeEl("importBackupBtn")?.addEventListener("click", () => safeEl("importFile")?.click());
  safeEl("importFile")?.addEventListener("change", (e)=>e.target.files[0] && importBackup(e.target.files[0]));
  safeEl("closeAlertModalBtn")?.addEventListener("click", closeAlertModal);
  safeEl("editAlertDayBtn")?.addEventListener("click", editSelectedAlertDay);
  safeEl("closeConfirmSaveModalBtn")?.addEventListener("click", closeConfirmSaveModal);
  safeEl("reviewDayBtn")?.addEventListener("click", closeConfirmSaveModal);
  safeEl("forceSaveDayBtn")?.addEventListener("click", forceSavePendingDay);
  safeEl("cardFornitori")?.addEventListener("click", ()=>navigate("fornitori"));
  safeEl("cardCoperti")?.addEventListener("click", ()=>navigate("giornaliera"));
  safeEl("cardIncasso")?.addEventListener("click", ()=>navigate("giornaliera"));
  safeEl("cardAlert")?.addEventListener("click", ()=>{ navigate("dashboard"); const first=document.querySelector(".alert-row"); if(first) first.scrollIntoView({behavior:"smooth",block:"center"}); });
}

async function main() {
  try {
    bindEvents();
    seedFields();
    loadRememberedEmail();
    loadRememberedEmail();
    window.setInterval(() => {
      if (!safeEl("appView")?.classList.contains("hidden")) renderLiveChecks();
    }, 15000);
    window.setInterval(() => {
      if (!safeEl("appView")?.classList.contains("hidden")) runCloudUiSyncCheck(true);
    }, 60000);
    const ok = await initSupabase();
    if (!ok) return;
    supabase.auth.onAuthStateChange(async (_event, session)=>{ state.session = session; });
    if (state.session) await bootstrapAfterAuth();
    else { hideAllViews(); safeEl("authView")?.classList.remove("hidden"); }
  } catch (err) {
    console.error("Errore main:", err);
    hideAllViews();
    safeEl("authView")?.classList.remove("hidden");
    showAuthMessage("Errore avvio app: " + (err?.message || err), true);
  }
}
main();
