# Verified update 2.1.1 — 2026-10-30

Only generated audio and synthetic test databases were used. No personal recordings or backups were inspected.

- Node: 40 tests, plus JavaScript syntax checks.
- Python local pipeline: 6 tests, including strict source/timing validation, missing translations, exact source expressions and both classic/extensible PCM headers.
- Safari storage: 14/14, including v1/v2/v3 migration, audio/metadata retention and learning/EFP roundtrip.
- Safari learning/native audio: 12/12, including seek/highlight, last-sentence repeat without queue advance, loop, pause, RU search/edit, cached phrase saving, known filtering and normal end after a drill.
- Manual Safari: generated spoken WAV and exact-hash transcript import; actual Mac AI result import; manual correction of one awkward Russian sentence; saved check-in expression; reload and playback with the HTTP server stopped (connection refusal verified); text and saved phrase retained.
- Explicit PWA updates retained the synthetic library. Database name, origin, PWA id and scope are unchanged; DB v4 adds a separate learning store. Old EFP v1/v2 remain readable, new v3 includes learning.
- Local Mac: WAV full pipeline; M4A conversion/ASR. 9.484 seconds of speech, 3 segments, 13 phrase/word entries, 7.297 seconds measured with warmed tools. The result passed the real Player importer/hash validator. Translation quality still needs review.
- Safari on this Mac returned no confirmed local en-US speech voice; the fallback message was verified. Actual synthesized voice playback is NOT TESTED.

Physical iPhone: NOT TESTED. Still verify installation/update of the user's real PWA, Files import, persistence after closing, airplane-mode use, selection/keyboard, AirPods, background/locked-screen playback and sentence timers. Long/noisy recordings and arbitrary codecs are NOT TESTED. Tests do not establish perfect ASR/translation accuracy.

## Historical 2.0.3 baseline (previous testing)

# Проверки English Flow Player 2.0.3

Только специально созданные синтетические WAV, тестовые метаданные и `.efp`. Личные аудио и резервные копии не использовались. Файлы QA находятся вне репозитория. Тестовые страницы не отправляют аудио на сервер.

## Автоматические проверки

- `npm test`: 29 тестов. Исходные проверки файлов/архивов/SW и новые сценарии A/B/C/D/H/I/J/K/L: 15 записей и две папки, смешанные назначения, все шесть сортировок, независимый приоритет/закрепление, 89/90% покрытия и повтор прохода, пропущенные участки, 2× по времени содержимого, 1/2/3/∞, старт с четвёртого, история, Play Next, удаление/ошибки очереди, детерминированный shuffle, старый/новый `.efp`, перевод и направление жестов.
- `npm run check`: синтаксис приложения, хранилища, резервных копий, SW и новых модулей.
- `browser-tests.html`: 12 тестов реальной IndexedDB, включая v1→v3 и v2→v3, сохранение Blob/метаданных, атомарность операций, повторное открытие, поздние записи после удаления/смены прохода, старые связи, новые поля и file-backed архив после сохранения Blob в IndexedDB.
- `media-tests.html`: 4 проверки реального HTMLAudio на синтетическом WAV: Play не начисляет, 2× и 90% начисляют один раз, ended/восстановление прохода не удваивают, перемотка к 95% не даёт ложного зачёта.

## Выполненные сценарии интерфейса на Mac

A/B. Safari: выбор 15 записей → две папки → выход; прежние смешанные назначения сохраняются. Автоматически проверены снятие всех связей, отсутствие дублей Blob и удаление папки без аудио.

C/J. Safari: звезда не меняет порядок; закрепление перемещает в верхний блок; Play/Pause и счётчики не переставляют карточки. Шесть сортировок дополнительно проверены в Node.

D. Chrome: долгое нажатие выбирает одну запись, Play не запускается; свайпы в обе стороны показывают правильные действия, касание снаружи закрывает без открытия записи; удаление показывает подтверждение количества, отмена сохраняет запись. Классификация вертикального/горизонтального/краевого движения проверена отдельно. Физические touch-жесты iPhone не проверены.

E. Safari: перемотка из мини-плеера меняет реальное время 0:22/0:44 без открытия полного; Play/Pause отдельно. Chrome: мобильная компоновка 390×844 CSS px. Это iframe, не эмуляция iOS.

F. Chrome: панель закрывается движением ручки вниз и касанием снаружи. Отмена предупреждения оставляет несохранённое название. Escape закрывает только вложенный редактор, возвращая фокус в меню. Касание/редактирование внутри не закрывает панель.

G/H. Safari: Save сохраняет многострочную заметку и сворачивает редактор за одно нажатие; повторное открытие и перезагрузка сохраняют текст. RU→EN не прерывает воспроизведение, язык сохраняется, пользовательский текст остаётся прежним.

I/K. Node/IndexedDB/native HTMLAudio: покрытие, сохранённый проход, скорость, очередь и повторы. Это реальные тесты отдельных компонентов; длительные фоновые последовательности на iPhone не проверены.

L. Safari: импорт старого синтетического `.efp` после обновления; восстановленный WAV проигрывается после чтения из IndexedDB. Обнаружена и исправлена потеря смещения File.slice при сохранении аудио из архива в Safari. Совместимость полей и точных байтов нового формата проверена автоматически.

M. Safari: обновление старой опубликованной оболочки в локальной копии через кнопку сохраняет записи, папку, заметку, позиции, исторические счётчики и приоритет. Chrome и Safari: сервер полностью остановлен, повторный запуск и воспроизведение WAV работают из кэша/IndexedDB. Механизм обновления не очищает базу. Принудительной перезагрузки во время воспроизведения/редактирования нет.

## Физический iPhone — NOT TESTED для обновления 2.0.3

Пользователь ранее подтвердил базовую работу первой опубликованной версии. Это не считается проверкой нового обновления.

- Получение 2.0.3 установленной PWA без удаления данных; перенос реальной библиотеки.
- Touch-свайпы, долгое нажатие, прокрутка и системный жест от края.
- Клавиатура: одно нажатие Save, длинная заметка, поворот экрана, доступность поля и кнопки над клавиатурой.
- Фон, блокировка, AirPods, переходы между файлами, точность покрытия при фоновых ограничениях.
- Импорт MP3/M4A/WAV из «Файлов»/iCloud, большие файлы и недостаток места.
- Авиарежим, закрытие/повторный запуск, перемотка и сохранение позиции.
- Экспорт/восстановление новой `.efp` через «Файлы» на iPhone.
- Локальное AI-распознавание: не подключено, NOT TESTED.

Отдельная резервная копия полезна, но не требовалась для начала миграции и разработки. Не очищайте данные сайта и не переустанавливайте PWA ради обычного обновления.
