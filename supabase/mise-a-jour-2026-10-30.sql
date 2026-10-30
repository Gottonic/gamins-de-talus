-- Gamins de Talus — mise à jour du 30.10.2026 (Drive, corbeille, place utilisée, mails).
-- À coller en une fois dans Supabase → SQL Editor → New query → Run. On peut le relancer sans risque.

-- 1. Stockage des fichiers : le Drive accepte tous les types de fichiers, jusqu'à 25 Mo
--    (avant : seulement photos et PDF, 10 Mo). Crée l'espace s'il n'existe pas encore.
insert into storage.buckets (id, name, public) values ('fichiers', 'fichiers', false) on conflict (id) do nothing;
update storage.buckets set allowed_mime_types = null, file_size_limit = 26214400 where id = 'fichiers';
drop policy if exists "fichiers : les membres lisent" on storage.objects;
create policy "fichiers : les membres lisent" on storage.objects for select to authenticated using (bucket_id = 'fichiers' and public.est_membre());
drop policy if exists "fichiers : les membres ajoutent" on storage.objects;
create policy "fichiers : les membres ajoutent" on storage.objects for insert to authenticated with check (bucket_id = 'fichiers' and public.est_membre());

-- 2. Effacer des fichiers : seulement ce qui a fait son temps.
--    Photos des messages > 6 mois ; justificatifs > 2 ans ; fichiers du Drive à la corbeille depuis plus de 6 mois.
drop policy if exists "fichiers : effacer ce qui a expiré" on storage.objects;
create policy "fichiers : effacer ce qui a expiré" on storage.objects for delete to authenticated using (
  bucket_id = 'fichiers' and public.est_membre() and (
    (name like 'messages/%' and created_at < now() - interval '6 months') or
    (name like 'justificatifs/%' and created_at < now() - interval '2 years') or
    (name like 'drive/%' and exists (
      select 1 from public.rows r where r.key like 'drv:%' and r.deleted and r.updated_at < now() - interval '6 months' and r.data->>'chemin' = storage.objects.name))));

-- 3. Corbeille : ce qui y est depuis plus de 6 mois est effacé pour de bon, historique compris (chaque nuit à 3 h 17).
--    (+ 14 jours de marge, pour que les appareils aient le temps d'effacer les fichiers du Drive correspondants.)
create extension if not exists pg_cron;
create or replace function public.vider_corbeille() returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with vieux as (select key from public.rows where deleted and updated_at < now() - interval '6 months 14 days'),
       h as (delete from public.rows_history where key in (select key from vieux))
  delete from public.rows where key in (select key from vieux);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.vider_corbeille() from public, anon, authenticated;
select cron.unschedule('gdt-vider-corbeille') where exists (select 1 from cron.job where jobname = 'gdt-vider-corbeille');
select cron.schedule('gdt-vider-corbeille', '17 3 * * *', 'select public.vider_corbeille()');

-- 4. Place utilisée (affichée dans le Drive et dans Réglages → Données).
create or replace function public.utilisation() returns jsonb language sql stable security definer set search_path = public, storage as $$
  select jsonb_build_object(
    'base', pg_database_size(current_database()),
    'donnees', pg_total_relation_size('public.rows'),
    'historique', pg_total_relation_size('public.rows_history'),
    'fichiers', coalesce((select jsonb_object_agg(dossier, taille) from (
        select split_part(name, '/', 1) as dossier, sum(coalesce((metadata->>'size')::bigint, 0)) as taille
        from storage.objects where bucket_id = 'fichiers' group by 1) t), '{}'::jsonb))
  where public.est_membre();
$$;
revoke all on function public.utilisation() from public, anon;
grant execute on function public.utilisation() to authenticated;

-- 5. (Si pas encore fait) messages en direct.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'rows') then
    alter publication supabase_realtime add table public.rows;
  end if;
end $$;

-- 6. (Facultatif, après avoir installé la fonction « mails » et défini le secret CRON_SECRET)
--    Relever la boîte toutes les 10 minutes, même quand personne n'a l'app ouverte.
--    Remplacer LE-SECRET par la valeur de CRON_SECRET, enlever les « -- » des 3 lignes et lancer.
-- create extension if not exists pg_net;
-- select cron.schedule('gdt-mails', '*/10 * * * *', $c$ select net.http_post(url := 'https://faouvytsqxridrwffrth.supabase.co/functions/v1/mails',
--   headers := '{"Content-Type": "application/json", "x-cron": "LE-SECRET"}'::jsonb, body := '{}'::jsonb) $c$);
