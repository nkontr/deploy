# 06. C# — export-service (продукт 1) и калькулятор (резерв)

**Владелец:** C#-разработчик. **Папка:** `export-service/`. **Порт:** 8082.
**БД в продуктах 1 и 2: нет.** Сервис без состояния: все данные берёт из core-api по HTTP (`/internal/*`).
Схема `calc` и пользователь `calc_svc` нужны только калькулятору (резерв); таблицы и справочники для него уже
созданы и засеяны в `infra/db/init` — из кода ничего не создавать (никакого `Database.Migrate()`).
**Стек:** .NET 8, ASP.NET Core Minimal API, `IHttpClientFactory`, CsvHelper,
`Microsoft.AspNetCore.Authentication.JwtBearer`; для резерва — Npgsql/Dapper и `DocumentFormat.OpenXml`.
**Dockerfile:** `mcr.microsoft.com/dotnet/sdk:8.0` (publish) → `mcr.microsoft.com/dotnet/aspnet:8.0`.

Переменные окружения: `ASPNETCORE_URLS` (`http://+:8082`), `CORE_API_URL`, `AUTH_JWKS_URL`, `INTERNAL_TOKEN`,
`CALC_DB` (резерв).

## Проверка JWT

- `AddAuthentication().AddJwtBearer(...)`: `ValidateIssuer = true`, `ValidIssuer = "radar-auth"`,
  `ValidateAudience = false`, `ValidateLifetime = true`, `ClockSkew = 30 s`.
- Ключи — из `AUTH_JWKS_URL`: `IssuerSigningKeyResolver` берёт `JsonWebKeySet` из кэша (10 минут); при неизвестном
  `kid` — перезапросить один раз. Первый запрос JWKS — лениво, не при старте (auth-service может ещё подниматься).
- Политика по умолчанию: аутентифицирован **и** в `amr` есть `"otp"` (claim `amr` может прийти массивом —
  проверять все значения).
- 401/403 отдавать в общем формате ошибок (через `JwtBearerEvents.OnChallenge` / `OnForbidden`).

## `GET /api/export/companies` — главное в продукте 1

Параметры: весь `CompanyFilter` (см. 00-common) + `format` = `csv` (по умолчанию) или `bitrix`.

**Логика:**

1. Проверить `format`: не `csv`/`bitrix` → 400 `VALIDATION_ERROR`.
2. Взять исходную query-строку, **убрать из неё только `format`**, остальное передать как есть (фильтр
   разбирает core-api — не дублировать валидацию):
   `GET {CORE_API_URL}/internal/companies?{query}` с заголовком `X-Internal-Token: {INTERNAL_TOKEN}`.
3. Ответ core-api:
   - 200 → JSON-массив `Company` (поля — в [02](02-java-1-core-api.md)), **может быть до 100 000 строк**;
   - 400 или 413 `TOO_LARGE` → вернуть клиенту то же тело и статус (фронт покажет «сузьте фильтр»);
   - таймаут 5 с на заголовки, 5xx, отказ соединения → 502 `UPSTREAM_UNAVAILABLE`.
4. **Потоком, без загрузки всего в память:** `HttpCompletionOption.ResponseHeadersRead` →
   `JsonSerializer.DeserializeAsyncEnumerable<CompanyDto>(stream)` → каждую запись сразу пишем CsvHelper'ом в
   `Response.Body`. Заголовки ответа выставить до первой записи:
   - `Content-Type: text/csv; charset=utf-8`
   - `Content-Disposition: attachment; filename="radar_2026-10-24.csv"; filename*=UTF-8''…` (для `bitrix` — `radar_bitrix_…`)
5. Пустой список → файл только с заголовком (не ошибка).

### Формат `csv` — для Excel

- Кодировка UTF-8 **с BOM** (`new UTF8Encoding(true)`), разделитель `;`, перевод строки `\r\n`.
  Без BOM русский Excel покажет кракозябры, с `,` — склеит колонки.
- Числа — культура `ru-RU` без разделителя тысяч: `18500000`, `12,5` (запятая — так Excel поймёт их как числа).
- Даты — `dd.MM.yyyy`. `true/false` → `Да/Нет`. `null` → пустая ячейка.
- Кавычки и `;` внутри значений экранирует CsvHelper (названия вида `ООО "ВЭЛНЕФТЕМОНТАЖ"`).

| Колонка | Поле |
| --- | --- |
| ИНН | `inn` |
| Наименование | `name` |
| Отрасль | `industryName` |
| ОКВЭД | `okvedCode` + « » + `okvedName` |
| Муниципалитет | `municipalityName` |
| Населённый пункт | `settlement` |
| Юридический адрес (ЕГРЮЛ) | `address` (у юрлиц, если найден) |
| Категория | micro → Микро, small → Малое, medium → Среднее |
| Численность | `employees` |
| Выручка, руб. (оценка) | `revenueEst` |
| Рост выручки, % (оценка) | `revenueGrowthEst` |
| Клиент РТ | `kind`: ours → «Да», others → «Нет», excluded → «Был клиентом, исключён из реестра» |
| Дата исключения из реестра | `excludedAt` |
| Источник выручки | `revenueSource`: fns → «ФНС», model → «оценка» |
| Новая компания | `isNew` |
| Дата регистрации | `registeredAt` |
| Телефон | `phone` |
| E-mail | `email` |

### Формат `bitrix` — импорт лидов в CRM

Тот же файл по техническим параметрам, колонки — по шаблону импорта лидов Bitrix24. **Точные названия колонок
сверить с шаблоном, который скачивается в самом Bitrix24** (CRM → Лиды → Импорт → «Скачать пример»); ниже —
ожидаемый набор:

| Колонка Bitrix24 | Значение |
| --- | --- |
| Название лида | `Радар: {name}` |
| Название компании | `name` |
| Рабочий телефон | `phone` |
| Рабочий e-mail | `email` |
| Адрес | `address` (ЕГРЮЛ), если есть; иначе `{municipalityName}` + `, {settlement}` |
| Источник | `Радар присутствия` |
| Комментарий | `ИНН {inn}; ОКВЭД {okvedCode}; отрасль {industryName}; выручка {revenueEst} руб. ({ФНС / оценка}); {Действующий клиент РТ / Потенциальный клиент / Исключён из реестра МСП}` |

Типичный сценарий куратора — «только не наши» в выбранной отрасли и диапазоне выручки → в CRM как новые лиды. Выгрузка
`client=ours&status=excluded` — список на чистку CRM (клиенты, исключённые из реестра).

Если будет время — зарегистрировать бесплатный демо-портал Bitrix24 и импортировать файл по-настоящему:
скриншот успешного импорта на слайд.

## `GET /health`

`200 {"status":"ok"}` — сервис жив (core-api не опрашивать: здоровье соседа — не наше здоровье).

## Пока core-api не готов

Флаг `USE_STUB=true` (по умолчанию `false`): вместо HTTP-вызова читать `contracts/examples/companies-internal.json`.
В compose флаг не задан — значит, в сборке ходим в настоящий core-api.

## Как проверить

```bash
TOKEN=…   # accessToken из auth-service (см. 05)
curl -s -D- -o radar.csv "localhost/api/export/companies?industry=logistics&client=false&format=csv" -H "Authorization: Bearer $TOKEN"
file radar.csv          # UTF-8 (with BOM) text
```

Открыть в Excel — колонки разделены, кириллица читается, суммы — числа (выравнены вправо).

## Продукт 2 (после зелёной сборки)

`GET /api/export/projects?<ProjectFilter>&format=csv|bitrix` — то же через `GET /internal/projects`;
колонки: название, инициатор, муниципалитет, стадия, отрасль, потребности, `recommendedOffers`, годы, объём (млн руб.),
рабочие места; Источник = «Инвестиционный навигатор».

## Резерв — модуль 3 «Калькулятор сделок»

Только если команда решит брать его вместо продукта 2.

- Справочники уже в БД: `calc.region_coef` (5 регионов), `calc.project_level` (basic/advanced/expert),
  `calc.work_stage` (pir 10%, pnr 15%, shef 5%), `calc.component` (20 позиций с ценой и коэффициентом сложности).
- `GET /api/calc/catalog` → всё это для формы.
- `POST /api/calc/estimate` `{ regionId, level, items: [{ componentId, qty }], stages: ["pir","pnr","shef"], urgent }`:
  ```
  equipment = Σ qty × base_price × complexity
  works     = equipment × Σ share_of_equipment выбранных этапов
  optimal   = (equipment + works) × region.coef × level.coef × (urgent ? 1.2 : 1.0)
  ```
  «Минимум» по кейсу должен опираться на похожие проекты, а истории сделок в данных нет — правило для минимума
  и коэффициент срочности **согласовать с куратором** (до этого — `min = optimal × 0.9`, явно подписав как допущение).
  Ростовская область — регион «Южный», коэффициент 1,1.
- `POST /api/export/proposal` → КП в DOCX (`DocumentFormat.OpenXml`): шапка с логотипом, клиент, таблица позиций,
  этапы, итог «минимум / оптимум».

## Готово, когда

CSV из интерфейса открывается в Excel без кракозябр и содержит ровно то, что на экране при тех же фильтрах;
выгрузка 100 000 строк не раздувает память сервиса (поток);
файл `bitrix` импортируется в Bitrix24 без ошибок сопоставления колонок; без токена — 401, при упавшем core-api — 502.
