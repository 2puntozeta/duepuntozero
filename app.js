
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
  cashMovements: [],
  customCashes: [],
  suppliers: [],
  supplierMovements: [],
  employees: [],
  employeeMovements: [],
  bookings: []
};

let supabase = null;
let selectedCompanyId = null;

const $ = (id) => document.getElementById(id);
const safeEl = (id) => document.getElementById(id);
const euro = (v) => new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(Number(v || 0));
const n = (v) => Number(v || 0);
const todayStr = () => new Date().toISOString().slice(0,10);
const isSupervisor = () => state.profile?.global_role === "supervisor";

function showGlobalMessage(message, type="ok"){
  $("globalFeedback").innerHTML = `<div class="alert ${type === "ok" ? "okline" : ""}">${message}</div>`;
  setTimeout(() => { $("globalFeedback").innerHTML = ""; }, 3500);
}
function showAuthMessage(message, isError=false){
  $("authFeedback").textContent = message;
  $("authFeedback").style.color = isError ? "#fecaca" : "#bbf7d0";
}
function hideAllViews(){ ["bootScreen","authView","companySelectorView","appView"].forEach(id => $(id).classList.add("hidden")); }

function seedFields(){
  ["gData","movData","fornMovData","dipMovData","banData"].forEach(id => { const el = $(id); if(el && !el.value) el.value = todayStr(); });
  if ($("reportMonth").options.length === 0){
    ["01","02","03","04","05","06","07","08","09","10","11","12"].forEach((m,i)=>{ const op=document.createElement("option"); op.value=i+1; op.textContent=m; $("reportMonth").appendChild(op); });
    $("reportMonth").value = new Date().getMonth()+1;
  }
  if ($("reportYear").options.length === 0){
    [2025,2026,2027,2028].forEach(y=>{ const op=document.createElement("option"); op.value=y; op.textContent=y; $("reportYear").appendChild(op); });
    $("reportYear").value = new Date().getFullYear();
  }
}
function navigate(sectionId){
  document.querySelectorAll(".section").forEach(s=>s.classList.remove("active"));
  $(sectionId).classList.add("active");
  document.querySelectorAll(".nav-btn[data-section]").forEach(b=>b.classList.toggle("active", b.dataset.section===sectionId));
  const meta = {
    dashboard:["Dashboard","Panoramica rapida di incassi, casse e controlli."],
    giornaliera:["Scheda giornaliera","Inserimento rapido di coperti, incassi e produzione."],
    casse:["Casse","Gestione saldi iniziali e movimenti manuali."],
    fornitori:["Fornitori","Debiti, fatture, pagamenti e sospesi."],
    dipendenti:["Dipendenti","Dovuto, pagato, residuo e movimenti del personale."],
    banchetti:["Prenotazioni / Banchetti","Eventi, coperti adulti+bambini e importi."],
    report:["Report base","Riepilogo mensile per la ditta attiva."]
  };
  $("pageTitle").textContent = meta[sectionId][0];
  $("pageSubtitle").textContent = meta[sectionId][1];
}
function getDailyTotals(rec){
  const pranzoInc = n(rec.pranzo.contanti)+n(rec.pranzo.pos);
  const cenaInc = n(rec.cena.contanti)+n(rec.cena.pos);
  const banInc = n(rec.banchetti.contanti)+n(rec.banchetti.pos);
  const totalIncasso = pranzoInc + cenaInc + banInc;
  const totalCoperti = n(rec.pranzo.coperti)+n(rec.cena.coperti)+n(rec.banchetti.coperti);
  return { totalIncasso, totalCoperti };
}
function validateDaily(rec){
  const alerts = [];
  const totals = getDailyTotals(rec);
  const copertiTot = n(rec.pranzo.coperti)+n(rec.cena.coperti)+n(rec.banchetti.coperti);
  const copertiPizzeria = copertiTot - n(rec.copertiRistorante);
  if(copertiPizzeria < 0) alerts.push("Coperti pizzeria negativi: i coperti ristorante superano i coperti totali.");
  if(n(rec.menu) + n(rec.supplementi) > n(rec.copertiRistorante)) alerts.push("Menù + supplementi superano i coperti ristorante.");
  const paymentNoService =
    (n(rec.pranzo.contanti)+n(rec.pranzo.pos) > 0 && n(rec.pranzo.coperti) === 0 && n(rec.pranzo.asporto) === 0) ||
    (n(rec.cena.contanti)+n(rec.cena.pos) > 0 && n(rec.cena.coperti) === 0 && n(rec.cena.asporto) === 0) ||
    (n(rec.banchetti.contanti)+n(rec.banchetti.pos) > 0 && n(rec.banchetti.coperti) === 0 && n(rec.banchetti.asporto) === 0);
  if(paymentNoService) alerts.push("Sono presenti incassi in una colonna con 0 coperti e 0 asporto.");
  if(totals.totalIncasso <= 0 && copertiTot > 0) alerts.push("Ci sono coperti ma l'incasso totale è zero.");
  return alerts;
}

async function saveNewCash(){
  const name = safeEl("newCashName")?.value?.trim();
  const amount = n(safeEl("newCashAmount")?.value);
  if(!name){ showGlobalMessage("Inserisci il nome della cassa.", "error"); return; }
  const { error } = await supabase.from("custom_cash_state").upsert({ company_id: state.activeCompany.id, name, amount }, { onConflict: "company_id,name" });
  if(error){ showGlobalMessage(error.message, "error"); return; }
  if (safeEl("newCashName")) $("newCashName").value = "";
  if (safeEl("newCashAmount")) $("newCashAmount").value = 0;
  await refreshData("Cassa personalizzata salvata.");
}
async function deleteCustomCash(name){
  if(!confirm(`Vuoi davvero cancellare la cassa ${name}?`)) return;
  const { error } = await supabase.from("custom_cash_state").delete().eq("company_id", state.activeCompany.id).eq("name", name);
  if(error){ showGlobalMessage(error.message, "error"); return; }
  await refreshData("Cassa personalizzata cancellata.");
}
function supplierSuspeso(s){
  const moves = state.supplierMovements.filter(m => m.supplier_id === s.id);
  const fatture = moves.filter(m=>m.tipo==="fattura").reduce((a,b)=>a+n(b.importo),0);
  const pagamenti = moves.filter(m=>m.tipo==="pagamento").reduce((a,b)=>a+n(b.importo),0);
  return n(s.sospeso_iniziale) + fatture - pagamenti;
}
function employeePaid(e){ return state.employeeMovements.filter(m => m.employee_id === e.id).reduce((a,b)=>a+n(b.importo),0); }
function computeCashBalances(){
  const balances = { ...state.cashInitial };
  state.dailyRecords.forEach(rec=>{
    balances.contanti += n(rec.pranzo.contanti)+n(rec.cena.contanti)+n(rec.banchetti.contanti);
    const lordo = n(rec.pranzo.pos)+n(rec.cena.pos)+n(rec.banchetti.pos);
    balances.pos += lordo - (lordo * 0.0195);
  });
  state.cashMovements.forEach(m=>{ balances[m.cassa] += (m.tipo === "entrata" ? 1 : -1) * n(m.importo); });
  return balances;
}
function computeGlobalAlerts(){
  const alerts = [];
  state.dailyRecords.forEach(r=> validateDaily(r).forEach(msg => alerts.push({title:r.data, text:msg})));
  state.suppliers.forEach(s=> { const sosp = supplierSuspeso(s); if(sosp > 0) alerts.push({title:"Fornitore aperto", text:`${s.nome}: sospeso residuo ${euro(sosp)}`}); });
  state.employees.forEach(e=> { const residuo = n(e.dovuto_mensile) - employeePaid(e); if(residuo > 0) alerts.push({title:"Dipendente da saldare", text:`${e.nome}: residuo ${euro(residuo)}`}); });
  return alerts;
}

async function initSupabase(){
  try{
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { session }, error } = await supabase.auth.getSession();
    if(error){
      hideAllViews();
      $("authView").classList.remove("hidden");
      showAuthMessage("Errore Supabase: " + error.message, true);
      return false;
    }
    state.session = session;
    return true;
  }catch(err){
    console.error(err);
    hideAllViews();
    $("authView").classList.remove("hidden");
    showAuthMessage("Errore avvio app: " + (err?.message || err), true);
    return false;
  }
}
function setAuthTab(tab){
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.authTab === tab));
  $("loginTab").classList.toggle("hidden", tab !== "login");
  $("registerTab").classList.toggle("hidden", tab !== "register");
}
async function login(){
  const { error, data } = await supabase.auth.signInWithPassword({ email: $("loginEmail").value.trim(), password: $("loginPassword").value.trim() });
  if(error){ showAuthMessage(error.message, true); return; }
  state.session = data.session;
  await bootstrapAfterAuth();
}
async function register(){
  const companyName = $("registerCompanyName").value.trim();
  const vatNumber = $("registerVatNumber").value.trim();
  const phone = $("registerPhone").value.trim();
  const email = $("registerEmail").value.trim();
  const password = $("registerPassword").value.trim();

  if(!companyName || !email || !password){
    showAuthMessage("Compila almeno nome ditta, email e password.", true);
    return;
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        company_name: companyName,
        vat_number: vatNumber,
        phone
      }
    }
  });

  if(error){ showAuthMessage(error.message, true); return; }
  showAuthMessage("Account creato. Se la conferma email è disattivata, puoi fare login subito.");
  setAuthTab("login");
  $("loginEmail").value = email;
}
async function logout(){
  await supabase.auth.signOut();
  state.session = null;
  state.profile = null;
  state.memberships = [];
  state.activeCompany = null;
  selectedCompanyId = null;
  hideAllViews();
  $("authView").classList.remove("hidden");
}
async function fetchProfileAndMemberships(){
  const [{ data: profile, error: pErr }, { data: memberships, error: mErr }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", state.session.user.id).single(),
    supabase.from("company_users").select("id, role, company_id, companies(id, name, vat_number)").order("created_at", { ascending: true })
  ]);
  if(pErr) throw pErr;
  if(mErr) throw mErr;
  state.profile = profile;
  state.memberships = memberships || [];
}
function renderCompanySelector(){
  hideAllViews();
  $("companySelectorView").classList.remove("hidden");
  $("companyInfo").textContent = `${state.profile?.email || ""} · ${isSupervisor() ? "supervisor" : "utente"}`;
  $("companyGrid").innerHTML = state.memberships.map(m => `
    <div class="card company-card ${selectedCompanyId === m.company_id ? 'selected' : ''}" data-company-id="${m.company_id}">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:start;">
        <div><div style="font-weight:800;font-size:18px;">${m.companies.name}</div><div class="muted tiny">${m.companies.vat_number || "P.IVA non inserita"}</div></div>
        <span class="tag">${m.role}</span>
      </div>
    </div>`).join("");
  document.querySelectorAll(".company-card").forEach(card => card.addEventListener("click", () => {
    selectedCompanyId = card.dataset.companyId;
    renderCompanySelector();
  }));
}
async function bootstrapAfterAuth(){
  await fetchProfileAndMemberships();
  if(state.memberships.length === 0){
    hideAllViews(); $("authView").classList.remove("hidden");
    showAuthMessage("Questo account non è collegato a nessuna ditta. Devi associarlo dal database.", true);
    return;
  }
  if(isSupervisor() || state.memberships.length > 1){
    selectedCompanyId = selectedCompanyId || state.memberships[0].company_id;
    renderCompanySelector();
  } else {
    selectedCompanyId = state.memberships[0].company_id;
    await openCompany(selectedCompanyId);
  }
}
async function openCompany(companyId){
  const membership = state.memberships.find(m => m.company_id === companyId);
  if(!membership) return;
  state.activeCompany = { id: companyId, name: membership.companies.name, role: membership.role };
  $("activeCompanyName").textContent = membership.companies.name;
  $("activeCompanyRole").textContent = `Ruolo: ${membership.role}`;
  hideAllViews();
  $("appView").classList.remove("hidden");
  seedFields();
  await refreshData();
}

async function fetchCompanyTable(table, orderColumn="created_at", ascending=true){
  const { data, error } = await supabase.from(table).select("*").eq("company_id", state.activeCompany.id).order(orderColumn, { ascending });
  if(error) throw error;
  return data || [];
}
async function loadCompanyData(){
  const [daily_records, cash_state, cash_movements, suppliers, supplier_movements, employees, employee_movements, bookings, custom_cash_state] = await Promise.all([
    fetchCompanyTable("daily_records", "data", true),
    fetchCompanyTable("cash_state", "kind", true),
    fetchCompanyTable("cash_movements", "data", true),
    fetchCompanyTable("suppliers", "nome", true),
    fetchCompanyTable("supplier_movements", "data", true),
    fetchCompanyTable("employees", "nome", true),
    fetchCompanyTable("employee_movements", "data", true),
    fetchCompanyTable("bookings", "data", true),
    fetchCompanyTable("custom_cash_state", "name", true)
  ]);
  state.dailyRecords = daily_records.map(r => r.payload);
  state.cashMovements = cash_movements;
  state.suppliers = suppliers;
  state.supplierMovements = supplier_movements;
  state.employees = employees;
  state.employeeMovements = employee_movements;
  state.bookings = bookings;
  state.customCashes = custom_cash_state;
  state.cashInitial = { contanti: 0, pos: 0 };
  cash_state.forEach(r => { state.cashInitial[r.kind] = n(r.amount); });
}
async function refreshData(message=null){
  try{
    await loadCompanyData();
    renderAll();
    if(message) showGlobalMessage(message);
  }catch(err){ showGlobalMessage(err.message, "error"); }
}
async function upsertCashState(kind, amount){
  const { error } = await supabase.from("cash_state").upsert({ company_id: state.activeCompany.id, kind, amount }, { onConflict: "company_id,kind" });
  if(error) throw error;
}
async function saveCashInitial(){
  try{
    await Promise.all([
      upsertCashState("contanti", n(safeEl("cashInitContanti")?.value)),
      upsertCashState("pos", n(safeEl("cashInitPos")?.value))
    ]);
    await refreshData("Saldi iniziali salvati.");
  }catch(err){ showGlobalMessage(err.message, "error"); }
}
async function saveCashMovement(){
  const payload = { company_id: state.activeCompany.id, data: $("movData").value, cassa: $("movCassa").value, tipo: $("movTipo").value, importo: n($("movImporto").value), descrizione: $("movDescrizione").value.trim() };
  if(!payload.data || !payload.descrizione || payload.importo <= 0){ showGlobalMessage("Compila data, descrizione e importo.", "error"); return; }
  const { error } = await supabase.from("cash_movements").insert(payload);
  if(error){ showGlobalMessage(error.message, "error"); return; }
  await refreshData("Movimento di cassa salvato.");
}
async function saveDaily(){
  const rec = {
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
  if(!rec.data){ showGlobalMessage("Inserisci la data.", "error"); return; }
  const { error } = await supabase.from("daily_records").upsert({ company_id: state.activeCompany.id, data: rec.data, payload: rec }, { onConflict: "company_id,data" });
  if(error){ showGlobalMessage(error.message, "error"); return; }
  const alerts = validateDaily(rec);
  $("giornalieraFeedback").innerHTML = alerts.length ? `<div class="alert">${alerts.map(a => `• ${a}`).join("<br>")}</div>` : `<div class="alert okline">Giornata salvata correttamente. Nessun alert bloccante nella V1.</div>`;
  await refreshData("Scheda giornaliera salvata.");
  resetDailyForm();
}
async function saveSupplier(){
  const nome = $("fornNome").value.trim();
  const alias = $("fornAlias").value.trim();
  const sospeso_iniziale = n($("fornSospeso").value);
  if(!nome){ showGlobalMessage("Inserisci il nome del fornitore.", "error"); return; }
  const existing = state.suppliers.find(s => s.nome.toLowerCase() === nome.toLowerCase());
  const aliases = [...(existing?.aliases || [])];
  if(alias && !aliases.includes(alias)) aliases.push(alias);
  const payload = { company_id: state.activeCompany.id, nome, aliases, sospeso_iniziale };
  const result = existing ? await supabase.from("suppliers").update(payload).eq("id", existing.id) : await supabase.from("suppliers").insert(payload);
  if(result.error){ showGlobalMessage(result.error.message, "error"); return; }
  await refreshData("Fornitore salvato.");
  $("fornNome").value = "";
  $("fornAlias").value = "";
  $("fornSospeso").value = 0;
}
async function saveSupplierMovement(){
  const supplier = state.suppliers.find(s => s.nome === $("fornMovNome").value);
  const payload = { company_id: state.activeCompany.id, supplier_id: supplier?.id, data: $("fornMovData").value, tipo: $("fornMovTipo").value, importo: n($("fornMovImporto").value), nota: $("fornMovNota").value.trim() };
  if(!payload.supplier_id || !payload.data || payload.importo <= 0){ showGlobalMessage("Controlla fornitore, data e importo.", "error"); return; }
  const { error } = await supabase.from("supplier_movements").insert(payload);
  if(error){ showGlobalMessage(error.message, "error"); return; }
  await refreshData("Movimento fornitore salvato.");
}
async function saveEmployee(){
  const nome = $("dipNome").value.trim();
  const ruolo = $("dipRuolo").value.trim();
  const dovuto_mensile = n($("dipDovuto").value);
  if(!nome){ showGlobalMessage("Inserisci il nome del dipendente.", "error"); return; }
  const existing = state.employees.find(e => e.nome.toLowerCase() === nome.toLowerCase());
  const payload = { company_id: state.activeCompany.id, nome, ruolo, dovuto_mensile };
  const result = existing ? await supabase.from("employees").update(payload).eq("id", existing.id) : await supabase.from("employees").insert(payload);
  if(result.error){ showGlobalMessage(result.error.message, "error"); return; }
  await refreshData("Dipendente salvato.");
  $("dipNome").value = "";
  $("dipRuolo").value = "";
  $("dipDovuto").value = 0;
}
async function saveEmployeeMovement(){
  const employee = state.employees.find(e => e.nome === $("dipMovNome").value);
  const payload = { company_id: state.activeCompany.id, employee_id: employee?.id, data: $("dipMovData").value, tipo: $("dipMovTipo").value, importo: n($("dipMovImporto").value), nota: $("dipMovNota").value.trim() };
  if(!payload.employee_id || !payload.data || payload.importo <= 0){ showGlobalMessage("Controlla dipendente, data e importo.", "error"); return; }
  const { error } = await supabase.from("employee_movements").insert(payload);
  if(error){ showGlobalMessage(error.message, "error"); return; }
  await refreshData("Movimento dipendente salvato.");
}
async function saveBooking(){
  const payload = { company_id: state.activeCompany.id, data: $("banData").value, nome: $("banNome").value.trim(), adulti: n($("banAdulti").value), bambini: n($("banBambini").value), tipo: $("banTipo").value, importo: n($("banImporto").value), ora: $("banOra").value.trim(), note: $("banNote").value.trim() };
  if(!payload.data || !payload.nome){ showGlobalMessage("Inserisci data e nome evento.", "error"); return; }
  const { error } = await supabase.from("bookings").insert(payload);
  if(error){ showGlobalMessage(error.message, "error"); return; }
  await refreshData("Prenotazione salvata.");
}
async function exportBackup(){
  const snapshot = { company: state.activeCompany, exported_at: new Date().toISOString(), dailyRecords: state.dailyRecords, cashInitial: state.cashInitial, cashMovements: state.cashMovements, suppliers: state.suppliers, supplierMovements: state.supplierMovements, employees: state.employees, employeeMovements: state.employeeMovements, bookings: state.bookings };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `backup_${state.activeCompany.name.replaceAll(" ","_")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function importBackup(file){
  try{
    const text = await file.text();
    const data = JSON.parse(text);
    if(!confirm(`Importare il backup nella ditta attiva: ${state.activeCompany.name}?`)) return;
    for(const rec of (data.dailyRecords || [])) await supabase.from("daily_records").upsert({ company_id: state.activeCompany.id, data: rec.data, payload: rec }, { onConflict: "company_id,data" });
    if(data.cashInitial) for(const [kind, amount] of Object.entries(data.cashInitial)) await supabase.from("cash_state").upsert({ company_id: state.activeCompany.id, kind, amount }, { onConflict: "company_id,kind" });
    for(const m of (data.cashMovements || [])) await supabase.from("cash_movements").insert({ company_id: state.activeCompany.id, data: m.data, cassa: m.cassa, tipo: m.tipo, importo: m.importo, descrizione: m.descrizione || "" });

    const supplierIdMap = {};
    for(const s of (data.suppliers || [])){
      const res = await supabase.from("suppliers").insert({ company_id: state.activeCompany.id, nome: s.nome, aliases: s.aliases || [], sospeso_iniziale: n(s.sospeso_iniziale || s.sospesoIniziale || 0) }).select("id,nome").single();
      if(!res.error && res.data) supplierIdMap[s.nome] = res.data.id;
    }
    for(const sm of (data.supplierMovements || [])){
      const sid = sm.supplier_id || supplierIdMap[sm.supplier_nome] || supplierIdMap[sm.nome];
      if(sid) await supabase.from("supplier_movements").insert({ company_id: state.activeCompany.id, supplier_id: sid, data: sm.data, tipo: sm.tipo, importo: sm.importo, nota: sm.nota || "" });
    }

    const employeeIdMap = {};
    for(const e of (data.employees || [])){
      const res = await supabase.from("employees").insert({ company_id: state.activeCompany.id, nome: e.nome, ruolo: e.ruolo || "", dovuto_mensile: n(e.dovuto_mensile || e.dovutoMensile || 0) }).select("id,nome").single();
      if(!res.error && res.data) employeeIdMap[e.nome] = res.data.id;
    }
    for(const em of (data.employeeMovements || [])){
      const eid = em.employee_id || employeeIdMap[em.employee_nome] || employeeIdMap[em.nome];
      if(eid) await supabase.from("employee_movements").insert({ company_id: state.activeCompany.id, employee_id: eid, data: em.data, tipo: em.tipo, importo: em.importo, nota: em.nota || "" });
    }
    for(const b of (data.bookings || [])) await supabase.from("bookings").insert({ company_id: state.activeCompany.id, data: b.data, nome: b.nome, adulti: b.adulti, bambini: b.bambini, tipo: b.tipo, importo: b.importo, ora: b.ora || "", note: b.note || "" });
    await refreshData("Backup importato nella ditta attiva.");
  } catch(err){ showGlobalMessage("Backup non valido: " + err.message, "error"); }
}
async function seedDemoCloud(){
  if(!confirm(`Vuoi caricare dati demo nella ditta attiva: ${state.activeCompany.name}?`)) return;
  await supabase.from("daily_records").upsert([
    { company_id: state.activeCompany.id, data:"2026-03-14", payload:{ data:"2026-03-14", pizze:97, copertiRistorante:18, menu:4, supplementi:2, portate:23, bancone:80, note:"Sabato pieno", pranzo:{coperti:22, asporto:35, contanti:210, pos:120}, cena:{coperti:48, asporto:90, contanti:640, pos:520}, banchetti:{coperti:25, asporto:0, contanti:300, pos:250} } },
    { company_id: state.activeCompany.id, data:"2026-03-15", payload:{ data:"2026-03-15", pizze:52, copertiRistorante:12, menu:2, supplementi:1, portate:16, bancone:40, note:"Domenica", pranzo:{coperti:18, asporto:20, contanti:160, pos:140}, cena:{coperti:26, asporto:60, contanti:310, pos:280}, banchetti:{coperti:0, asporto:0, contanti:0, pos:0} } }
  ], { onConflict: "company_id,data" });
  for(const [kind, amount] of Object.entries({ contanti: 283, pos: 0, allianz: 1250, postepay: 180 })) await supabase.from("cash_state").upsert({ company_id: state.activeCompany.id, kind, amount }, { onConflict: "company_id,kind" });
  await supabase.from("cash_movements").insert([
    { company_id: state.activeCompany.id, data:"2026-03-14", cassa:"contanti", tipo:"uscita", importo:55, descrizione:"ZETA" },
    { company_id: state.activeCompany.id, data:"2026-03-14", cassa:"allianz", tipo:"uscita", importo:120, descrizione:"Bonifico fornitore" },
    { company_id: state.activeCompany.id, data:"2026-03-15", cassa:"postepay", tipo:"entrata", importo:50, descrizione:"Giroconto demo" }
  ]);
  const s1 = await supabase.from("suppliers").insert({ company_id: state.activeCompany.id, nome:"Pastificio Calabria", aliases:["Fioccata"], sospeso_iniziale:350 }).select("id").single();
  const s2 = await supabase.from("suppliers").insert({ company_id: state.activeCompany.id, nome:"AGRIPIÙ", aliases:["Box Pizza","Agripiu"], sospeso_iniziale:120 }).select("id").single();
  if(s1.data) await supabase.from("supplier_movements").insert([{ company_id: state.activeCompany.id, supplier_id:s1.data.id, data:"2026-03-12", tipo:"fattura", importo:180, nota:"Fattura 124" }, { company_id: state.activeCompany.id, supplier_id:s1.data.id, data:"2026-03-13", tipo:"pagamento", importo:200, nota:"contanti" }]);
  if(s2.data) await supabase.from("supplier_movements").insert([{ company_id: state.activeCompany.id, supplier_id:s2.data.id, data:"2026-03-14", tipo:"fattura", importo:90, nota:"cartoni pizza" }]);
  const e1 = await supabase.from("employees").insert({ company_id: state.activeCompany.id, nome:"Tommaso", ruolo:"Sala", dovuto_mensile:1200 }).select("id").single();
  const e2 = await supabase.from("employees").insert({ company_id: state.activeCompany.id, nome:"Murdoch", ruolo:"Cucina", dovuto_mensile:1400 }).select("id").single();
  if(e1.data) await supabase.from("employee_movements").insert([{ company_id: state.activeCompany.id, employee_id:e1.data.id, data:"2026-03-10", tipo:"acconto", importo:300, nota:"acconto metà mese" }, { company_id: state.activeCompany.id, employee_id:e1.data.id, data:"2026-03-14", tipo:"extra", importo:50, nota:"doppio turno" }]);
  if(e2.data) await supabase.from("employee_movements").insert([{ company_id: state.activeCompany.id, employee_id:e2.data.id, data:"2026-03-02", tipo:"acconto", importo:500, nota:"prelievo ATM girato" }]);
  await supabase.from("bookings").insert([{ company_id: state.activeCompany.id, data:"2026-03-20", nome:"Compleanno Cristian", adulti:40, bambini:3, tipo:"banchetto", importo:900, ora:"20:30", note:"40+3" }, { company_id: state.activeCompany.id, data:"2026-03-22", nome:"Dragon", adulti:45, bambini:0, tipo:"giro_pizza", importo:720, ora:"21:00", note:"GP" }]);
  await refreshData("Dati demo cloud caricati.");
}
function renderDashboard(){
  const last = [...state.dailyRecords].sort((a,b)=>b.data.localeCompare(a.data))[0];
  const totals = last ? getDailyTotals(last) : { totalIncasso:0, totalCoperti:0 };
  const alerts = computeGlobalAlerts();
  const balances = computeCashBalances();
  if (safeEl("kpiIncasso")) $("kpiIncasso").textContent = euro(totals.totalIncasso);
  if (safeEl("kpiCoperti")) $("kpiCoperti").textContent = totals.totalCoperti;
  if (safeEl("kpiFornitori")) $("kpiFornitori").textContent = state.suppliers.filter(s => supplierSuspeso(s) > 0).length;
  if (safeEl("kpiAlert")) $("kpiAlert").textContent = alerts.length;
  if (safeEl("cashContanti")) $("cashContanti").textContent = euro(balances.contanti);
  if (safeEl("cashPos")) $("cashPos").textContent = euro(balances.pos);
  if (safeEl("alertsBox")) $("alertsBox").innerHTML = alerts.length ? alerts.slice(0,8).map(a => `<div class="item"><div><strong>${a.title}</strong><small>${a.text}</small></div><span class="tag">alert</span></div>`).join("") : `<div class="alert okline">Nessun alert attivo.</div>`;
  if (safeEl("dashboardFornitori")) $("dashboardFornitori").innerHTML = state.suppliers.slice(-5).reverse().map(s=>`<div class="item"><div><strong>${s.nome}</strong><small>${(s.aliases || []).join(", ") || "nessun alias"}</small></div><div>${euro(supplierSuspeso(s))}</div></div>`).join("") || `<div class="muted tiny">Nessun fornitore registrato.</div>`;
  if (safeEl("dashboardBanchetti")) $("dashboardBanchetti").innerHTML = state.bookings.slice(-5).reverse().map(b=>`<div class="item"><div><strong>${b.nome}</strong><small>${b.data} · ${b.tipo}</small></div><div>${b.adulti}+${b.bambini}</div></div>`).join("") || `<div class="muted tiny">Nessuna prenotazione registrata.</div>`;
}
function renderDailyTable(){ $("giorniTable").innerHTML = state.dailyRecords.map(r=>{ const totals = getDailyTotals(r); const alerts = validateDaily(r); return `<tr><td>${r.data}</td><td>${totals.totalCoperti}</td><td>${euro(totals.totalIncasso)}</td><td>${r.pizze}</td><td>${r.menu} / ${r.supplementi}</td><td>${alerts.length ? '<span class="bad">Alert</span>' : '<span class="ok">OK</span>'}</td></tr>`; }).join(""); }
function renderCash(){
  if (safeEl("cashInitContanti")) $("cashInitContanti").value = state.cashInitial.contanti || 0;
  if (safeEl("cashInitPos")) $("cashInitPos").value = state.cashInitial.pos || 0;

  const movSelect = safeEl("movCassa");
  if (movSelect) {
    const baseOptions = ['<option value="contanti">Contanti</option>', '<option value="pos">POS</option>'];
    const customOptions = (state.customCashes || []).map(c => `<option value="${c.name}">${c.name}</option>`);
    movSelect.innerHTML = [...baseOptions, ...customOptions].join("");
  }

  const customCashTable = safeEl("customCashTable");
  if (customCashTable) {
    customCashTable.innerHTML = (state.customCashes || []).map(c => `<tr><td>${c.name}</td><td>${euro(c.amount)}</td><td><button class="btn ghost custom-cash-delete-btn" data-cash-name="${c.name}" style="padding:6px 10px;">Cancella</button></td></tr>`).join("") || '<tr><td colspan="3">Nessuna cassa personalizzata</td></tr>';
    document.querySelectorAll(".custom-cash-delete-btn").forEach(btn => btn.addEventListener("click", () => deleteCustomCash(btn.dataset.cashName)));
  }

  if (safeEl("movimentiTable")) $("movimentiTable").innerHTML = state.cashMovements.map(m=>`<tr><td>${m.data}</td><td>${m.cassa}</td><td>${m.tipo}</td><td>${m.descrizione || ""}</td><td>${euro(m.importo)}</td></tr>`).join("");
}
function renderSuppliers(){ $("fornMovNome").innerHTML = state.suppliers.map(s => `<option value="${s.nome}">${s.nome}</option>`).join(""); $("fornitoriTable").innerHTML = state.suppliers.map(s=>{ const sosp = supplierSuspeso(s); const last = state.supplierMovements.filter(m=>m.supplier_id === s.id).slice(-1)[0]; return `<tr><td>${s.nome}</td><td>${(s.aliases || []).join(", ") || "—"}</td><td>${euro(sosp)}</td><td>${last ? `${last.data} · ${last.tipo} ${euro(last.importo)}` : "—"}</td><td>${sosp > 0 ? '<span class="warn">Aperto</span>' : '<span class="ok">Chiuso</span>'}</td></tr>`; }).join(""); }
function renderEmployees(){ $("dipMovNome").innerHTML = state.employees.map(e => `<option value="${e.nome}">${e.nome}</option>`).join(""); $("dipendentiTable").innerHTML = state.employees.map(e=>{ const pagato = employeePaid(e); const residuo = n(e.dovuto_mensile) - pagato; return `<tr><td>${e.nome}</td><td>${e.ruolo || "—"}</td><td>${euro(e.dovuto_mensile)}</td><td>${euro(pagato)}</td><td>${residuo > 0 ? `<span class="warn">${euro(residuo)}</span>` : `<span class="ok">${euro(residuo)}</span>`}</td></tr>`; }).join(""); }
function renderBookings(){ $("banchettiTable").innerHTML = state.bookings.map(b=>`<tr><td>${b.data}</td><td>${b.nome}</td><td>${b.adulti}+${b.bambini}</td><td>${b.tipo}</td><td>${euro(b.importo)}</td><td>${[b.ora, b.note].filter(Boolean).join(" · ") || "—"}</td></tr>`).join(""); }
function runMonthlyReport(){ const month = String($("reportMonth").value).padStart(2,"0"); const year = String($("reportYear").value); const records = state.dailyRecords.filter(r => r.data.startsWith(`${year}-${month}`)); let copPranzo=0, copCena=0, copBanchetti=0, incasso=0, asporto=0, bancone=0, pizze=0; records.forEach(r=>{ copPranzo += n(r.pranzo.coperti); copCena += n(r.cena.coperti); copBanchetti += n(r.banchetti.coperti); incasso += getDailyTotals(r).totalIncasso; asporto += n(r.pranzo.asporto)+n(r.cena.asporto)+n(r.banchetti.asporto); bancone += n(r.bancone); pizze += n(r.pizze); }); $("rCopPranzo").textContent = copPranzo; $("rCopCena").textContent = copCena; $("rCopBanchetti").textContent = copBanchetti; $("rIncasso").textContent = euro(incasso); $("reportSummary").innerHTML = [`<div class="item"><div><strong>Totale coperti complessivi</strong><small>pranzo + cena + banchetti</small></div><div>${copPranzo + copCena + copBanchetti}</div></div>`,`<div class="item"><div><strong>Asporto totale</strong><small>somma delle tre colonne</small></div><div>${euro(asporto)}</div></div>`,`<div class="item"><div><strong>Bancone totale</strong><small>incasso registrato a bancone</small></div><div>${euro(bancone)}</div></div>`,`<div class="item"><div><strong>Pizze totali</strong><small>somma delle giornate del mese</small></div><div>${pizze}</div></div>`,`<div class="item"><div><strong>Giornate presenti</strong><small>schede giornaliere salvate nel mese</small></div><div>${records.length}</div></div>`].join(""); }
function renderAll(){ renderDashboard(); renderDailyTable(); renderCash(); renderSuppliers(); renderEmployees(); renderBookings(); runMonthlyReport(); }

function bindEvents(){
  document.querySelectorAll(".nav-btn[data-section]").forEach(btn => btn.addEventListener("click", () => navigate(btn.dataset.section)));
  document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", () => setAuthTab(btn.dataset.authTab)));
  $("loginBtn").addEventListener("click", login);
  $("registerBtn").addEventListener("click", register);
  $("logoutBtn").addEventListener("click", logout);
  $("selectorLogoutBtn").addEventListener("click", logout);
  $("enterCompanyBtn").addEventListener("click", async () => { if(!selectedCompanyId){ alert("Seleziona una ditta."); return; } await openCompany(selectedCompanyId); });
  $("switchCompanyBtn").addEventListener("click", async () => { if(isSupervisor() || state.memberships.length > 1) renderCompanySelector(); });
  $("saveDayBtn").addEventListener("click", saveDaily);
  $("saveCashInitBtn").addEventListener("click", saveCashInitial);
  safeEl("saveNewCashBtn")?.addEventListener("click", saveNewCash);
  $("saveMovBtn").addEventListener("click", saveCashMovement);
  $("saveFornBtn").addEventListener("click", saveSupplier);
  $("saveFornMovBtn").addEventListener("click", saveSupplierMovement);
  $("saveDipBtn").addEventListener("click", saveEmployee);
  $("saveDipMovBtn").addEventListener("click", saveEmployeeMovement);
  $("saveBanBtn").addEventListener("click", saveBooking);
  $("runReportBtn").addEventListener("click", runMonthlyReport);
  $("refreshBtn").addEventListener("click", () => refreshData("Dati aggiornati dal cloud."));
  $("backupBtn").addEventListener("click", exportBackup);
  $("importFile").addEventListener("change", (e) => e.target.files[0] && importBackup(e.target.files[0]));
}
async function main(){
  try{
    bindEvents();
    seedFields();
    const ok = await initSupabase();
    if(!ok) return;
    supabase.auth.onAuthStateChange(async (_event, session) => { state.session = session; });
    if(state.session) await bootstrapAfterAuth();
    else { hideAllViews(); $("authView").classList.remove("hidden"); }
  }catch(err){
    console.error("Errore main:", err);
    hideAllViews();
    $("authView").classList.remove("hidden");
    showAuthMessage("Errore avvio app: " + (err?.message || err), true);
  }
}
main();
