package ru.rt.radar.radar.map;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import ru.rt.radar.ContractShape;
import ru.rt.radar.DbWebTest;
import ru.rt.radar.TestDb;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.hamcrest.Matchers.contains;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** /api/map/cells: точки, кластеры, граница режимов, согласованность с /api/companies. */
class MapApiTest extends DbWebTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeEach
    void data() {
        TestDb.resetStandardData();
    }

    private JsonNode json(String url) throws Exception {
        String body = mvc.perform(get(url)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return JSON.readTree(body);
    }

    // ---- точки ----

    @Test
    void pointsOnStandardData() throws Exception {
        mvc.perform(get("/api/map/cells?zoom=7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("points"))
                .andExpect(jsonPath("$.total").value(6))
                .andExpect(jsonPath("$.points[*].id", contains(1, 2, 3, 5, 6, 8)))
                .andExpect(jsonPath("$.points[*].kind", contains("ours", "others", "others", "others", "ours", "others")))
                .andExpect(jsonPath("$.points[0].lat").value(47.21))
                .andExpect(jsonPath("$.cellDeg").doesNotExist());
    }

    @Test
    void pointsWithExcludedAndWindow() throws Exception {
        mvc.perform(get("/api/map/cells?zoom=13&status=all&minLat=46&maxLat=47&minLon=41&maxLon=42"))
                .andExpect(jsonPath("$.mode").value("points"))
                .andExpect(jsonPath("$.points[*].id", contains(4, 5, 6)))
                .andExpect(jsonPath("$.points[*].kind", contains("excluded", "others", "ours")));
    }

    @Test
    void emptyResultIsPoints() throws Exception {
        mvc.perform(get(java.net.URI.create("/api/map/cells?zoom=10&q=%D0%BD%D0%B5%D1%82%D1%82%D0%B0%D0%BA%D0%BE%D0%B9")))
                .andExpect(jsonPath("$.mode").value("points"))
                .andExpect(jsonPath("$.total").value(0))
                .andExpect(jsonPath("$.points.length()").value(0));
    }

    /** Компании без адреса: не точками на условном здании, а группой на населённый пункт (или район). */
    @Test
    void groupsForCompaniesWithoutAddress() throws Exception {
        // 2 и 8 — в х. Победа района 1, 3 — без населённого пункта (только район 1); 1, 5, 6 — с адресом
        TestDb.jdbc().update("UPDATE company SET geo_precision = 'settlement', settlement = 'х. Победа' WHERE id IN (2, 8)");
        TestDb.jdbc().update("UPDATE company SET geo_precision = 'municipality' WHERE id = 3");
        mvc.perform(get("/api/map/cells?zoom=7"))
                .andExpect(jsonPath("$.mode").value("points"))
                .andExpect(jsonPath("$.total").value(6))                       // как у /api/companies: точки + группы
                .andExpect(jsonPath("$.points[*].id", contains(1, 5, 6)))
                .andExpect(jsonPath("$.groups[*].label", contains("х. Победа", "г. Тестоград")))
                .andExpect(jsonPath("$.groups[0].settlement").value("х. Победа"))
                .andExpect(jsonPath("$.groups[0].total").value(2))
                .andExpect(jsonPath("$.groups[0].others").value(2))
                .andExpect(jsonPath("$.groups[0].lat").value(47.235))              // среднее условных точек 2 и 8
                .andExpect(jsonPath("$.groups[1].settlement").doesNotExist())
                .andExpect(jsonPath("$.groups[1].municipalityId").value(1));
    }

    /** На масштабе улиц порог считается по точкам с адресом: тысячи компаний без адреса — одна группа. */
    @Test
    void streetZoomGroupsManyCompaniesWithoutAddress() throws Exception {
        TestDb.insertBulk(MapController.POINTS_LIMIT + 10, false);
        TestDb.jdbc().update("UPDATE company SET geo_precision = 'municipality', municipality_id = 1, lat = 47.2, lon = 39.7 WHERE inn LIKE 'B%'");
        String q = "/api/map/cells?minLat=47.1&maxLat=47.3&minLon=39.6&maxLon=39.8&zoom=";
        assertThat(json(q + (MapController.STREET_ZOOM - 1)).get("mode").asText()).isEqualTo("cells");
        JsonNode street = json(q + MapController.STREET_ZOOM);
        assertThat(street.get("mode").asText()).isEqualTo("points");
        assertThat(street.get("groups").size()).isEqualTo(1);              // все синтетические — в центре города 1
        assertThat(street.get("groups").get(0).get("total").asLong()).isGreaterThan(MapController.POINTS_LIMIT);
        assertThat(street.get("total").asLong())
                .isEqualTo(street.get("points").size() + street.get("groups").get(0).get("total").asLong());
    }

    @Test
    void pointsMatchContractExample() throws Exception {
        TestDb.jdbc().update("UPDATE company SET geo_precision = 'settlement', settlement = 'х. Победа' WHERE id = 2");
        String body = mvc.perform(get("/api/map/cells?zoom=13&status=all"))
                .andReturn().getResponse().getContentAsString();
        ContractShape.assertMatches("points.json", body);
    }

    @Test
    void pointCoordinatesRoundedTo5() throws Exception {
        TestDb.jdbc().update("UPDATE company SET lat = 47.123456789, lon = 39.987654321 WHERE id = 1");
        mvc.perform(get("/api/map/cells?zoom=7"))
                .andExpect(jsonPath("$.points[0].lat").value(47.12346))
                .andExpect(jsonPath("$.points[0].lon").value(39.98765));
    }

    // ---- граница режимов ----

    @Test
    void exactly1500IsPointsAnd1501IsCells() throws Exception {
        TestDb.insertBulk(1500 - 6, false);   // 6 действующих в стандартном наборе
        JsonNode atLimit = json("/api/map/cells?zoom=7");
        assertThat(atLimit.get("mode").asText()).isEqualTo("points");
        assertThat(atLimit.get("total").asLong()).isEqualTo(1500);
        assertThat(atLimit.get("points").size()).isEqualTo(1500);

        TestDb.insertBulk(1, false);
        JsonNode over = json("/api/map/cells?zoom=7");
        assertThat(over.get("mode").asText()).isEqualTo("cells");
        assertThat(over.get("total").asLong()).isEqualTo(1501);
    }

    // ---- кластеры ----

    @Test
    void cellsMatchContractExample() throws Exception {
        TestDb.insertBulk(3000, true);
        String body = mvc.perform(get("/api/map/cells?zoom=10&status=all"))
                .andReturn().getResponse().getContentAsString();
        ContractShape.assertMatches("cells.json", body);
    }

    @ParameterizedTest(name = "zoom={0}")
    @ValueSource(ints = {3, 7, 10, 12})
    void cellsInvariants(int zoom) throws Exception {
        TestDb.insertBulk(3000, true);
        JsonNode r = json("/api/map/cells?status=all&zoom=" + zoom);
        double cellDeg = 84.0 / Math.pow(2, zoom);
        assertThat(r.get("mode").asText()).isEqualTo("cells");
        assertThat(r.get("cellDeg").asDouble()).isEqualTo(cellDeg);

        long sum = 0;
        long prevTotal = Long.MAX_VALUE;
        for (JsonNode c : r.get("cells")) {
            long total = c.get("total").asLong();
            assertThat(c.get("ours").asLong() + c.get("others").asLong() + c.get("excluded").asLong())
                    .as("ours+others+excluded = total").isEqualTo(total);
            assertThat(total).as("сортировка по total убыв.").isLessThanOrEqualTo(prevTotal);
            prevTotal = total;
            sum += total;
        }
        assertThat(sum).as("сумма по ячейкам = total").isEqualTo(r.get("total").asLong());
        if (zoom == 3) {
            assertThat(r.get("cells").size()).as("вся тестовая область — одна ячейка").isEqualTo(1);
        }
    }

    @Test
    void cellCenterIsAverageInsideItsSquare() throws Exception {
        TestDb.insertBulk(3000, true);
        double cellDeg = 84.0 / Math.pow(2, 10);
        // эталон — прямо из БД: те же ячейки, их средние
        var expected = TestDb.jdbc().queryForList("""
                SELECT floor(lat / ?) AS i, floor(lon / ?) AS j, avg(lat) AS lat, avg(lon) AS lon, count(*) AS n
                FROM company GROUP BY 1, 2""", cellDeg, cellDeg);
        JsonNode cells = json("/api/map/cells?status=all&zoom=10").get("cells");
        assertThat(cells.size()).isEqualTo(expected.size());
        for (JsonNode c : cells) {
            double lat = c.get("lat").asDouble();
            double lon = c.get("lon").asDouble();
            var cell = expected.stream().filter(e -> ((Number) e.get("n")).longValue() == c.get("total").asLong()
                            && Math.abs(((Number) e.get("lat")).doubleValue() - lat) < 1e-4
                            && Math.abs(((Number) e.get("lon")).doubleValue() - lon) < 1e-4)
                    .findFirst();
            assertThat(cell).as("ячейка с центром %s,%s", lat, lon).isPresent();
            double i = ((Number) cell.get().get("i")).doubleValue();
            double j = ((Number) cell.get().get("j")).doubleValue();
            assertThat(lat).isBetween(i * cellDeg - 1e-4, (i + 1) * cellDeg + 1e-4);
            assertThat(lon).isBetween(j * cellDeg - 1e-4, (j + 1) * cellDeg + 1e-4);
        }
    }

    @Test
    void clientFilterGivesOneColorCells() throws Exception {
        TestDb.insertBulk(20000, true);   // клиентов среди синтетики — 2000, действующих из них 1600
        JsonNode r = json("/api/map/cells?zoom=10&client=ours");
        assertThat(r.get("mode").asText()).isEqualTo("cells");
        for (JsonNode c : r.get("cells")) {
            assertThat(c.get("others").asLong()).isZero();
            assertThat(c.get("excluded").asLong()).isZero();
            assertThat(c.get("ours").asLong()).isEqualTo(c.get("total").asLong());
        }
    }

    // ---- цифры сходятся с /api/companies ----

    @ParameterizedTest(name = "[{0}]")
    @ValueSource(strings = {
            "",
            "client=ours",
            "client=others&status=all",
            "client=ours&status=excluded",
            "industry=services&revenueMin=10000000&revenueMax=50000000",
            "minLat=47.1&maxLat=47.3&minLon=39.2&maxLon=39.8",
            "municipalityId=2&sizeCategory=micro",
    })
    void totalEqualsCompaniesTotal(String filter) throws Exception {
        TestDb.insertBulk(3000, true);
        long map = json("/api/map/cells?zoom=9&" + filter).get("total").asLong();
        long list = json("/api/companies?size=1&" + filter).get("total").asLong();
        assertThat(map).isEqualTo(list).isPositive();
    }

    // ---- параметры ----

    @ParameterizedTest(name = "{0} → 400 field={1}")
    @CsvSource(delimiter = '|', value = {
            "                 | zoom",
            "zoom=2           | zoom",
            "zoom=19          | zoom",
            "zoom=abc         | zoom",
            "zoom=7.5         | zoom",
            "zoom=7&status=no | status",
            "zoom=7&minLat=47 | maxLat",
    })
    void invalidParams(String query, String field) throws Exception {
        mvc.perform(get("/api/map/cells?" + (query == null ? "" : query)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.error.details.field").value(field));
    }

    @Test
    void cellDegFormula() {
        assertThat(MapController.cellDeg(3)).isEqualTo(10.5);
        assertThat(MapController.cellDeg(7)).isEqualTo(0.65625);
        assertThat(MapController.cellDeg(10)).isEqualTo(0.08203125);
        assertThat(MapController.cellDeg(12)).isEqualTo(0.0205078125);
        assertThat(MapController.cellDeg(18)).isCloseTo(0.000320434, within(1e-9));
    }

    @Test
    void swaggerShowsZoomAndFilter() throws Exception {
        mvc.perform(get("/v3/api-docs"))
                .andExpect(jsonPath("$.paths['/api/map/cells'].get.parameters[*].name",
                        org.hamcrest.Matchers.hasItems("zoom", "client", "status", "industry", "minLat", "q")))
                .andExpect(jsonPath("$.paths['/api/map/cells'].get.parameters[?(@.name == 'zoom')].required",
                        contains(true)));
    }
}
