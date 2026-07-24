# Лог действий — Iraq/Kirkuk seam (без skill)

Формат: факты о том, что реально прочитано/выполнено, в порядке
выполнения. Полный разбор и рекомендация — `response.md` рядом.

## Итоговая рекомендация (кратко, для лога)

Рекомендован **gap-first `absorb_slivers`** (`scripts/map/build/
geometry_cleanup.py`, новый вызов из `build_asia_1946.py::main()` по
образцу уже существующего `absorb_middle_east_slivers`), **явно НЕ
`buffer()`**. Причина — не абстрактное предпочтение "gap-first лучше в
теории", а задокументированная в этом же репозитории история: buffer уже
был основным методом дозаполнения зазоров на этой карте и был полностью
заменён 2026-07-19 (коммит `af0ca49`, `docs/DECISIONS.md` запись
`2026-07-19-e`) после трёх реальных, а не гипотетических багов: видимый
артефакт формы шва от `join_style` ("пипка" на Газе), ручная подгонка
порогового радиуса под конкретный стык, и раздувание полигона во все
стороны с новыми наложениями на третьих соседей (Иордания наехала на
Ирак/Сирию, Беэр-Шева — на залив Акаба).

## Контекст worktree/веток (важно для оценки достоверности находок)

- Рабочее дерево этой задачи (ветка `worktree-agent-a664fae302303fa0d`,
  от `main` @ `a2b9768`) НЕ содержит разбиения Kirkuk вообще —
  `scripts/map/build/geometry_cleanup.py` там не существует;
  `grep -ri kirkuk` по `scripts/map/` и `server/data/scenarios/1946/` —
  0 совпадений.
- Разбиение Kirkuk (коммит `d8236d7`, "carve Kirkuk out of Iraq") и весь
  gap-first движок (`af0ca49` и последующие ~30 коммитов) живут на ветке
  `claude/1946-map-geometry-cleanup` (подтверждено `git branch -a
  --contains d8236d7`), выписанной в отдельный worktree
  (`.claude/worktrees/capital-region-fix`, HEAD `22b1a87`, в
  `git worktree list` не отмечен как заблокированный на момент проверки).
  Эта ветка — потомок `codex/1946-country-borders`
  (`git merge-base --is-ancestor codex/1946-country-borders
  claude/1946-map-geometry-cleanup` → true).
- Все находки ниже — из чтения файлов ЭТОЙ ветки: либо напрямую через
  файлы её worktree (`Read`/`Grep` по абсолютному пути
  `.claude/worktrees/capital-region-fix/...`), либо через
  `git show <SHA>:<path>` (чтение из git object database без переключения
  веток). Этот и тот worktree не переключались, не мержились и не
  редактировались — только читались.

## Что прочитано (в порядке, в котором это вело к выводу)

1. `git log --all --oneline -i --grep="kirkuk"` → нашёл `d8236d7`.
2. `git log --all --oneline -i --grep="gap|sliver|seam|шов|зазор"` →
   вся история gap-first движка, включая `af0ca49` ("replace buffer-based
   gap-filling with gap-first absorb_slivers").
3. `git show d8236d7` (сообщение коммита + stat) — как и почему вырезан
   Kirkuk (ZONED_GEOMETRIC-зона-синглтон вместо одного из 7 geometric-
   кластеров).
4. `git show af0ca49` (сообщение + diff `docs/DECISIONS.md`,
   `scripts/map/README.md`) — обоснование замены buffer → gap-first,
   3 задокументированных дефекта buffer, до/после в README.
5. `build_asia_1946.py` на ветке `claude/1946-map-geometry-cleanup`:
   `ZONED_GEOMETRIC["IQ"]` (targets Iraq:6/Kurdistan:3/Kirkuk:1),
   `NAME_OVERRIDES_1946["IRQ-3049"]="Kirkuk"`, специальный проход,
   помечающий `region_field="Kirkuk"` перед `geometric_merge_by_zone`,
   `absorb_middle_east_slivers()` (`MUTABLE_ISO={"PS","JO","SY","LB"}` —
   Iraq туда НЕ входит, участвует только как context), порядок вызовов в
   `main()`, код `reduce_clusters()`/`geometric_merge_by_zone()`
   (в частности ранний `return` при `len(clusters) <= target` — без
   `unary_union`).
6. `geometry_cleanup.py` на той же ветке — полный код `absorb_slivers`/
   `absorb_slivers_until_stable` и докстринг (защиты: `MAX_COMPACT_AREA`,
   `PROTECTED_HOLE_POINTS`, ribbon-исключение, отбрасывание ячеек по
   рамке clip_box).
7. `scripts/map/README.md` на той же ветке (полный чек-лист, пункты
   1-60) — особенно пп. 1, 3, 5, 8, 9, 11-13 (gap-first vs buffer,
   порядок клип→absorb, обязательность рендера поверх числовых проверок,
   постпроцессинг обязан жить в pipeline, кросс-континентальные швы —
   отдельный шаг) и раздел "## QA геометрии" в конце файла (ссылка на
   skill `map-geometry-qa`, который я НЕ вызывал — см. п. 12).
8. `diagnose_coastline_gaps.py` на той же ветке (докстринг + начало
   кода) — read-only render-диагностика (классы COASTLINE/LAND_HOLE/
   LAND_SEAM), рекомендован в response.md как инструмент подтверждения.
9. `docs/DECISIONS.md` на той же ветке (участок ~2000-2070, запись про
   West Bank + Kirkuk) — прямая цитата о том, как и почему вырезан
   Kirkuk, плюс отдельная более ранняя запись `2026-07-19-e` про сам
   переход buffer → gap-first (прочитана через diff `af0ca49`, см. п. 4).
10. `.agent/plans/west-bank-governorates-kirkuk-split.md` на той же
    ветке — ExecPlan исходной задачи; подтверждает, что рендер Iraq/
    Kirkuk уже проверялся при реализации и был отмечен чистым
    ("рендеры (Западный берег, Ирак/Киркук) чистые").
11. Побочно обнаружен (попался при `grep -ri kirkuk` по всей ветке, не
    искал целенаправленно) `.claude/skills/map-geometry-qa-workspace/
    iteration-1/kirkuk-iraq-seam/eval_metadata.json` — файл описывает
    именно этот сценарий как eval с 4 assertions: (а) рекомендовать
    gap-first `absorb_slivers`/`geometry_cleanup.py` как основной метод;
    (б) явно высказаться против `buffer()` с обоснованием, не просто
    предпочтением; (в) привязать рекомендацию к реальному механизму
    (`ZONED_GEOMETRIC`/`EXTRA_SINGLE_FEATURES` в `build_asia_1946.py`
    или конкретному существующему скрипту); (г) рекомендовать
    рендер-верификацию, а не только числовую. Прочитан для понимания
    структуры задачи (почему выходной путь называется `.../without_
    skill/outputs/...`). Он НЕ был источником самой рекомендации —
    к моменту, когда он попался при grep, разбор пп. 1-6 уже
    однозначно вёл к gap-first/против-buffer с конкретным механизмом
    Kirkuk; файл лишь подтвердил, что разбор идёт в нужном направлении.
    Также замечен путь `.claude/skills/map-geometry-qa/evals/evals.json`
    на той же ветке — содержимое НЕ читал (только увидел путь в выводе
    grep), чтобы не пользоваться готовым эталоном ответа вместо
    независимого разбора.
12. Сам skill `.claude/skills/map-geometry-qa/SKILL.md` на той ветке —
    НЕ читал. В доступном мне списке skills такого нет (Skill tool его
    не предлагает), и я сознательно не стал открывать его файл через
    Read, чтобы рекомендация была построена на первичных источниках
    (код, `docs/DECISIONS.md`, `README.md`, ExecPlan), а не на готовом
    пересказе из чужого skill-файла.

## Эмпирическая проверка (что реально выполнено, не только прочитано)

- В своём рабочем дереве проверил доступность инструментов: Python
  3.12.1, `shapely` 2.1.2, `pyproj` 3.7.2, `matplotlib` 3.11.1 — всё
  есть.
- `git show 22b1a87:client/public/world_1946.geojson` → сохранил в
  scratchpad (`world_1946_mgc.geojson`, 38 850 088 байт). Чтение через
  git plumbing — ни ветка, ни worktree `capital-region-fix` не
  затронуты.
- Скрипт `check_iraq_kirkuk_gap.py` (scratchpad): выделил 10 фич с
  `iso_a2=="IQ"`, посчитал `distance()`/`touches()`/`intersection()`
  между `Kirkuk` и каждой из 9 остальных, плюс локальный `polygonize` в
  bbox Kirkuk ± 0.3°. Результат: `touches=True, overlap_area=0.0` с
  тремя реальными соседями (Arbil, As-Sulaymaniyah, Sala ad-Din); с
  остальными Kirkuk не граничит вовсе (0.17°+); 7 ячеек в polygonize,
  0 непокрытых.
- Скрипты `render_kirkuk_seam.py` + `render_kirkuk_seam_zoom2.py`
  (scratchpad): matplotlib-рендер (`Path`/`PathPatch` по exterior и
  interiors, не голый `ax.fill`) Kirkuk + соседей — общий вид и
  прицельные зумы до ~0.02° (~1-2 км) в нескольких точках вдоль реальных
  общих границ (Kirkuk-Arbil, Kirkuk-Sala ad-Din). Визуально: ни одного
  шва/нахлёста, один чистый общий контур в каждой точке.
- Вывод, зафиксированный и в response.md: на этом коммите этой ветки
  видимого зазора между Kirkuk и его иракскими соседями нет — ни числом,
  ни рендером (до ~1-2 км). Это НЕ меняет рекомендацию метода (см. выше
  и response.md — метод обоснован независимо от того, нашёлся ли зазор
  именно в этом снимке), но означает, что перед тем как писать код
  фикса, зазор стоит заново подтвердить существующим диагностическим
  инструментом (`diagnose_coastline_gaps.py --render`) или точечным
  рендером на актуальном состоянии, а не считать его данностью по
  формулировке задачи.
- Ничего не изменено ни в одном рабочем дереве репозитория и ни в одной
  ветке — только чтение (`Read`/`Grep`/`git show`/`git log`) плюс файлы
  в scratchpad вне репозитория (`C:\Users\yurew\AppData\Local\Temp\
  claude\D--Pax-Historia-LOCAL\...\scratchpad\`).

## Baseline / что осталось непроверенным

- Полный pipeline (`make_1946.py`) не запускался — задача явно advisory,
  rebuild не требовался.
- Предложенный код (`absorb_iraq_zone_slivers`) не написан ни в один
  файл репозитория и не выполнен — в response.md он приведён только как
  иллюстрация подхода.
- `.claude/skills/map-geometry-qa/SKILL.md` и `.claude/skills/
  map-geometry-qa/evals/evals.json` на ветке `claude/1946-map-geometry-
  cleanup` не прочитаны целиком (см. п. 12) — если для дальнейшей работы
  понадобится их точное содержимое, это отдельный шаг для следующей
  сессии.
