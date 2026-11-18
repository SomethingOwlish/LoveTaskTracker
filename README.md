# Совушка & Гусик — таск-трекер на двоих

Браузерное PWA-приложение: список задач, матрица приоритетов, общий календарь,
статистика, лайки/комментарии, ревью-флоу, две темы (дарк-академия / киберпанк)
с переключателем цвета. Бэкенд — Firebase (Firestore + Google-авторизация).

Пользователи зашиты в `src/config.js`:
- `argentummortis@gmail.com` → Совушка
- `arentakasi@gmail.com` → Гусик

---

## 1. Запуск локально

Нужен Node.js 18+.

```bash
npm install
npm run dev
```

Откроется на `http://localhost:5173`.

> При локальной разработке вход через Google работает, если `localhost` есть в
> списке авторизованных доменов Firebase (по умолчанию он там есть).

---

## 2. Настройка Firebase (один раз)

Проект уже создан (`tasktrackergando`), конфиг прописан в `src/firebase.js`.
Нужно включить три вещи в консоли Firebase (https://console.firebase.google.com):

1. **Authentication → Sign-in method → Google** — включить.
2. **Firestore Database** — создать базу (production mode).
3. **Firestore → Rules** — вставить содержимое файла `firestore.rules` из этого
   проекта и опубликовать. Эти правила пускают к данным только две почты выше.
4. **Authentication → Settings → Authorized domains** — добавить домен, на
   котором живёт приложение (`lovetasktracker.argentummortis.workers.dev`), иначе вход не
   сработает на проде.

---

## 3. Деплой на Cloudflare Workers

Приложение живёт на **https://lovetasktracker.argentummortis.workers.dev**
(статика из `dist/` + маленький воркер `worker/index.js`). Настройки — в `wrangler.jsonc`.

```bash
npm run deploy   # vite build + wrangler deploy
```

Тесты: `npm test` (vitest — повторы задач, разбор QR чека, счётчики бюджета).
GitHub Actions (`.github/workflows/ci.yml`) гоняет тесты и сборку на каждый PR.

**Автодеплой подключён** (Cloudflare Workers Builds, репозиторий `SomethingOwlish/LoveTaskTracker`):
пуш в `main` → `npm run build` → `npx wrangler deploy`. Для остальных веток
собираются предварительные версии (без выкладки на основной адрес).
Настройки: дашборд Cloudflare → Workers & Pages → `lovetasktracker` → Settings → Builds.

`dist/` больше не хранится в git — собирается при деплое.

**Почему воркер.** Вход через Google открывает страницу `/__/auth/handler`.
Воркер проксирует `/__/*` на `tasktrackergando.firebaseapp.com`, поэтому страница
входа оказывается на том же домене, что и приложение, и вход не ломается в Safari
и в PWA на iPhone. Воркер вызывается только для `/__/*`; остальные запросы — статика,
она бесплатна и не входит в лимит 100 000 запросов к воркерам в сутки.

Для нового домена один раз нужно:
1. Firebase → Authentication → Settings → **Authorized domains** → добавить
   `lovetasktracker.argentummortis.workers.dev`.
2. Google Cloud Console → APIs & Services → Credentials → OAuth-клиент
   «Web client (auto created by Google Service)» → **Authorized redirect URIs** →
   добавить `https://lovetasktracker.argentummortis.workers.dev/__/auth/handler`.

Старый адрес на GitHub Pages отдаёт только редирект на новый (папка `pages-redirect/`,
workflow `pages-redirect.yml`) и снимает старый service worker.

---

## 3.1. Push-уведомления

Рассылает `scripts/push/send.mjs`, его каждые 15 минут запускает GitHub Actions
(`.github/workflows/push-reminders.yml`; репозиторий публичный — минуты бесплатные,
cron-места Cloudflare не тратятся). Что приходит: задачи/комментарии/сердечки от
партнёра, «посмотрели — оцени» из Мурмура, утренняя сводка (задачи, просрочки,
платежи), «через час дедлайн», вечернее «как прошёл день?». Каждый включает и
настраивает у себя: Профиль → «Уведомления на телефон». На iPhone — только в
приложении, добавленном на экран «Домой» (iOS 16.4+).

**Однократная настройка (нужен сервисный ключ Firebase):**
1. Консоль Firebase → ⚙ Project settings → Service accounts → **Generate new private key**
   — скачается JSON.
2. В терминале (нужен `gh`, залогиненный в GitHub):
   ```bash
   cd scripts/push && npm install && node setup.mjs ~/Downloads/<скачанный-файл>.json
   ```
   Скрипт создаст ключи подписи уведомлений, запишет публичный в Firestore
   (`pushConfig/vapid`), а сервисный и секретный ключи — в секреты репозитория.
3. Удали скачанный JSON из «Загрузок».
4. Проверка: GitHub → Actions → Push reminders → Run workflow (галочка «dry run» —
   покажет в логе, что отправилось бы, без отправки).
## 3.2. Постеры в Мурмуре (TMDB и RAWG)

Пока пишешь название в Мурмуре, ниже появляются варианты с постером, годом и
описанием. Поиск идёт через воркер (`/api/media`, `worker/media.js`), ключи хранятся
только в секретах воркера и пускают лишь ваши два аккаунта. Без ключей всё работает
как раньше — просто без подсказок.

**Фильмы и сериалы — TMDB (бесплатно):**
1. Зарегистрируйся на https://www.themoviedb.org/signup и подтверди почту.
2. Профиль → Settings → **API** → Create → тип «Developer», назначение — личное
   некоммерческое приложение (название, описание: «семейный список фильмов»,
   сайт: адрес приложения).
3. На странице API скопируй **API Read Access Token** (длинная строка, начинается с `eyJ`).
4. Дашборд Cloudflare → Workers & Pages → `lovetasktracker` → Settings →
   **Variables and Secrets** → Add → тип **Secret**, имя `TMDB_TOKEN`, значение —
   этот токен → Deploy. (Или в терминале: `npx wrangler secret put TMDB_TOKEN`.)

**Игры — RAWG (бесплатно, 20 000 запросов в месяц):**
1. Зарегистрируйся на https://rawg.io/apidocs → Get API Key.
2. Скопируй ключ и добавь его так же: секрет `RAWG_KEY`.

Секреты подхватываются сразу, пересобирать приложение не нужно.

## 4. Установка на iPhone (как приложение)

1. Открыть адрес приложения в **Safari**.
2. Кнопка «Поделиться» → **«На экран Домой»**.
3. Появится иконка-кнопка; запускается в полноэкранном режиме без адресной строки.

То же самое работает на Android через Chrome («Установить приложение»).

### Расширение Chrome

Быстрые задачи прямо из браузера: кнопка на панели, ⌘⇧Y и правый клик по
тексту / ссылке / странице. Настройка и установка — в
[extension/README.md](extension/README.md).

---

## 5. Структура

```
src/
  App.jsx              вход, вкладки, управление темой
  firebase.js          инициализация Firebase
  firebaseConfig.js    ключи проекта (общие с расширением)
  config.js            два пользователя (whitelist)
  theme.css            две темы + переменные
  styles.css           стили интерфейса
  lib/
    db.js              работа с Firestore (задачи, события, комментарии, ревью)
    taskDoc.js         форма документа задачи (общая с расширением)
    recurrence.js      пересчёт повторений
    util.js            даты, квадранты, хелперы статистики
  components/
    TasksView.jsx      список + фильтры
    TaskCard.jsx       карточка задачи
    TaskModal.jsx      форма создания/редактирования + комментарии + ревью
    MatrixView.jsx     координатная матрица
    CalendarView.jsx   месячный календарь
    ProfileView.jsx    статистика + темы + аватары
    Avatar.jsx         сова / гусь
    Mood.jsx           трекер настроения (легенды, календарь, виджет дня)
    MurmurView.jsx     «Мурмур»: фильмы / сериалы / игры с оценками
    BudgetView.jsx     бюджет-планнер
public/
  manifest.webmanifest, sw.js, иконки   PWA
extension/             расширение Chrome (npm run ext:build → extension/dist)
firestore.rules        правила доступа (вставить в Firebase)
```

---

## Важно после обновления

**Чтения Firestore.** Бесплатный тариф — 50 000 чтений в сутки, а подписка при
холодном старте читает все свои документы. Поэтому живьём грузится только свежее:
активные задачи + закрытые с начала недели, «хотим» + просмотренное за 45 дней,
настроение за сегодня (календарь — только видимые 6 недель), события — только
видимый месяц, в бюджете — операции открытого месяца и запланированные.
Архивы (фильтр «Закрытые», «Посмотрели», «Все чеки», операции проекта) читаются
только когда их открывают. Остатки кошельков и итоги проектов — счётчики
(`balance`, `income`/`expense`), которые меняются тем же батчем, что и операция.

Новые разделы хранятся в новых коллекциях Firestore (`moods`, `moodLegends`,
`murmur`, `wallets`, `budgetTx`, `budgetProjects`, `receipts`, `receiptImages`).
**Перед деплоем вставь обновлённый `firestore.rules` в консоль Firebase
(Firestore → Rules) и опубликуй**, иначе эти разделы будут пустыми с ошибкой доступа.

Фото чеков хранятся сжатыми прямо в Firestore (≈100–300 КБ на чек), без Firebase
Storage — он на новых проектах требует платный тариф Blaze.

Ярлыки PWA (долгое нажатие на иконку на Android): «Сегодня», «Бюджет», «Мурмур».
Прямые ссылки: `?tab=tasks&view=today`, `?tab=budget`, `?tab=murmur`.

---

## Что упрощено в этом драфте (по ТЗ, доработаем дальше)
- Повторения — простой пересчёт даты (день/неделя/месяц).
- Матрица — позиция задаётся слайдерами (перетаскивание точки добавим позже).
- Календарь — только месячный вид.
- Push-уведомлений пока нет.
