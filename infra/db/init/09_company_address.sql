-- =====================================================================
-- 09 — настоящие адреса компаний. В реестре МСП адреса нет; юридический адрес
-- юрлиц берём из ЕГРЮЛ (DaData, «Организация по ИНН») — etl/etl/addresses.py.
--   geo_precision = 'address' — точка на адресе из ЕГРЮЛ (точность «дом»);
--   остальные — условные (на здании населённого пункта/района, 06): на уровне
--   улиц карта показывает их не точками, а группой на населённый пункт.
-- У ИП адрес в ЕГРИП закрыт — у них точного адреса не будет.
-- Применить к существующей БД: psql … -f этот файл (или docker compose down -v && up).
-- =====================================================================
SET ROLE core_svc;

ALTER TABLE core.company DROP CONSTRAINT company_geo_precision_check;
ALTER TABLE core.company ADD CONSTRAINT company_geo_precision_check
    CHECK (geo_precision IN ('address', 'settlement', 'municipality', 'approx'));
ALTER TABLE core.company ADD COLUMN address text;   -- юридический адрес из ЕГРЮЛ, если найден

RESET ROLE;

SET ROLE etl_loader;

-- Кэш ответов ЕГРЮЛ по ИНН: переживает перезагрузку core.company (ETL пересоздаёт её с нуля),
-- поэтому бесплатный лимит DaData (10 000 запросов в сутки) не тратится повторно.
CREATE TABLE etl.egrul_address (
    inn          text PRIMARY KEY,
    found        boolean     NOT NULL,                -- false — DaData не знает такой ИНН
    address      text,                                -- «344002, Ростовская обл, г Ростов-на-Дону, ул …»
    lat          double precision,
    lon          double precision,
    qc_geo       int,                                 -- 0 — дом, 1 — ближайший дом, 2 — улица, 3 — нас. пункт, 4 — город, 5 — нет
    fetched_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE etl.egrul_address IS 'Python — ETL: юридические адреса юрлиц из ЕГРЮЛ (DaData), кэш по ИНН';

RESET ROLE;
