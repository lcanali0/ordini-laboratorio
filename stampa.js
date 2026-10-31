// Foglio da stampare (o salvare in PDF) con gli ordini di un giorno, divisi per reparto.
// Lo usa l'app (pulsante Stampa) e anche il PDF automatico della sera nel progetto ordini-backup:
// se cambi questo file, copialo anche in ordini-backup/script/stampa.js.
(function (g) {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const euro = n => "€ " + n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parseIso = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const giornoLungo = iso => { const s = parseIso(iso).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const articoli = o => Array.isArray(o.articoli) ? o.articoli : [];
  const num = n => typeof n === "number" ? n : null;

  // se nelle impostazioni non ci sono reparti, gli stessi di partenza dell'app
  const REPARTI_BASE = [
    { id: "torte", nome: "Torte", colore: "#b8325a" }, { id: "biscotti", nome: "Biscotti", colore: "#7254a8" },
    { id: "dolci", nome: "Dolci", colore: "#2f6f8f" }, { id: "salateria", nome: "Salateria", colore: "#3f7d4e" },
    { id: "pane", nome: "Pane", colore: "#9a5b1e" },
  ];

  const CSS = `
.st { font-family: "Figtree", system-ui, -apple-system, "Segoe UI", Arial, sans-serif; color: #111; background: #fff; font-size: 10.5pt; line-height: 1.35; }
.st * { box-sizing: border-box; }
.st-top { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 10px; }
.st-top h1 { font-family: "Bricolage Grotesque", "Figtree", system-ui, sans-serif; font-weight: 800; font-size: 17pt; margin: 0; line-height: 1.1; }
.st-top .neg { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #555; margin-bottom: 2px; }
.st-top .info { text-align: right; font-size: 9pt; color: #444; white-space: nowrap; }
.st-top .info b { font-size: 11pt; color: #111; }
.st-rep { margin: 14px 0 0; }
.st-rep h2 { font-size: 12.5pt; margin: 0 0 4px; padding: 3px 8px; border-left: 6px solid var(--c); background: color-mix(in srgb, var(--c) 12%, #fff); -webkit-print-color-adjust: exact; print-color-adjust: exact; break-after: avoid; }
.st-rep h2 span { font-weight: 500; font-size: 9.5pt; color: #444; margin-left: 6px; }
.st table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.st th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: #555; border-bottom: 1px solid #999; padding: 3px 5px; }
.st td { vertical-align: top; border-bottom: 1px solid #ccc; padding: 5px; overflow-wrap: anywhere; }
.st tr { break-inside: avoid; page-break-inside: avoid; }
.st .c-ok { width: 26px; } .st .c-ora { width: 58px; } .st .c-cli { width: 27%; } .st .c-eur { width: 21%; }
.st .box { display: inline-block; width: 13px; height: 13px; border: 1.5px solid #111; border-radius: 2px; margin-top: 2px; }
.st .ora { font-weight: 800; font-size: 11.5pt; font-variant-numeric: tabular-nums; white-space: nowrap; }
.st .cli { font-weight: 700; }
.st .sub { color: #444; font-size: 9pt; }
.st .tag { display: inline-block; font-size: 7.5pt; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; border: 1px solid #111; border-radius: 3px; padding: 0 4px; margin-top: 2px; }
.st ul { margin: 0; padding: 0; list-style: none; }
.st li + li { margin-top: 2px; }
.st .q { font-weight: 800; font-variant-numeric: tabular-nums; }
.st .in { font-style: italic; color: #333; font-size: 9pt; }
.st .anche { color: #555; font-size: 8.5pt; margin-top: 3px; }
.st .nota { margin-top: 4px; border: 1px dashed #888; border-radius: 4px; padding: 2px 5px; font-size: 9pt; white-space: pre-wrap; }
.st .eur { font-size: 9pt; font-variant-numeric: tabular-nums; }
.st .eur div { display: flex; justify-content: space-between; gap: 6px; }
.st .eur .saldo { font-weight: 800; font-size: 10pt; border-top: 1px solid #999; margin-top: 2px; padding-top: 1px; }
.st .vuoto { padding: 30px 0; text-align: center; font-size: 13pt; color: #444; }
.st.separa .st-rep + .st-rep { break-before: page; page-break-before: always; }
.st-fine { margin-top: 12px; font-size: 8.5pt; color: #666; text-align: right; }
`;

  // opzioni: { ordini, reparti, giorno: "2026-10-31", reparto: "tutti" | id, negozio, preventivi: true, consegnati: false, separa: false, adesso: Date }
  // separa: ogni reparto comincia su un foglio nuovo
  function pagina(op) {
    const reparti = op.reparti && op.reparti.length ? op.reparti : REPARTI_BASE;
    const repNome = id => (reparti.find(r => r.id === id) || { nome: id || "Senza reparto" }).nome;
    const repColore = id => (reparti.find(r => r.id === id) || {}).colore || "#888888";
    const dove = op.reparto && op.reparto !== "tutti" ? op.reparto : null;
    const lista = (op.ordini || []).filter(o => !o.annullato && o.data === op.giorno
      && (op.preventivi !== false || o.tipo !== "preventivo")
      && (op.consegnati || !o.consegnato)
      && (!dove || articoli(o).some(a => a.reparto === dove)))
      .sort((a, b) => (a.ora || "99").localeCompare(b.ora || "99") || (a.cliente || "").localeCompare(b.cliente || "", "it"));

    // un ordine con prodotti di più reparti compare in ogni reparto, con solo i suoi prodotti
    const ordineRep = [...reparti.map(r => r.id)];
    const gruppi = new Map();
    for (const o of lista) {
      const reps = [...new Set(articoli(o).map(a => a.reparto || ""))];
      if (!reps.length) reps.push("");
      for (const r of reps) {
        if (dove && r !== dove) continue;
        if (!gruppi.has(r)) gruppi.set(r, []);
        gruppi.get(r).push(o);
      }
    }
    const chiavi = [...gruppi.keys()].sort((a, b) => {
      const ia = ordineRep.indexOf(a), ib = ordineRep.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });

    const riga = (o, rep) => {
      const tutti = articoli(o);
      const qui = tutti.filter(a => (a.reparto || "") === rep);
      const altri = [...new Set(tutti.filter(a => (a.reparto || "") !== rep).map(a => repNome(a.reparto)))];
      const prezzo = num(o.prezzo), cap = num(o.caparra);
      const tags = [o.tipo === "preventivo" ? "Preventivo" : "", o.consegnato ? "Consegnato" : ""].filter(Boolean);
      return `<tr>
<td><span class="box"></span></td>
<td class="ora">${esc(o.ora || "--:--")}</td>
<td><div class="cli">${esc(o.cliente || "Cliente senza nome")}</div>${o.telefono ? `<div class="sub">${esc(o.telefono)}</div>` : ""}${o.autore ? `<div class="sub">Inserito da ${esc(o.autore)}</div>` : ""}${tags.map(t => `<span class="tag">${t}</span> `).join("")}</td>
<td><ul>${qui.map(a => `<li>${a.quantita ? `<span class="q">${esc(a.quantita)} ${esc(a.unita || "")}</span> ` : ""}${esc(a.prodotto || "")}${a.note ? `<div class="in">${esc(a.note)}</div>` : ""}</li>`).join("") || "<li>—</li>"}</ul>${altri.length ? `<div class="anche">Nello stesso ordine anche: ${esc(altri.join(", "))}</div>` : ""}${o.note ? `<div class="nota">${esc(o.note)}</div>` : ""}</td>
<td class="eur">${prezzo != null ? `<div><span>Totale</span><span>${euro(prezzo)}</span></div>` : ""}${cap != null ? `<div><span>Caparra</span><span>${euro(cap)}</span></div>` : ""}${prezzo != null ? `<div class="saldo"><span>Da saldare</span><span>${euro(Math.max(0, prezzo - (cap || 0)))}</span></div>` : prezzo == null && cap == null ? `<span class="sub">—</span>` : ""}</td>
</tr>`;
    };

    const adesso = op.adesso || new Date();
    const quando = adesso.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) + " alle " + adesso.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    const quanti = lista.length === 1 ? "1 ordine" : `${lista.length} ordini`;
    let h = `<div class="st${op.separa ? " separa" : ""}">
<div class="st-top"><div>${op.negozio ? `<div class="neg">${esc(op.negozio)}</div>` : ""}<h1>Ordini di ${esc(giornoLungo(op.giorno))}</h1></div>
<div class="info"><b>${dove ? esc(repNome(dove)) : "Tutti i reparti"}</b><br>${quanti}</div></div>`;
    if (!lista.length) h += `<div class="vuoto">Nessun ordine per questo giorno${dove ? " in questo reparto" : ""}.</div>`;
    for (const r of chiavi) {
      const os = gruppi.get(r);
      h += `<section class="st-rep" style="--c:${esc(repColore(r))}"><h2>${esc(r ? repNome(r) : "Senza reparto")}<span>${os.length === 1 ? "1 ordine" : os.length + " ordini"}</span></h2>
<table><thead><tr><th class="c-ok">✓</th><th class="c-ora">Ora</th><th class="c-cli">Cliente</th><th>Prodotti e note</th><th class="c-eur">Prezzo</th></tr></thead><tbody>${os.map(o => riga(o, r)).join("")}</tbody></table></section>`;
    }
    h += `<div class="st-fine">Stampato il ${esc(quando)}</div></div>`;
    return { html: h, css: CSS, quanti: lista.length };
  }

  g.StampaOrdini = { pagina, giornoLungo };
})(typeof window !== "undefined" ? window : globalThis);
