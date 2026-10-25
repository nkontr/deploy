package ru.rt.radar;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.images.builder.Transferable;

import javax.sql.DataSource;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

/**
 * Один Postgres 16 на все тесты, со структурой из infra/db/init — как в docker compose.
 * Сервис ходит под core_svc, тесты тоже. Набор компаний — {@link #resetStandardData()}.
 */
public final class TestDb {

    public static final String CORE_USER = "core_svc";
    public static final String CORE_PASSWORD = "core_dev";   // значение по умолчанию из 01_roles_and_schemas.sh

    private static final Path INIT = Path.of("..", "infra", "db", "init");

    private static final PostgreSQLContainer<?> PG = start();

    private TestDb() {
    }

    public static String coreJdbcUrl() {
        return PG.getJdbcUrl() + "&currentSchema=core";
    }

    public static DataSource coreDataSource() {
        return new DriverManagerDataSource(coreJdbcUrl(), CORE_USER, CORE_PASSWORD);
    }

    public static JdbcTemplate jdbc() {
        return new JdbcTemplate(coreDataSource());
    }

    /**
     * Все init-скрипты — в /docker-entrypoint-initdb.d (withInitScript берёт только один SQL-файл, а 01 — bash).
     * CRLF убираем: на Windows git выдаёт .sh с CRLF, и bash его не запускает.
     */
    private static PostgreSQLContainer<?> start() {
        PostgreSQLContainer<?> pg = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("radar").withUsername("postgres").withPassword("postgres_test");
        try (Stream<Path> files = Files.list(INIT)) {
            files.sorted().forEach(file -> {
                String name = file.getFileName().toString();
                try {
                    String text = Files.readString(file, StandardCharsets.UTF_8).replace("\r", "");
                    pg.withCopyToContainer(
                            Transferable.of(text.getBytes(StandardCharsets.UTF_8), name.endsWith(".sh") ? 0755 : 0644),
                            "/docker-entrypoint-initdb.d/" + name);
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            });
        } catch (IOException e) {
            throw new UncheckedIOException("Нет папки " + INIT.toAbsolutePath(), e);
        }
        pg.start();   // останавливает Ryuk после завершения JVM
        return pg;
    }

    /**
     * Стандартный набор: 2 района и 8 компаний. id районов 1, 2; id компаний 1..8 по порядку вставки.
     * <pre>
     * id inn           название               отрасль    район выручка     рост  нов  клиент статус    kind
     * 1  6100000001    ООО "АЛЬФА"            trade      1     10 000 000  5.0   -    да     active    ours
     * 2  6100000002    ООО "БЕТА"             logistics  1     50 000 000  12.0  -    нет    active    others
     * 3  610000000301  ИП Гамма               logistics  1     null        null  да   нет    active    others
     * 4  6100000004    ООО "ДЕЛЬТА 100%"      it         2     200 000 000 -2.0  -    да     excluded  excluded
     * 5  6100000005    ООО "ЭПСИЛОН_1"        it         2     3 000 000   30.0  да   нет    active    others
     * 6  610000000601  ИП Зета                agro       2     70 000 000  1.0   -    да     active    ours
     * 7  6100000007    ООО "ЭТА"              trade      1     20 000 000  0.0   -    нет    excluded  others
     * 8  6100000008    ООО "ТЕТА"             trade      1     10 000 000  3.0   -    нет    active    others
     * </pre>
     */
    public static void resetStandardData() {
        JdbcTemplate j = jdbc();
        // company_location — без FK (переживает перезагрузку ETL), CASCADE её не чистит
        j.execute("TRUNCATE municipality_stats, company, municipality, company_location RESTART IDENTITY CASCADE");
        j.update("INSERT INTO municipality (id, name, kind, lat, lon) VALUES "
                + "(1, 'г. Тестоград', 'city', 47.2, 39.7), (2, 'Тестовый р-н', 'district', 46.5, 41.5)");
        j.update("""
                INSERT INTO company (inn, name, subject_type, industry, okved_code, municipality_id, lat, lon,
                                     size_category, employees, registered_at, revenue_est, revenue_growth_est,
                                     revenue_source, is_estimated, is_new, is_client, status) VALUES
                ('6100000001', 'ООО "АЛЬФА"',       'legal', 'trade',     '47.11', 1, 47.21, 39.71, 'micro',  3,    '2019-07-10', 10000000,  5.0,  'model', true,  false, true,  'active'),
                ('6100000002', 'ООО "БЕТА"',        'legal', 'logistics', '49.41', 1, 47.22, 39.72, 'small',  42,   '2015-11-02', 50000000,  12.0, 'fns',   false, false, false, 'active'),
                ('610000000301', 'ИП Гамма',        'ip',    'logistics', '49.41', 1, 47.23, 39.73, 'micro',  NULL, '2026-03-02', NULL,      NULL, NULL,    true,  true,  false, 'active'),
                ('6100000004', 'ООО "ДЕЛЬТА 100%"', 'legal', 'it',        '62.01', 2, 46.51, 41.51, 'medium', 120,  '2008-04-21', 200000000, -2.0, 'fns',   false, false, true,  'excluded'),
                ('6100000005', 'ООО "ЭПСИЛОН_1"',   'legal', 'it',        '62.01', 2, 46.52, 41.52, 'micro',  18,   '2020-01-15', 3000000,   30.0, 'model', true,  true,  false, 'active'),
                ('610000000601', 'ИП Зета',         'ip',    'agro',      '01.11', 2, 46.53, 41.53, 'micro',  NULL, '2017-09-05', 70000000,  1.0,  'model', true,  false, true,  'active'),
                ('6100000007', 'ООО "ЭТА"',         'legal', 'trade',     '47.11', 1, 47.24, 39.74, 'micro',  2,    NULL,         20000000,  0.0,  'model', true,  false, false, 'excluded'),
                ('6100000008', 'ООО "ТЕТА"',        'legal', 'trade',     '47.19', 1, 47.25, 39.75, 'micro',  NULL, '2021-05-20', 10000000,  3.0,  'model', true,  false, false, 'active')
                """);
        // У всех компаний стандартного набора — адрес из ЕГРЮЛ: на карте они точками.
        // Группы «без адреса» проверяет MapApiTest.groupsForCompaniesWithoutAddress
        j.update("UPDATE company SET geo_precision = 'address'");
        // Компания 1 — полностью заполненная карточка (для сверки с contracts/examples/company.json)
        j.update("""
                UPDATE company SET ogrn = '1196196012345', okved_name = 'Торговля розничная', phone = '+78632000001',
                       email = 'info@alfa.example', has_licenses = true WHERE id = 1
                """);
    }

    /** Место компании в company_location (по ИНН, без FK — как у сервиса). */
    public static void addLocation(String inn, String kind, String municipalityName, String regionName) {
        jdbc().update("""
                INSERT INTO company_location (inn, kind, municipality_name, region_name, source, confidence)
                VALUES (?, ?, ?, ?, 'manager', 0.8)""", inn, kind, municipalityName, regionName);
    }

    /**
     * Стандартный набор + 5 инвестпроектов (id 1..5). need_offer уже заполнен 04_need_offer.sql.
     * <pre>
     * id район  ключ  годы       млн      стадия        отрасль        потребности               updated_at (UTC)
     * 1  1      да    2022–2026  1150.00  construction  logistics      it_infra, phys_security   2026-10-20 10:00:00.123456
     * 2  1      нет   2021–2028  8000.00  construction  manufacturing  apcs, it_infra            2026-10-20 11:00:00
     * 3  2      нет   2024–2026  3704.00  launch        agro           —                         2026-10-21 09:30:00.5
     * 4  2      нет   —          null     null          null           info_security             2026-10-22 12:00:00
     * 5  1      да    2019–2025  650.50   launch        logistics      it_infra                  2026-10-23 08:00:00.000001
     * </pre>
     */
    public static void resetStandardDataWithProjects() {
        resetStandardData();
        jdbc().update("""
                INSERT INTO invest_project (id, municipality_id, initiator, title, is_key, curator, start_year, launch_year,
                                            amount_mln, jobs, stage, industry, needs, updated_at) VALUES
                (1, 1, 'ООО «Бета»',  'Логистический центр',    true,  'Минпром',    2022, 2026, 1150.00, 150,  'construction', 'logistics',     '{it_infra,phys_security}', '2026-10-20 10:00:00.123456+00'),
                (2, 1, 'ИП Зета',     'Завод запчастей',        false, NULL,         2021, 2028, 8000.00, 700,  'construction', 'manufacturing', '{apcs,it_infra}',          '2026-10-20 11:00:00+00'),
                (3, 2, NULL,          'Теплица',                false, 'Минсельхоз', 2024, 2026, 3704.00, 120,  'launch',       'agro',          '{}',                       '2026-10-21 09:30:00.5+00'),
                (4, 2, 'АО "Дубль"',  'Без годов 100%',         false, NULL,         NULL, NULL, NULL,    NULL, NULL,           NULL,            '{info_security}',          '2026-10-22 12:00:00+00'),
                (5, 1, 'ООО "ТЕТА"',  'Склад_1',                true,  NULL,         2019, 2025, 650.50,  50,   'launch',       'logistics',     '{it_infra}',               '2026-10-23 08:00:00.000001+00')
                """);
    }

    /**
     * Добавляет n синтетических компаний (отрасль services, район 1 или 2) в квадрат lat 47.0–47.5, lon 39.0–40.0.
     * С mixed = true: каждая 10-я — клиент, из клиентов каждый 5-й — исключён из реестра; выручка 0–99 млн.
     * С mixed = false: все — действующие не клиенты. ИНН начинаются с 'B' и не пересекаются со стандартным набором.
     */
    public static void insertBulk(int n, boolean mixed) {
        jdbc().update("""
                INSERT INTO company (inn, name, subject_type, industry, municipality_id, lat, lon, size_category,
                                     revenue_est, is_client, status, geo_precision)
                SELECT 'B' || lpad(g::text, 11, '0'), 'Синтетика ' || g, 'legal', 'services', 1 + g % 2,
                       47.0 + (g % 100) * 0.005, 39.0 + (g / 100 % 100) * 0.01, 'micro',
                       (g % 100) * 1000000,
                       ? AND g % 10 = 0,
                       CASE WHEN ? AND g % 50 = 0 THEN 'excluded' ELSE 'active' END,
                       'address'
                FROM generate_series((SELECT count(*) FROM company WHERE inn LIKE 'B%') + 1,
                                     (SELECT count(*) FROM company WHERE inn LIKE 'B%') + ?) g
                """, mixed, mixed, n);
    }
}
