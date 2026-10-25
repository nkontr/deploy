import { useQuery } from '@tanstack/react-query'
import { getCompany } from '../api/endpoints'
import { Badge } from '../ui/Badge'
import { WhereWorks } from './WhereWorks'
import styles from './CompanyCard.module.css'
import { useState } from 'react'
import type { GeoPrecision } from '../api/types'

// Адреса в реестре МСП нет: точка — только у юрлиц с адресом из ЕГРЮЛ, остальные на карте группой нас. пункта
const GEO_PRECISION_HINT: Record<GeoPrecision, string> = {
  address: 'Точка на карте — юридический адрес из ЕГРЮЛ',
  settlement: 'Точного адреса нет — на карте в группе этого населённого пункта',
  municipality: 'Точного адреса нет — на карте в группе района',
  approx: 'Точного адреса нет — на карте в группе района',
}

interface CompanyCardProps {
  companyId: number
  onClose: () => void
}

export function CompanyCard({ companyId, onClose }: CompanyCardProps) {
  const { data: company, isLoading, error } = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => getCompany(companyId),
    enabled: !!companyId,
  })

  const [copied, setCopied] = useState(false)

  const handleCopyInn = async () => {
    if (company?.inn) {
      await navigator.clipboard.writeText(company.inn)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const formatRevenue = (revenue: number | null) => {
    if (!revenue) return '—'
    const millions = revenue / 1_000_000
    return `${millions.toFixed(1)} млн ₽/год`
  }

  const formatDate = (date: string | null) => {
    if (!date) return '—'
    return new Date(date).toLocaleDateString('ru-RU')
  }

  if (isLoading) {
    return (
      <div className={styles.drawer}>
        <div className={styles.loading}>Загрузка...</div>
      </div>
    )
  }

  if (error || !company) {
    return (
      <div className={styles.drawer}>
        <div className={styles.error}>Компания не найдена</div>
        <button className={styles.closeButton} onClick={onClose}>
          Закрыть
        </button>
      </div>
    )
  }

  const kindColor = company.kind === 'ours' ? 'purple' : company.kind === 'others' ? 'orange' : 'default'
  const revenueSourceLabel = company.revenueSource === 'fns' ? 'ФНС' : 'оценка'

  return (
    <div className={styles.drawer}>
      <div className={styles.header}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>

      <div className={styles.content}>
        <h2 className={styles.title}>{company.name}</h2>

        <div className={styles.badges}>
          {company.isClient && <Badge variant="purple">наш клиент</Badge>}
          {company.isEstimated && <Badge variant="default">оценка</Badge>}
          {company.isNew && <Badge variant={kindColor}>новая</Badge>}
          {company.relocated && <Badge variant="purple">работает в другом месте</Badge>}
          {company.status === 'excluded' && (
            <Badge variant="default">исключён из реестра МСП</Badge>
          )}
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Реквизиты</h3>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>ИНН:</span>
            <div className={styles.innWrapper}>
              <span className={styles.fieldValue}>{company.inn}</span>
              <button
                className={styles.copyButton}
                onClick={handleCopyInn}
                title="Скопировать ИНН"
              >
                {copied ? '✓' : '⎘'}
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>ОГРН:</span>
            <span className={styles.fieldValue}>{company.ogrn}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Тип:</span>
            <span className={styles.fieldValue}>
              {company.subjectType === 'ip' ? 'ИП' : 'Юридическое лицо'}
            </span>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Основная информация</h3>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Отрасль:</span>
            <span className={styles.fieldValue}>{company.industryName}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>ОКВЭД:</span>
            <span className={styles.fieldValue}>
              {company.okvedCode} — {company.okvedName}
            </span>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Город:</span>
            <span className={styles.fieldValue}>
              {company.municipalityName}
              {company.settlement && `, ${company.settlement}`}
            </span>
            {company.address ? (
              <span className={styles.fieldValue}>{company.address}</span>
            ) : (
              company.subjectType === 'legal' && <span className={styles.hint}>Юридический адрес пока не загружен из ЕГРЮЛ</span>
            )}
            <span className={styles.hint}>{GEO_PRECISION_HINT[company.geoPrecision]}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Размер:</span>
            <span className={styles.fieldValue}>
              {company.sizeCategory === 'micro'
                ? 'Микро'
                : company.sizeCategory === 'small'
                ? 'Малый'
                : 'Средний'}
            </span>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Сотрудников:</span>
            <span className={styles.fieldValue}>{company.employees || '—'}</span>
          </div>
        </div>

        <WhereWorks companyId={company.id} />

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Финансы</h3>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Выручка:</span>
            <span className={styles.fieldValue}>
              {formatRevenue(company.revenueEst)}{' '}
              <span className={styles.hint}>({revenueSourceLabel})</span>
            </span>
          </div>
          {company.revenueGrowthEst !== null && (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Рост выручки:</span>
              <span
                className={`${styles.fieldValue} ${
                  company.revenueGrowthEst > 0 ? styles.positive : styles.negative
                }`}
              >
                {company.revenueGrowthEst > 0 ? '+' : ''}
                {company.revenueGrowthEst}%
              </span>
            </div>
          )}
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Контакты</h3>
          {company.phone && (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Телефон:</span>
              <a href={`tel:${company.phone}`} className={styles.link}>
                {company.phone}
              </a>
            </div>
          )}
          {company.email && (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Email:</span>
              <a href={`mailto:${company.email}`} className={styles.link}>
                {company.email}
              </a>
            </div>
          )}
          {company.website && (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Сайт:</span>
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.link}
              >
                {company.website}
              </a>
            </div>
          )}
          {!company.phone && !company.email && !company.website && (
            <div className={styles.hint}>Контактная информация отсутствует</div>
          )}
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Дополнительно</h3>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Дата регистрации:</span>
            <span className={styles.fieldValue}>{formatDate(company.registeredAt)}</span>
          </div>
          {company.excludedAt && (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Исключён из реестра:</span>
              <span className={styles.fieldValue}>{formatDate(company.excludedAt)}</span>
            </div>
          )}
          {(company.hasLicenses || company.isInnovative || company.isSocial) && (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Признаки:</span>
              <div className={styles.features}>
                {company.hasLicenses && <Badge variant="default">лицензии</Badge>}
                {company.isInnovative && <Badge variant="purple">инновационная</Badge>}
                {company.isSocial && <Badge variant="default">социальная</Badge>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
