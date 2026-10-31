-- Ordini Laboratorio: da incollare una volta sola in Supabase > SQL Editor > Run.
-- Si può rilanciare senza perdere dati.

-- Tutti i dati dell'app: ordini, clienti, operatori, impostazioni.
create table if not exists public.docs (
  coll text not null check (coll in ('ordini', 'clienti', 'operatori', 'impostazioni')),
  id text not null default replace(gen_random_uuid()::text, '-', ''),
  data jsonb not null default '{}'::jsonb,
  creato timestamptz not null default now(),
  aggiornato timestamptz not null default now(),
  primary key (coll, id)
);

-- Storico: ogni creazione, modifica o cancellazione resta qui per sempre.
create table if not exists public.storia (
  n bigserial primary key,
  coll text not null,
  doc_id text not null,
  azione text not null,
  utente text,
  quando timestamptz not null default now(),
  prima jsonb,
  dopo jsonb
);
create index if not exists storia_doc on public.storia (coll, doc_id, n);

-- Chi può entrare nell'app. admin = può gestire utenti e impostazioni.
create table if not exists public.ammessi (
  email text primary key check (email = lower(email)),
  admin boolean not null default false,
  aggiunto timestamptz not null default now()
);

create or replace function public.sono_ammesso() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ammessi where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
create or replace function public.sono_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ammessi where email = lower(coalesce(auth.jwt() ->> 'email', '')) and admin);
$$;

create or replace function public.registra_storia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.data = new.data then return new; end if;
  insert into storia (coll, doc_id, azione, utente, prima, dopo)
  values (
    coalesce(new.coll, old.coll), coalesce(new.id, old.id), lower(tg_op),
    coalesce(auth.jwt() ->> 'email', 'sistema'),
    case when tg_op <> 'INSERT' then old.data end,
    case when tg_op <> 'DELETE' then new.data end
  );
  return coalesce(new, old);
end $$;
drop trigger if exists docs_storia on public.docs;
create trigger docs_storia after insert or update or delete on public.docs
  for each row execute function public.registra_storia();

-- Modifica solo i campi indicati, senza toccare gli altri.
create or replace function public.aggiorna_doc(p_coll text, p_id text, p_patch jsonb) returns void
language sql security invoker set search_path = public as $$
  update docs set data = data || p_patch, aggiornato = now() where coll = p_coll and id = p_id;
$$;

alter table public.docs enable row level security;
alter table public.storia enable row level security;
alter table public.ammessi enable row level security;

drop policy if exists docs_leggi on public.docs;
drop policy if exists docs_crea on public.docs;
drop policy if exists docs_modifica on public.docs;
drop policy if exists docs_cancella on public.docs;
create policy docs_leggi on public.docs for select to authenticated using (sono_ammesso());
create policy docs_crea on public.docs for insert to authenticated
  with check (sono_ammesso() and (coll <> 'impostazioni' or sono_admin()));
create policy docs_modifica on public.docs for update to authenticated
  using (sono_ammesso() and (coll <> 'impostazioni' or sono_admin()))
  with check (sono_ammesso() and (coll <> 'impostazioni' or sono_admin()));
-- Ordini e clienti non si cancellano mai: si annullano o si archiviano.
create policy docs_cancella on public.docs for delete to authenticated
  using (sono_ammesso() and coll = 'operatori');

drop policy if exists storia_leggi on public.storia;
create policy storia_leggi on public.storia for select to authenticated using (sono_ammesso());

drop policy if exists ammessi_leggi on public.ammessi;
drop policy if exists ammessi_gestisci on public.ammessi;
create policy ammessi_leggi on public.ammessi for select to authenticated using (sono_ammesso());
create policy ammessi_gestisci on public.ammessi for all to authenticated using (sono_admin()) with check (sono_admin());

-- Aggiornamenti in tempo reale su tutti i dispositivi.
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- Foto di riferimento (private, non si cancellano).
insert into storage.buckets (id, name, public) values ('foto', 'foto', false) on conflict (id) do nothing;
drop policy if exists foto_leggi on storage.objects;
drop policy if exists foto_carica on storage.objects;
create policy foto_leggi on storage.objects for select to authenticated using (bucket_id = 'foto' and public.sono_ammesso());
create policy foto_carica on storage.objects for insert to authenticated with check (bucket_id = 'foto' and public.sono_ammesso());

-- Preavviso minimo per reparto (es. Biscotti 5 giorni): un ordine troppo vicino
-- si salva solo con il PIN dei titolari. Il controllo è qui nel database,
-- quindi vale anche se qualcuno prova a saltare l'app.
create extension if not exists pgcrypto with schema extensions;

-- Il PIN è salvato cifrato e nessuno lo può leggere dall'app.
create table if not exists public.segreti (nome text primary key, valore text not null);
alter table public.segreti enable row level security;

-- Sblocchi usa-e-getta, validi 30 minuti, creati solo con il PIN giusto.
create table if not exists public.sblocchi (
  token text primary key default replace(gen_random_uuid()::text, '-', ''),
  creato_da text,
  scade timestamptz not null default now() + interval '30 minutes',
  usato boolean not null default false
);
alter table public.sblocchi enable row level security;

create or replace function public.imposta_pin(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not sono_admin() then raise exception 'Solo i titolari possono cambiare il PIN'; end if;
  if p_pin is null or length(p_pin) < 4 then raise exception 'Il PIN deve avere almeno 4 cifre'; end if;
  insert into segreti (nome, valore) values ('pin_titolari', crypt(p_pin, gen_salt('bf')))
  on conflict (nome) do update set valore = excluded.valore;
end $$;

create or replace function public.pin_impostato() returns boolean
language sql stable security definer set search_path = public as $$
  select sono_ammesso() and exists (select 1 from segreti where nome = 'pin_titolari');
$$;

create or replace function public.sblocca_con_pin(p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare h text; t text;
begin
  if not sono_ammesso() then raise exception 'Accesso non abilitato'; end if;
  select valore into h from segreti where nome = 'pin_titolari';
  if h is null then raise exception 'PIN_MANCANTE'; end if;
  if crypt(coalesce(p_pin, ''), h) <> h then
    perform pg_sleep(2);  -- rallenta chi prova a indovinare
    raise exception 'PIN_SBAGLIATO';
  end if;
  insert into sblocchi (creato_da) values (auth.jwt() ->> 'email') returning token into t;
  return t;
end $$;

create or replace function public.controlla_preavviso() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  giorni int; minimo int := 0; nome_rep text; tok text; reps jsonb; a jsonb; r jsonb; g int;
begin
  if new.coll <> 'ordini' or coalesce((new.data ->> 'annullato')::boolean, false) then return new; end if;
  if coalesce(new.data ->> 'data', '') !~ '^\d{4}-\d{2}-\d{2}$' then return new; end if;
  -- si controlla solo quando cambiano il giorno o i reparti (non per i cambi di stato)
  if tg_op = 'UPDATE'
     and old.data -> 'data' is not distinct from new.data -> 'data'
     and jsonb_path_query_array(coalesce(old.data -> 'articoli', '[]'), '$[*].reparto')
         = jsonb_path_query_array(coalesce(new.data -> 'articoli', '[]'), '$[*].reparto')
     and not coalesce((old.data ->> 'annullato')::boolean, false) then
    return new;
  end if;
  giorni := (new.data ->> 'data')::date - (now() at time zone 'Europe/Rome')::date;
  select data -> 'reparti' into reps from docs where coll = 'impostazioni' and id = 'negozio';
  for a in select * from jsonb_array_elements(coalesce(new.data -> 'articoli', '[]')) loop
    for r in select * from jsonb_array_elements(coalesce(reps, '[]')) loop
      g := coalesce(nullif(r ->> 'giorniMinimi', '')::int, 0);
      if r ->> 'id' = a ->> 'reparto' and g > giorni and g > minimo then minimo := g; nome_rep := r ->> 'nome'; end if;
    end loop;
  end loop;
  if minimo = 0 then return new; end if;
  tok := new.data ->> 'sblocco';
  if tok is not null then
    update sblocchi set usato = true where token = tok and not usato and scade > now();
    if found then return new; end if;
  end if;
  raise exception 'PREAVVISO|%|%|%', nome_rep, minimo, giorni using errcode = 'P0001';
end $$;
drop trigger if exists docs_preavviso on public.docs;
create trigger docs_preavviso before insert or update on public.docs
  for each row execute function public.controlla_preavviso();

-- Dati iniziali.
insert into public.docs (coll, id, data) values
  ('impostazioni', 'negozio', jsonb_build_object(
    'nome', '',
    'reparti', jsonb_build_array(
      jsonb_build_object('id', 'torte', 'nome', 'Torte', 'colore', '#b8325a', 'unita', jsonb_build_array('torte', 'persone', 'kg')),
      jsonb_build_object('id', 'biscotti', 'nome', 'Biscotti', 'colore', '#7254a8', 'unita', jsonb_build_array('kg', 'pezzi', 'vassoi'), 'giorniMinimi', 5),
      jsonb_build_object('id', 'dolci', 'nome', 'Dolci', 'colore', '#2f6f8f', 'unita', jsonb_build_array('kg', 'pezzi', 'vassoi')),
      jsonb_build_object('id', 'salateria', 'nome', 'Salateria', 'colore', '#3f7d4e', 'unita', jsonb_build_array('kg', 'quantità')),
      jsonb_build_object('id', 'pane', 'nome', 'Pane', 'colore', '#9a5b1e', 'unita', jsonb_build_array('kg', 'pezzi'))
    ),
    'saluto', 'Ciao {nome}, ecco il riepilogo del tuo ordine da {negozio}:',
    'salutoPreventivo', 'Ciao {nome}, ecco il preventivo da {negozio}:',
    'chiusuraPreventivo', 'Facci sapere se va bene così confermiamo l''ordine.',
    'firma', 'Grazie e a presto!'
  )),
  ('impostazioni', 'calendario', jsonb_build_object('token', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')))
on conflict do nothing;

insert into public.docs (coll, id, data)
select 'operatori', lower(n), jsonb_build_object('nome', n)
from unnest(array['Sofia', 'Annalisa', 'Sara', 'Miriam', 'Antonella', 'Filippo']) as n
on conflict do nothing;

-- La prima amministratrice si aggiunge a parte (la sua email non sta in questo file pubblico):
-- insert into public.ammessi (email, admin) values ('email@esempio.it', true) on conflict (email) do update set admin = true;
