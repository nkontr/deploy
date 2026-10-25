-- =====================================================================
-- 06 — точность координат компании (адресов в реестре МСП нет):
--   settlement   — центр указанного населённого пункта;
--   municipality — центр района / городского округа;
--   approx       — не используется (была случайная точка у центра);
--   address      — юридический адрес из ЕГРЮЛ (добавлен в 09).
-- Фронт показывает это в карточке; на масштабе улиц без адреса — группа на нас. пункт.
-- Применить к существующей БД: docker compose down -v && docker compose up -d --build.
-- =====================================================================
SET ROLE core_svc;

ALTER TABLE core.company ADD COLUMN geo_precision text NOT NULL DEFAULT 'approx'
    CHECK (geo_precision IN ('settlement', 'municipality', 'approx'));

RESET ROLE;
