-- Gamins de Talus : base de données partagée (Noé + Nicolas).
-- À coller une fois dans Supabase > SQL Editor > New query, puis « Run ».
-- Le script peut être relancé sans risque : il ne supprime aucune donnée.

-- 1. Les membres : seules les personnes listées ici voient et modifient les données.
create table if not exists public.membres (
  user_id uuid primary key references auth.users(id) on delete cascade,
  personne text not null unique,          -- 'nicolas' ou 'noe' : la clé utilisée dans les données
  nom      text not null
);
alter table public.membres enable row level security;

create or replace function public.est_membre() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membres where user_id = auth.uid())
$$;
revoke all on function public.est_membre() from public;
grant execute on function public.est_membre() to authenticated;

drop policy if exists "membres visibles par les membres" on public.membres;
create policy "membres visibles par les membres" on public.membres for select to authenticated using (public.est_membre());
revoke all on public.membres from anon, authenticated;
grant select on public.membres to authenticated;

-- 2. Les données : chaque facture, dépense, heure, tâche, contact… est une ligne (clé + contenu JSON).
--    Rien n'est jamais effacé : une suppression met seulement « deleted » à vrai (corbeille).
create table if not exists public.rows (
  key        text        primary key,
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid        default auth.uid()
);
create index if not exists rows_updated on public.rows (updated_at);

-- 3. L'historique : chaque version de chaque ligne est gardée, avec qui et quand.
--    Personne ne peut modifier ni effacer l'historique depuis l'app.
create table if not exists public.rows_history (
  id         bigserial   primary key,
  key        text        not null,
  data       jsonb,
  deleted    boolean     not null,
  changed_at timestamptz not null default now(),
  changed_by uuid
);
create index if not exists rows_history_key on public.rows_history (key, changed_at);

create or replace function public.rows_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create or replace function public.rows_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.data is not distinct from old.data and new.deleted = old.deleted then
    return new;
  end if;
  insert into public.rows_history (key, data, deleted, changed_at, changed_by)
  values (new.key, new.data, new.deleted, new.updated_at, new.updated_by);
  return new;
end $$;

drop trigger if exists rows_touch on public.rows;
create trigger rows_touch before insert or update on public.rows for each row execute function public.rows_touch();
drop trigger if exists rows_log on public.rows;
create trigger rows_log after insert or update on public.rows for each row execute function public.rows_log();

alter table public.rows enable row level security;
alter table public.rows_history enable row level security;

drop policy if exists "lire"     on public.rows;
drop policy if exists "ajouter"  on public.rows;
drop policy if exists "modifier" on public.rows;
create policy "lire"     on public.rows for select to authenticated using (public.est_membre());
create policy "ajouter"  on public.rows for insert to authenticated with check (public.est_membre());
create policy "modifier" on public.rows for update to authenticated using (public.est_membre()) with check (public.est_membre());

drop policy if exists "lire historique" on public.rows_history;
create policy "lire historique" on public.rows_history for select to authenticated using (public.est_membre());

revoke all on public.rows, public.rows_history from anon, authenticated;
grant select, insert, update on public.rows to authenticated;      -- pas de « delete »
grant select on public.rows_history to authenticated;              -- lecture seule
revoke all on sequence public.rows_history_id_seq from anon, authenticated;

-- 4. Petit signal (envoyé par GitHub deux fois par semaine) pour que le projet gratuit ne se mette pas en veille.
create or replace function public.ping() returns integer language sql stable as $$ select 1 $$;
grant execute on function public.ping() to anon, authenticated;

-- 5. APRÈS avoir créé les deux comptes (Authentication > Users), relier chaque compte à sa personne.
--    Remplacer les adresses, puis exécuter ces deux lignes (dans une nouvelle requête) :
--
-- insert into public.membres (user_id, personne, nom) select id, 'nicolas', 'Nicolas' from auth.users where email = 'ADRESSE-DE-NICOLAS' on conflict do nothing;
-- insert into public.membres (user_id, personne, nom) select id, 'noe', 'Noé' from auth.users where email = 'ADRESSE-DE-NOE' on conflict do nothing;

-- 6. (Facultatif, pour la messagerie) Mises à jour en direct : les autres voient un message dès qu'il est envoyé.
alter publication supabase_realtime add table public.rows;
