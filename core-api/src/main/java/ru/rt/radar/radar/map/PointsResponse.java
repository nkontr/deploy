package ru.rt.radar.radar.map;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * Компаний в окне не больше порога. Порядок полей = contracts/examples/points.json.
 * points — компании с настоящим адресом (geo_precision = address, ЕГРЮЛ): каждая точкой.
 * groups — остальные: адреса нет, их координата условная (здание в населённом пункте), поэтому точкой на доме
 * не показываем — одна группа на населённый пункт (или район, если пункт неизвестен). total = points + groups.
 */
public record PointsResponse(
        @Schema(allowableValues = "points") String mode,
        long total,
        List<Point> points,
        List<Group> groups
) implements MapResponse {

    public PointsResponse(long total, List<Point> points, List<Group> groups) {
        this("points", total, points, groups);
    }

    /** kind: ours | others | excluded. */
    public record Point(int id, double lat, double lon, String kind) {
    }

    /**
     * Компании без адреса в одном населённом пункте: lat/lon — среднее их условных точек (внутри пункта),
     * label — «х. Победа» или «Аксайский р-н», settlement — null, если известен только район.
     */
    public record Group(String label, int municipalityId, String settlement, double lat, double lon,
                        long total, long ours, long others, long excluded) {
    }
}
