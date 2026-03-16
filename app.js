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
};

let supabase = null;
let selectedCompanyId = null;
let selectedAlertRecord = null;
let pendingDailyRecord = null;
let editingSupplierId = null;
let editingEmployeeId = null;
let editingBookingId = null;

const $ = (id) => document.getElementById(id);
const safeEl = (id) => document.getElementById(id);
const n = (v) => Number(v || 0);
const todayStr = () => new Date().toISOString().slice(0, 10);
const euro = (v) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(v || 0));
const isSupervisor = () => state.profile?.global_role === "supervisor";

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

function getDailyTotals(rec) {
  const totalIncasso = n(rec.pranzo?.contanti)+n(rec.pranzo?.pos)+n(rec.cena?.contanti)+n(rec.cena?.pos)+n(rec.banchetti?.contanti)+n(rec.banchetti?.pos);
  const totalCoperti = n(rec.pranzo?.coperti)+n(rec.cena?.coperti)+n(rec.banchetti?.coperti);
  return { totalIncasso, totalCoperti };
}
function validateDaily(rec) {
  const alerts = [];
  const totals = getDailyTotals(rec);
  const copertiTot = totals.totalCoperti;
  const copertiPizzeria = copertiTot - n(rec.copertiRistorante);
  if (copertiPizzeria < 0) alerts.push("Coperti pizzeria negativi: i coperti ristorante superano i coperti totali.");
  if (n(rec.menu) + n(rec.supplementi) > n(rec.copertiRistorante)) alerts.push("Menù + supplementi superano i coperti ristorante.");
  const paymentNoService =
    (n(rec.pranzo?.contanti)+n(rec.pranzo?.pos) > 0 && n(rec.pranzo?.coperti) === 0 && n(rec.pranzo?.asporto) === 0) ||
    (n(rec.cena?.contanti)+n(rec.cena?.pos) > 0 && n(rec.cena?.coperti) === 0 && n(rec.cena?.asporto) === 0) ||
    (n(rec.banchetti?.contanti)+n(rec.banchetti?.pos) > 0 && n(rec.banchetti?.coperti) === 0 && n(rec.banchetti?.asporto) === 0);
  if (paymentNoService) alerts.push("Sono presenti incassi in una colonna con 0 coperti e 0 asporto.");
  if (totals.totalIncasso <= 0 && copertiTot > 0) alerts.push("Ci sono coperti ma l'incasso totale è zero.");
  return alerts;
}
function fillDailyForm(rec) {
  $("gData").value = rec.data || "";
  $("gPizze").value = rec.pizze ?? 0;
  $("gCopertiRistorante").value = rec.copertiRistorante ?? 0;
  $("gMenu").value = rec.menu ?? 0;
  $("gSupplementi").value = rec.supplementi ?? 0;
  $("gPortate").value = rec.portate ?? 0;
  $("gBancone").value = rec.bancone ?? 0;
  $("gNote").value = rec.note || "";
  $("pranzoCoperti").value = rec.pranzo?.coperti ?? 0;
  $("pranzoAsporto").value = rec.pranzo?.asporto ?? 0;
  $("pranzoContanti").value = rec.pranzo?.contanti ?? 0;
  $("pranzoPos").value = rec.pranzo?.pos ?? 0;
  $("cenaCoperti").value = rec.cena?.coperti ?? 0;
  $("cenaAsporto").value = rec.cena?.asporto ?? 0;
  $("cenaContanti").value = rec.cena?.contanti ?? 0;
  $("cenaPos").value = rec.cena?.pos ?? 0;
  $("banchettiCoperti").value = rec.banchetti?.coperti ?? 0;
  $("banchettiAsporto").value = rec.banchetti?.asporto ?? 0;
  $("banchettiContanti").value = rec.banchetti?.contanti ?? 0;
  $("banchettiPos").value = rec.banchetti?.pos ?? 0;
}
function collectDailyFromForm() {
  return {
    data: $("gData").value,
    pizze: n($("gPizze").value),
    copertiRistorante: n($("gCopertiRistorante").value),
    menu: n($("gMenu").value),
    supplementi: n($("gSupplementi").value),
    portate: n($("gPortate").value),
    bancone: n($("gBancone").value),
    note: $("gNote").value.trim(),
    pranzo: { coperti: n($("pranzoCoperti").value), asporto: n($("pranzoAsporto").value), contanti: n($("pranzoContanti").value), pos: n($("pranzoPos").value) },
    cena: { coperti: n($("cenaCoperti").value), asporto: n($("cenaAsporto").value), contanti: n($("cenaContanti").value), pos: n($("cenaPos").value) },
    banchetti: { coperti: n($("banchettiCoperti").value), asporto: n($("banchettiAsporto").value), contanti: n($("banchettiContanti").value), pos: n($("banchettiPos").value) }
  };
}
function resetDailyForm() {
  fillDailyForm({
    data: todayStr(), pizze:0,copertiRistorante:0,menu:0,supplementi:0,portate:0,bancone:0,note:"",
    pranzo:{coperti:0,asporto:0,contanti:0,pos:0},
    cena:{coperti:0,asporto:0,contanti:0,pos:0},
    banchetti:{coperti:0,asporto:0,contanti:0,pos:0}
  });
}

function supplierSuspeso(supplier) {
  const moves = state.supplierMovements.filter(m => m.supplier_id === supplier.id);
  const fatture = moves.filter(m => m.tipo === "fattura").reduce((a,b)=>a+n(b.importo),0);
  const pagamenti = moves.filter(m => m.tipo === "pagamento").reduce((a,b)=>a+n(b.importo),0);
  return n(supplier.sospeso_iniziale) + fatture - pagamenti;
}
function employeePaid(employee) {
  return state.employeeMovements.filter(m => m.employee_id === employee.id).reduce((a,b)=>a+n(b.importo),0);
}
function computeCashBalances() {
  const balances = { ...state.cashInitial };
  state.customCashes.forEach(c => { if (!(c.name in balances)) balances[c.name] = n(c.amount); });
  state.dailyRecords.forEach(rec => {
    balances.contanti += n(rec.pranzo?.contanti)+n(rec.cena?.contanti)+n(rec.banchetti?.contanti);
    const lordo = n(rec.pranzo?.pos)+n(rec.cena?.pos)+n(rec.banchetti?.pos);
    balances.pos += lordo - lordo * 0.0195;
  });
  state.cashMovements.forEach(m => {
    if (!(m.cassa in balances)) balances[m.cassa] = 0;
    balances[m.cassa] += (m.tipo === "entrata" ? 1 : -1) * n(m.importo);
  });
  return balances;
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
  const { error } = await supabase.auth.signUp({
    email, password,
    options: { data: { company_name: companyName, vat_number: vatNumber, phone } }
  });
  if (error) return showAuthMessage(error.message, true);
  showAuthMessage("Account creato. Se la conferma email è disattivata, puoi fare login subito.");
  setAuthTab("login");
  $("loginEmail").value = email;
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
    const { data: companies, error: cErr } = await supabase.from("companies").select("id,name,vat_number").order("created_at", { ascending: true });
    if (cErr) throw cErr;
    state.memberships = (companies || []).map(c => ({ id: `supervisor-${c.id}`, role:"supervisor", company_id:c.id, companies:c }));
    return;
  }

  const { data: memberships, error: mErr } = await supabase.from("company_users").select("id, role, company_id, companies(id, name, vat_number)").order("created_at", { ascending: true });
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
  if (state.memberships.length === 0) {
    hideAllViews();
    safeEl("authView")?.classList.remove("hidden");
    return showAuthMessage("Questo account non è collegato a nessuna ditta.", true);
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
  state.activeCompany = { id: companyId, name: membership.companies.name, role: membership.role };
  if (safeEl("activeCompanyName")) $("activeCompanyName").textContent = membership.companies.name;
  if (safeEl("activeCompanyRole")) $("activeCompanyRole").textContent = `Ruolo: ${membership.role}`;
  hideAllViews();
  safeEl("appView")?.classList.remove("hidden");
  seedFields();
  await refreshData();
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
  state.dailyRecords = daily_records.map(r => r.payload);
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
async function saveCashMovement() {
  const payload = {
    company_id: state.activeCompany.id,
    data: $("movData").value,
    cassa: $("movCassa").value,
    tipo: $("movTipo").value,
    importo: n($("movImporto").value),
    descrizione: $("movDescrizione").value.trim(),
  };
  if (!payload.data || !payload.descrizione || payload.importo <= 0) return showGlobalMessage("Compila data, descrizione e importo.", "error");
  const { error } = await supabase.from("cash_movements").insert(payload);
  if (error) return showGlobalMessage(error.message, "error");
  await refreshData("Movimento di cassa salvato.");
}

async function persistDailyRecord(rec) {
  const { error } = await supabase.from("daily_records").upsert({ company_id: state.activeCompany.id, data: rec.data, payload: rec }, { onConflict: "company_id,data" });
  if (error) return showGlobalMessage(error.message, "error"), false;
  return true;
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
  if (!confirm(`Vuoi davvero cancellare la giornata ${dateStr}?`)) return;
  const { error } = await supabase.from("daily_records").delete().eq("company_id", state.activeCompany.id).eq("data", dateStr);
  if (error) return showGlobalMessage(error.message, "error");
  await refreshData("Giornata cancellata.");
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
  const supplier = state.suppliers.find(s => s.nome === $("fornMovNome").value);
  const payload = {
    company_id: state.activeCompany.id,
    supplier_id: supplier?.id,
    data: $("fornMovData").value,
    tipo: $("fornMovTipo").value,
    importo: n($("fornMovImporto").value),
    nota: $("fornMovNota").value.trim(),
  };
  if (!payload.supplier_id || !payload.data || payload.importo <= 0) return showGlobalMessage("Controlla fornitore, data e importo.", "error");
  const { error } = await supabase.from("supplier_movements").insert(payload);
  if (error) return showGlobalMessage(error.message, "error");
  await refreshData("Movimento fornitore salvato.");
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
    company_id: state.activeCompany.id,
    employee_id: employee?.id,
    data: $("dipMovData").value,
    tipo: $("dipMovTipo").value,
    importo: n($("dipMovImporto").value),
    nota: $("dipMovNota").value.trim(),
  };
  if (!payload.employee_id || !payload.data || payload.importo <= 0) return showGlobalMessage("Controlla dipendente, data e importo.", "error");
  const { error } = await supabase.from("employee_movements").insert(payload);
  if (error) return showGlobalMessage(error.message, "error");
  await refreshData("Movimento dipendente salvato.");
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
    ["Coperti ristorante", rec.copertiRistorante ?? 0],
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
    $("cashSummary").innerHTML = Object.entries(balances).map(([k,v]) => `<div class="item"><div><strong>${k}</strong></div><div>${euro(v)}</div></div>`).join("");
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
      <td>${totals.totalCoperti}</td>
      <td>${euro(totals.totalIncasso)}</td>
      <td>${r.pizze}</td>
      <td>${r.menu} / ${r.supplementi}</td>
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
  const movSelect = safeEl("movCassa");
  if (movSelect) {
    const baseOptions = ['<option value="contanti">Contanti</option>', '<option value="pos">POS</option>'];
    const customOptions = (state.customCashes || []).map(c => `<option value="${c.name}">${c.name}</option>`);
    movSelect.innerHTML = [...baseOptions, ...customOptions].join("");
  }
  if (safeEl("customCashTable")) {
    $("customCashTable").innerHTML = (state.customCashes || []).map(c => `<tr><td>${c.name}</td><td>${euro(c.amount)}</td><td><button class="btn ghost custom-cash-delete-btn" data-cash-name="${c.name}">Elimina</button></td></tr>`).join("") || '<tr><td colspan="3">Nessuna cassa personalizzata</td></tr>';
    document.querySelectorAll(".custom-cash-delete-btn").forEach(btn => btn.addEventListener("click", ()=>deleteCustomCash(btn.dataset.cashName)));
  }
  if (safeEl("movimentiTable")) $("movimentiTable").innerHTML = state.cashMovements.map(m=>`<tr><td>${m.data}</td><td>${m.cassa}</td><td>${m.tipo}</td><td>${m.descrizione || ""}</td><td>${euro(m.importo)}</td></tr>`).join("");
}
function renderSuppliers() {
  if (safeEl("fornMovNome")) $("fornMovNome").innerHTML = state.suppliers.map(s => `<option value="${s.nome}">${s.nome}</option>`).join("");
  const table = safeEl("fornitoriTable");
  if (!table) return;
  table.innerHTML = state.suppliers.map(s=>{
    const sosp = supplierSuspeso(s);
    const last = state.supplierMovements.filter(m => m.supplier_id === s.id).slice(-1)[0];
    return `<tr>
      <td>${s.nome}</td>
      <td>${(s.aliases || []).join(", ") || "—"}</td>
      <td>${euro(sosp)}</td>
      <td>${last ? `${last.data} · ${last.tipo} ${euro(last.importo)}` : "—"}</td>
      <td>${sosp > 0 ? '<span class="warn">Aperto</span>' : '<span class="ok">Chiuso</span>'}</td>
      <td style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn ghost supplier-edit-btn" data-supplier-name="${s.nome}">Modifica</button>
        <button class="btn ghost supplier-delete-btn" data-supplier-name="${s.nome}">Elimina</button>
      </td>
    </tr>`;
  }).join("");
  document.querySelectorAll(".supplier-edit-btn").forEach(btn => btn.addEventListener("click", ()=>{
    const supplier = state.suppliers.find(s => s.nome === btn.dataset.supplierName);
    if (supplier) startSupplierEdit(supplier);
  }));
  document.querySelectorAll(".supplier-delete-btn").forEach(btn => btn.addEventListener("click", ()=>deleteSupplierByName(btn.dataset.supplierName)));
}
function renderEmployees() {
  if (safeEl("dipMovNome")) $("dipMovNome").innerHTML = state.employees.map(e => `<option value="${e.nome}">${e.nome}</option>`).join("");
  const table = safeEl("dipendentiTable");
  if (!table) return;
  table.innerHTML = state.employees.map(e=>{
    const pagato = employeePaid(e);
    const residuo = n(e.dovuto_mensile) - pagato;
    return `<tr>
      <td>${e.nome}</td>
      <td>${e.ruolo || "—"}</td>
      <td>${euro(e.dovuto_mensile)}</td>
      <td>${euro(pagato)}</td>
      <td>${residuo > 0 ? `<span class="warn">${euro(residuo)}</span>` : `<span class="ok">${euro(residuo)}</span>`}</td>
      <td style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn ghost employee-edit-btn" data-employee-name="${e.nome}">Modifica</button>
        <button class="btn ghost employee-delete-btn" data-employee-name="${e.nome}">Elimina</button>
      </td>
    </tr>`;
  }).join("");
  document.querySelectorAll(".employee-edit-btn").forEach(btn => btn.addEventListener("click", ()=>{
    const employee = state.employees.find(e => e.nome === btn.dataset.employeeName);
    if (employee) startEmployeeEdit(employee);
  }));
  document.querySelectorAll(".employee-delete-btn").forEach(btn => btn.addEventListener("click", ()=>deleteEmployeeByName(btn.dataset.employeeName)));
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
function runMonthlyReport() {
  const month = String($("reportMonth").value).padStart(2,"0");
  const year = String($("reportYear").value);
  const records = state.dailyRecords.filter(r => r.data.startsWith(`${year}-${month}`));
  let copPranzo=0,copCena=0,copBanchetti=0,incasso=0,asporto=0,bancone=0,pizze=0;
  records.forEach(r=>{
    copPranzo += n(r.pranzo.coperti); copCena += n(r.cena.coperti); copBanchetti += n(r.banchetti.coperti);
    incasso += getDailyTotals(r).totalIncasso;
    asporto += n(r.pranzo.asporto)+n(r.cena.asporto)+n(r.banchetti.asporto);
    bancone += n(r.bancone); pizze += n(r.pizze);
  });
  if (safeEl("rCopPranzo")) $("rCopPranzo").textContent = copPranzo;
  if (safeEl("rCopCena")) $("rCopCena").textContent = copCena;
  if (safeEl("rCopBanchetti")) $("rCopBanchetti").textContent = copBanchetti;
  if (safeEl("rIncasso")) $("rIncasso").textContent = euro(incasso);
  if (safeEl("reportSummary")) $("reportSummary").innerHTML = [
    `<div class="card inner"><strong>Coperti complessivi</strong><div>${copPranzo + copCena + copBanchetti}</div></div>`,
    `<div class="card inner"><strong>Asporto totale</strong><div>${euro(asporto)}</div></div>`,
    `<div class="card inner"><strong>Bancone totale</strong><div>${euro(bancone)}</div></div>`,
    `<div class="card inner"><strong>Pizze totali</strong><div>${pizze}</div></div>`,
  ].join("");
}
function renderAll() {
  renderDashboard();
  renderDailyTable();
  renderCash();
  renderSuppliers();
  renderEmployees();
  renderBookings();
  runMonthlyReport();
}

function bindEvents() {
  document.querySelectorAll(".nav-btn[data-section]").forEach(btn => btn.addEventListener("click", ()=>navigate(btn.dataset.section)));
  document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", ()=>setAuthTab(btn.dataset.authTab)));
  safeEl("loginBtn")?.addEventListener("click", login);
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
  safeEl("saveDipBtn")?.addEventListener("click", saveEmployee);
  safeEl("cancelDipEditBtn")?.addEventListener("click", resetEmployeeForm);
  safeEl("saveDipMovBtn")?.addEventListener("click", saveEmployeeMovement);
  safeEl("saveBanBtn")?.addEventListener("click", saveBooking);
  safeEl("runReportBtn")?.addEventListener("click", runMonthlyReport);
  safeEl("refreshBtn")?.addEventListener("click", ()=>refreshData("Dati aggiornati dal cloud."));
  safeEl("backupBtn")?.addEventListener("click", exportBackup);
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
