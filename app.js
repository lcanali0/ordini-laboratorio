// reparti di partenza: quelli veri si cambiano da Impostazioni
const REPARTI_BASE = [
  { id: "torte", nome: "Torte", colore: "#b8325a", unita: ["torte", "persone", "kg"] },
  { id: "biscotti", nome: "Biscotti", colore: "#7254a8", unita: ["kg", "pezzi", "vassoi"] },
  { id: "dolci", nome: "Dolci", colore: "#2f6f8f", unita: ["kg", "pezzi", "vassoi"] },
  { id: "salateria", nome: "Salateria", colore: "#3f7d4e", unita: ["kg", "quantità"] },
  { id: "pane", nome: "Pane", colore: "#9a5b1e", unita: ["kg", "pezzi"] },
];
let REPARTI = REPARTI_BASE;
const STATI = [
  { id: "da_fare", nome: "Da fare" },
  { id: "in_lavorazione", nome: "In lavorazione" },
  { id: "pronto", nome: "Pronto" },
];
function unitaPer(rep) {
  const r = REPARTI.find(x => x.id === rep);
  return r && Array.isArray(r.unita) && r.unita.length ? r.unita : ["pezzi", "kg"];
}
const repColor = id => (REPARTI.find(r => r.id === id) || {}).colore || "#888888";
function fillUnita(sel, rep, keep) {
  const list = rep ? unitaPer(rep).slice() : ["scegli prima il reparto"];
  if (keep && !list.includes(keep)) list.push(keep);
  sel.textContent = "";
  list.forEach(u => { const op = el("option", null, u); op.value = rep ? u : ""; sel.append(op); });
  sel.value = keep && list.includes(keep) ? keep : (rep ? list[0] : "");
  sel.disabled = !rep;
}
const statoNome = id => (STATI.find(s => s.id === id) || STATI[0]).nome;
const repNome = id => (REPARTI.find(r => r.id === id) || { nome: id || "?" }).nome;

const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

let orders = [];
let clienti = [];
let operatori = [];
let formClienteId = null;
let editingCliente = null;
let cliSearch = "";
let config = {};
let live = false;
let sb = null;           // collegamento a Supabase
let utente = null;       // email di chi è entrato
let sonoAdmin = false;
let arcSearch = "", arcDay = "";
let view = "lista";
let filterDep = store.get("rep") || "tutti";
let filterDay = "oggi";
let pickedDate = "";
let calMonth = new Date(); calMonth.setDate(1);
let editing = null;      // ordine in modifica
let formTipo = "ordine";
let formFoto = [];       // id foto nel modulo
let uploading = 0;

// date e soldi
const pad = n => String(n).padStart(2, "0");
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDay(new Date());
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return isoDay(d); };
const parseIso = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const longDay = iso => parseIso(iso).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
const fmtDay = iso => {
  if (iso === today()) return "Oggi";
  if (iso === tomorrow()) return "Domani";
  const s = longDay(iso);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const parseEuro = s => {
  if (s == null || String(s).trim() === "") return null;
  const n = Number(String(s).replace(/[€\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const euro = n => "€ " + n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function articoli(o) { return Array.isArray(o.articoli) ? o.articoli : []; }
function orderReady(o) { const a = articoli(o); return a.length > 0 && a.every(x => x.stato === "pronto"); }

// esempi mostrati solo finché il collegamento non risponde
function inDayFilter(o) {
  if (filterDay === "oggi") return o.data === today();
  if (filterDay === "domani") return o.data === tomorrow();
  if (filterDay === "tutti") return o.data >= today();
  if (filterDay === "giorno") return o.data === pickedDate;
  return true;
}
function visible() {
  const showDone = $("showDone").checked;
  return orders.filter(o => {
    if (o.annullato) return false;
    if (filterDep !== "tutti" && !articoli(o).some(a => a.reparto === filterDep)) return false;
    if (!showDone && o.consegnato) return false;
    return inDayFilter(o);
  }).sort((a, b) => ((a.data || "") + (a.ora || "")).localeCompare((b.data || "") + (b.ora || "")));
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function dot(rep) { const d = el("span", "dot"); d.style.background = repColor(rep); return d; }

function renderChips() {
  const base = orders.filter(o => !o.consegnato && !o.annullato && inDayFilter(o));
  const count = id => id === "tutti" ? base.length : base.filter(o => articoli(o).some(a => a.reparto === id)).length;
  const wrap = $("depChips");
  wrap.textContent = "";
  for (const r of [{ id: "tutti", nome: "Tutti" }, ...REPARTI]) {
    const b = el("button", "chip");
    b.setAttribute("aria-pressed", String(filterDep === r.id));
    if (r.id !== "tutti") b.append(dot(r.id));
    b.append(r.nome);
    if (view === "lista") b.append(el("span", "n", count(r.id)));
    b.onclick = () => { filterDep = r.id; store.set("rep", r.id); render(); };
    wrap.append(b);
  }
  for (const k of ["oggi", "domani", "tutti"]) $("d-" + k).setAttribute("aria-pressed", String(filterDay === k));
  $("dayBar").hidden = view !== "lista";
  $("depChips").hidden = view === "cli" || view === "arc";
  $("v-lista").setAttribute("aria-pressed", String(view === "lista"));
  $("v-cal").setAttribute("aria-pressed", String(view === "cal"));
  $("v-cli").setAttribute("aria-pressed", String(view === "cli"));
  $("v-arc").setAttribute("aria-pressed", String(view === "arc"));
}

function card(o) {
  const c = el("article", "card" + (o.annullato ? " ann" : o.consegnato ? " done" : ""));
  const head = el("div", "c-head");
  head.append(el("div", "time", o.ora || "--:--"));
  if (view === "arc") head.firstChild.title = o.data ? fmtDay(o.data) : "";
  const who = el("div", "who");
  who.append(el("div", "cli", o.cliente || "Cliente senza nome"));
  const sub = [o.telefono, o.autore ? "inserito da " + o.autore : ""].filter(Boolean).join(" · ");
  if (sub) who.append(el("div", "sub", sub));
  head.append(who);
  if (o.annullato) head.append(el("span", "badge ann", "Annullato"));
  else if (o.consegnato) head.append(el("span", "badge cons", "Consegnato"));
  else if (o.tipo === "preventivo") head.append(el("span", "badge prev", "Preventivo"));
  else if (orderReady(o)) head.append(el("span", "badge ready", "Tutto pronto"));
  else head.append(el("span"));
  c.append(head);

  const all = articoli(o);
  const shown = filterDep === "tutti" ? all : all.filter(a => a.reparto === filterDep);
  const ul = el("ul", "items");
  shown.forEach(a => {
    const idx = all.indexOf(a);
    const li = el("li", "item");
    li.style.setProperty("--dep", repColor(a.reparto));
    li.append(el("span", "bar"));
    const t = el("div", "t");
    t.append(el("div", "r", repNome(a.reparto)));
    const p = el("div", "p");
    if (a.quantita) p.append(el("span", "q", `${a.quantita} ${a.unita || ""} `));
    p.append(a.prodotto || "");
    t.append(p);
    if (a.note) t.append(el("div", "in", a.note));
    li.append(t);
    const s = el("button", "status", statoNome(a.stato));
    s.dataset.s = a.stato || "da_fare";
    s.title = "Tocca per passare allo stato successivo";
    s.onclick = () => advance(o, idx);
    if (o.annullato) s.disabled = true;
    li.append(s);
    ul.append(li);
  });
  c.append(ul);
  if (shown.length < all.length) {
    const altri = [...new Set(all.filter(a => a.reparto !== filterDep).map(a => repNome(a.reparto)))];
    c.append(el("div", "others", `Nello stesso ordine anche: ${altri.join(", ")}`));
  }
  if (o.note) c.append(el("div", "note", o.note));

  if (Array.isArray(o.foto) && o.foto.length) {
    const th = el("div", "thumbs");
    for (const id of o.foto) {
      const b = el("button");
      b.setAttribute("aria-label", "Apri foto");
      const img = el("img"); img.alt = ""; img.loading = "lazy"; setFoto(img, id);
      img.onerror = () => { b.hidden = true; };
      b.append(img);
      b.onclick = () => { $("viewerImg").removeAttribute("src"); setFoto($("viewerImg"), id); $("viewer").hidden = false; };
      th.append(b);
    }
    c.append(th);
  }

  const prezzo = typeof o.prezzo === "number" ? o.prezzo : null;
  const cap = typeof o.caparra === "number" ? o.caparra : null;
  if (prezzo != null || cap != null) {
    const m = el("div", "money");
    if (prezzo != null) { const s = el("span", null, "Totale "); s.append(el("b", null, euro(prezzo))); m.append(s); }
    if (cap != null) { const s = el("span", null, "Caparra "); s.append(el("b", null, euro(cap))); m.append(s); }
    if (prezzo != null) { const s = el("span", "due", "Da saldare "); s.append(el("b", null, euro(Math.max(0, prezzo - (cap || 0))))); m.append(s); }
    c.append(m);
  }

  const act = el("div", "c-actions");
  const send = el("button", "sbtn wa", "Invia al cliente");
  send.onclick = () => openSend(o);
  const ed = el("button", "sbtn", "Apri / modifica");
  ed.onclick = () => openForm(o);
  const ok = el("button", "sbtn ok", o.consegnato ? "Segna non consegnato" : "Consegnato ✓");
  ok.onclick = () => toggleDelivered(o);
  if (o.annullato) {
    const rip = el("button", "sbtn ok", "Ripristina ordine");
    rip.onclick = () => restoreOrder(o);
    act.append(ed, rip);
  } else act.append(send, ed, ok);
  c.append(act);
  return c;
}

function renderList(list) {
  const rows = visible();
  if (!rows.length) {
    const e = el("div", "empty");
    e.append(el("strong", null, "Nessun ordine qui"));
    e.append(el("span", null, orders.length ? "Prova un altro reparto o un altro giorno." : "Tocca “+ Nuovo ordine” per inserire il primo."));
    list.append(e);
    return;
  }
  const byDay = new Map();
  for (const o of rows) { if (!byDay.has(o.data)) byDay.set(o.data, []); byDay.get(o.data).push(o); }
  for (const [day, items] of byDay) {
    const g = el("section", "group");
    const h = el("h2", null, day ? fmtDay(day) : "Senza data");
    h.append(el("span", null, items.length === 1 ? "1 ordine" : `${items.length} ordini`));
    g.append(h);
    for (const o of items) g.append(card(o));
    list.append(g);
  }
}

function renderCal(list) {
  const box = el("section", "cal");
  const head = el("div", "cal-head");
  const prev = el("button", "iconbtn", "‹"); prev.setAttribute("aria-label", "Mese precedente");
  const next = el("button", "iconbtn", "›"); next.setAttribute("aria-label", "Mese successivo");
  prev.onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); render(); };
  next.onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); render(); };
  head.append(prev, el("h2", null, calMonth.toLocaleDateString("it-IT", { month: "long", year: "numeric" })), next);
  box.append(head);

  const grid = el("div", "cal-grid");
  for (const d of ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]) grid.append(el("div", "cal-dow", d));
  const first = new Date(calMonth);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const relevant = orders.filter(o => !o.consegnato && !o.annullato && (filterDep === "tutti" || articoli(o).some(a => a.reparto === filterDep)));
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i === 35 && d.getMonth() !== calMonth.getMonth()) break;
    const iso = isoDay(d);
    const dayOrders = relevant.filter(o => o.data === iso);
    const b = el("button", "cal-day" + (d.getMonth() !== calMonth.getMonth() ? " out" : "") + (iso === today() ? " today" : ""));
    b.append(el("span", "dn", d.getDate()));
    if (dayOrders.length) {
      b.append(el("span", "cnt", dayOrders.length === 1 ? "1 ordine" : dayOrders.length + " ordini"));
      const dots = el("span", "dots");
      const reps = new Set();
      dayOrders.forEach(o => articoli(o).forEach(a => reps.add(a.reparto)));
      REPARTI.filter(r => reps.has(r.id)).forEach(r => dots.append(dot(r.id)));
      b.append(dots);
    }
    b.setAttribute("aria-label", `${longDay(iso)}: ${dayOrders.length} ordini`);
    b.onclick = () => { pickedDate = iso; filterDay = "giorno"; $("dayPick").value = iso; view = "lista"; render(); };
    grid.append(b);
  }
  box.append(grid);
  const lg = el("div", "legend-row");
  REPARTI.forEach(r => { const s = el("span"); s.append(dot(r.id), r.nome); lg.append(s); });
  box.append(lg);
  box.append(el("div", "hint", "Tocca un giorno per vedere i suoi ordini. I consegnati non sono contati."));
  list.append(box);
}

function render() {
  renderChips();
  $("shopTitle").textContent = config.nome || "Ordini del laboratorio";
  const list = $("list");
  list.textContent = "";
  if (!live) list.append(el("div", "demo", "Carico gli ordini…"));
  const focusId = document.activeElement && document.activeElement.id;
  if (view === "lista") renderReminder(list);
  if (view === "cal") renderCal(list); else if (view === "cli") renderClienti(list); else if (view === "arc") renderArchivio(list); else renderList(list);
  if ((focusId === "cliSearch" || focusId === "arcSearch") && $(focusId)) { const n = $(focusId); n.focus(); if (n.type === "search") n.setSelectionRange(n.value.length, n.value.length); }
}

/* ---------- anagrafica clienti ---------- */
const fullName = c => [c.nome, c.cognome].filter(Boolean).join(" ");
const digits = s => String(s || "").replace(/\D/g, "").replace(/^(0039|39)(?=3\d{8,9}$)/, "");
function matchClienti(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const qd = q.replace(/\D/g, "");
  return clienti.filter(c => !c.archiviato).filter(c => fullName(c).toLowerCase().includes(q) || (c.cognome || "").toLowerCase().startsWith(q) || (qd.length >= 3 && digits(c.telefono).includes(qd)));
}
function ordiniDi(c) {
  return orders.filter(o => o.clienteId === c.id || (!o.clienteId && c.telefono && digits(o.telefono) === digits(c.telefono)));
}
function renderClienti(list) {
  const tools = el("div", "cli-tools");
  const s = el("input"); s.type = "search"; s.id = "cliSearch"; s.placeholder = "Cerca cliente per nome o telefono"; s.value = cliSearch;
  s.oninput = () => { cliSearch = s.value; render(); };
  const add = el("button", "btn", "+ Cliente"); add.onclick = () => openCliente(null);
  tools.append(s, add);
  list.append(tools);
  const rows = (cliSearch.trim() ? matchClienti(cliSearch) : clienti.filter(c => !c.archiviato)).slice().sort((a, b) => (a.cognome || a.nome || "").localeCompare(b.cognome || b.nome || "", "it"));
  if (!rows.length) {
    const e = el("div", "empty");
    e.append(el("strong", null, clienti.length ? "Nessun cliente trovato" : "Anagrafica vuota"));
    e.append(el("span", null, clienti.length ? "Prova con un altro nome o numero." : "I clienti si salvano qui da soli quando inserisci un ordine, oppure tocca “+ Cliente”."));
    list.append(e);
    return;
  }
  const g = el("section", "group");
  g.append(el("h2", null, rows.length === 1 ? "1 cliente" : rows.length + " clienti"));
  for (const c of rows) {
    const k = el("article", "ccard");
    k.append(el("div", "cn", fullName(c) || "Senza nome"));
    const sub = [c.telefono, c.email].filter(Boolean).join(" · ");
    if (sub) k.append(el("div", "cs", sub));
    if (c.note) k.append(el("div", "note", c.note));
    const os = ordiniDi(c).sort((a, b) => (b.data || "").localeCompare(a.data || "")).slice(0, 5);
    if (os.length) {
      const ul = el("ul");
      for (const o of os) {
        const li = el("li");
        li.append(el("span", "d", o.data ? parseIso(o.data).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "--"));
        li.append(el("span", "w", (o.tipo === "preventivo" ? "Preventivo: " : "") + articoli(o).map(a => a.prodotto).join(", ")));
        li.onclick = () => openForm(o);
        ul.append(li);
      }
      k.append(ul);
    }
    const act = el("div", "c-actions");
    const no = el("button", "sbtn wa", "Nuovo ordine"); no.onclick = () => openForm(null, c);
    const ed = el("button", "sbtn", "Modifica dati"); ed.onclick = () => openCliente(c);
    act.append(no, ed);
    k.append(act);
    g.append(k);
  }
  list.append(g);
}
function openCliente(c) {
  editingCliente = c;
  $("cliTitle").textContent = c ? "Modifica cliente" : "Nuovo cliente";
  $("k-nome").value = c ? c.nome || "" : "";
  $("k-cognome").value = c ? c.cognome || "" : "";
  $("k-telefono").value = c ? c.telefono || "" : "";
  $("k-email").value = c ? c.email || "" : "";
  $("k-note").value = c ? c.note || "" : "";
  $("cliDel").hidden = !c; $("cliDel").textContent = "Archivia"; delete $("cliDel").dataset.confirm;
  $("cliErr").hidden = true;
  $("cliBg").hidden = false;
}
async function saveCliente(ev) {
  ev.preventDefault();
  const err = m => { $("cliErr").textContent = m; $("cliErr").hidden = false; };
  const d = { nome: $("k-nome").value.trim(), cognome: $("k-cognome").value.trim(), telefono: $("k-telefono").value.trim(), email: $("k-email").value.trim(), note: $("k-note").value.trim(), aggiornato: new Date().toISOString() };
  const manca = [!d.nome && "il nome", !d.cognome && "il cognome", digits(d.telefono).length < 6 && "il telefono"].filter(Boolean);
  if (manca.length) return err("Manca " + manca.join(", ") + " del cliente. L'email invece è facoltativa.");
  if (!live) return err("Non collegato: non posso salvare adesso.");
  try {
    if (editingCliente) await api.update("clienti", editingCliente.id, d);
    else {
      d.creato = d.aggiornato;
      const id = await api.create("clienti", d);
      if (anagPerOrdine) {
        await api.update("ordini", anagPerOrdine.id, { clienteId: id });
        if (sendOrder && sendOrder.id === anagPerOrdine.id) sendOrder = { ...sendOrder, clienteId: id };
      }
    }
    anagPerOrdine = null;
    if (!$("sendBg").hidden) refreshSendLinks();
    $("cliBg").hidden = true; toast("Cliente salvato");
  } catch (e) { err(writeError(e)); }
}
async function deleteCliente() {
  const b = $("cliDel");
  if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "Tocca di nuovo per archiviare"; return; }
  try { await api.update("clienti", editingCliente.id, { archiviato: true, aggiornato: new Date().toISOString() }); $("cliBg").hidden = true; toast("Cliente archiviato. I suoi ordini restano."); }
  catch (e) { $("cliErr").textContent = writeError(e); $("cliErr").hidden = false; }
}

// nel modulo ordine
function setFormCliente(c) {
  formClienteId = c ? c.id : null;
  $("f-nome").value = c ? c.nome || "" : "";
  $("f-cognome").value = c ? c.cognome || "" : "";
  $("f-telefono").value = c ? c.telefono || "" : "";
  $("f-email").value = c ? c.email || "" : "";
  $("f-cerca").value = "";
  $("sugg").textContent = "";
  $("cliState").textContent = c ? "dall'anagrafica" : "nuovo cliente";
}
function renderSugg() {
  const box = $("sugg");
  box.textContent = "";
  for (const c of matchClienti($("f-cerca").value).slice(0, 5)) {
    const b = el("button"); b.type = "button";
    b.append(el("b", null, fullName(c) || "Senza nome"));
    b.append(el("span", null, [c.telefono, c.email].filter(Boolean).join(" · ") || "nessun recapito"));
    b.onclick = () => setFormCliente(c);
    box.append(b);
  }
  if ($("f-cerca").value.trim() && !box.children.length) box.append(el("span", "hint", "Nessun cliente trovato: compila i campi qui sotto e verrà aggiunto all'anagrafica."));
}
// salva o aggiorna il cliente dell'ordine e ne restituisce l'id
async function upsertCliente(d) {
  let id = formClienteId;
  if (!id && d.telefono) { const same = clienti.find(c => digits(c.telefono) && digits(c.telefono) === digits(d.telefono)); if (same) { id = same.id; if (same.archiviato) await api.update("clienti", id, { archiviato: false }); } }
  const now = new Date().toISOString();
  if (id) {
    const cur = clienti.find(c => c.id === id) || {};
    const patch = {};
    for (const k of ["nome", "cognome", "telefono", "email"]) if (d[k] && d[k] !== cur[k]) patch[k] = d[k];
    if (Object.keys(patch).length) { patch.aggiornato = now; await api.update("clienti", id, patch); }
    return id;
  }
  return await api.create("clienti", { ...d, note: "", creato: now, aggiornato: now });
}
const nomiOperatori = () => operatori.map(o => o.nome).filter(Boolean).sort((a, b) => a.localeCompare(b, "it"));
function fillOperatoreSelect(keep) {
  const sel = $("f-operatore");
  const cur = keep != null ? keep : sel.value;
  sel.textContent = "";
  const ph = el("option", null, "Scegli il tuo nome…"); ph.value = "";
  sel.append(ph);
  for (const n of nomiOperatori()) { const op = el("option", null, n); op.value = n; sel.append(op); }
  sel.value = nomiOperatori().includes(cur) ? cur : "";
  $("opHint").textContent = nomiOperatori().length ? "" : "L'elenco operatori è vuoto: aggiungili da Impostazioni (⚙ in alto).";
}
function renderOperatori() {
  fillOperatoreSelect();
  const box = $("opList");
  box.textContent = "";
  for (const o of operatori.slice().sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "it"))) {
    const row = el("div", "cli-tools");
    row.append(el("span", null, o.nome));
    row.firstChild.style.flex = "1";
    const rm = el("button", "sbtn", "Togli"); rm.type = "button";
    rm.onclick = async () => {
      if (!rm.dataset.confirm) { rm.dataset.confirm = "1"; rm.textContent = "Sicura? Tocca ancora"; return; }
      try { await api.remove("operatori", o.id); } catch (e) { toast(writeError(e)); }
    };
    row.append(rm);
    box.append(row);
  }
  if (!operatori.length) box.append(el("span", "hint", "Nessun operatore ancora."));
}
async function addOperatore() {
  const name = $("opNew").value.trim().replace(/\s+/g, " ");
  if (!name) return;
  if (!live) { toast("Non collegato: non posso salvare adesso."); return; }
  if (operatori.some(o => (o.nome || "").toLowerCase() === name.toLowerCase())) { toast("È già nell'elenco"); return; }
  try { await api.create("operatori", { nome: name, creato: new Date().toISOString() }); $("opNew").value = ""; toast(name + " aggiunto all'elenco"); }
  catch (e) { toast(writeError(e)); }
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}
function needLive() {
  if (live) return true;
  toast("Non collegato: non posso salvare adesso.");
  return false;
}
function writeError(e) {
  const code = e && e.code;
  if (code === "42501" || /row-level security|permission/i.test((e && e.message) || "")) return "Non hai il permesso per questa modifica. Chiedi a Rosa.";
  if (e && /storage|quota|exceed/i.test(e.message || "")) return "Spazio pieno o caricamento non riuscito.";
  return "Salvataggio non riuscito. Controlla la connessione e riprova.";
}
// chi sta lavorando su questo dispositivo: l'ultimo operatore scelto, altrimenti l'email
const chiSono = () => store.get("autore") || utente || "";

async function advance(o, idx) {
  if (!needLive()) return;
  const arts = articoli(o).map(a => ({ ...a }));
  const i = STATI.findIndex(s => s.id === arts[idx].stato);
  arts[idx].stato = STATI[(i + 1) % STATI.length].id;
  try { await api.update("ordini", o.id, { articoli: arts, modificatoDa: chiSono(), aggiornato: new Date().toISOString() }); }
  catch (e) { toast(writeError(e)); }
}
async function toggleDelivered(o) {
  if (!needLive()) return;
  try {
    await api.update("ordini", o.id, { consegnato: !o.consegnato, modificatoDa: chiSono(), aggiornato: new Date().toISOString() });
    toast(o.consegnato ? "Ordine riaperto" : "Segnato come consegnato");
  } catch (e) { toast(writeError(e)); }
}

/* ---------- modulo ordine ---------- */
let artSeq = 0;
function addArtRow(a) {
  const n = ++artSeq;
  const box = el("div", "art");
  box.dataset.stato = (a && a.stato) || "da_fare";
  const top = el("div", "art-top");
  top.append(el("span", "legend", "Prodotto"));
  const rm = el("button", "sbtn", "Togli");
  rm.type = "button";
  rm.onclick = () => { if ($("arts").children.length > 1) box.remove(); else toast("Serve almeno un prodotto"); };
  top.append(rm);
  box.append(top);

  const deps = el("div", "deps");
  deps.setAttribute("role", "radiogroup");
  deps.setAttribute("aria-label", "Reparto");
  const def = a ? a.reparto : (filterDep !== "tutti" ? filterDep : "");
  for (const r of REPARTI) {
    const l = el("label");
    l.style.setProperty("--dep", repColor(r.id));
    const i = el("input");
    i.type = "radio"; i.name = "rep" + n; i.value = r.id; i.id = `rep${n}-${r.id}`;
    i.checked = r.id === def;
    i.onchange = () => { box.style.setProperty("--dep", repColor(r.id)); fillUnita(su, r.id, null); fillProdotti(r.id); };
    l.append(i, dot(r.id), r.nome);
    deps.append(l);
  }
  if (def) box.style.setProperty("--dep", repColor(def));
  box.append(deps);

  const fp = el("div", "field");
  const lp = el("label", null, "Cosa"); lp.htmlFor = `a${n}-prodotto`;
  const ip = el("input"); ip.id = `a${n}-prodotto`; ip.className = "a-prodotto"; ip.placeholder = "Es. Torta millefoglie, biscotti al burro, pizzette, pane casereccio";
  ip.value = a ? a.prodotto || "" : "";
  // reparti con una lista di prodotti (Impostazioni): si sceglie dal menu invece di scrivere
  const sp = el("select"); sp.id = `a${n}-prodotto-sel`; sp.className = "a-prodotto-sel"; sp.hidden = true;
  const fillProdotti = (repId, valore) => {
    const r = REPARTI.find(x => x.id === repId);
    const lista = r && Array.isArray(r.prodotti) ? r.prodotti.filter(Boolean) : [];
    if (!lista.length) {
      sp.hidden = true; ip.hidden = false; lp.htmlFor = ip.id; return;
    }
    const attuale = valore != null ? valore : (sp.hidden ? ip.value.trim() : sp.value);
    sp.textContent = "";
    const vuoto = el("option", null, "Scegli il prodotto…"); vuoto.value = ""; sp.append(vuoto);
    const voci = attuale && !lista.includes(attuale) ? [attuale, ...lista] : lista;   // un ordine vecchio tiene il suo prodotto
    for (const v of voci) { const o = el("option", null, v); o.value = v; sp.append(o); }
    sp.value = voci.includes(attuale) ? attuale : "";
    sp.hidden = false; ip.hidden = true; lp.htmlFor = sp.id;
  };
  fp.append(lp, ip, sp);
  box.append(fp);
  fillProdotti(def, a ? a.prodotto || "" : null);

  const row = el("div", "row");
  const fq = el("div", "field");
  const lq = el("label", null, "Quantità"); lq.htmlFor = `a${n}-q`;
  const iq = el("input"); iq.id = `a${n}-q`; iq.className = "a-q"; iq.inputMode = "decimal"; iq.placeholder = "Es. 2";
  iq.value = a ? a.quantita || "" : "";
  fq.append(lq, iq);
  const fu = el("div", "field");
  const lu = el("label", null, "Unità"); lu.htmlFor = `a${n}-u`;
  const su = el("select"); su.id = `a${n}-u`; su.className = "a-u";
  fillUnita(su, def, a ? a.unita : null);
  fu.append(lu, su);
  row.append(fq, fu);
  box.append(row);

  const fn = el("div", "field");
  const ln = el("label", null, "Note per il reparto"); ln.htmlFor = `a${n}-n`;
  const tn = el("textarea"); tn.id = `a${n}-n`; tn.className = "a-n"; tn.placeholder = "Scritta, gusto, decorazione…";
  tn.value = a ? a.note || "" : "";
  fn.append(ln, tn);
  box.append(fn);

  $("arts").append(box);
  return box;
}

function renderPhotos() {
  const wrap = $("photos");
  wrap.textContent = "";
  for (const id of formFoto) {
    const p = el("div", "ph");
    const img = el("img"); img.alt = "Foto di riferimento"; setFoto(img, id);
    const x = el("button", null, "✕"); x.type = "button"; x.setAttribute("aria-label", "Togli foto");
    x.onclick = () => { formFoto = formFoto.filter(f => f !== id); renderPhotos(); };
    p.append(img, x);
    wrap.append(p);
  }
  for (let i = 0; i < uploading; i++) wrap.append(el("div", "ph loading", "Carico…"));
  if (live) {
    const l = el("label", "addph");
    l.append("+ Foto");
    const inp = el("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true; inp.id = "photoInput";
    inp.onchange = () => { addPhotos([...inp.files]); inp.value = ""; };
    l.append(inp);
    wrap.append(l);
    $("photoHint").textContent = "Scatta o scegli le foto (torta da copiare, decorazione, scritta).";
  } else {
    $("photoHint").textContent = "Le foto si possono aggiungere quando l'app è collegata.";
  }
}

// riduce le foto del telefono prima di caricarle
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const max = 1600, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.82));
    return blob || file;
  } catch { return file; }
}
async function addPhotos(files) {
  if (!live) return;
  for (const f of files) {
    uploading++; renderPhotos();
    try {
      const b = await shrink(f);
      const type = b.type && b.type.startsWith("image/") ? b.type : "image/jpeg";
      const name = crypto.randomUUID() + (type === "image/png" ? ".png" : ".jpg");
      const { error } = await sb.storage.from("foto").upload(name, b, { contentType: type, upsert: false });
      if (error) throw error;
      formFoto.push(name);
    } catch (e) {
      toast(/exceed|quota|size/i.test((e && e.message) || "") ? "Spazio per le foto esaurito o foto troppo grande" : "Caricamento foto non riuscito");
    }
    uploading--; renderPhotos();
  }
}

function setTipo(t) {
  formTipo = t;
  $("t-ordine").setAttribute("aria-pressed", String(t === "ordine"));
  $("t-preventivo").setAttribute("aria-pressed", String(t === "preventivo"));
}
function updateSaldo() {
  const p = parseEuro($("f-prezzo").value), c = parseEuro($("f-caparra").value);
  const s = $("saldo");
  s.textContent = "";
  if (p == null || isNaN(p)) return;
  s.append("Da saldare al ritiro: ");
  s.append(el("b", null, euro(Math.max(0, p - (c && !isNaN(c) ? c : 0)))));
}

/* ---------- preavviso minimo per reparto (es. Biscotti) ---------- */
let formSblocco = null;   // sblocco dato dal PIN dei titolari, vale per un salvataggio
const repList = arts => arts.map(a => a.reparto).join(",");
// giorni lavorativi: il laboratorio è chiuso il lunedì e nelle festività
function pasqua(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mese = Math.floor((h + l - 7 * m + 114) / 31);
  return new Date(y, mese - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
const FESTE = ["01-01", "01-06", "04-25", "05-01", "06-02", "08-15", "11-01", "12-08", "12-25", "12-26"];
function chiuso(d) {
  if (d.getDay() === 1) return true;
  const md = isoDay(d).slice(5);
  if (FESTE.includes(md)) return true;
  const p = pasqua(d.getFullYear());
  return isoDay(p) === isoDay(d);
}
function giorniLavorativi(dataIso) {
  const fine = parseIso(dataIso), d = parseIso(today());
  let n = 0;
  for (let i = 0; i < 400 && d < fine; i++) { d.setDate(d.getDate() + 1); if (!chiuso(d)) n++; }
  return n;
}
function serveSblocco(arts, data) {
  if (!data) return null;
  // come nel database: si controlla solo se cambiano il giorno o i reparti
  if (editing && !editing.annullato && editing.data === data && repList(articoli(editing)) === repList(arts)) return null;
  const giorni = giorniLavorativi(data);
  let peggio = null;
  for (const a of arts) {
    const r = REPARTI.find(x => x.id === a.reparto);
    const g = r ? Number(r.giorniMinimi) || 0 : 0;
    if (g > giorni && (!peggio || g > peggio.minimo)) peggio = { nome: r.nome, minimo: g, giorni, lavorativi: true };
  }
  return peggio;
}
function mostraPin(p) {
  const quando = p.lavorativi ? (p.giorni <= 0 ? "non c'è nessun giorno lavorativo prima del ritiro" : p.giorni === 1 ? "prima del ritiro c'è solo 1 giorno lavorativo" : `prima del ritiro ci sono solo ${p.giorni} giorni lavorativi`)
    : "il ritiro è " + (p.giorni <= 0 ? "oggi" : p.giorni === 1 ? "domani" : `tra ${p.giorni} giorni`);
  $("pinMsg").textContent = `${p.nome}: servono almeno ${p.minimo} giorni lavorativi di preparazione, ma ${quando}. Per accettare l'ordine lo stesso serve il PIN dei titolari.`;
  $("pinErr").hidden = true;
  $("pinInput").value = "";
  $("pinBox").hidden = false;
  $("formErr").hidden = true;
  $("pinBox").scrollIntoView({ block: "center", behavior: "smooth" });
  $("pinInput").focus({ preventScroll: true });
}
async function sbloccaConPin() {
  const pinErr = m => { $("pinErr").textContent = m; $("pinErr").hidden = false; };
  const pin = $("pinInput").value.trim();
  if (!pin) return pinErr("Scrivi il PIN.");
  $("pinBtn").disabled = true;
  const { data, error } = await sb.rpc("sblocca_con_pin", { p_pin: pin });
  $("pinBtn").disabled = false;
  if (error) {
    const m = error.message || "";
    return pinErr(/PIN_SBAGLIATO/.test(m) ? "PIN sbagliato." : /PIN_MANCANTE/.test(m) ? "I titolari non hanno ancora scelto un PIN: si imposta in Impostazioni." : "Non riesco a controllare il PIN. Riprova.");
  }
  formSblocco = data;
  $("pinBox").hidden = true;
  $("form").requestSubmit();
}

function openForm(o, cliente) {
  editing = o || null;
  formSblocco = null;
  $("pinBox").hidden = true;
  $("formTitle").textContent = o ? (o.tipo === "preventivo" ? "Preventivo" : "Ordine") + (o.cliente ? " di " + o.cliente : "") : "Nuovo ordine";
  $("delBtn").hidden = !o || !!o.annullato;
  $("delBtn").textContent = o && o.tipo === "preventivo" ? "Annulla preventivo" : "Annulla ordine";
  delete $("delBtn").dataset.confirm;
  $("formErr").hidden = true;
  setTipo(o ? o.tipo || "ordine" : "ordine");
  if (o) {
    const c = clienti.find(k => k.id === o.clienteId);
    if (c) setFormCliente(c);
    else {
      setFormCliente(null);
      const parts = (o.cliente || "").split(" ");
      $("f-nome").value = o.nome != null ? o.nome : parts.shift() || "";
      $("f-cognome").value = o.cognome != null ? o.cognome : parts.join(" ");
      $("f-telefono").value = o.telefono || "";
      $("f-email").value = o.email || "";
    }
  } else setFormCliente(cliente || null);
  $("f-data").value = o ? o.data || "" : (filterDay === "domani" ? tomorrow() : filterDay === "giorno" && pickedDate ? pickedDate : today());
  $("f-ora").value = o ? o.ora || "" : "";
  $("f-prezzo").value = o && typeof o.prezzo === "number" ? String(o.prezzo).replace(".", ",") : "";
  $("f-caparra").value = o && typeof o.caparra === "number" ? String(o.caparra).replace(".", ",") : "";
  $("f-note").value = o ? o.note || "" : "";
  fillOperatoreSelect(store.get("autore") || "");
  const storia = [];
  if (o && o.autore) storia.push(`Inserito da ${o.autore}${o.creato ? " il " + new Date(o.creato).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : ""}.`);
  if (o && o.modificatoDa && o.aggiornato) storia.push(`Ultima modifica: ${o.modificatoDa}, ${new Date(o.aggiornato).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}.`);
  $("f-storia").textContent = storia.join(" ");
  loadStorico(o);
  $("arts").textContent = "";
  const arts = o ? articoli(o) : [];
  if (arts.length) arts.forEach(a => addArtRow(a)); else addArtRow(null);
  formFoto = o && Array.isArray(o.foto) ? [...o.foto] : [];
  uploading = 0;
  renderPhotos();
  updateSaldo();
  $("formBg").hidden = false;
  $("form").scrollTop = 0;
}
function closeForm() { $("formBg").hidden = true; editing = null; }

function readArts() {
  return [...$("arts").children].map(box => {
    const r = box.querySelector("input[type=radio]:checked");
    return {
      reparto: r ? r.value : "",
      prodotto: (box.querySelector(".a-prodotto-sel").hidden ? box.querySelector(".a-prodotto") : box.querySelector(".a-prodotto-sel")).value.trim(),
      quantita: box.querySelector(".a-q").value.trim(),
      unita: box.querySelector(".a-u").value,
      note: box.querySelector(".a-n").value.trim(),
      stato: box.dataset.stato || "da_fare",
    };
  }).filter(a => a.prodotto || a.reparto || a.quantita || a.note);
}

async function saveForm(ev) {
  ev.preventDefault();
  const err = msg => { $("formErr").textContent = msg; $("formErr").hidden = false; };
  if (uploading) return err("Aspetta che le foto finiscano di caricarsi.");
  const arts = readArts();
  const prezzo = parseEuro($("f-prezzo").value), caparra = parseEuro($("f-caparra").value);
  const missing = [];
  if (!arts.length) missing.push("almeno un prodotto");
  if (arts.some(a => !a.reparto)) missing.push("il reparto di ogni prodotto");
  if (arts.some(a => !a.prodotto)) missing.push("il nome di ogni prodotto");
  if (!$("f-operatore").value) missing.push("l'operatore (sceglilo dall'elenco)");
  if (!$("f-nome").value.trim()) missing.push("il nome del cliente");
  if (!$("f-cognome").value.trim()) missing.push("il cognome del cliente");
  if (digits($("f-telefono").value).length < 6) missing.push("il telefono del cliente");
  if (!$("f-data").value) missing.push("il giorno");
  if (!$("f-ora").value) missing.push("l'ora");
  if (missing.length) return err("Manca " + missing.join(", ") + ".");
  if (Number.isNaN(prezzo) || Number.isNaN(caparra)) return err("Scrivi prezzo e caparra solo con numeri, es. 45,50.");
  const preavviso = serveSblocco(arts, $("f-data").value);
  if (preavviso && !formSblocco) return mostraPin(preavviso);
  if (!needLive()) return;
  const cli = { nome: $("f-nome").value.trim(), cognome: $("f-cognome").value.trim(), telefono: $("f-telefono").value.trim(), email: $("f-email").value.trim() };
  const operatore = $("f-operatore").value.trim();
  const data = {
    tipo: formTipo,
    ...cli,
    cliente: fullName(cli),
    data: $("f-data").value,
    ora: $("f-ora").value,
    articoli: arts,
    foto: formFoto,
    prezzo, caparra,
    note: $("f-note").value.trim(),
    modificatoDa: operatore,
    aggiornato: new Date().toISOString(),
  };
  if (formSblocco) { data.sblocco = formSblocco; data.sbloccatoDa = operatore; }
  store.set("autore", operatore);
  $("saveBtn").disabled = true;
  try {
    data.clienteId = await upsertCliente(cli);
    if (editing) { await api.update("ordini", editing.id, data); toast("Ordine aggiornato"); }
    else {
      data.autore = operatore; data.creato = data.aggiornato; data.consegnato = false; data.annullato = false;
      const id = await api.create("ordini", data);
      mieiNuovi.add(id);
      toast(formTipo === "preventivo" ? "Preventivo salvato" : "Ordine salvato");
    }
    closeForm();
  } catch (e) {
    const m = /PREAVVISO\|([^|]*)\|(\d+)\|(-?\d+)/.exec((e && e.message) || "");
    if (m) { formSblocco = null; mostraPin({ nome: m[1], minimo: +m[2], giorni: +m[3] }); }
    else err(writeError(e));
  }
  finally { $("saveBtn").disabled = false; }
}

// gli ordini non si cancellano: si annullano e restano nell'Archivio
async function deleteOrder() {
  const b = $("delBtn");
  if (!$("f-operatore").value) { $("formErr").textContent = "Scegli prima l'operatore che annulla l'ordine."; $("formErr").hidden = false; return; }
  if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "Tocca di nuovo per annullare"; return; }
  if (!needLive() || !editing) return;
  const chi = $("f-operatore").value;
  store.set("autore", chi);
  try {
    await api.update("ordini", editing.id, { annullato: true, annullatoDa: chi, modificatoDa: chi, aggiornato: new Date().toISOString() });
    toast("Ordine annullato: lo trovi nell'Archivio"); closeForm();
  } catch (e) { $("formErr").textContent = writeError(e); $("formErr").hidden = false; }
}
async function restoreOrder(o) {
  if (!needLive()) return;
  try { await api.update("ordini", o.id, { annullato: false, modificatoDa: chiSono(), aggiornato: new Date().toISOString() }); toast("Ordine ripristinato"); }
  catch (e) { toast(writeError(e)); }
}

/* ---------- invio al cliente ---------- */
let sendOrder = null;
function messageFor(o) {
  const nome = config.nome || "la pasticceria";
  const isPrev = o.tipo === "preventivo";
  const lines = [];
  const fill = t => String(t || "").replace(/\{nome\}/g, o.nome || (o.cliente || "").split(" ")[0] || "").replace(/\{negozio\}/g, nome).replace(/ ,/g, ",").replace(/\s+:/g, ":");
  lines.push(fill(isPrev ? config.salutoPreventivo || "Ciao {nome}, ecco il preventivo da {negozio}:" : config.saluto || "Ciao {nome}, ecco il riepilogo del tuo ordine da {negozio}:"));
  lines.push("");
  for (const a of articoli(o)) lines.push(`• ${a.quantita ? a.quantita + " " + (a.unita || "") + " " : ""}${a.prodotto}${a.note ? " (" + a.note + ")" : ""}`);
  lines.push("");
  if (o.data) lines.push(`Ritiro: ${longDay(o.data)}${o.ora ? " alle " + o.ora : ""}`);
  if (typeof o.prezzo === "number") lines.push(`${isPrev ? "Prezzo" : "Totale"}: ${euro(o.prezzo)}`);
  if (typeof o.caparra === "number") lines.push(`Caparra versata: ${euro(o.caparra)}`);
  if (typeof o.prezzo === "number" && typeof o.caparra === "number") lines.push(`Da saldare al ritiro: ${euro(Math.max(0, o.prezzo - o.caparra))}`);
  if (isPrev) { lines.push(""); lines.push(fill(config.chiusuraPreventivo || "Facci sapere se va bene così confermiamo l'ordine.")); }
  lines.push("");
  lines.push(config.firma || "Grazie e a presto!");
  return lines.join("\n");
}
function waNumber(tel) {
  let d = String(tel || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.length >= 9 && d.length <= 10 && (d.startsWith("3") || d.startsWith("0"))) d = "39" + d;
  return d.replace(/\D/g, "");
}
function gcalDate(iso, hm) { return iso.replace(/-/g, "") + "T" + (hm || "09:00").replace(":", "") + "00"; }
// i recapiti per WhatsApp ed email si prendono dall'anagrafica clienti
function clienteDi(o) {
  return clienti.find(c => c.id === o.clienteId) || (digits(o.telefono) && clienti.find(c => digits(c.telefono) === digits(o.telefono))) || null;
}
function recapiti(o) {
  const c = clienteDi(o);
  return { c, telefono: (c && c.telefono) || o.telefono || "", email: (c && c.email) || o.email || "" };
}
let anagPerOrdine = null;   // ordine da collegare al cliente che si sta creando
function refreshSendLinks() {
  const o = sendOrder; if (!o) return;
  const text = $("s-testo").value;
  const rc = recapiti(o);
  const num = waNumber(rc.telefono);
  $("s-wa").href = "https://wa.me/" + (num ? num : "") + "?text=" + encodeURIComponent(text);
  const subj = (o.tipo === "preventivo" ? "Preventivo" : "Riepilogo ordine") + " - " + (config.nome || "Pasticceria");
  $("s-gmail").href = "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(rc.email) + "&su=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(text);
  $("s-mail").href = "mailto:" + encodeURIComponent(rc.email) + "?subject=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(text);
  if (o.data) {
    const end = o.ora ? (() => { const [h, m] = o.ora.split(":").map(Number); const t = h * 60 + m + 30; return pad(Math.floor(t / 60) % 24) + ":" + pad(t % 60); })() : "09:30";
    const title = `${o.tipo === "preventivo" ? "Preventivo" : "Ritiro"}: ${o.cliente || "cliente"}`;
    const det = articoli(o).map(a => `${repNome(a.reparto)}: ${a.quantita || ""} ${a.unita || ""} ${a.prodotto}`).join("\n");
    $("s-gcal").href = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(title) + "&dates=" + gcalDate(o.data, o.ora) + "/" + gcalDate(o.data, end) + "&details=" + encodeURIComponent(det);
    $("s-gcal").removeAttribute("aria-disabled");
  } else { $("s-gcal").removeAttribute("href"); $("s-gcal").setAttribute("aria-disabled", "true"); }
  const h = [];
  if (!num) h.push("Nell'anagrafica manca il telefono: WhatsApp ti farà scegliere il contatto a mano.");
  if (!rc.email) h.push("Nell'anagrafica manca l'email.");
  const b = $("s-anag");
  b.hidden = !!(num && rc.email);
  b.textContent = rc.c ? "Completa i dati in anagrafica" : "Aggiungi il cliente in anagrafica";
  b.onclick = () => {
    if (rc.c) { anagPerOrdine = null; openCliente(rc.c); return; }
    anagPerOrdine = o;
    openCliente(null);
    $("k-nome").value = o.nome || (o.cliente || "").split(" ")[0] || "";
    $("k-cognome").value = o.cognome || (o.cliente || "").split(" ").slice(1).join(" ");
    $("k-telefono").value = o.telefono || "";
    $("k-email").value = o.email || "";
  };
  h.push("Gmail apre la tua posta Google con il messaggio pronto. Se usi un'altra app di posta tocca Altra email.");
  $("s-hint").textContent = h.join(" ");
}
function openSend(o) {
  sendOrder = o;
  $("s-testo").value = messageFor(o);
  refreshSendLinks();
  $("sendBg").hidden = false;
}
async function copyText() {
  const ta = $("s-testo");
  try { await navigator.clipboard.writeText(ta.value); toast("Testo copiato"); }
  catch { ta.focus(); ta.select(); toast("Testo selezionato: copialo dal menu"); }
}

function setSync(state, text) { const s = $("sync"); s.className = "sync " + state; s.lastChild.textContent = text; }

// eventi
$("v-lista").onclick = () => { view = "lista"; render(); };
$("v-cal").onclick = () => { view = "cal"; render(); };
$("v-cli").onclick = () => { view = "cli"; render(); };
$("v-arc").onclick = () => { view = "arc"; render(); };
$("f-cerca").oninput = renderSugg;
for (const id of ["f-nome", "f-cognome"]) $(id).addEventListener("input", () => {
  // se cambia il nome di un cliente scelto, diventa un cliente nuovo
  const c = clienti.find(k => k.id === formClienteId);
  if (c && ($("f-nome").value.trim() !== (c.nome || "") || $("f-cognome").value.trim() !== (c.cognome || ""))) { formClienteId = null; $("cliState").textContent = "nuovo cliente"; }
});
$("cliForm").onsubmit = saveCliente;
$("cliCancel").onclick = () => { $("cliBg").hidden = true; anagPerOrdine = null; };
$("cliDel").onclick = deleteCliente;
$("opAdd").onclick = addOperatore;
$("opNew").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addOperatore(); } });
for (const k of ["oggi", "domani", "tutti"]) $("d-" + k).onclick = () => { filterDay = k; $("dayPick").value = ""; render(); };
$("dayPick").onchange = e => { if (e.target.value) { pickedDate = e.target.value; filterDay = "giorno"; } else filterDay = "oggi"; render(); };
$("showDone").onchange = render;
$("newBtn").onclick = () => openForm(null);
$("cancelBtn").onclick = closeForm;
$("form").onsubmit = saveForm;
$("delBtn").onclick = deleteOrder;
$("addArt").onclick = () => { const b = addArtRow(null); b.querySelector("input").focus(); };
$("t-ordine").onclick = () => setTipo("ordine");
$("t-preventivo").onclick = () => setTipo("preventivo");
$("f-prezzo").oninput = updateSaldo;
$("f-caparra").oninput = updateSaldo;
$("s-testo").oninput = refreshSendLinks;
$("s-copy").onclick = copyText;
$("s-close").onclick = () => { $("sendBg").hidden = true; };
$("setBtn").onclick = openSettings;
$("setCancel").onclick = () => { $("setBg").hidden = true; };
$("setClose2").onclick = () => { $("setBg").hidden = true; };
$("setForm").onsubmit = saveSettings;
$("viewer").onclick = () => { $("viewer").hidden = true; };
for (const id of ["formBg", "sendBg", "setBg", "cliBg", "printBg"]) $(id).addEventListener("click", e => { if (e.target === $(id)) $(id).hidden = true; });
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  for (const id of ["viewer", "sendBg", "setBg", "cliBg", "printBg", "formBg"]) if (!$(id).hidden) { $(id).hidden = true; break; }
});

// a mezzanotte "oggi" cambia
setInterval(() => { if ($("formBg").hidden) render(); }, 5 * 60 * 1000);

/* ---------- collegamento a Supabase ---------- */
const dati = { ordini: new Map(), clienti: new Map(), operatori: new Map(), impostazioni: new Map() };
const mieiNuovi = new Set();   // ordini creati da questo dispositivo: niente avviso
const conId = r => ({ id: r.id, ...r.data });
const api = {
  async create(coll, data) {
    const { data: r, error } = await sb.from("docs").insert({ coll, data }).select("id,data").single();
    if (error) throw error;
    dati[coll].set(r.id, conId(r)); aggiornaVista();
    return r.id;
  },
  async update(coll, id, patch) {
    const { error } = await sb.rpc("aggiorna_doc", { p_coll: coll, p_id: id, p_patch: patch });
    if (error) throw error;
    const cur = dati[coll].get(id);
    if (cur) { dati[coll].set(id, { ...cur, ...patch }); aggiornaVista(); }
  },
  async set(coll, id, data) {
    const { error } = await sb.from("docs").upsert({ coll, id, data, aggiornato: new Date().toISOString() });
    if (error) throw error;
    dati[coll].set(id, { id, ...data }); aggiornaVista();
  },
  async remove(coll, id) {
    const { error } = await sb.from("docs").delete().eq("coll", coll).eq("id", id);
    if (error) throw error;
    dati[coll].delete(id); aggiornaVista();
  },
};

function aggiornaVista() {
  orders = [...dati.ordini.values()];
  clienti = [...dati.clienti.values()];
  operatori = [...dati.operatori.values()];
  config = dati.impostazioni.get("negozio") || {};
  REPARTI = Array.isArray(config.reparti) && config.reparti.length ? config.reparti : REPARTI_BASE;
  renderOperatori();
  if ($("formBg").hidden && $("setBg").hidden && $("cliBg").hidden) render();
  else { renderChips(); $("shopTitle").textContent = config.nome || "Ordini del laboratorio"; }
}

async function caricaTutto() {
  const tutti = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from("docs").select("coll,id,data").order("coll").order("id").range(off, off + 999);
    if (error) throw error;
    tutti.push(...data);
    if (data.length < 1000) break;
  }
  for (const m of Object.values(dati)) m.clear();
  for (const r of tutti) if (dati[r.coll]) dati[r.coll].set(r.id, conId(r));
  live = true;
  setSync("ok", "Aggiornato");
  aggiornaVista();
}

let canale = null;
function ascoltaModifiche() {
  if (canale) sb.removeChannel(canale);
  canale = sb.channel("docs")
    .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, p => {
      if (p.eventType === "DELETE") { const o = p.old || {}; if (dati[o.coll]) dati[o.coll].delete(o.id); }
      else {
        const r = p.new; if (!dati[r.coll]) return;
        const nuovo = p.eventType === "INSERT" && !dati[r.coll].has(r.id);
        dati[r.coll].set(r.id, conId(r));
        if (r.coll === "ordini" && nuovo && !mieiNuovi.has(r.id)) avvisaNuovo(conId(r));
      }
      aggiornaVista();
    })
    .subscribe(stato => {
      if (stato === "SUBSCRIBED") setSync("ok", "Aggiornato");
      else if (stato === "CHANNEL_ERROR" || stato === "TIMED_OUT" || stato === "CLOSED") setSync("err", "Riconnessione…");
    });
}
// tornando sull'app dopo un po', ricarica tutto (il telefono può aver perso il collegamento)
let ultimoCarico = Date.now();
document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !utente || Date.now() - ultimoCarico < 60000) return;
  ultimoCarico = Date.now();
  try { await caricaTutto(); ascoltaModifiche(); } catch { setSync("err", "Non collegato"); }
});

// foto private: si mostrano con un link temporaneo
const fotoCache = new Map();
function setFoto(img, id) {
  if (!fotoCache.has(id)) {
    fotoCache.set(id, sb.storage.from("foto").createSignedUrl(id, 6 * 3600).then(r => {
      if (r.error) { fotoCache.delete(id); throw r.error; }
      return r.data.signedUrl;
    }));
  }
  fotoCache.get(id).then(u => { img.src = u; }, () => { img.dispatchEvent(new Event("error")); });
}

/* ---------- promemoria e avvisi ---------- */
function renderReminder(list) {
  const dm = orders.filter(o => !o.annullato && !o.consegnato && o.data === tomorrow());
  const og = orders.filter(o => !o.annullato && !o.consegnato && o.data === today() && !orderReady(o));
  if (!dm.length && !og.length) return;
  const r = el("div", "remind");
  const t = el("div");
  const parti = [];
  if (og.length) parti.push(og.length === 1 ? "oggi 1 ordine ancora da preparare" : `oggi ${og.length} ordini ancora da preparare`);
  if (dm.length) parti.push(dm.length === 1 ? "domani 1 ordine" : `domani ${dm.length} ordini`);
  t.append(el("b", null, "Promemoria: "), parti.join(", ") + ".");
  r.append(t);
  if (dm.length && filterDay !== "domani") {
    const b = el("button", "sbtn", "Vedi domani");
    b.onclick = () => { filterDay = "domani"; $("dayPick").value = ""; render(); };
    r.append(b);
  }
  if (dm.length) {
    const p = el("button", "sbtn", "Stampa domani");
    p.onclick = () => openStampa(tomorrow());
    r.append(p);
  }
  list.append(r);
}

let popOrder = null;
function riassunto(o) {
  const reps = [...new Set(articoli(o).map(a => repNome(a.reparto)))].join(", ");
  return `${o.cliente || "Cliente"} · ${o.data ? fmtDay(o.data) : ""}${o.ora ? " alle " + o.ora : ""}${reps ? " · " + reps : ""}`;
}
function mostraPopup(titolo, testo, o) {
  popOrder = o || null;
  $("popTitle").textContent = titolo;
  $("popBody").textContent = testo;
  $("popOpen").hidden = !o;
  $("popup").hidden = false;
}
function avvisaNuovo(o) {
  const titolo = o.tipo === "preventivo" ? "Nuovo preventivo" : "Nuovo ordine";
  const testo = riassunto(o) + (o.autore ? ` (inserito da ${o.autore})` : "");
  mostraPopup(titolo, testo, o);
  try { navigator.vibrate && navigator.vibrate(200); } catch {}
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    navigator.serviceWorker.ready.then(reg => reg.showNotification(titolo, { body: testo, tag: "ordine-" + o.id, icon: "icona-192.png" }))
      .catch(() => { try { new Notification(titolo, { body: testo }); } catch {} });
  }
}
// una volta al giorno, all'apertura: cosa c'è domani
function promemoriaDelGiorno() {
  const key = "promemoria-" + today();
  if (store.get(key)) return;
  const dm = orders.filter(o => !o.annullato && !o.consegnato && o.data === tomorrow());
  if (!dm.length) return;
  store.set(key, "1");
  mostraPopup("Promemoria per domani", dm.length === 1 ? "Domani c'è 1 ordine: " + riassunto(dm[0]) : `Domani ci sono ${dm.length} ordini. Tocca "Vedi domani" nella lista.`, dm.length === 1 ? dm[0] : null);
}
function statoNotifiche() {
  const s = $("notifState"), b = $("notifBtn");
  if (!("Notification" in window)) { s.textContent = "Questo dispositivo non supporta gli avvisi. Su iPhone aggiungi prima l'app alla schermata Home (Condividi > Aggiungi alla schermata Home)."; b.hidden = true; return; }
  if (Notification.permission === "granted") { s.textContent = "Avvisi attivi: quando entra un ordine nuovo compare un avviso, anche se stai usando un'altra scheda. Con l'app chiusa del tutto l'avviso non arriva."; b.hidden = true; }
  else if (Notification.permission === "denied") { s.textContent = "Gli avvisi sono bloccati: riattivali dalle impostazioni del browser."; b.hidden = true; }
  else { s.textContent = "Quando l'app è aperta, gli ordini nuovi compaiono sempre con un riquadro in alto. Attiva gli avvisi per vederli anche mentre usi altro."; b.hidden = false; }
}

/* ---------- archivio e ricerca ---------- */
function renderArchivio(list) {
  const tools = el("div", "cli-tools");
  const s = el("input"); s.type = "search"; s.id = "arcSearch"; s.placeholder = "Cerca per cliente, telefono o prodotto"; s.value = arcSearch;
  s.oninput = () => { arcSearch = s.value; render(); };
  const d = el("input"); d.type = "date"; d.id = "arcDay"; d.value = arcDay; d.style.flex = "0 0 auto"; d.setAttribute("aria-label", "Giorno");
  d.onchange = () => { arcDay = d.value; render(); };
  tools.append(s, d);
  list.append(tools);
  const q = arcSearch.trim().toLowerCase(), qd = q.replace(/\D/g, "");
  let rows = orders.filter(o => {
    if (arcDay && o.data !== arcDay) return false;
    if (!q) return true;
    if ((o.cliente || "").toLowerCase().includes(q)) return true;
    if (qd.length >= 3 && digits(o.telefono).includes(qd)) return true;
    return articoli(o).some(a => (a.prodotto || "").toLowerCase().includes(q));
  }).sort((a, b) => ((b.data || "") + (b.ora || "")).localeCompare((a.data || "") + (a.ora || "")));
  const tot = rows.length;
  rows = rows.slice(0, 100);
  if (!rows.length) {
    const e = el("div", "empty");
    e.append(el("strong", null, "Nessun ordine trovato"), el("span", null, "Prova con un altro nome, numero o giorno."));
    list.append(e);
    return;
  }
  list.append(el("div", "hint", tot > 100 ? `${tot} ordini trovati: mostro i 100 più recenti. Scrivi un nome o scegli un giorno per restringere.` : (tot === 1 ? "1 ordine trovato" : `${tot} ordini trovati`) + ", compresi consegnati e annullati."));
  const byDay = new Map();
  for (const o of rows) { if (!byDay.has(o.data)) byDay.set(o.data, []); byDay.get(o.data).push(o); }
  for (const [day, items] of byDay) {
    const g = el("section", "group");
    g.append(el("h2", null, day ? fmtDay(day) + (day.slice(0, 4) !== today().slice(0, 4) ? " " + day.slice(0, 4) : "") : "Senza data"));
    for (const o of items) g.append(card(o));
    list.append(g);
  }
}

/* ---------- storico modifiche ---------- */
const CAMPI = { cliente: "Cliente", telefono: "Telefono", email: "Email", data: "Giorno", ora: "Ora", prezzo: "Prezzo", caparra: "Caparra", note: "Note", tipo: "Tipo" };
const val = (k, v) => v == null || v === "" ? "vuoto" : k === "data" ? fmtDay(v) : (k === "prezzo" || k === "caparra") && typeof v === "number" ? euro(v) : String(v);
function differenze(prima, dopo) {
  if (!prima) return [dopo && dopo.tipo === "preventivo" ? "Preventivo creato" : "Ordine creato"];
  const out = [];
  for (const k of Object.keys(CAMPI)) if (JSON.stringify(prima[k] ?? null) !== JSON.stringify(dopo[k] ?? null)) out.push(`${CAMPI[k]}: ${val(k, prima[k])} → ${val(k, dopo[k])}`);
  if (!!prima.consegnato !== !!dopo.consegnato) out.push(dopo.consegnato ? "Segnato come consegnato" : "Segnato come non consegnato");
  if (!!prima.annullato !== !!dopo.annullato) out.push(dopo.annullato ? "Ordine annullato" : "Ordine ripristinato");
  const a = articoli(prima), b = articoli(dopo);
  const nome = x => `${repNome(x.reparto)} ${x.prodotto || ""}`.trim();
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (!x) { out.push("Aggiunto: " + nome(y)); continue; }
    if (!y) { out.push("Tolto: " + nome(x)); continue; }
    if (x.stato !== y.stato) out.push(`${nome(y)}: ${statoNome(x.stato)} → ${statoNome(y.stato)}`);
    const det = ["prodotto", "quantita", "unita", "note", "reparto"].filter(k => (x[k] || "") !== (y[k] || ""));
    if (det.length) out.push(`${nome(y)}: modificato (${det.map(k => ({ quantita: "quantità", unita: "unità" })[k] || k).join(", ")})`);
  }
  if (JSON.stringify(prima.foto || []) !== JSON.stringify(dopo.foto || [])) out.push("Foto cambiate");
  return out;
}
async function loadStorico(o) {
  const box = $("f-storico"), ol = $("f-storico-list");
  ol.textContent = ""; box.hidden = !o; box.open = false;
  if (!o) return;
  const { data, error } = await sb.from("storia").select("n,azione,utente,quando,prima,dopo").eq("coll", "ordini").eq("doc_id", o.id).order("n", { ascending: false }).limit(200);
  if (editing !== o) return;
  if (error) { ol.append(el("li", "hint", "Non riesco a caricare lo storico.")); return; }
  for (const r of data) {
    const righe = differenze(r.prima, r.dopo || {});
    if (!righe.length) continue;
    const li = el("li");
    const chi = (r.dopo && r.dopo.modificatoDa) || (r.dopo && r.dopo.autore) || "";
    li.append(el("div", "q", new Date(r.quando).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) + " · " + [chi, r.utente].filter(Boolean).join(" · ")));
    for (const t of righe) li.append(el("div", null, t));
    ol.append(li);
  }
  $("f-storico").querySelector("summary").textContent = `Storico modifiche (${ol.children.length})`;
}

/* ---------- impostazioni ---------- */
let repBozza = [];
function renderRepEdit() {
  const box = $("repEdit");
  box.textContent = "";
  repBozza.forEach((r, i) => {
    const row = el("div", "reprow");
    const c = el("input"); c.type = "color"; c.value = r.colore || "#888888"; c.setAttribute("aria-label", "Colore " + r.nome);
    c.oninput = () => { r.colore = c.value; };
    const n = el("input"); n.type = "text"; n.value = r.nome; n.placeholder = "Nome reparto"; n.setAttribute("aria-label", "Nome reparto");
    n.oninput = () => { r.nome = n.value; };
    const rm = el("button", "sbtn", "Togli"); rm.type = "button";
    rm.onclick = () => {
      if (!rm.dataset.confirm) { rm.dataset.confirm = "1"; rm.textContent = "Sicura?"; return; }
      repBozza.splice(i, 1); renderRepEdit();
    };
    const u = el("input"); u.type = "text"; u.className = "full"; u.value = (r.unita || []).join(", "); u.placeholder = "Unità, es. kg, pezzi"; u.setAttribute("aria-label", "Unità " + r.nome);
    u.oninput = () => { r.unita = [...new Set(u.value.split(",").map(x => x.trim()).filter(Boolean))]; };
    const gl = el("label", "full hint");
    const gi = el("input"); gi.type = "number"; gi.min = "0"; gi.max = "60"; gi.inputMode = "numeric"; gi.value = r.giorniMinimi || 0;
    gi.style.cssText = "width:70px;margin-left:8px;border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:7px 9px";
    gi.oninput = () => { r.giorniMinimi = Math.max(0, parseInt(gi.value, 10) || 0); };
    gl.append("Giorni lavorativi minimi di preparazione (lunedì e festività non contano; 0 = nessuno)", gi);
    const pl = el("label", "full hint", "Prodotti da scegliere, uno per riga (se vuoto, il prodotto si scrive a mano)");
    const pt = el("textarea"); pt.className = "full"; pt.rows = 4; pt.value = (r.prodotti || []).join("\n");
    pt.placeholder = "Es.\nPane casereccio\nFilone\nRosette"; pt.setAttribute("aria-label", "Prodotti " + r.nome);
    pt.oninput = () => { r.prodotti = [...new Set(pt.value.split("\n").map(x => x.trim()).filter(Boolean))]; };
    row.append(c, n, rm, u, gl, pl, pt);
    box.append(row);
  });
}
function renderUtenti(lista) {
  const box = $("userList");
  box.textContent = "";
  for (const u of lista) {
    const row = el("div", "cli-tools");
    const t = el("span", null, u.email + (u.admin ? " (amministratrice)" : "")); t.style.flex = "1"; t.style.overflowWrap = "anywhere";
    row.append(t);
    if (u.email !== utente) {
      const rm = el("button", "sbtn", "Togli"); rm.type = "button";
      rm.onclick = async () => {
        if (!rm.dataset.confirm) { rm.dataset.confirm = "1"; rm.textContent = "Sicura? Tocca ancora"; return; }
        const { error } = await sb.from("ammessi").delete().eq("email", u.email);
        if (error) toast(writeError(error)); else caricaUtenti();
      };
      row.append(rm);
    }
    box.append(row);
  }
}
async function caricaUtenti() {
  const { data, error } = await sb.from("ammessi").select("email,admin").order("email");
  if (!error) renderUtenti(data);
}
async function addUtente() {
  const email = $("userNew").value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("Scrivi un'email valida"); return; }
  const { error } = await sb.from("ammessi").upsert({ email });
  if (error) { toast(writeError(error)); return; }
  $("userNew").value = ""; toast(email + " può entrare"); caricaUtenti();
}
function openSettings() {
  $("c-nome").value = config.nome || "";
  $("c-saluto").value = config.saluto || "Ciao {nome}, ecco il riepilogo del tuo ordine da {negozio}:";
  $("c-salutoP").value = config.salutoPreventivo || "Ciao {nome}, ecco il preventivo da {negozio}:";
  $("c-chiusuraP").value = config.chiusuraPreventivo || "Facci sapere se va bene così confermiamo l'ordine.";
  $("c-firma").value = config.firma || "Grazie e a presto!";
  repBozza = REPARTI.map(r => ({ ...r, unita: [...(r.unita || [])], prodotti: [...(r.prodotti || [])] }));
  renderRepEdit();
  $("adminFields").disabled = !sonoAdmin;
  $("setAdminHint").hidden = sonoAdmin;
  $("userSec").hidden = !sonoAdmin;
  $("pinSec").hidden = !sonoAdmin;
  if (sonoAdmin) sb.rpc("pin_impostato").then(r => { $("pinState").textContent = r.data ? "Il PIN è impostato. Scrivine uno nuovo solo se vuoi cambiarlo." : "Il PIN non è ancora impostato: sceglilo qui."; });
  if (sonoAdmin) caricaUtenti();
  const cal = dati.impostazioni.get("calendario");
  $("calSec").hidden = !(cal && cal.token);
  if (cal && cal.token) $("calLink").value = `${window.ORDINI_CONFIG.url.replace(/\/+$/, "")}/functions/v1/calendario?token=${cal.token}`;
  $("whoami").textContent = "Sei entrata come " + utente + (sonoAdmin ? " (amministratrice)." : ".");
  statoNotifiche();
  $("setErr").hidden = true;
  $("setBg").hidden = false;
}
const slug = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "reparto";
async function saveSettings(ev) {
  ev.preventDefault();
  const err = m => { $("setErr").textContent = m; $("setErr").hidden = false; };
  if (!live) return err("Non collegato: non posso salvare adesso.");
  const reparti = repBozza.map(r => ({ ...r, nome: (r.nome || "").trim() })).filter(r => r.nome);
  if (!reparti.length) return err("Serve almeno un reparto.");
  const usati = new Set();
  for (const r of reparti) {
    if (!r.id) { let id = slug(r.nome), k = 2; while (usati.has(id) || REPARTI.some(x => x.id === id)) id = slug(r.nome) + "-" + k++; r.id = id; }
    usati.add(r.id);
    if (!r.unita || !r.unita.length) r.unita = ["pezzi", "kg"];
  }
  try {
    await api.set("impostazioni", "negozio", {
      ...config,
      nome: $("c-nome").value.trim(),
      reparti,
      saluto: $("c-saluto").value.trim(),
      salutoPreventivo: $("c-salutoP").value.trim(),
      chiusuraPreventivo: $("c-chiusuraP").value.trim(),
      firma: $("c-firma").value.trim(),
    });
    if (filterDep !== "tutti" && !reparti.some(r => r.id === filterDep)) filterDep = "tutti";
    $("setBg").hidden = true; toast("Impostazioni salvate"); render();
  } catch (e) { err(writeError(e)); }
}

/* ---------- backup da scaricare ---------- */
/* ---------- stampa / PDF ---------- */
function opzioniStampa() {
  return { ordini: orders, reparti: REPARTI, negozio: config.nome || "", giorno: $("p-giorno").value, reparto: $("p-rep").value,
    preventivi: $("p-prev").checked, consegnati: $("p-cons").checked, separa: $("p-sep").checked };
}
function contaStampa() {
  const g = $("p-giorno").value;
  $("p-oggi").setAttribute("aria-pressed", String(g === today()));
  $("p-domani").setAttribute("aria-pressed", String(g === tomorrow()));
  if (!g) { $("p-conta").textContent = "Scegli un giorno."; return; }
  const n = StampaOrdini.pagina(opzioniStampa()).quanti;
  $("p-conta").textContent = n === 0 ? "Nessun ordine per questa scelta." : n === 1 ? "1 ordine da stampare." : `${n} ordini da stampare.`;
}
function openStampa(giorno) {
  const sel = $("p-rep");
  sel.textContent = "";
  for (const r of [{ id: "tutti", nome: "Tutti i reparti" }, ...REPARTI]) { const op = el("option", null, r.nome); op.value = r.id; sel.append(op); }
  sel.value = REPARTI.some(r => r.id === filterDep) ? filterDep : "tutti";
  $("p-giorno").value = giorno || (view === "lista" && filterDay === "giorno" && pickedDate) || tomorrow();
  contaStampa();
  $("printBg").hidden = false;
}
function stampa(ev) {
  ev.preventDefault();
  if (!$("p-giorno").value) { contaStampa(); return; }
  const p = StampaOrdini.pagina(opzioniStampa());
  $("printArea").innerHTML = `<style>${p.css}</style>` + p.html;
  const titolo = document.title;
  // il titolo diventa il nome del PDF
  const rep = $("p-rep").value;
  document.title = `Ordini ${$("p-giorno").value}${rep !== "tutti" ? " " + repNome(rep) : ""}`;
  $("printBg").hidden = true;
  window.addEventListener("afterprint", () => { document.title = titolo; }, { once: true });
  setTimeout(() => window.print(), 50);
}

function scarica(nome, contenuto, tipo) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([contenuto], { type: tipo }));
  a.download = nome;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const csvCell = v => { const s = v == null ? "" : String(v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function backupExcel() {
  const righe = [["Giorno", "Ora", "Tipo", "Cliente", "Telefono", "Email", "Reparto", "Prodotto", "Quantità", "Unità", "Note prodotto", "Stato", "Totale", "Caparra", "Note", "Inserito da", "Consegnato", "Annullato"]];
  const num = n => typeof n === "number" ? String(n).replace(".", ",") : "";
  for (const o of orders.slice().sort((a, b) => ((a.data || "") + (a.ora || "")).localeCompare((b.data || "") + (b.ora || "")))) {
    const arts = articoli(o).length ? articoli(o) : [{}];
    for (const a of arts) righe.push([o.data, o.ora, o.tipo, o.cliente, o.telefono, o.email, a.reparto ? repNome(a.reparto) : "", a.prodotto, a.quantita, a.unita, a.note, a.stato ? statoNome(a.stato) : "", num(o.prezzo), num(o.caparra), o.note, o.autore, o.consegnato ? "sì" : "", o.annullato ? "sì" : ""]);
  }
  scarica(`ordini-${today()}.csv`, "﻿" + righe.map(r => r.map(csvCell).join(";")).join("\r\n"), "text/csv;charset=utf-8");
}
/* ---------- Excel degli ordini del giorno ---------- */
function caricaXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, ko) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    sc.onload = () => window.XLSX ? ok(window.XLSX) : ko(new Error("xlsx"));
    sc.onerror = () => ko(new Error("xlsx"));
    document.head.append(sc);
  });
}
function righeExcel() {
  const op = opzioniStampa();
  const dove = op.reparto && op.reparto !== "tutti" ? op.reparto : null;
  const lista = orders.filter(o => !o.annullato && o.data === op.giorno
      && (op.consegnati || !o.consegnato)
      && (!dove || articoli(o).some(a => a.reparto === dove)))
    .sort((a, b) => (a.ora || "99").localeCompare(b.ora || "99") || (a.cliente || "").localeCompare(b.cliente || "", "it"));
  const numero = v => { if (typeof v === "number") return v; const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? null : n; };
  const ordini = [["Ora", "Cliente", "Telefono", "Reparto", "Prodotto", "Quantità", "Unità", "Note prodotto", "Note ordine", "Prezzo €", "Caparra €", "Da saldare €", "Inserito da", "Consegnato"]];
  const tot = new Map();
  for (const o of lista) {
    const arts = articoli(o).filter(a => !dove || a.reparto === dove);
    const cli = clienteDi(o);
    const tel = (cli && cli.telefono) || o.telefono || "";
    const prezzo = numero(o.prezzo), cap = numero(o.caparra);
    (arts.length ? arts : [{}]).forEach((a, i) => {
      const q = numero(a.quantita);
      ordini.push([o.ora || "", o.cliente || "", tel, a.reparto ? repNome(a.reparto) : "", a.prodotto || "", q != null ? q : (a.quantita || ""), a.unita || "", a.note || "",
        i === 0 ? (o.note || "") : "", i === 0 ? prezzo : null, i === 0 ? cap : null,
        i === 0 && prezzo != null ? Math.round((prezzo - (cap || 0)) * 100) / 100 : null, i === 0 ? (o.autore || "") : "", i === 0 && o.consegnato ? "sì" : ""]);
      if (!a.prodotto) return;
      const k = [a.reparto || "", a.prodotto.trim().toLowerCase(), a.unita || ""].join("|");
      if (!tot.has(k)) tot.set(k, { rep: a.reparto ? repNome(a.reparto) : "", prodotto: a.prodotto.trim(), unita: a.unita || "", q: 0, testo: [], n: 0 });
      const t = tot.get(k); t.n++;
      if (q != null) t.q += q; else if (a.quantita) t.testo.push(a.quantita);
    });
  }
  const totali = [["Reparto", "Prodotto", "Quantità totale", "Unità", "N. ordini"]];
  for (const t of [...tot.values()].sort((a, b) => a.rep.localeCompare(b.rep, "it") || a.prodotto.localeCompare(b.prodotto, "it")))
    totali.push([t.rep, t.prodotto, t.testo.length ? [t.q || "", ...t.testo].filter(Boolean).join(" + ") : t.q, t.unita, t.n]);
  return { ordini, totali, quanti: lista.length };
}
async function scaricaExcel() {
  const g = $("p-giorno").value;
  if (!g) { contaStampa(); return; }
  const { ordini, totali, quanti } = righeExcel();
  if (!quanti) { $("p-conta").textContent = "Nessun ordine per questa scelta."; return; }
  const rep = $("p-rep").value;
  const nome = `ordini-${g}${rep !== "tutti" ? "-" + repNome(rep).toLowerCase().replace(/\s+/g, "-") : ""}`;
  const b = $("p-excel"); b.disabled = true; b.textContent = "Preparo…";
  try {
    const X = await caricaXlsx();
    const wb = X.utils.book_new();
    const s1 = X.utils.aoa_to_sheet(ordini);
    s1["!cols"] = [6, 22, 14, 12, 26, 9, 8, 24, 24, 9, 9, 11, 12, 10].map(w => ({ wch: w }));
    const s2 = X.utils.aoa_to_sheet(totali);
    s2["!cols"] = [12, 30, 14, 8, 9].map(w => ({ wch: w }));
    X.utils.book_append_sheet(wb, s1, "Ordini");
    X.utils.book_append_sheet(wb, s2, "Totale prodotti");
    X.writeFile(wb, nome + ".xlsx");
  } catch {
    // senza connessione al servizio Excel: file CSV, si apre lo stesso con Excel
    const testo = r => r.map(v => csvCell(typeof v === "number" ? String(v).replace(".", ",") : v)).join(";");
    scarica(nome + ".csv", "﻿" + [...ordini, [], ["TOTALE PRODOTTI"], ...totali].map(testo).join("\r\n"), "text/csv;charset=utf-8");
  } finally { b.disabled = false; b.textContent = "Scarica Excel"; }
}
async function backupTutto() {
  const b = $("bkAll"); b.disabled = true; b.textContent = "Preparo…";
  try {
    const storia = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await sb.from("storia").select("*").order("n").range(off, off + 999);
      if (error) throw error;
      storia.push(...data);
      if (data.length < 1000) break;
    }
    const out = { creato: new Date().toISOString(), ordini: orders, clienti, operatori, impostazioni: Object.fromEntries(dati.impostazioni), storico: storia };
    scarica(`backup-ordini-${today()}.json`, JSON.stringify(out, null, 1), "application/json");
  } catch (e) { toast("Backup non riuscito: controlla la connessione."); }
  finally { b.disabled = false; b.textContent = "Scarica tutto"; }
}

/* ---------- accesso ---------- */
function mostra(id) { for (const x of ["loginBox", "resetBox", "msgBox", "appBox"]) $(x).hidden = x !== id; $("newBtn").hidden = id !== "appBox"; }
function messaggio(titolo, testo, bottone, azione) {
  $("msgTitle").textContent = titolo; $("msgText").textContent = testo;
  $("msgBtn").hidden = !bottone; $("msgBtn").textContent = bottone || ""; $("msgBtn").onclick = azione || null;
  mostra("msgBox");
}
const loginErr = m => { $("loginErr").textContent = m; $("loginErr").hidden = !m; $("loginOk").hidden = true; };
const loginOk = m => { $("loginOk").textContent = m; $("loginOk").hidden = false; $("loginErr").hidden = true; };
function erroreAccesso(e) {
  const m = (e && e.message) || "";
  if (/invalid login|invalid credentials/i.test(m)) return "Email o password sbagliate.";
  if (/already registered|already exists/i.test(m)) return "Questa email ha già un accesso: tocca Entra.";
  if (/password/i.test(m) && /6|8|short|weak/i.test(m)) return "La password è troppo corta: usane una di almeno 8 caratteri.";
  if (/not confirmed/i.test(m)) return "Devi prima confermare l'email: controlla la posta.";
  if (/rate|too many/i.test(m)) return "Troppi tentativi: aspetta qualche minuto.";
  return "Non riesco a collegarmi. Controlla la connessione e riprova.";
}
$("loginForm").onsubmit = async ev => {
  ev.preventDefault();
  const email = $("l-email").value.trim().toLowerCase(), password = $("l-pass").value;
  if (!email || !password) return loginErr("Scrivi email e password.");
  $("loginBtn").disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $("loginBtn").disabled = false;
  if (error) loginErr(erroreAccesso(error));
};
$("signupBtn").onclick = async () => {
  const email = $("l-email").value.trim().toLowerCase(), password = $("l-pass").value;
  if (!email) return loginErr("Scrivi la tua email, poi scegli una password e tocca di nuovo qui.");
  if (password.length < 8) return loginErr("Scegli una password di almeno 8 caratteri, poi tocca di nuovo qui.");
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split("#")[0] } });
  if (error) return loginErr(erroreAccesso(error));
  if (!data.session) loginOk("Ti ho mandato un'email: apri il link per confermare, poi torna qui e tocca Entra.");
};
$("forgotBtn").onclick = async () => {
  const email = $("l-email").value.trim().toLowerCase();
  if (!email) return loginErr("Scrivi prima la tua email qui sopra.");
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] });
  if (error) return loginErr(erroreAccesso(error));
  loginOk("Se l'email è giusta ti arriva un messaggio con il link per scegliere una nuova password.");
};
$("resetForm").onsubmit = async ev => {
  ev.preventDefault();
  const password = $("r-pass").value;
  if (password.length < 8) { $("resetErr").textContent = "Usa almeno 8 caratteri."; $("resetErr").hidden = false; return; }
  const { error } = await sb.auth.updateUser({ password });
  if (error) { $("resetErr").textContent = erroreAccesso(error); $("resetErr").hidden = false; return; }
  toast("Password cambiata"); avvia();
};
$("logoutBtn").onclick = async () => { await sb.auth.signOut(); location.reload(); };
$("opAdd").onclick = addOperatore;
$("userAdd").onclick = addUtente;
$("userNew").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addUtente(); } });
$("repAdd").onclick = () => { repBozza.push({ nome: "", colore: "#5d6878", unita: ["pezzi", "kg"] }); renderRepEdit(); const ins = $("repEdit").querySelectorAll("input[type=text]"); ins[ins.length - 2].focus(); };
$("calCopy").onclick = async () => { try { await navigator.clipboard.writeText($("calLink").value); toast("Link copiato"); } catch { $("calLink").select(); toast("Link selezionato: copialo dal menu"); } };
$("bkExcel").onclick = backupExcel;
$("printBtn").onclick = () => openStampa();
$("printForm").onsubmit = stampa;
$("p-excel").onclick = scaricaExcel;
$("p-chiudi").onclick = () => { $("printBg").hidden = true; };
$("p-oggi").onclick = () => { $("p-giorno").value = today(); contaStampa(); };
$("p-domani").onclick = () => { $("p-giorno").value = tomorrow(); contaStampa(); };
for (const id of ["p-giorno", "p-rep", "p-prev", "p-cons"]) $(id).onchange = contaStampa;
$("bkAll").onclick = backupTutto;
$("notifBtn").onclick = async () => { try { await Notification.requestPermission(); } catch {} statoNotifiche(); };
$("popClose").onclick = () => { $("popup").hidden = true; };
$("popOpen").onclick = () => { $("popup").hidden = true; if (popOrder) openForm(dati.ordini.get(popOrder.id) || popOrder); };

let avviato = false;
async function avvia() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { avviato = false; mostra("loginBox"); return; }
  utente = (session.user.email || "").toLowerCase();
  const { data: ok, error } = await sb.rpc("sono_ammesso");
  if (error) { messaggio("Non collegato", "Non riesco a raggiungere il database. Se l'app non si usa da molti giorni potrebbe essere in pausa: chi la gestisce la riattiva da supabase.com con un clic.", "Riprova", () => location.reload()); return; }
  if (!ok) { messaggio("Accesso non ancora abilitato", `L'email ${utente} non è nell'elenco di chi può usare l'app. Chiedi a Rosa di aggiungerla in Impostazioni.`, "Esci", async () => { await sb.auth.signOut(); location.reload(); }); return; }
  sonoAdmin = !!(await sb.rpc("sono_admin")).data;
  if (avviato) { mostra("appBox"); return; }
  avviato = true;
  mostra("appBox");
  render();
  try { await caricaTutto(); ultimoCarico = Date.now(); ascoltaModifiche(); promemoriaDelGiorno(); }
  catch { setSync("err", "Non collegato"); }
}

(function init() {
  const cfg = window.ORDINI_CONFIG || {};
  if (!cfg.url || !cfg.key || /INSERISCI/.test(cfg.url + cfg.key) || !window.supabase) {
    messaggio("App da configurare", "Manca il collegamento al database: va inserito nel file config.js.");
    return;
  }
  sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  sb.auth.onAuthStateChange((evento, session) => {
    if (evento === "PASSWORD_RECOVERY") { mostra("resetBox"); return; }
    if (evento === "SIGNED_IN" || evento === "SIGNED_OUT" || evento === "INITIAL_SESSION") setTimeout(avvia, 0);
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();

$("pinBtn").onclick = sbloccaConPin;
$("pinInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); sbloccaConPin(); } });
$("pinSave").onclick = async () => {
  const pin = $("pinNew").value.trim();
  if (!/^\d{4,}$/.test(pin)) { toast("Il PIN deve avere almeno 4 cifre"); return; }
  const { error } = await sb.rpc("imposta_pin", { p_pin: pin });
  if (error) { toast(writeError(error)); return; }
  $("pinNew").value = ""; $("pinState").textContent = "Il PIN è impostato. Scrivine uno nuovo solo se vuoi cambiarlo."; toast("PIN salvato");
};
