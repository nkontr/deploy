import { useState } from 'react'
import type { WhiteSpot } from '../api/types'
import { whiteSpotText } from './whiteSpotText'
import styles from './WhiteSpotsList.module.css'

interface WhiteSpotsListProps {
  spots: WhiteSpot[]
  onSelectSpot: (lat: number, lon: number) => void
}

/** Десктоп — список сразу раскрыт; планшет и телефон — свёрнут в плашку, чтобы не закрывать карту */
const isDesktop = () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1280px)').matches

export function WhiteSpotsList({ spots, onSelectSpot }: WhiteSpotsListProps) {
  const [expanded, setExpanded] = useState(isDesktop)

  if (spots.length === 0) {
    return null
  }

  return (
    <div className={`${styles.container} ${expanded ? styles.expanded : ''}`}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span>Белые пятна · {spots.length}</span>
        <span className={styles.chevron} aria-hidden="true">
          {expanded ? '▾' : '▴'}
        </span>
      </button>
      {expanded && (
        <div className={styles.list}>
          {spots.map((spot) => (
            <button
              key={spot.municipalityId}
              type="button"
              className={styles.item}
              onClick={() => {
                onSelectSpot(spot.lat, spot.lon)
                if (!isDesktop()) setExpanded(false)   // на телефоне и планшете — освободить карту
              }}
            >
              <SpotBody spot={spot} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SpotBody({ spot }: { spot: WhiteSpot }) {
  const text = whiteSpotText(spot)
  return (
    <>
      <div className={styles.name}>{spot.name}</div>
      <div className={styles.meta}>
        <span className={styles.potential}>{text.potential}</span>
        <span className={styles.companies}>{text.counts}</span>
      </div>
      <div className={styles.reason}>{text.coverage}</div>
    </>
  )
}
