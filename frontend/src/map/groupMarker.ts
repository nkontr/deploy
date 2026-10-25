import type { MapGroup } from '../api/types'
import { plural } from '../utils/plural'

// Компании без адреса на уровне улиц: не точка на условном здании (это выглядело бы как настоящий адрес),
// а один значок на населённый пункт — пунктирный круг с числом. Сами компании — в списке справа.

/** «х. Победа: 47 компаний без точного адреса, из них 3 наших» */
export function groupTooltip(g: MapGroup): string {
  const companies = `${g.total} ${plural(g.total, ['компания', 'компании', 'компаний'])}`
  const ours = g.ours > 0 ? `, из них ${g.ours} ${plural(g.ours, ['наша', 'наших', 'наших'])}` : ''
  const where = g.settlement ? '' : ' (населённый пункт не указан)'
  return `${g.label}${where}: ${companies} без точного адреса${ours}. В реестре только населённый пункт — компании в списке справа.`
}

export function createGroupMarker(g: MapGroup): HTMLElement {
  const el = document.createElement('div')
  el.className = 'radar-group-marker'
  el.style.cursor = 'pointer'
  const size = Math.min(56, Math.max(28, 22 + Math.log10(g.total) * 12))
  // Наши среди них — фиолетовая обводка, иначе оранжевая (как у точек «наши» / «не наши»)
  const color = g.ours > 0 ? 'var(--rt-purple)' : 'var(--rt-orange)'
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    border: `2px dashed ${color}`,
    background: 'rgba(255, 255, 255, 0.85)',
    color: 'var(--rt-black)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: '600',
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.15)',
  })
  el.textContent = g.total > 999 ? `${Math.round(g.total / 1000)}k` : String(g.total)
  el.setAttribute('aria-label', groupTooltip(g))
  el.title = groupTooltip(g)
  return el
}

/** Ближе этого к центру города или района — считаем, что карта смотрит на него (км) */
const NEAR_KM = 25

/**
 * Город или район, на который смотрит карта на масштабе улиц, если его группы «без адреса» нет в кадре:
 * значок стоит в центре пункта, а карту приблизили к окраине — иначе там пусто и непонятно почему.
 */
export function offscreenMunicipality<M extends { id: number; name: string; lat: number; lon: number }>(
  center: { lat: number; lon: number },
  municipalities: M[],
  groupsInView: { municipalityId: number; settlement: string | null }[]
): M | null {
  const km = (m: M) =>
    Math.hypot((m.lat - center.lat) * 111.3, (m.lon - center.lon) * 111.3 * Math.cos((center.lat * Math.PI) / 180))
  const nearest = [...municipalities].sort((a, b) => km(a) - km(b))[0]
  if (!nearest || km(nearest) > NEAR_KM) return null
  const visible = groupsInView.some((g) => g.municipalityId === nearest.id && g.settlement === null)
  return visible ? null : nearest
}
