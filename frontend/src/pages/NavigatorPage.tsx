import { useState, useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppHeader } from '../ui/AppHeader'
import { Tabs } from '../ui/Tabs'
import { useProjectFilter } from '../projects/useProjectFilter'
import { ProjectFilterPanel } from '../projects/ProjectFilterPanel'
import { ProjectList } from '../projects/ProjectList'
import { ProjectTimeline } from '../projects/ProjectTimeline'
import { ProjectMap } from '../projects/ProjectMap'
import { ProjectCard } from '../projects/ProjectCard'
import { projectFilterToQuery } from '../projects/projectFilterToQuery'
import { getProjectTimeline } from '../api/endpoints'
import { useQuery } from '@tanstack/react-query'
import { plural } from '../utils/plural'
import { CompanyCard } from '../company/CompanyCard'
import type { ProjectSortField, ProjectSortDirection } from '../projects/types'
import type { OpenProjectState } from '../notifications/NotificationBell'
import styles from './NavigatorPage.module.css'

export function NavigatorPage() {
  const { user, logout } = useAuth()
  const { filters, updateFilters, resetFilters } = useProjectFilter()
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>()
  const [sort, setSort] = useState<`${ProjectSortField},${ProjectSortDirection}`>('amountMln,desc')
  // На телефоне таймлайн, карта и список — отдельные вкладки на весь экран (на планшете и десктопе — все сразу)
  const [activeTab, setActiveTab] = useState<'timeline' | 'map' | 'list'>('map')
  // < 1280: фильтры не колонкой, а выезжающей панелью (ТЗ 11, раздел 3)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const queryString = projectFilterToQuery(filters)
  // Тот же запрос, что у таймлайна (общий кэш): total = число проектов под фильтром
  const { data: timeline } = useQuery({
    queryKey: ['timeline', queryString],
    queryFn: () => getProjectTimeline(queryString),
    staleTime: 30000,
  })
  const activeFilters = Object.values(filters).filter(
    (v) => v !== undefined && v !== false && !(Array.isArray(v) && v.length === 0)
  ).length
  // Карточка компании радара поверх карточки проекта: закрыли — вернулись к проекту
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | undefined>()

  const handleCloseProject = useCallback(() => {
    setSelectedProjectId(undefined)
    setSelectedCompanyId(undefined)
  }, [])

  const handleCloseCompany = useCallback(() => setSelectedCompanyId(undefined), [])

  // Клик по уведомлению в колокольчике → navigate('/navigator', { state: { openProjectId } })
  const location = useLocation()
  const navigate = useNavigate()
  const openProjectId = (location.state as OpenProjectState | null)?.openProjectId
  useEffect(() => {
    if (openProjectId === undefined) return
    setSelectedProjectId(openProjectId)
    setSelectedCompanyId(undefined)
    // Стираем state, чтобы «назад»/перезагрузка не открывали карточку снова; фильтр в URL сохраняем
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
  }, [openProjectId, navigate, location.pathname, location.search])

  const handleYearRangeChange = useCallback(
    (yearFrom: number | undefined, yearTo: number | undefined) => {
      updateFilters({ yearFrom, yearTo })
    },
    [updateFilters]
  )

  const handleSelectMunicipality = useCallback(
    (municipalityId: number) => {
      updateFilters({ municipalityId: [municipalityId] })
    },
    [updateFilters]
  )

  return (
    <div className={styles.container}>
      <AppHeader userName={user?.fullName || ''} onLogout={logout} />

      {/* Мобильные вкладки */}
      <div className={styles.mobileTabs}>
        <Tabs
          tabs={[
            { id: 'timeline', label: 'Таймлайн' },
            { id: 'map', label: 'Карта' },
            { id: 'list', label: 'Список' },
          ]}
          activeTab={activeTab}
          onChange={(tab) => setActiveTab(tab as 'timeline' | 'map' | 'list')}
        />
      </div>

      <main className={styles.main}>
        <div className={`${styles.filterContainer} ${filtersOpen ? styles.filtersOpen : ''}`}>
          {/* Заголовок «Фильтры» и «Сбросить» — у самой панели, здесь только «закрыть» */}
          <div className={styles.sheetHeader}>
            <button className={styles.sheetClose} onClick={() => setFiltersOpen(false)} aria-label="Закрыть фильтры">
              ×
            </button>
          </div>
          <div className={styles.sheetBody}>
            <ProjectFilterPanel
              filters={filters}
              onFiltersChange={updateFilters}
              onReset={resetFilters}
            />
          </div>
          <div className={styles.sheetFooter}>
            <button className={styles.sheetApply} onClick={() => setFiltersOpen(false)}>
              {timeline ? `Показать ${timeline.total} ${plural(timeline.total, ['проект', 'проекта', 'проектов'])}` : 'Показать'}
            </button>
          </div>
        </div>
        {filtersOpen && <div className={styles.sheetOverlay} onClick={() => setFiltersOpen(false)} />}

        <button className={styles.filtersButton} onClick={() => setFiltersOpen(true)}>
          Фильтры{activeFilters > 0 && ` · ${activeFilters}`}
        </button>

        <div className={styles.rightPanel}>
          <div className={`${styles.timelineContainer} ${activeTab === 'timeline' ? styles.active : ''}`}>
            <ProjectTimeline
              filters={filters}
              onSelectProject={setSelectedProjectId}
              onYearRangeChange={handleYearRangeChange}
            />
          </div>

          <div className={`${styles.contentContainer} ${activeTab === 'timeline' ? styles.hidden : ''}`}>
            {/* Десктоп: карта и список бок о бок */}
            <div className={`${styles.mapContainer} ${activeTab === 'map' ? styles.active : ''}`}>
              <ProjectMap
                filters={filters}
                selectedProjectId={selectedProjectId}
                onSelectMunicipality={handleSelectMunicipality}
              />
            </div>

            <div className={`${styles.listContainer} ${activeTab === 'list' ? styles.active : ''}`}>
              <ProjectList
                filters={filters}
                selectedId={selectedProjectId}
                onSelectProject={setSelectedProjectId}
                sort={sort}
                onSortChange={setSort}
              />
            </div>
          </div>
        </div>
      </main>

      {selectedProjectId !== undefined && (
        <ProjectCard
          key={selectedProjectId}
          projectId={selectedProjectId}
          onClose={handleCloseProject}
          onOpenCompany={setSelectedCompanyId}
        />
      )}
      {selectedCompanyId !== undefined && (
        <CompanyCard companyId={selectedCompanyId} onClose={handleCloseCompany} />
      )}
    </div>
  )
}
