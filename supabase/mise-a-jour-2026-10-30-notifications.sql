-- Gamins de Talus — mise à jour du 30.10.2026 (3) : notifications « pop-up » sur les téléphones et ordinateurs.
-- Avant : déployer la fonction « notifier » (Verify JWT désactivé) et ajouter le secret VAPID_PRIVATE.
-- Remplacer LE-SECRET (2 fois) par la valeur de CRON_SECRET, puis coller le tout dans SQL Editor → Run. On peut le relancer.

create extension if not exists pg_net;

-- 1. À chaque nouveau message ou nouveau mail, la base prévient la fonction « notifier ».
create or replace function public.notifier_nouveau() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.deleted and (new.key like 'msg:%' or new.key like 'mail:%') then
    perform net.http_post(
      url := 'https://faouvytsqxridrwffrth.supabase.co/functions/v1/notifier',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron', 'LE-SECRET'),
      body := jsonb_build_object('key', new.key, 'data', new.data));
  end if;
  return new;
end $$;
revoke all on function public.notifier_nouveau() from public, anon, authenticated;
drop trigger if exists notifier_nouveau on public.rows;
create trigger notifier_nouveau after insert on public.rows for each row execute function public.notifier_nouveau();

-- 2. Chaque matin (6 h 15 UTC = 7 h 15 en hiver, 8 h 15 en été) : les tâches et événements du jour.
select cron.unschedule('gdt-notif-matin') where exists (select 1 from cron.job where jobname = 'gdt-notif-matin');
select cron.schedule('gdt-notif-matin', '15 6 * * *', $c$ select net.http_post(url := 'https://faouvytsqxridrwffrth.supabase.co/functions/v1/notifier',
  headers := '{"Content-Type": "application/json", "x-cron": "LE-SECRET"}'::jsonb, body := '{"matin": true}'::jsonb) $c$);
