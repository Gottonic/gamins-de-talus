-- Gamins de Talus — mise à jour du 30.10.2026 (2) : historique allégé.
-- À coller en une fois dans Supabase → SQL Editor → New query → Run. On peut le relancer sans risque.
--
-- Certaines lignes changent très souvent sans rien d'utile à garder : les marques « lu » de la messagerie,
-- l'état de la relève des mails, les calculs d'irrigation de la semaine et la date de la dernière sauvegarde.
-- Elles restent dans la base (valeur actuelle), mais ne sont plus copiées dans l'historique à chaque changement.

create or replace function public.rows_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.data is not distinct from old.data and new.deleted = old.deleted then
    return new;
  end if;
  if new.key like 'lu:%' or new.key like 'irr:%' or new.key in ('cfg:mails:etat', 'cfg:sauvegarde') then
    return new;
  end if;
  insert into public.rows_history (key, data, deleted, changed_at, changed_by)
  values (new.key, new.data, new.deleted, new.updated_at, new.updated_by);
  return new;
end $$;

-- Et on efface les copies déjà accumulées pour ces lignes-là (rien d'autre n'est touché).
delete from public.rows_history
where key like 'lu:%' or key like 'irr:%' or key in ('cfg:mails:etat', 'cfg:sauvegarde');

-- La place libérée est réutilisée automatiquement par la base (nettoyage automatique de Postgres).
