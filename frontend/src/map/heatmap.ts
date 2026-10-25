import type { CircleLayerSpecification } from 'maplibre-gl'
import type { MapDataResponse } from '../api/types'

// Тепловая карта (кейс: «интерактивная тепловая карта с возможностью приближения»).
// Цвет — доля НАШИХ клиентов среди компаний места: мало — оранжевый, много — фиолетовый (как точки
// «не наши» / «наши»). Размер и яркость пятна — сколько там компаний.
// Слой heatmap MapLibre красит только по плотности, поэтому тепло — размытые круги с цветом из данных.
// Источник — /api/map/cells с фильтрами, по всей области и на сетке мельче видимой — пятна плавные.

/** До этого масштаба видно тепло; дальше — кружки кластеров и точки компаний */
export const HEAT_MAX_ZOOM = 11

/** Сетка для тепла: на 3 уровня мельче видимой, но не мельче 12 (~2 км) — запрос остаётся ~0,1 с */
export function heatGridZoom(zoom: number): number {
  return Math.min(12, Math.max(9, Math.round(zoom) + 3))
}

/** Доля наших, при которой пятно полностью фиолетовое: ~2,5 средних по области (0,4%) — верхние 10% мест */
export const FULL_COVERAGE = 0.01
/** Сглаживание доли: в месте из 3 компаний 1 наша — это случайность, а не 33% охвата */
const COVERAGE_PRIOR = 200

/**
 * Ячейки -> точки GeoJSON:
 *  w — плотность 0..1, квадрат логарифма числа компаний: линейный вес даёт один Ростов и невидимые сёла,
 *      чистый логарифм — ровную заливку всей области; квадрат оставляет и то, и другое;
 *  c — охват 0..1: сглаженная доля наших, 1 = FULL_COVERAGE и выше.
 */
export function cellsToHeatGeoJson(data: MapDataResponse | undefined) {
  const cells =
    data?.mode === 'cells'
      ? data.cells.map((c) => ({ lat: c.lat, lon: c.lon, total: c.total, ours: c.ours }))
      : [
          ...(data?.points ?? []).map((p) => ({ lat: p.lat, lon: p.lon, total: 1, ours: p.kind === 'ours' ? 1 : 0 })),
          ...(data?.groups ?? []).map((g) => ({ lat: g.lat, lon: g.lon, total: g.total, ours: g.ours })),
        ]
  const max = Math.max(1, ...cells.map((c) => c.total))
  return {
    type: 'FeatureCollection' as const,
    features: cells
      .filter((c) => c.total > 0)
      .map((c) => ({
        type: 'Feature' as const,
        properties: {
          w: (Math.log1p(c.total) / Math.log1p(max)) ** 2,
          c: Math.min(1, c.ours / (c.total + COVERAGE_PRIOR) / FULL_COVERAGE),
        },
        geometry: { type: 'Point' as const, coordinates: [c.lon, c.lat] }, // MapLibre — [lon, lat]
      })),
  }
}

type Expr = NonNullable<CircleLayerSpecification['paint']>['circle-radius']

/** Радиус на масштабе: от 50% (редко — иначе сёла на обзоре рассыпаются в горошек) до 100% (плотно) */
const radius = (px: number) => ['*', px, ['+', 0.5, ['*', 0.5, ['get', 'w']]]]
/** Непрозрачность: плотные места ярче */
const opacity = (k: number) => ['*', k, ['+', 0.2, ['*', 0.6, ['get', 'w']]]]

export const heatLayout: CircleLayerSpecification['layout'] = {
  'circle-sort-key': ['get', 'w'], // плотные пятна поверх редких
}

export const heatPaint: CircleLayerSpecification['paint'] = {
  'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, radius(22), 9, radius(30), 12, radius(38)] as Expr,
  // Тот же переход, что в легенде (MapLegend.module.css, .heatBar)
  'circle-color': ['interpolate', ['linear'], ['get', 'c'], 0, '#FF4F12', 0.5, '#B428B0', 1, '#7700FF'],
  'circle-blur': 1,
  // Кластеры появляются, когда Math.round(zoom) доходит до HEAT_MAX_ZOOM (с HEAT_MAX_ZOOM − 0.5) — тепло гаснет
  // начиная оттуда же, иначе между бледным теплом и кластерами пустая карта
  'circle-opacity': [
    'interpolate',
    ['linear'],
    ['zoom'],
    HEAT_MAX_ZOOM - 0.5,
    opacity(1),
    HEAT_MAX_ZOOM + 0.5,
    opacity(0.25),
  ] as Expr,
}
