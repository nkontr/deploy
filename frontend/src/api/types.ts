// API типы данных

export interface User {
  id: number
  email: string
  fullName: string
  roles: string[]
}

export interface LoginResponse {
  mfaToken: string
  mfaSetupRequired: boolean
  otpauthUrl?: string
  qrPngBase64?: string
}

export interface TwoFactorVerifyResponse {
  accessToken: string
  expiresIn: number
  user: User
}

export interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface ErrorResponse {
  error: ApiError
}

// Справочники
export interface Industry {
  code: string
  name: string
}

export interface Municipality {
  id: number
  name: string
  kind: 'city' | 'district'
  lat: number
  lon: number
}

export interface SizeCategory {
  code: string
  name: string
}

export interface Stage {
  code: string
  name: string
}

export interface Need {
  code: string
  name: string
}

export interface Dictionaries {
  industries: Industry[]
  municipalities: Municipality[]
  sizeCategories: SizeCategory[]
  stages: Stage[]
  needs: Need[]
}

// Карта
export interface MapCell {
  lat: number
  lon: number
  total: number
  ours: number
  others: number
  excluded: number
}

export interface MapPoint {
  id: number
  lat: number
  lon: number
  kind: 'ours' | 'others' | 'excluded'
}

export interface MapCellsResponse {
  mode: 'cells'
  cellDeg: number
  total: number
  cells: MapCell[]
}

/** Компании без адреса в одном населённом пункте (или районе) — одним значком, а не точками на условных зданиях */
export interface MapGroup {
  label: string // «х. Победа» или «Аксайский р-н»
  municipalityId: number
  settlement: string | null
  lat: number
  lon: number
  total: number
  ours: number
  others: number
  excluded: number
}

export interface MapPointsResponse {
  mode: 'points'
  total: number
  points: MapPoint[] // только компании с адресом из ЕГРЮЛ
  groups?: MapGroup[] // остальные; старый core-api поля не отдаёт
}

export type MapDataResponse = MapCellsResponse | MapPointsResponse

// Компании
export type CompanyKind = 'ours' | 'others' | 'excluded'
export type CompanyStatus = 'active' | 'excluded'
export type SubjectType = 'ip' | 'legal'
export type SizeCategoryCode = 'micro' | 'small' | 'medium'
export type GeoPrecision = 'address' | 'settlement' | 'municipality' | 'approx'
export type RevenueSource = 'fns' | 'model'

export interface CompanyShort {
  id: number
  inn: string
  name: string
  industry: string
  industryName: string
  okvedCode: string
  okvedName: string
  municipalityId: number
  municipalityName: string
  settlement: string | null
  lat: number
  lon: number
  // Адресов в реестре МСП нет: точка — здание из OSM в населённом пункте, в районе или (approx) около центра района
  geoPrecision: GeoPrecision
  sizeCategory: SizeCategoryCode
  employees: number | null
  revenueEst: number | null
  revenueGrowthEst: number | null
  revenueSource: RevenueSource
  isEstimated: boolean
  isClient: boolean
  status: CompanyStatus
  kind: CompanyKind
  excludedAt: string | null
  isNew: boolean
  registeredAt: string
  relocated?: boolean // задача со звёздочкой
}

export interface Company extends CompanyShort {
  ogrn: string
  subjectType: SubjectType
  phone: string | null
  email: string | null
  website: string | null
  hasLicenses: boolean
  isInnovative: boolean
  isSocial: boolean
  address?: string | null // юридический адрес из ЕГРЮЛ (у юрлиц, если найден)
}

export interface CompaniesResponse {
  items: CompanyShort[]
  page: number
  size: number
  total: number
}

// Статистика районов
export interface MunicipalityStats {
  municipalityId: number
  name: string
  kind: 'city' | 'district'
  lat: number
  lon: number
  industry: string
  companies: number
  clients: number
  excludedClients: number
  coverage: number
  newShare: number
  revenueEstSum: number | null
  potentialScore: number
  isWhiteSpot: boolean
  reason: string | null
}

// Белые пятна
export interface WhiteSpot {
  municipalityId: number
  name: string
  lat: number
  lon: number
  potentialScore: number
  companies: number
  clients: number
  reason: string
}

// Импорт клиентов (admin) — POST /api/clients/import, core-api clients/ClientImportResult
export type ImportMode = 'append' | 'replace'

export interface ImportClientsResponse {
  rows: number
  matched: number
  notFound: string[]
  mode: ImportMode
  whiteSpots: number
}

// «Где работает» — GET /api/companies/{id}/locations (contracts/examples/locations.json)
export type LocationSource = 'crm' | 'manager' | 'egrul' | string

export interface RegisteredLocation {
  municipalityName: string
  settlement: string | null
  lat: number
  lon: number
}

export interface ActualLocation {
  id: number
  municipalityName: string | null
  /** Другой регион, если место за пределами области */
  regionName: string | null
  address: string | null
  lat: number | null
  lon: number | null
  source: LocationSource
  confidence: number
  note: string | null
  createdAt: string
}

export interface CompanyLocations {
  registered: RegisteredLocation
  actual: ActualLocation[]
  relocated: boolean
}

/** POST /api/companies/{id}/locations: ровно одно из municipalityName и regionName */
export interface LocationInput {
  municipalityName?: string
  regionName?: string
  address?: string
  note?: string
}

/** POST /api/locations/import (admin) */
export interface LocationImportResponse {
  rows: number
  matched: number
  notFound: string[]
  invalid: string[]
}

// Проекты (продукт 2 - Навигатор)
export type ProjectStage = 'design' | 'construction' | 'launch'

export interface RecommendedOffer {
  need: string
  needName: string
  offers: string[]
}

export interface ProjectShort {
  id: number
  title: string
  initiator: string
  municipalityId: number
  municipalityName: string
  lat: number
  lon: number
  isKey: boolean
  // В core-api (invest/Project.java) поля ниже могут быть null — в данных бывают пропуски
  curator: string | null
  startYear: number | null
  launchYear: number | null
  amountMln: number | null
  jobs: number | null
  stage: ProjectStage
  stageName: string
  industry: string | null
  industryName: string | null
  needs: string[]
  recommendedOffers: RecommendedOffer[]
  updatedAt: string
}

export interface Project extends ProjectShort {
  // Все поля уже в ProjectShort, но явно обозначаем полную форму
}

export interface ProjectsResponse {
  items: ProjectShort[]
  page: number
  size: number
  total: number
}

// Таймлайн проектов
export type TimelineEventType = 'start' | 'launch'

export interface TimelineEvent {
  projectId: number
  type: TimelineEventType
  title: string
  municipalityId: number
  municipalityName: string
  stage: ProjectStage
  amountMln: number | null
}

export interface TimelineYear {
  year: number
  events: TimelineEvent[]
}

export interface TimelineResponse {
  /** null — под фильтром нет ни одного события */
  minYear: number | null
  maxYear: number | null
  total: number
  years: TimelineYear[]
}

// Связанные компании проекта
export type ProjectCompanyRelation = 'initiator' | 'same_area_industry'

/** Компания вокруг проекта — CompanyShort как в списке радара + отношение к проекту (контракт 08) */
export type ProjectRelatedCompany = CompanyShort & { relation: ProjectCompanyRelation }

export interface ProjectRelatedCompaniesResponse {
  projectId: number
  items: ProjectRelatedCompany[]
  /** Сколько всего действующих компаний той же отрасли в районе проекта */
  sameAreaIndustryTotal: number
  /** Строка CompanyFilter для «Открыть в радаре»; null — у проекта нет отрасли */
  radarQuery: string | null
}

// Подписки (notifier, контракт 08). Названия кодов — из /api/dictionaries на фронте
export interface Subscription {
  id: number
  industry: string | null
  municipalityId: number | null
  need: string | null
  stage: ProjectStage | null
  createdAt: string
}

export interface SubscriptionInput {
  industry?: string
  municipalityId?: number
  need?: string
  stage?: ProjectStage
}

/** GET /api/subscriptions — массив подписок, новые сверху (contracts/examples/subscriptions.json) */
export type SubscriptionsResponse = Subscription[]

// Уведомления
export interface Notification {
  id: number
  projectId: number
  title: string
  municipalityName: string | null
  subscriptionId: number | null
  isRead: boolean
  sentToTelegram: boolean
  createdAt: string
}

export interface NotificationsResponse {
  items: Notification[]
  unreadCount: number
}

// Telegram-линк
export interface TelegramLinkResponse {
  botConfigured: boolean
  linked: boolean
  url: string | null
}
