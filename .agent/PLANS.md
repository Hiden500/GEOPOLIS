# ExecPlans

ExecPlan — живой execution contract для работы, которую нельзя надёжно удержать
в коротком списке шагов.

## Когда обязателен

- cross-module feature или изменение shared contract;
- data/schema/save migration;
- существенный refactor или архитектурное решение;
- security-sensitive, long-running или multi-agent работа;
- изменение с нетривиальным rollback/compatibility риском;
- задача, которую нужно продолжать через несколько сессий.

Для маленького локального reversible fix достаточно краткого рабочего плана.
Не создавай отдельный план как журнал каждого коммита.

## Расположение и ownership

Активные планы: `.agent/plans/<task>.md`. Один owner отвечает за итоговую
согласованность. Субагенты могут обновлять только назначенные непересекающиеся
разделы/файлы. После влития ветки план УДАЛЯЕТСЯ в интеграционном коммите:
его итог обязан жить датированной записью в `docs/DECISIONS.md` и
git-историей, не файлом плана. Оставить файл можно, только пока на него
ссылается живой код или документ. (Аудит 2026-08-01: 27 завершённых
планов-сирот накопились потому, что «либо удаляется» читалось как «можно
оставить».)

## Обязательная структура

```markdown
# <Название>
Status: proposed | active | blocked | complete
Owner: <agent/human>
Starting commit: <sha>

## Objective and observable outcome
## Scope and constraints
## Assumptions and unknowns
## Alternatives and selected decision
## Progress
- [ ] шаг с observable result
## Discoveries
## Decision log
## Validation
## Rollback / containment
## Final outcome
```

План должен быть самодостаточным: команды содержат cwd, критерии — наблюдаемый
результат, а `UNKNOWN` не маскируется как решение.

## Lifecycle

1. До правок зафиксировать starting commit, dirty state, baseline и ограничения.
2. Выбрать минимальный scope и перечислить intentionally excluded work.
3. После каждого значимого этапа обновить progress/discoveries/decisions.
4. При новом конфликте сначала проверить код, историю и domain docs. Если он
   меняет продуктовую семантику — остановиться для решения пользователя.
5. Validation начинать с targeted checks, затем расширять по риску.
6. В `Final outcome` перечислить изменённое, доказательства, baseline failures,
   unresolved risks и fresh-session requirements.
7. Не помечать `complete`, пока обязательные acceptance criteria не выполнены.

## Rollback

Rollback описывает конкретные обратимые единицы: файлы/commit/config flag/data
backup. Не предлагай destructive `git reset --hard`. При чужом dirty worktree
откатывай только собственный patch или проси владельца о координации.
