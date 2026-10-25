package ru.rt.radar.radar.map;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ru.rt.radar.common.exception.ValidationException;
import ru.rt.radar.radar.filter.CompanyFilter;

import java.util.List;

@RestController
@Tag(name = "Карта")
public class MapController {

    /** Не больше стольких компаний — отдаём точками, иначе кластерами. */
    static final int POINTS_LIMIT = 1500;
    /** С этого зума (улицы) — точки с адресом и группы без адреса, даже если компаний в окне больше порога */
    static final int STREET_ZOOM = 13;
    static final int MIN_ZOOM = 3;
    static final int MAX_ZOOM = 18;

    private final MapRepository map;

    public MapController(MapRepository map) {
        this.map = map;
    }

    @GetMapping("/api/map/cells")
    @Operation(summary = "Карта «как выбор ПВЗ»: точки или кластеры",
            description = "total ≤ " + POINTS_LIMIT + " (или zoom ≥ " + STREET_ZOOM + " и компаний с адресом ≤ " + POINTS_LIMIT
                    + ") → mode=points (компании с адресом — точками, без адреса — группами по населённому пункту), иначе mode=cells — кластеры "
                    + "по сетке cellDeg = 84 / 2^zoom с центром в среднем координат компаний. Без границ окна — вся область. "
                    + "total совпадает с /api/companies при том же фильтре.",
            responses = @ApiResponse(responseCode = "200", content = @Content(
                    schema = @Schema(oneOf = {PointsResponse.class, CellsResponse.class}))))
    public MapResponse cells(
            CompanyFilter filter,
            @Parameter(description = "Целый зум карты, " + MIN_ZOOM + "–" + MAX_ZOOM, required = true,
                    schema = @Schema(minimum = "" + MIN_ZOOM, maximum = "" + MAX_ZOOM))
            @RequestParam int zoom) {
        if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) {
            throw new ValidationException("zoom", "zoom должен быть от " + MIN_ZOOM + " до " + MAX_ZOOM);
        }
        // Сначала кластеры: total = сумма по ячейкам (тот же WHERE, что у count) — один проход по таблице
        // вместо двух. Мало компаний — отдаём их точками.
        double cellDeg = cellDeg(zoom);
        List<CellsResponse.Cell> cells = map.cells(filter, cellDeg);
        long total = cells.stream().mapToLong(CellsResponse.Cell::total).sum();
        // С масштаба улиц компании без адреса стоят одной группой на нас. пункт: в Ростове их десятки тысяч в одной
        // точке, порог по total никогда бы не прошёл. Считаем по точкам с адресом — их рисуем по одной.
        if (total <= POINTS_LIMIT || zoom >= STREET_ZOOM && map.countWithAddress(filter) <= POINTS_LIMIT) {
            return new PointsResponse(total, map.points(filter), map.groups(filter));
        }
        return new CellsResponse(cellDeg, total, cells);
    }

    /** Ячейка ≈ 60 пикселей экрана: zoom 7 → 0.65625°, 10 → 0.08203125°, 12 → 0.0205078125°. */
    static double cellDeg(int zoom) {
        return 84.0 / (1L << zoom);
    }
}
