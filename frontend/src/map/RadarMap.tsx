import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../api/apiFetch'
import type { MapDataResponse, MunicipalityStats, WhiteSpot } from '../api/types'
import { filterToQuery } from '../filters/filterToQuery'
import type { CompanyFilters } from '../filters/types'
import { createClusterMarker } from './clusterMarker'
import { createGroupMarker, groupTooltip, offscreenMunicipality } from './groupMarker'
import { getDictionaries } from '../api/endpoints'
import { clampDeg } from './bounds'
import { attachBasemapFallback, createBaseStyle } from './basemap'
import { potentialTooltip } from './potentialTooltip'
import { HEAT_MAX_ZOOM, cellsToHeatGeoJson, heatGridZoom, heatLayout, heatPaint } from './heatmap'
import styles from './RadarMap.module.css'

interface RadarMapProps {
  filters: CompanyFilters
  selectedCompanyId?: number
  onBoundsChange: (bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number }) => void
  onSelectCompany: (id: number) => void
  onMapReady?: (map: maplibregl.Map) => void
  potentialStats?: MunicipalityStats[]
  whiteSpots?: WhiteSpot[]
  onDistrictClick?: (stats: MunicipalityStats) => void
  /** Выбранная компания работает не там, где зарегистрирована: пунктир регистрация → факт (ТЗ 07) */
  relocation?: RelocationLine | null
  /** Тепловая карта плотности вместо кружков кластеров на обзорных масштабах */
  heat?: boolean
}

export interface RelocationLine {
  from: { lat: number; lon: number }
  to: { lat: number; lon: number }[]
}

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] }

function relocationGeoJson(line: RelocationLine | null | undefined) {
  if (!line || line.to.length === 0) return EMPTY_FC
  const from: [number, number] = [line.from.lon, line.from.lat] // MapLibre — [lon, lat]
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...line.to.map((p) => ({
        type: 'Feature' as const,
        properties: { role: 'line' },
        geometry: { type: 'LineString' as const, coordinates: [from, [p.lon, p.lat]] },
      })),
      { type: 'Feature' as const, properties: { role: 'registered' }, geometry: { type: 'Point' as const, coordinates: from } },
      ...line.to.map((p) => ({
        type: 'Feature' as const,
        properties: { role: 'actual' },
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      })),
    ],
  }
}

const ROSTOV_CENTER: [number, number] = [40.8, 47.6] // [lon, lat] для MapLibre
const INITIAL_ZOOM = 7
/** Дальше отдалять незачем: карта про Ростовскую область, а окно на весь мир ломало фильтр по границам */
const MIN_ZOOM = 4
/** Как MapController.STREET_ZOOM в core-api: с него компании без адреса — группами, а не кластерами */
const STREET_ZOOM = 13

export function RadarMap({
  filters,
  selectedCompanyId,
  onBoundsChange,
  onSelectCompany,
  onMapReady,
  potentialStats,
  whiteSpots,
  onDistrictClick,
  relocation,
  heat = false,
}: RadarMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const [center, setCenter] = useState({ lat: ROSTOV_CENTER[1], lon: ROSTOV_CENTER[0] })
  const { data: dict } = useQuery({ queryKey: ['dictionaries'], queryFn: getDictionaries, staleTime: Infinity })
  const markersRef = useRef<maplibregl.Marker[]>([])
  const whiteSpotLabelsRef = useRef<maplibregl.Marker[]>([])
  const boundsTimeoutRef = useRef<NodeJS.Timeout>()
  const lastBoundsRef = useRef<string>('') // Храним предыдущий bbox для сравнения

  // Запрос данных карты - используем ЦЕЛОЕ zoom
  const { data, isLoading } = useQuery({
    queryKey: ['map', filterToQuery(filters), Math.round(zoom)],
    queryFn: async () => {
      const query = filterToQuery(filters)
      const url = `/api/map/cells?${query}&zoom=${Math.round(zoom)}`
      return apiFetch<MapDataResponse>(url)
    },
    staleTime: 30000,
    placeholderData: (prev) => prev, // Показываем старые данные пока грузятся новые
  })

  // Тепло — по всей области (без окна карты: при сдвиге не будет пустых краёв), сетка мельче видимой
  const heatQuery = filterToQuery({ ...filters, minLat: undefined, maxLat: undefined, minLon: undefined, maxLon: undefined })
  const heatZoom = heatGridZoom(zoom)
  const { data: heatData } = useQuery({
    queryKey: ['map-heat', heatQuery, heatZoom],
    queryFn: () => apiFetch<MapDataResponse>(`/api/map/cells?${heatQuery}${heatQuery ? '&' : ''}zoom=${heatZoom}`),
    enabled: heat,
    staleTime: 30000,
    placeholderData: (prev) => prev,
  })
  const heatCoversClusters = heat && Math.round(zoom) < HEAT_MAX_ZOOM

  // Инициализация карты - ОДИН РАЗ
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: createBaseStyle(),
      center: ROSTOV_CENTER,
      zoom: INITIAL_ZOOM,
      minZoom: MIN_ZOOM,
      // Явно включаем интерактивность
      scrollZoom: true,
      dragPan: true,
      touchZoomRotate: true,
      doubleClickZoom: true,
    })

    map.current = mapInstance
    const detachBasemap = attachBasemapFallback(mapInstance)

    // Вызываем callback когда карта готова
    if (onMapReady) {
      onMapReady(mapInstance)
    }

    // ResizeObserver для реакции на изменение размера контейнера
    // (появление списка, вкладки на телефоне, открытие карточки)
    const resizeObserver = new ResizeObserver(() => {
      mapInstance.resize()
    })
    resizeObserver.observe(mapContainer.current)

    // Обновляем zoom при изменении
    mapInstance.on('zoom', () => {
      setZoom(mapInstance.getZoom())
    })

    // Обновляем bounds после moveend с дебаунсом (ТОЛЬКО запись в URL)
    // Только если bbox реально изменился И карта видима
    mapInstance.on('moveend', () => {
      const c = mapInstance.getCenter()
      setCenter({ lat: c.lat, lon: c.lng })
      if (boundsTimeoutRef.current) {
        clearTimeout(boundsTimeoutRef.current)
      }
      boundsTimeoutRef.current = setTimeout(() => {
        // НЕ пишем bbox, если контейнер скрыт или имеет размер 0
        if (!mapContainer.current) return
        const rect = mapContainer.current.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return

        const bounds = mapInstance.getBounds()
        const newBounds = {
          // На мелком масштабе окно шире 360° — API принимает только -180..180 / -90..90
          minLat: clampDeg(bounds.getSouth(), 90),
          maxLat: clampDeg(bounds.getNorth(), 90),
          minLon: clampDeg(bounds.getWest(), 180),
          maxLon: clampDeg(bounds.getEast(), 180),
        }

        // Сериализуем bbox для сравнения
        const boundsKey = `${newBounds.minLat},${newBounds.maxLat},${newBounds.minLon},${newBounds.maxLon}`

        // Обновляем URL только если bbox изменился
        if (lastBoundsRef.current !== boundsKey) {
          lastBoundsRef.current = boundsKey
          onBoundsChange(newBounds)
        }
      }, 400)
    })

    return () => {
      if (boundsTimeoutRef.current) {
        clearTimeout(boundsTimeoutRef.current)
      }
      resizeObserver.disconnect()
      detachBasemap()
      mapInstance.remove()
      map.current = null // Обнуляем ref после удаления карты
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // ПУСТЫЕ зависимости - карта создаётся ОДИН РАЗ

  // Отслеживаем видимость контейнера карты и делаем resize при показе
  useEffect(() => {
    if (!mapContainer.current || !map.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        const isNowVisible = entry.isIntersecting && entry.intersectionRatio > 0

        // Когда карта становится видимой, делаем resize
        if (isNowVisible && map.current) {
          map.current.resize()
        }
      },
      { threshold: [0, 0.1] }
    )

    observer.observe(mapContainer.current)

    return () => {
      observer.disconnect()
    }
  }, [])

  // Функция объединения близких кластеров
  const mergeClusters = (cells: Array<{ lat: number; lon: number; total: number; ours: number; others: number; excluded: number }>, mapInstance: maplibregl.Map) => {
    if (cells.length === 0) return []

    const MERGE_DISTANCE_PX = 48
    const merged: typeof cells = []
    const used = new Set<number>()

    cells.forEach((cell: typeof cells[0], i: number) => {
      if (used.has(i)) return

      const cellPx = mapInstance.project([cell.lon, cell.lat])
      const cluster = { ...cell }
      let totalWeight = cell.total
      let sumLat = cell.lat * cell.total
      let sumLon = cell.lon * cell.total

      // Ищем близкие кластеры
      cells.forEach((other: typeof cells[0], j: number) => {
        if (i === j || used.has(j)) return

        const otherPx = mapInstance.project([other.lon, other.lat])
        const dist = Math.sqrt(
          Math.pow(cellPx.x - otherPx.x, 2) + Math.pow(cellPx.y - otherPx.y, 2)
        )

        if (dist < MERGE_DISTANCE_PX) {
          // Объединяем
          cluster.total += other.total
          cluster.ours += other.ours
          cluster.others += other.others
          cluster.excluded += other.excluded
          sumLat += other.lat * other.total
          sumLon += other.lon * other.total
          totalWeight += other.total
          used.add(j)
        }
      })

      // Взвешенный центр
      cluster.lat = sumLat / totalWeight
      cluster.lon = sumLon / totalWeight
      merged.push(cluster)
      used.add(i)
    })

    return merged
  }

  // Отрисовка маркеров
  useEffect(() => {
    if (!map.current || !data) return

    // Удаляем старые маркеры
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []

    if (data.mode === 'cells' && !heatCoversClusters) {
      // Объединяем близкие кластеры
      const mergedCells = mergeClusters(data.cells || [], map.current)

      // Рисуем объединённые кластеры
      mergedCells.forEach((cell: typeof mergedCells[0]) => {
        const element = createClusterMarker(cell, filters.client)

        // Размер от 28 до 48 px
        const size = Math.min(48, Math.max(28, 28 + Math.log(cell.total) * 4))
        element.style.width = `${size}px`
        element.style.height = `${size}px`

        // Приглушаем если слой потенциала активен
        if (potentialStats) {
          element.style.opacity = '0.5'
        }

        // ВАЖНО: порядок [lon, lat] для MapLibre и anchor: 'center'
        const marker = new maplibregl.Marker({ element, anchor: 'center' })
          .setLngLat([cell.lon, cell.lat]) // [lon, lat]
          .addTo(map.current!)

        // Клик по кластеру - zoom +2 и центрирование
        element.addEventListener('click', () => {
          if (map.current) {
            map.current.flyTo({
              center: [cell.lon, cell.lat], // [lon, lat]
              zoom: map.current.getZoom() + 2,
              duration: 800,
            })
          }
        })

        markersRef.current.push(marker)
      })
    } else if (data.mode === 'points') {
      // Рисуем точки
      data.points.forEach((point) => {
        const isSelected = point.id === selectedCompanyId
        const color =
          point.kind === 'ours'
            ? 'var(--rt-purple)'
            : point.kind === 'others'
            ? 'var(--rt-orange)'
            : 'var(--rt-gray)'

        const el = document.createElement('div')
        el.className = `${styles.pointMarker} ${isSelected ? styles.selected : ''}`
        el.style.backgroundColor = color

        // Клик по точке - открыть карточку компании
        el.addEventListener('click', () => {
          onSelectCompany(point.id)
        })

        // ВАЖНО: порядок [lon, lat] для MapLibre и anchor: 'center'
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([point.lon, point.lat]) // [lon, lat]
          .addTo(map.current!)

        markersRef.current.push(marker)
      })

      // Компании без адреса — значком на населённый пункт, а не точками на условных зданиях
      data.groups?.forEach((group) => {
        const el = createGroupMarker(group)
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([group.lon, group.lat]) // [lon, lat]
          .setPopup(new maplibregl.Popup({ closeButton: false, offset: 16 }).setText(groupTooltip(group)))
          .addTo(map.current!)
        markersRef.current.push(marker)
      })
    }
  }, [data, filters.client, selectedCompanyId, onSelectCompany, potentialStats, heatCoversClusters])

  // Отрисовка слоёв аналитики через GeoJSON
  useEffect(() => {
    const mapInstance = map.current
    if (!mapInstance) return

    // Проверяем, что карта жива и стиль загружен
    let isStyleLoaded = false
    try {
      isStyleLoaded = mapInstance.isStyleLoaded() || false
    } catch {
      return
    }

    if (!isStyleLoaded) {
      // Ждём загрузки стиля
      const onLoad = () => {
        // Перезапускаем эффект после загрузки
        if (map.current) {
          renderLayers()
        }
      }
      mapInstance.once('load', onLoad)
      return () => {
        mapInstance.off('load', onLoad)
      }
    }

    renderLayers()

    function renderLayers() {
      const mapInstance = map.current
      if (!mapInstance) return

      // Проверяем что карта жива
      try {
        if (!mapInstance.getStyle()) return
      } catch {
        return
      }

      // Удаляем старые слои если есть
      try {
        if (mapInstance.getLayer('white-spots-circle')) {
          mapInstance.removeLayer('white-spots-circle')
        }
        whiteSpotLabelsRef.current.forEach((m) => m.remove())
        whiteSpotLabelsRef.current = []
        if (mapInstance.getLayer('potential-circle')) {
          mapInstance.removeLayer('potential-circle')
        }
        if (mapInstance.getSource('white-spots')) {
          mapInstance.removeSource('white-spots')
        }
        if (mapInstance.getSource('potential')) {
          mapInstance.removeSource('potential')
        }
      } catch {
        // Игнорируем ошибки если карта уже уничтожена
        return
      }

    // Слой "Потенциал"
    if (potentialStats && potentialStats.length > 0) {
      const features = potentialStats.map((stats) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [stats.lon, stats.lat],
        },
        properties: {
          name: stats.name,
          potentialScore: stats.potentialScore,
          kind: stats.kind,
          municipalityId: stats.municipalityId,
          companies: stats.companies,
          clients: stats.clients,
          coverage: stats.coverage,
          excludedClients: stats.excludedClients,
          revenueEstSum: stats.revenueEstSum,
          tooltip: potentialTooltip(stats),
        },
      }))

      mapInstance.addSource('potential', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features,
        },
      })

      mapInstance.addLayer({
        id: 'potential-circle',
        type: 'circle',
        source: 'potential',
        paint: {
          // В пикселях и по числу компаний: кружки в метрах (20 км) у Ростова накрывали друг друга,
          // и подсказка показывала не тот район
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['sqrt', ['get', 'companies']],
            0, 6,
            50, 18,
            250, 34,
          ],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 1.5,
          'circle-color': '#7700FF',
          'circle-opacity': [
            'interpolate',
            ['linear'],
            ['get', 'potentialScore'],
            0, 0.15,
            100, 0.45,
          ],
        },
      })

      // Клик и hover
      mapInstance.on('click', 'potential-circle', (e) => {
        if (e.features && e.features[0] && onDistrictClick) {
          const props = e.features[0].properties
          onDistrictClick({
            municipalityId: props.municipalityId,
            name: props.name,
            kind: props.kind,
            lat: e.lngLat.lat,
            lon: e.lngLat.lng,
            industry: '',
            companies: props.companies,
            clients: props.clients,
            excludedClients: props.excludedClients,
            coverage: props.coverage,
            newShare: 0,
            revenueEstSum: props.revenueEstSum,
            potentialScore: props.potentialScore,
            isWhiteSpot: false,
            reason: '',
          })
        }
      })

      mapInstance.on('mouseenter', 'potential-circle', (e) => {
        mapInstance.getCanvas().style.cursor = 'pointer'
        if (e.features && e.features[0]) {
          const props = e.features[0].properties
          new maplibregl.Popup({ closeButton: false })
            .setLngLat(e.lngLat)
            .setText(props.tooltip)
            .addTo(mapInstance)
        }
      })

      mapInstance.on('mouseleave', 'potential-circle', () => {
        mapInstance.getCanvas().style.cursor = ''
        const popups = document.getElementsByClassName('maplibregl-popup')
        if (popups.length) {
          Array.from(popups).forEach((p) => p.remove())
        }
      })
    }

    // Слой "Белые пятна"
    if (whiteSpots && whiteSpots.length > 0) {
      // Определяем kind для белых пятен по municipalityId из справочника
      const features = whiteSpots.map((spot) => {
        // Определяем тип по имени (города обычно короче, районы содержат "район" или "р-н")
        const isCity = !spot.name.toLowerCase().includes('район') &&
                       !spot.name.toLowerCase().includes('р-н') &&
                       !spot.name.toLowerCase().includes('р.')

        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [spot.lon, spot.lat],
          },
          properties: {
            name: spot.name,
            reason: spot.reason,
            potentialScore: spot.potentialScore,
            // Радиус в метрах: 8км для городов, 20км для районов
            radiusM: isCity ? 8000 : 20000,
          },
        }
      })

      mapInstance.addSource('white-spots', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features,
        },
      })

      // Круг - под точками компаний
      mapInstance.addLayer(
        {
          id: 'white-spots-circle',
          type: 'circle',
          source: 'white-spots',
          paint: {
            'circle-radius': [
              'interpolate',
              ['exponential', 2],
              ['zoom'],
              0, ['/', ['get', 'radiusM'], 106760],
              20, ['*', ['/', ['get', 'radiusM'], 106760], 1048576],
            ],
            'circle-color': '#FF4F12',
            'circle-opacity': 0.08,
            'circle-stroke-width': 3,
            'circle-stroke-color': '#FF4F12',
            'circle-stroke-opacity': 0.8,
          },
          layout: {},
        },
        // Вставляем под первый слой маркеров (если они есть)
        undefined
      )

      // Подписи — HTML-маркерами, а не symbol-слоем: тому нужны шрифты-глифы с внешнего сервера,
      // без них (и без интернета на площадке) MapLibre сыпет ошибками в консоль
      whiteSpots.forEach((spot) => {
        const el = document.createElement('div')
        el.className = styles.whiteSpotLabel
        el.textContent = spot.name
        whiteSpotLabelsRef.current.push(
          new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -14] })
            .setLngLat([spot.lon, spot.lat])
            .addTo(mapInstance)
        )
      })

      // Hover и popup
      mapInstance.on('mouseenter', 'white-spots-circle', (e) => {
        mapInstance.getCanvas().style.cursor = 'pointer'
        if (e.features && e.features[0]) {
          const props = e.features[0].properties
          new maplibregl.Popup({ closeButton: false })
            .setLngLat(e.lngLat)
            .setText(props.reason || '')
            .addTo(mapInstance)
        }
      })

      mapInstance.on('mouseleave', 'white-spots-circle', () => {
        mapInstance.getCanvas().style.cursor = ''
        const popups = document.getElementsByClassName('maplibregl-popup')
        if (popups.length) {
          Array.from(popups).forEach((p) => p.remove())
        }
      })
    }
    } // Закрываем функцию renderLayers

    // Cleanup - проверяем что карта жива
    return () => {
      const mapInstance = map.current
      if (!mapInstance) return

      // Проверяем что карта не уничтожена
      try {
        if (!mapInstance.getStyle()) return
      } catch {
        return
      }

      const mapAny = mapInstance as any

      try {
        if (mapInstance.getLayer('white-spots-circle')) {
          mapAny.off('mouseenter', 'white-spots-circle')
          mapAny.off('mouseleave', 'white-spots-circle')
        }
        if (mapInstance.getLayer('potential-circle')) {
          mapAny.off('click', 'potential-circle')
          mapAny.off('mouseenter', 'potential-circle')
          mapAny.off('mouseleave', 'potential-circle')
        }
      } catch {
        // Игнорируем ошибки если карта уже уничтожена
      }
    }
  }, [potentialStats, whiteSpots, onDistrictClick])

  // Тепловая карта: слой под остальными (кластеры и точки — HTML-маркеры, они и так сверху)
  useEffect(() => {
    const mapInstance = map.current
    if (!mapInstance) return
    const fc = cellsToHeatGeoJson(heat ? heatData : undefined)

    const draw = () => {
      const m = map.current
      if (!m) return
      const source = m.getSource('heat') as maplibregl.GeoJSONSource | undefined
      if (source) {
        source.setData(fc)
      } else {
        m.addSource('heat', { type: 'geojson', data: fc })
        const firstOverlay = ['potential-circle', 'white-spots-circle', 'relocation-line'].find((id) => m.getLayer(id))
        m.addLayer(
          { id: 'heat', type: 'circle', source: 'heat', layout: heatLayout, paint: heatPaint },
          firstOverlay,
        )
      }
      m.setLayoutProperty('heat', 'visibility', heat ? 'visible' : 'none')
    }

    // Не ждём isStyleLoaded()/load: они наступают только после загрузки тайлов подложки, а на площадке тайлы
    // могут висеть или не грузиться вовсе — тепло не появилось бы. Пробуем сразу, стиль не готов — на styledata.
    const attempt = () => {
      try {
        draw()
      } catch {
        map.current?.once('styledata', attempt)
      }
    }
    attempt()
    return () => {
      mapInstance.off('styledata', attempt)
    }
  }, [heat, heatData])

  // Пунктир «регистрация → фактическое место» у выбранной компании
  useEffect(() => {
    const mapInstance = map.current
    if (!mapInstance) return
    const data = relocationGeoJson(relocation)

    const draw = () => {
      const m = map.current
      if (!m) return
      const source = m.getSource('relocation') as maplibregl.GeoJSONSource | undefined
      if (source) {
        source.setData(data)
        return
      }
      m.addSource('relocation', { type: 'geojson', data })
      m.addLayer({
        id: 'relocation-line',
        type: 'line',
        source: 'relocation',
        filter: ['==', ['get', 'role'], 'line'],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#7700FF', 'line-width': 3, 'line-dasharray': [2, 2] },
      })
      m.addLayer({
        id: 'relocation-points',
        type: 'circle',
        source: 'relocation',
        filter: ['!=', ['get', 'role'], 'line'],
        paint: {
          'circle-radius': 7,
          // Регистрация — полый кружок, факт — залитый (как в карточке «Где работает»)
          'circle-color': ['case', ['==', ['get', 'role'], 'actual'], '#7700FF', '#FFFFFF'],
          'circle-stroke-color': '#7700FF',
          'circle-stroke-width': 3,
        },
      })
    }

    try {
      if (mapInstance.isStyleLoaded()) {
        draw()
        return
      }
    } catch {
      return
    }
    mapInstance.once('load', draw)
    return () => {
      mapInstance.off('load', draw)
    }
  }, [relocation])

  // Окраина города на масштабе улиц: значок «без адреса» стоит в центре — подсказываем, где он
  const offscreen =
    data?.mode === 'points' && Math.round(zoom) >= STREET_ZOOM && dict
      ? offscreenMunicipality(center, dict.municipalities, data.groups ?? [])
      : null

  return (
    <div className={styles.container}>
      <div ref={mapContainer} className={styles.map} />
      {offscreen && (
        <div className={styles.offscreenHint} role="status">
          <span>
            Компании «{offscreen.name}» без точного адреса показаны одним значком в центре — в реестре только город
            или район.
          </span>
          <button
            type="button"
            onClick={() => map.current?.flyTo({ center: [offscreen.lon, offscreen.lat], zoom: STREET_ZOOM })}
          >
            Показать
          </button>
        </div>
      )}
      {isLoading && (
        <div className={styles.loader}>
          <div className={styles.spinner} />
        </div>
      )}
    </div>
  )
}
