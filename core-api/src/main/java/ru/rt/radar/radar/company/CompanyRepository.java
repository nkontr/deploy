package ru.rt.radar.radar.company;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import ru.rt.radar.radar.filter.CodedEnum;
import ru.rt.radar.radar.filter.CompanyFilter;
import ru.rt.radar.radar.filter.CompanyFilterSql;
import ru.rt.radar.radar.filter.Industry;

import javax.sql.DataSource;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/** Чтение компаний. WHERE — только из {@link CompanyFilterSql}, чтобы список, карта и экспорт сходились. */
@Repository
public class CompanyRepository {

    private static final Logger log = LoggerFactory.getLogger(CompanyRepository.class);

    /** Все колонки полной карточки. Общие для списка, карточки и /internal/companies. */
    static final String SELECT = """
            SELECT c.id, c.inn, c.name, c.industry, c.okved_code, c.okved_name, c.municipality_id,
                   m.name AS municipality_name, c.settlement, c.lat, c.lon, c.geo_precision, c.address,
                   c.size_category, c.employees,
                   c.revenue_est, c.revenue_growth_est, c.revenue_source, c.is_estimated, c.is_client, c.status,
                   %s AS kind, c.excluded_at, c.is_new, c.registered_at, %s AS relocated,
                   c.ogrn, c.subject_type, c.phone, c.email, c.website, c.has_licenses, c.is_innovative, c.is_social
            FROM company c JOIN municipality m ON m.id = c.municipality_id
            """.formatted(CompanyFilterSql.KIND, CompanyFilterSql.RELOCATED);

    private static final Set<String> warnedIndustries = ConcurrentHashMap.newKeySet();

    static final RowMapper<Company> MAPPER = CompanyRepository::map;

    /** Строк за один сетевой запрос к БД при потоковой выгрузке. */
    static final int STREAM_FETCH_SIZE = 1000;

    private final NamedParameterJdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate streamJdbc;
    private final TransactionTemplate readOnlyTx;

    public CompanyRepository(NamedParameterJdbcTemplate jdbc, DataSource dataSource, PlatformTransactionManager tx) {
        this.jdbc = jdbc;
        JdbcTemplate streaming = new JdbcTemplate(dataSource);
        streaming.setFetchSize(STREAM_FETCH_SIZE);
        this.streamJdbc = new NamedParameterJdbcTemplate(streaming);
        this.readOnlyTx = new TransactionTemplate(tx);
        this.readOnlyTx.setReadOnly(true);
    }

    public long count(CompanyFilter filter) {
        CompanyFilterSql.Where w = CompanyFilterSql.build(filter);
        Long total = jdbc.queryForObject("SELECT count(*) FROM company c " + w.sql(), w.params(), Long.class);
        return total == null ? 0 : total;
    }

    /** Страница списка; total — по тому же фильтру. */
    public CompanyPage findPage(CompanyFilter filter, CompanySort sort, int page, int size) {
        long total = count(filter);
        long offset = (long) page * size;
        if (offset >= total) {
            return new CompanyPage(List.of(), total);
        }
        CompanyFilterSql.Where w = CompanyFilterSql.build(filter);
        MapSqlParameterSource params = w.params().addValue("limit", size).addValue("offset", offset);
        List<CompanyShort> items = jdbc.query(SELECT + w.sql() + "\n" + sort.orderBy() + "\nLIMIT :limit OFFSET :offset",
                params, MAPPER).stream().map(Company::toShort).toList();
        return new CompanyPage(items, total);
    }

    public Optional<Company> findById(int id) {
        return jdbc.query(SELECT + "WHERE c.id = :id", new MapSqlParameterSource("id", id), MAPPER)
                .stream().findFirst();
    }

    /**
     * Компании по готовому условию — те же колонки и маппинг, что у списка (related-companies продукта 2, Java #2).
     * whereAndOrder — константа вызывающего кода с :параметрами, без пользовательского ввода.
     */
    public List<Company> findWhere(String whereAndOrder, MapSqlParameterSource params) {
        return jdbc.query(SELECT + whereAndOrder, params, MAPPER);
    }

    /**
     * Все компании по фильтру, по name, — по одной в sink, без сбора в список (/internal/companies).
     * Транзакция обязательна: в автокоммите драйвер Postgres игнорирует fetchSize и читает весь результат в память.
     */
    public void streamByName(CompanyFilter filter, Consumer<Company> sink) {
        CompanyFilterSql.Where w = CompanyFilterSql.build(filter);
        String sql = SELECT + w.sql() + "\nORDER BY c.name, c.id";
        readOnlyTx.executeWithoutResult(status -> streamJdbc.query(sql, w.params(),
                (RowCallbackHandler) rs -> sink.accept(MAPPER.mapRow(rs, rs.getRow()))));
    }

    public record CompanyPage(List<CompanyShort> items, long total) {
    }

    // ---- маппинг ----

    private static Company map(ResultSet rs, int row) throws SQLException {
        String industry = rs.getString("industry");
        return new Company(
                rs.getInt("id"),
                rs.getString("inn"),
                rs.getString("name"),
                industry,
                industryName(industry),
                rs.getString("okved_code"),
                rs.getString("okved_name"),
                rs.getInt("municipality_id"),
                rs.getString("municipality_name"),
                rs.getString("settlement"),
                rs.getDouble("lat"),
                rs.getDouble("lon"),
                rs.getString("geo_precision"),
                rs.getString("address"),
                rs.getString("size_category"),
                rs.getObject("employees", Integer.class),
                rubles(rs.getBigDecimal("revenue_est")),
                oneDecimal(rs.getBigDecimal("revenue_growth_est")),
                rs.getString("revenue_source"),
                rs.getBoolean("is_estimated"),
                rs.getBoolean("is_client"),
                rs.getString("status"),
                rs.getString("kind"),
                rs.getObject("excluded_at", LocalDate.class),
                rs.getBoolean("is_new"),
                rs.getObject("registered_at", LocalDate.class),
                rs.getBoolean("relocated"),
                rs.getString("ogrn"),
                rs.getString("subject_type"),
                rs.getString("phone"),
                rs.getString("email"),
                rs.getString("website"),
                rs.getBoolean("has_licenses"),
                rs.getBoolean("is_innovative"),
                rs.getBoolean("is_social"));
    }

    /** Выручка — целые рубли числом. */
    static Long rubles(BigDecimal v) {
        return v == null ? null : v.setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    /** Рост, % — один знак после запятой (без stripTrailingZeros: Jackson вывел бы 1E+1). */
    static BigDecimal oneDecimal(BigDecimal v) {
        return v == null ? null : v.setScale(1, RoundingMode.HALF_UP);
    }

    /** Неизвестный код отрасли из БД (ошибка ETL) — null и одно предупреждение в лог, а не 500. */
    private static String industryName(String code) {
        Optional<Industry> industry = CodedEnum.find(Industry.class, code);
        if (industry.isEmpty() && warnedIndustries.add(String.valueOf(code))) {
            log.warn("В company неизвестный код отрасли '{}' — industryName будет null", code);
        }
        return industry.map(Industry::title).orElse(null);
    }
}
