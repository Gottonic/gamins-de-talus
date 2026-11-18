-- Gamins de Talus — mise à jour du 18.11.2026 : mails programmés (envoyés à l'heure dite, même si personne n'ouvre l'app).
-- Avant : redéployer la fonction « mails » (sans « Verify JWT », comme « notifier »).
-- Remplacer LE-SECRET par la valeur de CRON_SECRET, puis SQL Editor → Run. On peut le relancer.

-- Toutes les 15 minutes : la fonction « mails » envoie les mails programmés dont l'heure est passée.
select cron.unschedule('gdt-mails-programmes') where exists (select 1 from cron.job where jobname = 'gdt-mails-programmes');
select cron.schedule('gdt-mails-programmes', '*/15 * * * *', $c$ select net.http_post(url := 'https://faouvytsqxridrwffrth.supabase.co/functions/v1/mails',
  headers := '{"Content-Type": "application/json", "x-cron": "LE-SECRET"}'::jsonb, body := '{"programmes": true}'::jsonb) $c$);
