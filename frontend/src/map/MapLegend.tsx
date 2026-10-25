import { useState } from 'react'
import styles from './MapLegend.module.css'

interface MapLegendProps {
  /** Показан слой тепловой карты — добавляем шкалу охвата */
  heat?: boolean
}

function HeatScale({ short }: { short?: boolean }) {
  return (
    <div className={styles.heat}>
      <div className={styles.heatBar} />
      <div className={styles.heatLabels}>
        <span>{short ? 'мало наших' : 'мало наших клиентов'}</span>
        <span>много</span>
      </div>
      {!short && (
        <div className={styles.heatHint}>Крупнее и ярче пятно — больше компаний. Приблизьте, чтобы увидеть их</div>
      )}
    </div>
  )
}

export function MapLegend({ heat = false }: MapLegendProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <>
      {/* Десктоп - всегда развёрнута */}
      <div className={styles.legendDesktop}>
        <div className={styles.title}>Легенда</div>
        {heat && <HeatScale />}
        <div className={styles.items}>
          <div className={styles.item}>
            <div className={styles.dot} style={{ backgroundColor: 'var(--rt-purple)' }} />
            <span>Наши клиенты</span>
          </div>
          <div className={styles.item}>
            <div className={styles.dot} style={{ backgroundColor: 'var(--rt-orange)' }} />
            <span>Не наши (потенциальные)</span>
          </div>
          <div className={styles.item}>
            <div className={styles.dot} style={{ backgroundColor: 'var(--rt-gray)' }} />
            <span>Исключены из реестра МСП</span>
          </div>
          <div className={styles.item}>
            <div className={styles.groupIcon}>N</div>
            <span>Без точного адреса — по населённому пункту</span>
          </div>
        </div>
      </div>

      {/* Мобильный - сворачиваемая */}
      <div className={styles.legendMobile}>
        {isExpanded ? (
          <div className={styles.legendExpanded}>
            {heat && <HeatScale short />}
            <div className={styles.items}>
              <div className={styles.item}>
                <div className={styles.dot} style={{ backgroundColor: 'var(--rt-purple)' }} />
                <span>Наши</span>
              </div>
              <div className={styles.item}>
                <div className={styles.dot} style={{ backgroundColor: 'var(--rt-orange)' }} />
                <span>Не наши</span>
              </div>
              <div className={styles.item}>
                <div className={styles.dot} style={{ backgroundColor: 'var(--rt-gray)' }} />
                <span>Исключены</span>
              </div>
            </div>
            <button
              className={styles.closeButton}
              onClick={() => setIsExpanded(false)}
              aria-label="Свернуть легенду"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            className={styles.legendButton}
            onClick={() => setIsExpanded(true)}
            aria-label="Показать легенду"
          >
            i
          </button>
        )}
      </div>
    </>
  )
}
