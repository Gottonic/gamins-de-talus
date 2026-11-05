-- Gamins de Talus — mise à jour du 05.11.2026 (2) : résumé des notifications arrivées hors des jours et heures choisis.
-- Avant : redéployer la fonction « notifier ». Remplacer LE-SECRET par la valeur de CRON_SECRET, puis SQL Editor → Run. On peut le relancer.

-- Toutes les 15 minutes : la fonction envoie ce qui attend, à ceux dont la plage horaire est ouverte.
select cron.unschedule('gdt-notif-resume') where exists (select 1 from cron.job where jobname = 'gdt-notif-resume');
select cron.schedule('gdt-notif-resume', '*/15 * * * *', $c$ select net.http_post(url := 'https://faouvytsqxridrwffrth.supabase.co/functions/v1/notifier',
  headers := '{"Content-Type": "application/json", "x-cron": "LE-SECRET"}'::jsonb, body := '{"resume": true}'::jsonb) $c$);
