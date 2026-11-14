-- Gamins de Talus : lien privé « mes heures », en lecture seule (pour Locus, l'app perso de Nicolas).
-- À coller une fois dans Supabase (projet GDT) > SQL Editor > New query, puis « Run ». Peut être relancé sans risque.
--
-- Ce que ça fait : chaque personne peut créer une clé secrète qui permet de lire SES heures (lignes h:…), et rien d'autre.
-- Pas d'écriture, pas d'accès aux heures des autres, ni aux factures, contacts, etc.
-- Supabase ne garde que l'empreinte de la clé. Une nouvelle clé remplace l'ancienne (l'ancien lien ne marche plus).
-- Ne change rien pour l'app GDT ni pour les autres membres.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.liens_heures (
  personne text primary key,
  cle_hash text not null,
  cree     timestamptz not null default now()
);
alter table public.liens_heures enable row level security;   -- aucune règle : on n'y touche que par les deux fonctions ci-dessous
revoke all on public.liens_heures from anon, authenticated;

-- Créer (ou remplacer) sa clé : réservé à un membre connecté, renvoie la clé une seule fois.
create or replace function public.lien_heures_nouveau() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare p text; c text := encode(gen_random_bytes(24), 'hex');
begin
  select personne into p from public.membres where user_id = auth.uid();
  if p is null then raise exception 'réservé aux membres'; end if;
  insert into public.liens_heures (personne, cle_hash) values (p, encode(digest(c, 'sha256'), 'hex'))
  on conflict (personne) do update set cle_hash = excluded.cle_hash, cree = now();
  return c;
end $$;
revoke all on function public.lien_heures_nouveau() from public, anon;
grant execute on function public.lien_heures_nouveau() to authenticated;

-- Lire ses heures avec la clé : jours travaillés (pas les jours « off »), depuis une date (par défaut 400 jours).
create or replace function public.mes_heures(cle text, depuis date default null) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare p text; d text := to_char(coalesce(depuis, (now() at time zone 'Europe/Zurich')::date - 400), 'YYYY-MM-DD');
begin
  select personne into p from public.liens_heures where cle_hash = encode(digest(coalesce(cle, ''), 'sha256'), 'hex');
  if p is null then raise exception 'clé inconnue'; end if;
  return jsonb_build_object(
    'personne', p,
    'lu', now(),
    'heures', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', r.data->>'date', 'heures', r.data->'heures', 'debut', r.data->>'debut', 'fin', r.data->>'fin',
               'pause', r.data->'pause', 'note', r.data->>'note') order by r.data->>'date')
      from public.rows r
      where r.key like 'h:%' and not r.deleted
        and r.data->>'personne' = p
        and coalesce(r.data->>'off', 'false') not in ('true', '1')
        and r.data->>'date' >= d
    ), '[]'::jsonb));
end $$;
revoke all on function public.mes_heures(text, date) from public;
grant execute on function public.mes_heures(text, date) to anon, authenticated;
