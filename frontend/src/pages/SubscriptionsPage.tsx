import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { AppHeader } from '../ui/AppHeader'
import { Toast } from '../ui/Toast'
import {
  createSubscription,
  deleteSubscription,
  getDictionaries,
  getSubscriptions,
  getTelegramLink,
} from '../api/endpoints'
import type { ApiError, ProjectStage, SubscriptionInput } from '../api/types'
import { describeSubscription } from '../notifications/describeSubscription'
import styles from './SubscriptionsPage.module.css'

const apiMessage = (err: unknown) => (err as ApiError | null)?.message ?? 'Произошла ошибка'

export function SubscriptionsPage() {
  const { user, logout } = useAuth()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  return (
    <div className={styles.page}>
      <AppHeader userName={user?.fullName || ''} onLogout={logout} />
      <main className={styles.main}>
        <h1 className={styles.title}>Подписки на проекты</h1>
        <p className={styles.lead}>
          Сообщим о новых инвестпроектах по выбранным условиям — в колокольчике и в Telegram. В ленту попадают
          только проекты, появившиеся после оформления подписки.
        </p>
        <div className={styles.grid}>
          <div className={styles.column}>
            <NewSubscriptionForm onDone={setToast} />
            <TelegramBlock />
          </div>
          <SubscriptionList onDone={setToast} />
        </div>
      </main>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

type ToastFn = (t: { message: string; type: 'success' | 'error' }) => void

function useDictionaries() {
  return useQuery({ queryKey: ['dictionaries'], queryFn: getDictionaries, staleTime: Infinity })
}

function NewSubscriptionForm({ onDone }: { onDone: ToastFn }) {
  const queryClient = useQueryClient()
  const { data: dict } = useDictionaries()
  const [industry, setIndustry] = useState('')
  const [municipalityId, setMunicipalityId] = useState('')
  const [need, setNeed] = useState('')
  const [stage, setStage] = useState('')

  const isEmpty = !industry && !municipalityId && !need && !stage

  const mutation = useMutation({
    mutationFn: (input: SubscriptionInput) => createSubscription(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      setIndustry('')
      setMunicipalityId('')
      setNeed('')
      setStage('')
      onDone({ message: 'Подписка оформлена', type: 'success' })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isEmpty) return
    mutation.mutate({
      industry: industry || undefined,
      municipalityId: municipalityId ? Number(municipalityId) : undefined,
      need: need || undefined,
      stage: (stage || undefined) as ProjectStage | undefined,
    })
  }

  const municipalities = dict ? [...dict.municipalities].sort((a, b) => a.name.localeCompare(b.name, 'ru')) : []

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>Новая подписка</h2>
      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span className={styles.label}>Отрасль</span>
          <select className={styles.select} value={industry} onChange={(e) => setIndustry(e.target.value)}>
            <option value="">Любая</option>
            {dict?.industries.map((i) => (
              <option key={i.code} value={i.code}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Район / город</span>
          <select
            className={styles.select}
            value={municipalityId}
            onChange={(e) => setMunicipalityId(e.target.value)}
          >
            <option value="">Любой</option>
            {municipalities.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Потребность</span>
          <select className={styles.select} value={need} onChange={(e) => setNeed(e.target.value)}>
            <option value="">Любая</option>
            {dict?.needs.map((n) => (
              <option key={n.code} value={n.code}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Стадия</span>
          <select className={styles.select} value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">Любая</option>
            {dict?.stages.map((st) => (
              <option key={st.code} value={st.code}>
                {st.name}
              </option>
            ))}
          </select>
        </label>

        {mutation.isError && <p className={styles.error}>{apiMessage(mutation.error)}</p>}

        <button type="submit" className={styles.primaryButton} disabled={isEmpty || mutation.isPending}>
          {mutation.isPending ? 'Оформляем…' : 'Подписаться'}
        </button>
        {isEmpty && <p className={styles.hint}>Выберите хотя бы одно условие</p>}
      </form>
    </section>
  )
}

function SubscriptionList({ onDone }: { onDone: ToastFn }) {
  const queryClient = useQueryClient()
  const { data: dict } = useDictionaries()
  const { data, isLoading, error } = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions })

  const remove = useMutation({
    mutationFn: deleteSubscription,
    onSuccess: () => onDone({ message: 'Подписка удалена', type: 'success' }),
    onError: (err) => onDone({ message: apiMessage(err), type: 'error' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
  })

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>
        Мои подписки{data && data.length > 0 && <span className={styles.counter}>{data.length}</span>}
      </h2>

      {isLoading && (
        <>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </>
      )}
      {error && <p className={styles.error}>{apiMessage(error)}</p>}
      {data && data.length === 0 && (
        <p className={styles.hint}>
          Подписок пока нет. Выберите условия в форме «Новая подписка» или нажмите «Подписаться на такие проекты» в карточке проекта.
        </p>
      )}

      {data && data.length > 0 && (
        <ul className={styles.list}>
          {data.map((sub) => (
            <li key={sub.id} className={styles.row}>
              <div className={styles.rowBody}>
                <span className={styles.rowTitle}>{describeSubscription(sub, dict)}</span>
                <span className={styles.rowMeta}>
                  с {new Date(sub.createdAt).toLocaleDateString('ru-RU')}
                </span>
              </div>
              <button
                className={styles.secondaryButton}
                onClick={() => remove.mutate(sub.id)}
                disabled={remove.isPending && remove.variables === sub.id}
              >
                Отписаться
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TelegramBlock() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['telegram-link'],
    queryFn: getTelegramLink,
    // Вернулись из Telegram после /start — статус «привязан» подтянется
    refetchOnWindowFocus: true,
  })

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>Telegram</h2>
      {isLoading && <div className={styles.skeleton} />}
      {error && <p className={styles.error}>{apiMessage(error)}</p>}
      {data && !data.botConfigured && (
        <p className={styles.muted}>Telegram не подключён на сервере</p>
      )}
      {data && data.botConfigured && data.linked && (
        <p className={styles.linked}>Уведомления приходят в Telegram ✓</p>
      )}
      {data && data.botConfigured && !data.linked && data.url && (
        <>
          <p className={styles.hint}>Откроется бот — нажмите «Запустить», и уведомления будут приходить в чат.</p>
          <a className={styles.primaryButton} href={data.url} target="_blank" rel="noopener noreferrer">
            Подключить Telegram
          </a>
        </>
      )}
    </section>
  )
}
