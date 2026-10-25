import { useState } from 'react'
import { shortOrgName } from '../utils/shortOrgName'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createSubscription, getProject, getProjectRelatedCompanies } from '../api/endpoints'
import type { ApiError, Project, ProjectRelatedCompany } from '../api/types'
import { Badge } from '../ui/Badge'
import { Toast } from '../ui/Toast'
import { formatMoney, formatYears } from '../utils/formatMoney'
import styles from './ProjectCard.module.css'

interface ProjectCardProps {
  projectId: number
  onClose: () => void
  /** Клик по компании из «Компании рядом» — открыть карточку компании радара */
  onOpenCompany: (companyId: number) => void
}

export function ProjectCard({ projectId, onClose, onOpenCompany }: ProjectCardProps) {
  const { data: project, isLoading, error } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  })

  if (isLoading) {
    return (
      <aside className={styles.drawer} aria-label="Карточка проекта">
        <CardHeader onClose={onClose} />
        <div className={styles.content}>
          <div className={styles.skeletonTitle} />
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonBlock} />
        </div>
      </aside>
    )
  }

  if (error || !project) {
    const apiError = error as unknown as ApiError | null
    return (
      <aside className={styles.drawer} aria-label="Карточка проекта">
        <CardHeader onClose={onClose} />
        <div className={styles.error}>
          {!apiError || apiError.code === 'NOT_FOUND' ? 'Проект не найден' : apiError.message}
        </div>
      </aside>
    )
  }

  return (
    <aside className={styles.drawer} aria-label="Карточка проекта">
      <CardHeader onClose={onClose} />
      <div className={styles.content}>
        <ProjectSummary project={project} />
        <RecommendedOffers project={project} />
        <RelatedCompanies projectId={project.id} onOpenCompany={onOpenCompany} />
        <SubscribeButton project={project} />
      </div>
    </aside>
  )
}

function CardHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.header}>
      <button className={styles.closeButton} onClick={onClose} aria-label="Закрыть">
        ×
      </button>
    </div>
  )
}

function ProjectSummary({ project }: { project: Project }) {
  return (
    <>
      <h2 className={styles.title}>{project.title}</h2>
      <div className={styles.badges}>
        <span className={`${styles.stageBadge} ${styles[`stage-${project.stage}`]}`}>
          {project.stageName}
        </span>
        {project.isKey && <span className={styles.keyBadge}>ключевой</span>}
      </div>

      <dl className={styles.fields}>
        <Field label="Инициатор" value={project.initiator} />
        <Field label="Район" value={project.municipalityName} />
        <Field label="Отрасль" value={project.industryName || '—'} />
        <Field label="Годы" value={formatYears(project.startYear, project.launchYear)} />
        <Field label="Объём" value={formatMoney(project.amountMln)} />
        <Field label="Рабочие места" value={project.jobs ? String(project.jobs) : '—'} />
        <Field label="Куратор" value={project.curator || '—'} />
      </dl>
    </>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.field}>
      <dt className={styles.fieldLabel}>{label}</dt>
      <dd className={styles.fieldValue}>{value}</dd>
    </div>
  )
}

function RecommendedOffers({ project }: { project: Project }) {
  return (
    <section className={styles.offers}>
      <h3 className={styles.offersTitle}>Что предложить Ростелекому</h3>
      {project.recommendedOffers.length === 0 ? (
        <p className={styles.hint}>Потребности проекта не указаны</p>
      ) : (
        project.recommendedOffers.map((group) => (
          <div key={group.need} className={styles.offerGroup}>
            <h4 className={styles.needName}>{group.needName}</h4>
            <ul className={styles.offerList}>
              {group.offers.map((offer) => (
                <li key={offer}>{offer}</li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}

function RelatedCompanies({
  projectId,
  onOpenCompany,
}: {
  projectId: number
  onOpenCompany: (companyId: number) => void
}) {
  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['project-related-companies', projectId],
    queryFn: () => getProjectRelatedCompanies(projectId),
    staleTime: 60000,
  })

  // Инициатор — первым, остальные в порядке сервера (сначала не клиенты)
  const items = data
    ? [
        ...data.items.filter((c) => c.relation === 'initiator'),
        ...data.items.filter((c) => c.relation !== 'initiator'),
      ]
    : []

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Компании рядом</h3>

      {isLoading && (
        <>
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonLine} />
        </>
      )}

      {error && <p className={styles.errorText}>{(error as unknown as ApiError).message}</p>}

      {data && (
        <>
          {items.length === 0 ? (
            <p className={styles.hint}>Компаний этой отрасли в районе не нашлось</p>
          ) : (
            <ul className={styles.companyList}>
              {items.map((company) => (
                <li key={company.id}>
                  <RelatedCompanyRow company={company} onClick={() => onOpenCompany(company.id)} />
                </li>
              ))}
            </ul>
          )}

          <div className={styles.radarFooter}>
            <span className={styles.total}>
              Всего в районе по отрасли: {data.sameAreaIndustryTotal.toLocaleString('ru-RU')}
            </span>
            {data.radarQuery && (
              <button
                className={styles.secondaryButton}
                onClick={() => navigate(`/?${data.radarQuery}`)}
              >
                Открыть в радаре
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function RelatedCompanyRow({
  company,
  onClick,
}: {
  company: ProjectRelatedCompany
  onClick: () => void
}) {
  return (
    <button className={styles.companyRow} onClick={onClick}>
      <span className={`${styles.kindDot} ${styles[`kind-${company.kind}`]}`} aria-hidden="true" />
      <span className={styles.companyMain}>
        {company.relation === 'initiator' && <Badge variant="purple">Инициатор проекта</Badge>}
        <span className={styles.companyName} title={company.name}>
          {shortOrgName(company.name)}
        </span>
        <span className={styles.companyMeta}>
          {company.revenueEst !== null ? formatMoney(company.revenueEst / 1_000_000) : 'выручка —'}
          {company.revenueEst !== null && (
            <Badge variant={company.isEstimated ? 'default' : 'purple'}>
              {company.revenueSource === 'fns' ? 'ФНС' : 'оценка'}
            </Badge>
          )}
          {company.isClient && <span className={styles.clientMark}>наш клиент</span>}
        </span>
      </span>
    </button>
  )
}

function SubscribeButton({ project }: { project: Project }) {
  const queryClient = useQueryClient()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      createSubscription({
        industry: project.industry || undefined,
        municipalityId: project.municipalityId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      setToast({ message: 'Подписка оформлена', type: 'success' })
    },
    onError: (err) => setToast({ message: (err as unknown as ApiError).message, type: 'error' }),
  })

  return (
    <>
      <button
        className={styles.primaryButton}
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || mutation.isSuccess}
      >
        {mutation.isSuccess ? 'Вы подписаны ✓' : 'Подписаться на такие проекты'}
      </button>
      <p className={styles.hint}>
        Уведомим о новых проектах: {[project.industryName, project.municipalityName].filter(Boolean).join(' · ')}
      </p>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}
