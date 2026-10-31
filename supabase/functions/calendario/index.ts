// Calendario degli ordini per Google Calendar (iscrizione "Da URL").
// Indirizzo: https://<progetto>.supabase.co/functions/v1/calendario?token=<token>
// Il token si trova nell'app: Impostazioni > Calendario Google.
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const esc = (s: string) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// righe ICS lunghe max 75 byte
const fold = (line: string) => {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 74) { out.push(cur); cur = " " + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
};
const stamp = (iso: string, hm: string) => iso.replace(/-/g, "") + "T" + (hm || "09:00").replace(":", "").padEnd(4, "0") + "00";
const plus30 = (hm: string) => {
  const [h, m] = (hm || "09:00").split(":").map(Number);
  const t = h * 60 + m + 30;
  return String(Math.floor(t / 60) % 24).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
};

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token") || "";
  const { data: cal } = await db.from("docs").select("data").eq("coll", "impostazioni").eq("id", "calendario").maybeSingle();
  if (!token || !cal || cal.data?.token !== token) return new Response("Link non valido", { status: 403 });

  const { data: neg } = await db.from("docs").select("data").eq("coll", "impostazioni").eq("id", "negozio").maybeSingle();
  const reparti: { id: string; nome: string }[] = neg?.data?.reparti || [];
  const repNome = (id: string) => reparti.find((r) => r.id === id)?.nome || id;

  const from = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const rows: { id: string; data: any }[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from("docs").select("id,data").eq("coll", "ordini").gte("data->>data", from).range(off, off + 999);
    if (error) return new Response("Errore", { status: 500 });
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ordini Laboratorio//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + esc(neg?.data?.nome ? "Ordini " + neg.data.nome : "Ordini laboratorio"),
    "X-WR-TIMEZONE:Europe/Rome", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];
  for (const { id, data: o } of rows) {
    if (!o.data || o.annullato) continue;
    const arts = Array.isArray(o.articoli) ? o.articoli : [];
    const pre = o.tipo === "preventivo" ? "Preventivo: " : o.consegnato ? "✓ " : "";
    const desc = [
      ...arts.map((a: any) => `${repNome(a.reparto)}: ${[a.quantita, a.unita, a.prodotto].filter(Boolean).join(" ")}${a.note ? " (" + a.note + ")" : ""}`),
      o.telefono ? "Tel: " + o.telefono : "",
      o.note ? "Note: " + o.note : "",
      typeof o.prezzo === "number" ? "Totale: € " + o.prezzo.toFixed(2).replace(".", ",") : "",
      typeof o.caparra === "number" ? "Caparra: € " + o.caparra.toFixed(2).replace(".", ",") : "",
      o.autore ? "Inserito da " + o.autore : "",
    ].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      "UID:" + id + "@ordini-laboratorio",
      "DTSTAMP:" + now,
      "DTSTART;TZID=Europe/Rome:" + stamp(o.data, o.ora),
      "DTEND;TZID=Europe/Rome:" + stamp(o.data, plus30(o.ora)),
      fold("SUMMARY:" + esc(pre + (o.cliente || "Cliente") + " – " + [...new Set(arts.map((a: any) => repNome(a.reparto)))].join(", "))),
      fold("DESCRIPTION:" + esc(desc)),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-cache" },
  });
});
