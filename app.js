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
  if (contantiInput) contantiInput.value = auto.contanti;
  if (posInput) posInput.value = auto.pos;
}
function renderDailyCashInputs(rec = null) {
  const box = safeEl("dailyCashInputs");
  if (!box) return;
  const currentValues = {};
  box.querySelectorAll("input[data-daily-cash]").forEach(input => currentValues[input.dataset.dailyCash] = input.value);
  const auto = rec ? autoCashFromRecord(rec) : calculateDailyCashAutoFromForm();
  box.innerHTML = cashNames().map(name => {
    let value = currentValues[name] ?? 0;
    let readonly = "";
    let note = "";
    if (name === "contanti") { value = auto.contanti; readonly = "readonly"; note = `<small class="muted">Calcolato automaticamente dai servizi.</small>`; }
    else if (name === "pos") { value = auto.pos; readonly = "readonly"; note = `<small class="muted">POS lordo calcolato automaticamente. SumUp -0,95% nel saldo cassa.</small>`; }
    else if (rec?.casse && Object.prototype.hasOwnProperty.call(rec.casse, name)) value = n(rec.casse[name]);
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
function addDailySupplierPaymentRow(row = {}) {
  const box = safeEl("dailySupplierPayments");
  if (!box) return;
  const div = document.createElement("div");
  div.className = "daily-row daily-supplier-row";
  div.innerHTML = `
    <div class="field"><label>Cerca fornitore / alias</label><input data-field="supplier_search" list="suppliersDatalist" value="${escapeHtml(supplierInputValue(row))}" placeholder="nome o alias" autocomplete="off" /><input data-field="supplier_id" type="hidden" value="${escapeHtml(row.supplier_id || "")}" /></div>
    <div class="field"><label>Nuovo fornitore</label><input data-field="new_supplier_name" value="${escapeHtml(row.new_supplier_name || "")}" placeholder="scrivi qui se non esiste" /></div>
    <div class="field"><label>Cassa</label><select data-field="cassa">${cashSelectOptions(row.cassa || "contanti")}</select></div>
    <div class="field"><label>Importo</label><input data-field="importo" type="number" step="0.01" value="${n(row.importo)}" /></div>
    <div class="field"><label>Data/ora pagamento</label><input data-field="operated_at" type="datetime-local" value="${escapeHtml(row.operated_at || "")}" /></div>
    <div class="field"><label>Nota</label><input data-field="nota" value="${escapeHtml(row.nota || "")}" placeholder="es. pagamento merce" /></div>
    <button class="secondary daily-row-remove" type="button">Rimuovi</button>`;
  div.querySelector(".daily-row-remove")?.addEventListener("click", () => div.remove());
  box.appendChild(div);
}
function addDailyEmployeePaymentRow(row = {}) {
  const box = safeEl("dailyEmployeePayments");
  if (!box) return;
  const div = document.createElement("div");
  div.className = "daily-row daily-employee-row";
  div.innerHTML = `
    <div class="field"><label>Dipendente esistente</label><select data-field="employee_id">${employeeSelectOptions(row.employee_id || "")}</select></div>
    <div class="field"><label>Nuovo dipendente</label><input data-field="new_employee_name" value="${escapeHtml(row.new_employee_name || "")}" placeholder="scrivi qui se non esiste" /></div>
    <div class="field"><label>Tipo</label><select data-field="tipo"><option value="acconto" ${(row.tipo || "acconto") === "acconto" ? "selected" : ""}>Acconto</option><option value="pagamento" ${row.tipo === "pagamento" ? "selected" : ""}>Pagamento</option><option value="extra" ${row.tipo === "extra" ? "selected" : ""}>Extra</option></select></div>
    <div class="field"><label>Cassa</label><select data-field="cassa">${cashSelectOptions(row.cassa || "contanti")}</select></div>
    <div class="field"><label>Importo</label><input data-field="importo" type="number" step="0.01" value="${n(row.importo)}" /></div>
    <div class="field"><label>Data/ora pagamento</label><input data-field="operated_at" type="datetime-local" value="${escapeHtml(row.operated_at || "")}" /></div>
    <div class="field"><label>Nota</label><input data-field="nota" value="${escapeHtml(row.nota || "")}" placeholder="es. acconto" /></div>
    <button class="secondary daily-row-remove" type="button">Rimuovi</button>`;
  div.querySelector(".daily-row-remove")?.addEventListener("click", () => div.remove());
  box.appendChild(div);
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
    return {
      supplier_id: supplier?.id || "",
      supplier_search: supplierSearch,
      new_supplier_name: row.querySelector('[data-field="new_supplier_name"]')?.value?.trim() || "",
      cassa: row.querySelector('[data-field="cassa"]')?.value || "contanti",
      importo: n(row.querySelector('[data-field="importo"]')?.value),
      operated_at: cleanDateTimeLocal(row.querySelector('[data-field="operated_at"]')?.value),
      nota: row.querySelector('[data-field="nota"]')?.value?.trim() || "",
    };
  }).filter(row => (row.supplier_id || row.new_supplier_name) && row.importo > 0);
}
function collectDailyEmployeePayments() {
  return Array.from(safeEl("dailyEmployeePayments")?.querySelectorAll(".daily-employee-row") || []).map(row => ({
    employee_id: row.querySelector('[data-field="employee_id"]')?.value || "",
    new_employee_name: row.querySelector('[data-field="new_employee_name"]')?.value?.trim() || "",
    tipo: row.querySelector('[data-field="tipo"]')?.value || "acconto",
    cassa: row.querySelector('[data-field="cassa"]')?.value || "contanti",
    importo: n(row.querySelector('[data-field="importo"]')?.value),
    operated_at: cleanDateTimeLocal(row.querySelector('[data-field="operated_at"]')?.value),
    nota: row.querySelector('[data-field="nota"]')?.value?.trim() || "",
  })).filter(row => (row.employee_id || row.new_employee_name) && row.importo > 0);
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
  Object.entries(map).forEach(([suffix, field]) => { if (safeEl(prefix + suffix)) safeEl(prefix + suffix).value = s[field] ?? 0; });
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
      <div class="field"><label>Coperti</label><input data-field="coperti" type="number" value="${s.coperti}" /></div>
      <div class="field"><label>Contanti</label><input data-field="contanti" type="number" step="0.01" value="${s.contanti}" /></div>
      <div class="field"><label>POS lordo</label><input data-field="pos" type="number" step="0.01" value="${s.pos}" /></div>
      <div class="field"><label>Asporto €</label><input data-field="asporto" type="number" step="0.01" value="${s.asporto}" /></div>
      <div class="field"><label>Banchetti €</label><input data-field="servizio" type="number" step="0.01" value="${s.servizio}" /></div>
      <div class="field"><label>Bancone €</label><input data-field="bancone" type="number" step="0.01" value="${s.bancone}" /></div>
      <div class="field"><label>Pizze totali</label><input data-field="pizze" type="number" value="${s.pizze}" /></div>
      <div class="field"><label>Coperti ristorante</label><input data-field="copertiRistorante" type="number" value="${s.copertiRistorante}" /></div>
      <div class="field"><label>Menù</label><input data-field="menu" type="number" value="${s.menu}" /></div>
      <div class="field"><label>Supplementi</label><input data-field="supplementi" type="number" value="${s.supplementi}" /></div>
      <div class="field"><label>Portate</label><input data-field="portate" type="number" value="${s.portate}" /></div>
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
  renderDailySupplierPayments(rec.supplierPayments || []);
  renderDailyEmployeePayments(rec.employeePayments || []);
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
function computeCashBreakdown() {
  const out = {};
  cashNames().forEach(name => {
    out[name] = emptyCashBreakdownRow();
  });

  Object.entries(state.cashInitial || {}).forEach(([name, amount]) => {
    if (!out[name]) out[name] = emptyCashBreakdownRow();
    out[name].iniziale += n(amount);
  });
  (state.customCashes || []).forEach(c => {
    if (!out[c.name]) out[c.name] = emptyCashBreakdownRow();
    out[c.name].iniziale += n(c.amount);
  });
  state.dailyRecords.forEach(rec => {
    cashNames().forEach(name => {
      if (!out[name]) out[name] = emptyCashBreakdownRow();
      const gross = getDailyCashAmount(rec, name);
      const fee = getDailyCashFeeAmount(rec, name);
      const net = getDailyCashNetAmount(rec, name);
      out[name].lordo += gross;
      out[name].commissioni += fee;
      out[name].incassi += net;
    });
  });
  state.cashMovements.forEach(m => {
    const name = m.cassa || "contanti";
    if (!out[name]) out[name] = emptyCashBreakdownRow();
    if (m.tipo === "entrata") out[name].entrate += n(m.importo);
    else out[name].uscite += n(m.importo);
  });
  Object.values(out).forEach(row => {
    row.saldo = n(row.iniziale) + n(row.incassi) + n(row.entrate) - n(row.uscite);
  });
  return out;
}
function computeCashBalances() {
  const breakdown = computeCashBreakdown();
  return Object.fromEntries(Object.entries(breakdown).map(([name,row]) => [name, row.saldo]));
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
  cash_state.forEach(r => { state.cashInitial[r.kind] = n(r.amount); });
}
async function refreshData(message=null) {
  try {
    if (isSupervisor()) await refreshCompaniesAdmin();
    await loadCompanyData();
    renderAll();
    if (message) showGlobalMessage(message);
  } catch (err) {
    console.error(err);
    showGlobalMessage(err.message || "Errore caricamento dati", "error");
  }
}

async function upsertCashState(kind, amount) {
  const { error } = await supabase.from("cash_state").upsert({ company_id: state.activeCompany.id, kind, amount }, { onConflict: "company_id,kind" });
  if (error) throw error;
}
async function saveCashInitial() {
  try {
    await Promise.all([
      upsertCashState("contanti", n(safeEl("cashInitContanti")?.value)),
      upsertCashState("pos", n(safeEl("cashInitPos")?.value)),
    ]);
    await refreshData("Saldi iniziali salvati.");
  } catch (err) {
    showGlobalMessage(err.message, "error");
  }
}
async function saveNewCash() {
  const name = safeEl("newCashName")?.value?.trim();
  const amount = n(safeEl("newCashAmount")?.value);
  if (!name) return showGlobalMessage("Inserisci il nome della cassa.", "error");
  const { error } = await supabase.from("custom_cash_state").upsert({ company_id: state.activeCompany.id, name, amount }, { onConflict: "company_id,name" });
  if (error) return showGlobalMessage(error.message, "error");
  $("newCashName").value = ""; $("newCashAmount").value = 0;
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
  if (safeEl("movImporto")) $("movImporto").value = 0;
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
    data: dateFromDateTimeOrDate(safeEl("movOperatedAt")?.value, $("movData").value),
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
  const name = String(row.new_supplier_name || "").trim();
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
  const name = String(row.new_employee_name || "").trim();
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
  for (const p of (rec.supplierPayments || []).filter(p => (p.supplier_id || p.new_supplier_name) && n(p.importo) > 0)) {
    const supplier = await getOrCreateSupplierFromDaily(p);
    if (supplier) supplierRows.push({ ...p, supplier_id: supplier.id, supplier_name: supplier.nome });
  }

  const employeeRows = [];
  for (const p of (rec.employeePayments || []).filter(p => (p.employee_id || p.new_employee_name) && n(p.importo) > 0)) {
    const employee = await getOrCreateEmployeeFromDaily(p);
    if (employee) employeeRows.push({ ...p, employee_id: employee.id, employee_name: employee.nome });
  }

  rec.supplierPayments = supplierRows;
  rec.employeePayments = employeeRows;

  if (supplierRows.length) {
    const supplierMovements = supplierRows.map(p => ({
      company_id: state.activeCompany.id,
      supplier_id: p.supplier_id,
      data: dateFromDateTimeOrDate(p.operated_at, rec.data),
      tipo: "pagamento",
      importo: n(p.importo),
      operated_at: cleanDateTimeLocal(p.operated_at),
      saved_at: new Date().toISOString(),
      nota: `${prefix} ${p.cassa || "contanti"}${p.nota ? " · " + p.nota : ""}`,
    }));
    const { error } = await supabase.from("supplier_movements").insert(supplierMovements);
    if (error) throw error;

    const cashMovements = supplierRows.map(p => ({
      company_id: state.activeCompany.id,
      data: dateFromDateTimeOrDate(p.operated_at, rec.data),
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

  if (employeeRows.length) {
    const employeeMovements = employeeRows.map(p => ({
      company_id: state.activeCompany.id,
      employee_id: p.employee_id,
      data: dateFromDateTimeOrDate(p.operated_at, rec.data),
      tipo: p.tipo || "acconto",
      importo: n(p.importo),
      operated_at: cleanDateTimeLocal(p.operated_at),
      saved_at: new Date().toISOString(),
      nota: `${prefix} ${p.cassa || "contanti"}${p.nota ? " · " + p.nota : ""}`,
    }));
    const { error } = await supabase.from("employee_movements").insert(employeeMovements);
    if (error) throw error;

    const cashMovements = employeeRows.map(p => ({
      company_id: state.activeCompany.id,
      data: dateFromDateTimeOrDate(p.operated_at, rec.data),
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
  if (!confirm(`Vuoi davvero cancellare la giornata ${dateStr}? Verranno rimossi anche i pagamenti automatici collegati a questa scheda.`)) return;
  try {
    await clearAutoLinkedMovementsForDate(dateStr);
    const { error } = await supabase.from("daily_records").delete().eq("company_id", state.activeCompany.id).eq("data", dateStr);
    if (error) throw error;
    await refreshData("Giornata cancellata.");
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
  $("fornNome").value = ""; $("fornAlias").value = ""; $("fornSospeso").value = 0;
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
async function deleteSupplierByName(name) {
  const s = state.suppliers.find(x => x.nome === name);
  if (!s) return;
  if (!confirm(`Vuoi davvero eliminare il fornitore "${name}"?`)) return;
  const delMoves = await supabase.from("supplier_movements").delete().eq("company_id", state.activeCompany.id).eq("supplier_id", s.id);
  if (delMoves.error) return showGlobalMessage(delMoves.error.message, "error");
  const delSupp = await supabase.from("suppliers").delete().eq("company_id", state.activeCompany.id).eq("id", s.id);
  if (delSupp.error) return showGlobalMessage(delSupp.error.message, "error");
  resetSupplierForm();
  await refreshData("Fornitore eliminato.");
}
async function saveSupplierMovement() {
  const supplierSearch = safeEl("fornMovSearch")?.value || safeEl("fornMovNome")?.value || "";
  const supplier = findSupplierByNameOrAlias(supplierSearch);
  const payload = {
    supplierId: supplier?.id,
    data: dateFromDateTimeOrDate(safeEl("fornMovOperatedAt")?.value, $("fornMovData").value),
    operated_at: cleanDateTimeLocal(safeEl("fornMovOperatedAt")?.value),
    tipo: $("fornMovTipo").value,
    cassa: safeEl("fornMovCassa")?.value || "contanti",
    importo: n($("fornMovImporto").value),
    nota: $("fornMovNota").value.trim(),
  };
  if (!payload.supplierId || !payload.data || payload.importo <= 0) return showGlobalMessage("Controlla fornitore, data e importo.", "error");
  try {
    await insertSupplierMovement(payload);
    if (safeEl("fornMovImporto")) $("fornMovImporto").value = 0;
    if (safeEl("fornMovOperatedAt")) $("fornMovOperatedAt").value = "";
    if (safeEl("fornMovNota")) $("fornMovNota").value = "";
    await refreshData("Movimento fornitore salvato e cassa aggiornata.");
  } catch (err) {
    showGlobalMessage(err.message || String(err), "error");
  }
}
async function saveSupplierDetailMovement() {
  if (!selectedSupplierDetailId) return showGlobalMessage("Apri prima la scheda di un fornitore.", "error");
  const payload = {
    supplierId: selectedSupplierDetailId,
    data: dateFromDateTimeOrDate(safeEl("supplierDetailOperatedAt")?.value, safeEl("supplierDetailData")?.value || todayStr()),
    operated_at: cleanDateTimeLocal(safeEl("supplierDetailOperatedAt")?.value),
    tipo: safeEl("supplierDetailTipo")?.value || "pagamento",
    cassa: safeEl("supplierDetailCassa")?.value || "contanti",
    importo: n(safeEl("supplierDetailImporto")?.value),
    nota: safeEl("supplierDetailNota")?.value?.trim() || "",
  };
  if (!payload.data || payload.importo <= 0) return showGlobalMessage("Inserisci data e importo.", "error");
  try {
    await insertSupplierMovement(payload);
    if (safeEl("supplierDetailImporto")) $("supplierDetailImporto").value = 0;
    if (safeEl("supplierDetailOperatedAt")) $("supplierDetailOperatedAt").value = "";
    if (safeEl("supplierDetailNota")) $("supplierDetailNota").value = "";
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
  $("dipNome").value = ""; $("dipRuolo").value = ""; $("dipDovuto").value = 0;
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
async function deleteEmployeeByName(name) {
  const e = state.employees.find(x => x.nome === name);
  if (!e) return;
  if (!confirm(`Vuoi davvero eliminare il dipendente "${name}"?`)) return;
  const delMoves = await supabase.from("employee_movements").delete().eq("company_id", state.activeCompany.id).eq("employee_id", e.id);
  if (delMoves.error) return showGlobalMessage(delMoves.error.message, "error");
  const delEmp = await supabase.from("employees").delete().eq("company_id", state.activeCompany.id).eq("id", e.id);
  if (delEmp.error) return showGlobalMessage(delEmp.error.message, "error");
  resetEmployeeForm();
  await refreshData("Dipendente eliminato.");
}
async function saveEmployeeMovement() {
  const employee = state.employees.find(e => e.nome === $("dipMovNome").value);
  const payload = {
    employeeId: employee?.id,
    data: dateFromDateTimeOrDate(safeEl("dipMovOperatedAt")?.value, $("dipMovData").value),
    operated_at: cleanDateTimeLocal(safeEl("dipMovOperatedAt")?.value),
    tipo: $("dipMovTipo").value,
    cassa: safeEl("dipMovCassa")?.value || "contanti",
    importo: n($("dipMovImporto").value),
    nota: $("dipMovNota").value.trim(),
  };
  if (!payload.employeeId || !payload.data || payload.importo <= 0) return showGlobalMessage("Controlla dipendente, data e importo.", "error");
  try {
    await insertEmployeeMovement(payload);
    if (safeEl("dipMovImporto")) $("dipMovImporto").value = 0;
    if (safeEl("dipMovOperatedAt")) $("dipMovOperatedAt").value = "";
    if (safeEl("dipMovNota")) $("dipMovNota").value = "";
    await refreshData("Movimento dipendente salvato e cassa aggiornata.");
  } catch (err) {
    showGlobalMessage(err.message || String(err), "error");
  }
}
async function saveEmployeeDetailMovement() {
  if (!selectedEmployeeDetailId) return showGlobalMessage("Apri prima la scheda di un dipendente.", "error");
  const payload = {
    employeeId: selectedEmployeeDetailId,
    data: dateFromDateTimeOrDate(safeEl("employeeDetailOperatedAt")?.value, safeEl("employeeDetailData")?.value || todayStr()),
    operated_at: cleanDateTimeLocal(safeEl("employeeDetailOperatedAt")?.value),
    tipo: safeEl("employeeDetailTipo")?.value || "acconto",
    cassa: safeEl("employeeDetailCassa")?.value || "contanti",
    importo: n(safeEl("employeeDetailImporto")?.value),
    nota: safeEl("employeeDetailNota")?.value?.trim() || "",
  };
  if (!payload.data || payload.importo <= 0) return showGlobalMessage("Inserisci data e importo.", "error");
  try {
    await insertEmployeeMovement(payload);
    if (safeEl("employeeDetailImporto")) $("employeeDetailImporto").value = 0;
    if (safeEl("employeeDetailOperatedAt")) $("employeeDetailOperatedAt").value = "";
    if (safeEl("employeeDetailNota")) $("employeeDetailNota").value = "";
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
  $("banNome").value = ""; $("banAdulti").value = 0; $("banBambini").value = 0; $("banTipo").value = "ristorante"; $("banImporto").value = 0; $("banOra").value = ""; $("banNote").value = "";
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
    dailyRecords: state.dailyRecords, cashInitial: state.cashInitial, customCashes: state.customCashes,
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
      await supabase.from("cash_state").upsert({ company_id: state.activeCompany.id, kind, amount }, { onConflict: "company_id,kind" });
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
      const detail = isPosCash(k)
        ? `iniziale ${euro(row.iniziale)} · incassi netti ${euro(row.incassi)} · POS lordo ${euro(row.lordo)} · commissioni SumUp ${euro(row.commissioni)} · entrate ${euro(row.entrate)} · uscite ${euro(row.uscite)}`
        : `iniziale ${euro(row.iniziale)} · incassi ${euro(row.incassi)} · entrate ${euro(row.entrate)} · uscite ${euro(row.uscite)}`;
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
}

function renderDailyTable() {
  const tbody = safeEl("giorniTable");
  if (!tbody) return;
  tbody.innerHTML = state.dailyRecords.map(r=>{
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
        <button class="btn ghost day-delete-btn" data-day-date="${r.data}">Cancella</button>
      </td>
    </tr>`;
  }).join("");
  document.querySelectorAll(".day-alert-btn").forEach(btn => btn.addEventListener("click", ()=>openAlertModalByDate(btn.dataset.alertDate)));
  document.querySelectorAll(".day-edit-btn").forEach(btn => btn.addEventListener("click", ()=>loadDailyByDate(btn.dataset.dayDate)));
  document.querySelectorAll(".day-delete-btn").forEach(btn => btn.addEventListener("click", ()=>deleteDailyByDate(btn.dataset.dayDate)));
}
function renderCash() {
  if (safeEl("cashInitContanti")) $("cashInitContanti").value = state.cashInitial.contanti || 0;
  if (safeEl("cashInitPos")) $("cashInitPos").value = state.cashInitial.pos || 0;
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
  const allMoves = state.supplierMovements.filter(m => m.supplier_id === s.id).sort((a,b)=>String(a.data).localeCompare(String(b.data)));
  const moves = allMoves.filter(m => monthMatches(m.data, month));
  const daPagare = allMoves.filter(m => !isSupplierPaymentType(m.tipo)).reduce((a,b)=>a+n(b.importo),0);
  const pagamenti = allMoves.filter(m => isSupplierPaymentType(m.tipo)).reduce((a,b)=>a+n(b.importo),0);
  if (safeEl("supplierDetailTitle")) $("supplierDetailTitle").textContent = `Scheda fornitore · ${s.nome}`;
  if (safeEl("supplierDetailSubtitle")) $("supplierDetailSubtitle").textContent = month ? `Movimenti del mese ${month}` : "Calendario completo movimenti";
  if (safeEl("supplierDetailData") && !$("supplierDetailData").value) $("supplierDetailData").value = todayStr();
  fillCashSelect("supplierDetailCassa", safeEl("supplierDetailCassa")?.value || "contanti");
  if (safeEl("supplierDetailKpis")) $("supplierDetailKpis").innerHTML = [
    `<div class="card inner"><div class="muted small">Sospeso iniziale</div><div class="metric-value small">${euro(s.sospeso_iniziale)}</div></div>`,
    `<div class="card inner"><div class="muted small">Da pagare / extra</div><div class="metric-value small">${euro(daPagare)}</div></div>`,
    `<div class="card inner"><div class="muted small">Pagamenti / acconti</div><div class="metric-value small">${euro(pagamenti)}</div></div>`,
    `<div class="card inner"><div class="muted small">Scoperto attuale</div><div class="metric-value small">${euro(supplierSuspeso(s))}</div></div>`,
  ].join("");
  if (safeEl("supplierDetailTable")) $("supplierDetailTable").innerHTML = moves.map(m => `<tr><td>${m.data}</td><td>${formatOperationDateTime(m)}</td><td>${formatSavedAt(m)}</td><td>${typeLabel(m.tipo)}</td><td>${euro(m.importo)}</td><td>${escapeHtml(m.nota || "")}</td></tr>`).join("") || '<tr><td colspan="6">Nessun movimento</td></tr>';
}
function renderEmployees() {
  if (safeEl("dipMovNome")) $("dipMovNome").innerHTML = state.employees.map(e => `<option value="${e.nome}">${escapeHtml(e.nome)}</option>`).join("");
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
  if (safeEl("employeeDetailMonth") && !$("employeeDetailMonth").value) $("employeeDetailMonth").value = getCurrentMonthPrefix();
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
  const month = safeEl("employeeDetailMonth")?.value || getCurrentMonthPrefix();
  const allMoves = state.employeeMovements.filter(m => m.employee_id === e.id).sort((a,b)=>String(a.data).localeCompare(String(b.data)));
  const moves = allMoves.filter(m => monthMatches(m.data, month));
  const status = employeeMonthStatus(e, month);
  const paidAll = employeePaid(e, "");
  if (safeEl("employeeDetailTitle")) $("employeeDetailTitle").textContent = `Scheda dipendente · ${e.nome}`;
  if (safeEl("employeeDetailSubtitle")) $("employeeDetailSubtitle").textContent = `Mese ${month} · calendario pagamenti/acconti`;
  if (safeEl("employeeDetailData") && !$("employeeDetailData").value) $("employeeDetailData").value = todayStr();
  fillCashSelect("employeeDetailCassa", safeEl("employeeDetailCassa")?.value || "contanti");
  if (safeEl("employeeDetailKpis")) $("employeeDetailKpis").innerHTML = [
    `<div class="card inner"><div class="muted small">Dovuto mese</div><div class="metric-value small">${euro(status.due)}</div></div>`,
    `<div class="card inner"><div class="muted small">Dato nel mese</div><div class="metric-value small">${euro(status.paid)}</div></div>`,
    `<div class="card inner"><div class="muted small">Manca nel mese</div><div class="metric-value small">${euro(status.residuo)}</div></div>`,
    `<div class="card inner"><div class="muted small">Dato totale storico</div><div class="metric-value small">${euro(paidAll)}</div></div>`,
  ].join("");
  if (safeEl("employeeDetailTable")) $("employeeDetailTable").innerHTML = moves.map(m => `<tr><td>${m.data}</td><td>${formatOperationDateTime(m)}</td><td>${formatSavedAt(m)}</td><td>${typeLabel(m.tipo)}</td><td>${euro(m.importo)}</td><td>${escapeHtml(m.nota || "")}</td></tr>`).join("") || '<tr><td colspan="6">Nessun movimento</td></tr>';
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
  const allDates = state.dailyRecords.map(r => r.data).filter(Boolean).sort();
  const earliest = allDates[0] || "";
  const latest = allDates[allDates.length - 1] || "";
  return { from: from || earliest, to: to || latest };
}
function recordsInRange(from, to) {
  const range = reportDateRange(from, to);
  return state.dailyRecords.filter(r => (!range.from || r.data >= range.from) && (!range.to || r.data <= range.to));
}
function renderReportFromRecords(records, label = "") {
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

  if (safeEl("rCopPranzo")) $("rCopPranzo").textContent = servizioTotali.pranzo.coperti;
  if (safeEl("rCopCena")) $("rCopCena").textContent = servizioTotali.cena.coperti;
  if (safeEl("rCopBanchetti")) $("rCopBanchetti").textContent = servizioTotali.banchetti.coperti;
  if (safeEl("rIncasso")) $("rIncasso").textContent = euro(incasso);

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

  if (safeEl("reportSummary")) $("reportSummary").innerHTML = [
    `<div class="card inner"><strong>${escapeHtml(label || "Periodo")}</strong><div>${records.length} giornate</div></div>`,
    `<div class="card inner"><strong>Coperti complessivi</strong><div>${servizioTotali.totale.coperti}</div><small>Pranzo ${servizioTotali.pranzo.coperti} · Cena ${servizioTotali.cena.coperti} · Banchetti ${servizioTotali.banchetti.coperti}</small></div>`,
    `<div class="card inner"><strong>Incasso lordo</strong><div>${euro(incasso)}</div></div>`,
    `<div class="card inner"><strong>Incasso netto dopo SumUp</strong><div>${euro(incassoNetto)}</div></div>`,
    `<div class="card inner"><strong>Commissioni SumUp POS</strong><div>${euro(commissioni)}</div></div>`,
    `<div class="card inner"><strong>Asporto totale</strong><div>${euro(asporto)}</div></div>`,
    `<div class="card inner"><strong>Pranzo €</strong><div>${euro(servizioPranzo)}</div></div>`,
    `<div class="card inner"><strong>Cena €</strong><div>${euro(servizioCena)}</div></div>`,
    `<div class="card inner"><strong>Banchetti €</strong><div>${euro(servizioBanchetti)}</div></div>`,
    `<div class="card inner"><strong>Bancone totale</strong><div>${euro(bancone)}</div></div>`,
    ...metricCards,
    ...Object.entries(cashTotals).map(([name,total]) => {
      const extra = isPosCash(name) ? `<small>lordo ${euro(cashGrossTotals[name])} · commissioni ${euro(cashFees[name])}</small>` : "";
      return `<div class="card inner"><strong>${escapeHtml(isPosCash(name) ? "POS netto" : cashLabel(name))}</strong><div>${euro(total)}</div>${extra}</div>`;
    }),
  ].join("");
}
function runMonthlyReport() {
  const month = String($("reportMonth").value).padStart(2,"0");
  const year = String($("reportYear").value);
  const records = state.dailyRecords.filter(r => r.data.startsWith(`${year}-${month}`));
  renderReportFromRecords(records, `Report ${month}/${year}`);
}
function runPeriodReport() {
  const from = safeEl("reportFromDate")?.value || "";
  const to = safeEl("reportToDate")?.value || "";
  let records;
  let label;
  if (from && !to) { records = recordsInRange(from, ""); label = `Dal ${from} all’ultimo dato`; }
  else if (!from && to) { records = recordsInRange("", to); label = `Dall’inizio al ${to}`; }
  else if (from && to) { records = recordsInRange(from, to); label = from === to ? `Giorno ${from}` : `${from} → ${to}`; }
  else { records = recordsInRange("", ""); label = "Tutto l’archivio"; }
  renderReportFromRecords(records, label);
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
  safeEl("saveCashInitBtn")?.addEventListener("click", saveCashInitial);
  safeEl("saveNewCashBtn")?.addEventListener("click", saveNewCash);
  safeEl("saveMovBtn")?.addEventListener("click", saveCashMovement);
  safeEl("saveFornBtn")?.addEventListener("click", saveSupplier);
  safeEl("cancelFornEditBtn")?.addEventListener("click", resetSupplierForm);
  safeEl("saveFornMovBtn")?.addEventListener("click", saveSupplierMovement);
  safeEl("saveSupplierDetailMovBtn")?.addEventListener("click", saveSupplierDetailMovement);
  safeEl("saveDipBtn")?.addEventListener("click", saveEmployee);
  safeEl("cancelDipEditBtn")?.addEventListener("click", resetEmployeeForm);
  safeEl("saveDipMovBtn")?.addEventListener("click", saveEmployeeMovement);
  safeEl("saveEmployeeDetailMovBtn")?.addEventListener("click", saveEmployeeDetailMovement);
  safeEl("saveBanBtn")?.addEventListener("click", saveBooking);
  safeEl("runReportBtn")?.addEventListener("click", runMonthlyReport);
  safeEl("runPeriodReportBtn")?.addEventListener("click", runPeriodReport);
  safeEl("addBanchettoRowBtn")?.addEventListener("click", ()=>{ addBanchettoRow({}); updateDailyCashAuto(); });
  safeEl("giornaliera")?.addEventListener("input", () => updateDailyCashAuto());
  safeEl("addDailySupplierPaymentBtn")?.addEventListener("click", ()=>addDailySupplierPaymentRow({}));
  safeEl("addDailyEmployeePaymentBtn")?.addEventListener("click", ()=>addDailyEmployeePaymentRow({}));
  safeEl("supplierDetailMonth")?.addEventListener("change", renderSupplierDetail);
  safeEl("employeeDetailMonth")?.addEventListener("change", renderEmployeeDetail);
  safeEl("refreshBtn")?.addEventListener("click", ()=>refreshData("Dati aggiornati dal cloud."));
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
