import { useState, useEffect } from 'react'
import { shortOrgName } from '../utils/shortOrgName'
import { useQuery } from '@tanstack/react-query'
import { getCompanies } from '../api/endpoints'
import { filterToQuery } from '../filters/filterToQuery'
import type { CompanyFilters } from '../filters/types'
import type { CompanyShort } from '../api/types'
import { Badge } from '../ui/Badge'
import { ExportButtons } from '../export/ExportButtons'
import { SmartSearch } from '../search/SmartSearch'
import { FilterChips } from '../search/FilterChips'
import { highlightText } from '../search/highlightText'
import styles from './CompanyList.module.css'

interface CompanyListProps {
  filters: CompanyFilters
  selectedId?: number
  onSelectCompany: (id: number) => void
  onFiltersChange: (updates: Partial<CompanyFilters>) => void
  onResetFilters: () => void
}

const SORT_OPTIONS = [
  { value: 'revenueEst,desc', label: 'По выручке ↓' },
  { value: 'revenueEst,asc', label: 'По выручке ↑' },
  { value: 'revenueGrowthEst,desc', label: 'По росту ↓' },
  { value: 'revenueGrowthEst,asc', label: 'По росту ↑' },
  { value: 'name,asc', label: 'По названию ↑' },
  { value: 'name,desc', label: 'По названию ↓' },
  { value: 'employees,desc', label: 'По численности ↓' },
  { value: 'employees,asc', label: 'По численности ↑' },
  { value: 'registeredAt,desc', label: 'Новые сначала' },
  { value: 'registeredAt,asc', label: 'Старые сначала' },
]

export function CompanyList({ filters, selectedId, onSelectCompany, onFiltersChange, onResetFilters }: CompanyListProps) {
  const [sort, setSort] = useState('revenueEst,desc')
  const [page, setPage] = useState(0)
  const [allItems, setAllItems] = useState<CompanyShort[]>([])
  const size = 50

  // Получаем название поля сортировки для отображения в строках
  const sortField = sort.split(',')[0] as keyof CompanyShort

  const queryString = filterToQuery(filters) + `&page=${page}&size=${size}&sort=${sort}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['companies', queryString],
    queryFn: () => getCompanies(queryString),
    placeholderData: (prev) => prev,
  })

  // Сброс при изменении фильтров или сортировки
  useEffect(() => {
    setPage(0)
    setAllItems([])
  }, [filterToQuery(filters), sort])

  // Накопление данных при пагинации
  useEffect(() => {
    if (data?.items) {
      if (page === 0) {
        setAllItems(data.items)
      } else {
        setAllItems((prev) => [...prev, ...data.items])
      }
    }
  }, [data, page])

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSort(e.target.value)
  }

  const handleLoadMore = () => {
    setPage((prev) => prev + 1)
  }

  if (isLoading && allItems.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Загрузка...</div>
      </div>
    )
  }

  if (error) {
    const errorMessage = (error as any)?.error?.message || 'Ошибка загрузки списка компаний'
    return (
      <div className={styles.container}>
        <div className={styles.errorContainer}>
          <div className={styles.error}>{errorMessage}</div>
          <button className={styles.retryButton} onClick={() => window.location.reload()}>
            Повторить
          </button>
        </div>
      </div>
    )
  }

  if (!data || data.total === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.searchSection}>
          <SmartSearch
            filters={filters}
            onFiltersChange={onFiltersChange}
            onSelectCompany={onSelectCompany}
          />
          <FilterChips
            filters={filters}
            onFiltersChange={onFiltersChange}
            onResetAll={onResetFilters}
          />
        </div>
        <div className={styles.empty}>
          <p>Ничего не найдено</p>
          <p className={styles.hint}>Попробуйте изменить параметры поиска</p>
          <button className={styles.resetButton} onClick={onResetFilters}>
            Сбросить фильтры поиска
          </button>
        </div>
      </div>
    )
  }

  const hasMore = allItems.length < data.total

  return (
    <div className={styles.container}>
      <div className={styles.searchSection}>
        <SmartSearch
          filters={filters}
          onFiltersChange={onFiltersChange}
          onSelectCompany={onSelectCompany}
        />
        <FilterChips
          filters={filters}
          onFiltersChange={onFiltersChange}
          onResetAll={onResetFilters}
        />
      </div>

      <ExportButtons
        endpoint="/api/export/companies"
        query={filterToQuery(filters)}
        total={data.total}
        noun="компаний"
        allowImport
      />

      <div className={styles.header}>
        <h3 className={styles.title}>Найдено: {data.total}</h3>
        <select className={styles.sortSelect} value={sort} onChange={handleSortChange}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.list}>
        {allItems.map((company) => (
          <CompanyRow
            key={company.id}
            company={company}
            isSelected={company.id === selectedId}
            onClick={() => onSelectCompany(company.id)}
            searchQuery={filters.q}
            sortField={sortField}
          />
        ))}

        {hasMore && (
          <button className={styles.loadMore} onClick={handleLoadMore} disabled={isLoading}>
            {isLoading ? 'Загрузка...' : 'Показать ещё'}
          </button>
        )}
      </div>
    </div>
  )
}

interface CompanyRowProps {
  company: CompanyShort
  isSelected: boolean
  onClick: () => void
  searchQuery?: string
  sortField: keyof CompanyShort
}

function CompanyRow({ company, isSelected, onClick, searchQuery, sortField }: CompanyRowProps) {
  const formatRevenue = (revenue: number | null) => {
    if (!revenue) return '—'
    const millions = revenue / 1_000_000
    return `${millions.toFixed(1)} млн ₽`
  }

  const formatGrowth = (growth: number | null) => {
    if (growth === null) return null
    return growth > 0 ? `+${growth}%` : `${growth}%`
  }

  const getSizeLabel = (size: string) => {
    switch (size) {
      case 'micro':
        return 'Микропредприятие'
      case 'small':
        return 'Малое'
      case 'medium':
        return 'Среднее'
      default:
        return size
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  // Проверяем, нужно ли показывать дополнительное поле
  const showEmployees = sortField === 'employees'
  const showRegisteredAt = sortField === 'registeredAt'

  const getKindLabel = (kind: string) => {
    switch (kind) {
      case 'ours':
        return 'наш'
      case 'others':
        return 'не наш'
      case 'excluded':
        return 'исключён'
      default:
        return kind
    }
  }

  const kindColor = company.kind === 'ours' ? 'purple' : company.kind === 'others' ? 'orange' : 'default'
  const growth = formatGrowth(company.revenueGrowthEst)

  return (
    <div
      className={`${styles.row} ${isSelected ? styles.selected : ''}`}
      onClick={onClick}
    >
      <div className={styles.rowHeader}>
        <div className={styles.rowTitleLine}>
          <Badge variant={kindColor}>{getKindLabel(company.kind)}</Badge>
          <div className={styles.rowTitle} title={company.name}>
            {highlightText(shortOrgName(company.name), searchQuery)}
          </div>
        </div>
        <div className={styles.badges}>
          {company.isEstimated && <Badge variant="default">оценка</Badge>}
          {company.isNew && <Badge variant="purple">новая</Badge>}
          {company.relocated && (
            <span title="Работает не там, где зарегистрирована">
              <Badge variant="purple">работает в другом месте</Badge>
            </span>
          )}
        </div>
      </div>

      <div className={styles.rowDetails}>
        <div className={styles.detail}>
          <span className={styles.label}>Отрасль:</span> {company.industryName}
        </div>
        <div className={styles.detail}>
          <span className={styles.label}>Категория:</span> {getSizeLabel(company.sizeCategory)}
        </div>
        <div className={styles.detail}>
          <span className={styles.label}>Выручка:</span> {formatRevenue(company.revenueEst)}
          {growth && (
            <span className={company.revenueGrowthEst! > 0 ? styles.growthPositive : styles.growthNegative}>
              {' '}
              ({growth})
            </span>
          )}
        </div>
        <div className={styles.detail}>
          <span className={styles.label}>Город:</span> {company.municipalityName}
        </div>
        {showEmployees && (
          <div className={styles.detail}>
            <span className={styles.label}>Сотрудников:</span> {company.employees || '—'}
          </div>
        )}
        {showRegisteredAt && (
          <div className={styles.detail}>
            <span className={styles.label}>Зарегистрирована:</span> {formatDate(company.registeredAt)}
          </div>
        )}
      </div>
    </div>
  )
}
