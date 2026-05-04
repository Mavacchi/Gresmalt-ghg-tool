-- ════════════════════════════════════════════════════════════════════
-- 07_invite_operators.sql — Mappa email → ruolo + auto-assegnazione
-- ════════════════════════════════════════════════════════════════════
--
-- DESIGN
--   La precedente versione era una do-block one-shot che faceva
--     update auth.users ... where email = '...'
--   e usciva con `raise notice` se l'utente non era ancora registrato.
--   Risultato: ogni volta che un nuovo operatore veniva invitato BISOGNAVA
--   ricordarsi di rieseguire lo script DOPO la registrazione, altrimenti
--   l'utente restava `viewer`.
--
--   Questa versione sposta il ruolo in una tabella di mapping
--   (`public.role_map`) e aggancia 2 trigger:
--
--     1) BEFORE INSERT/UPDATE OF email ON auth.users
--        → quando un utente Supabase viene creato o cambia email,
--          se la sua email è in role_map, scrive `role` in
--          `raw_app_meta_data` PRIMA del commit.
--
--     2) AFTER INSERT/UPDATE/DELETE ON public.role_map
--        → quando un admin aggiunge/rinomina/rimuove un mapping,
--          propaga il cambio a auth.users per gli utenti già registrati.
--
--   Vantaggio: l'ordine di operazioni non importa più. Posso
--   prima invitare l'utente e poi mapparlo, oppure mapparlo prima e
--   invitarlo dopo: in entrambi i casi il ruolo arriva al primo login.
--
-- USAGE
--   1. Eseguire una volta come postgres / service_role.
--   2. Per aggiungere un nuovo operatore: inserire (o aggiornare) una
--      riga in `public.role_map` (manualmente via SQL editor o via
--      una UI futura). Niente da rieseguire.
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
--  TABELLA role_map
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.role_map (
  email      text primary key,
  role       text not null check (role in ('admin','editor','auditor','viewer')),
  added_at   timestamptz default now(),
  added_by   uuid references auth.users(id),
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

-- Migrazione: schemi pre-esistenti senza updated_by (bug storico:
-- il trigger set_updated_at() la presupponeva). Add idempotente.
alter table public.role_map
  add column if not exists updated_by uuid references auth.users(id);

-- updated_at + updated_by via trigger esistente (definito in 01_schema.sql)
drop trigger if exists role_map_set_updated_at on public.role_map;
create trigger role_map_set_updated_at
before update on public.role_map
for each row execute function public.set_updated_at();

-- RLS: solo admin legge e scrive
alter table public.role_map enable row level security;
alter table public.role_map force  row level security;

drop policy if exists role_map_select on public.role_map;
create policy role_map_select on public.role_map
  for select to authenticated
  using (public.current_role() = 'admin');

drop policy if exists role_map_write on public.role_map;
create policy role_map_write on public.role_map
  for all to authenticated
  using      (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- GRANT base (vedi nota su grant in 03_roles.sql)
grant select, insert, update, delete on public.role_map to authenticated;

-- ────────────────────────────────────────────────────────────────────
--  TRIGGER 1 — auth.users: applica il ruolo al primo login / al cambio email
--  Esegue come security definer (l'owner postgres ha accesso ad auth.users).
-- ────────────────────────────────────────────────────────────────────
create or replace function public.apply_role_from_map()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
begin
  if new.email is null then
    return new;
  end if;
  select role into v_role
    from public.role_map
   where lower(email) = lower(new.email)
   limit 1;
  if v_role is not null then
    new.raw_app_meta_data :=
      coalesce(new.raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', v_role);
  end if;
  return new;
end;
$$;

drop trigger if exists apply_role_from_map_trg on auth.users;
create trigger apply_role_from_map_trg
  before insert or update of email on auth.users
  for each row execute function public.apply_role_from_map();

-- ────────────────────────────────────────────────────────────────────
--  TRIGGER 2 — role_map: propaga il cambio agli utenti già registrati
-- ────────────────────────────────────────────────────────────────────
create or replace function public.propagate_role_map_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if (tg_op = 'DELETE') then
    -- Rimuove la chiave 'role' da app_metadata; conserva il resto del jsonb.
    update auth.users
       set raw_app_meta_data = (raw_app_meta_data - 'role')
     where lower(email) = lower(old.email);
    return old;
  else
    -- INSERT o UPDATE: applica il nuovo ruolo.
    update auth.users
       set raw_app_meta_data =
             coalesce(raw_app_meta_data, '{}'::jsonb)
             || jsonb_build_object('role', new.role)
     where lower(email) = lower(new.email);
    -- Se in UPDATE l'email è cambiata, sgancia la vecchia.
    if tg_op = 'UPDATE' and lower(old.email) <> lower(new.email) then
      update auth.users
         set raw_app_meta_data = (raw_app_meta_data - 'role')
       where lower(email) = lower(old.email);
    end if;
    return new;
  end if;
end;
$$;

drop trigger if exists propagate_role_map_change_trg on public.role_map;
create trigger propagate_role_map_change_trg
  after insert or update or delete on public.role_map
  for each row execute function public.propagate_role_map_change();

-- ────────────────────────────────────────────────────────────────────
--  SEED iniziale dei 3 operatori noti
--  (i trigger sopra fanno il resto: backfill di auth.users
--  per chi è già registrato, applicazione al primo login per chi non lo è)
-- ────────────────────────────────────────────────────────────────────
insert into public.role_map (email, role) values
  ('marco.vacchi@gresmalt.it',     'admin'),
  ('davide.settembre@gresmalt.it', 'editor'),
  ('luca.iattici@gresmalt.it',     'editor')
on conflict (email) do update
  set role = excluded.role;

-- ────────────────────────────────────────────────────────────────────
--  PROMEMORIA MFA
--  Per admin e auditor MFA TOTP è obbligatorio. L'enrollment avviene
--  al primo login dalla sezione Account → MFA del client. Per forzare
--  AAL2 sui ruoli admin/auditor, configurare Authentication → Policies
--  in Supabase.
-- ────────────────────────────────────────────────────────────────────

-- ════════════════════════════════════════════════════════════════════
-- end of 07_invite_operators.sql
-- ════════════════════════════════════════════════════════════════════
