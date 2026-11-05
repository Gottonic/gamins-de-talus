-- Gamins de Talus — mise à jour du 05.11.2026 : notification « Nouvel événement créé ».
-- Avant : redéployer la fonction « notifier » (code de supabase/functions/notifier/index.ts).
-- Remplacer LE-SECRET par la valeur de CRON_SECRET, puis coller le tout dans SQL Editor → Run. On peut le relancer.

-- À chaque nouveau message, nouveau mail ou nouvel événement, la base prévient la fonction « notifier ».
create or replace function public.notifier_nouveau() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.deleted and (new.key like 'msg:%' or new.key like 'mail:%' or new.key like 'ev:%') then
    perform net.http_post(
      url := 'https://faouvytsqxridrwffrth.supabase.co/functions/v1/notifier',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron', 'LE-SECRET'),
      body := jsonb_build_object('key', new.key, 'data', new.data));
  end if;
  return new;
end $$;
revoke all on function public.notifier_nouveau() from public, anon, authenticated;
