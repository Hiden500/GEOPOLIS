"""Public, dependency-free regression checks for Geopolis agent configuration."""

from __future__ import annotations

import datetime as _dt
import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[3]
FAILURES: list[str] = []
PASSES: list[str] = []


def check(condition: bool, label: str, detail: str = "") -> None:
    if condition:
        PASSES.append(label)
    else:
        FAILURES.append(f"{label}: {detail}" if detail else label)


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_frontmatter(text: str) -> dict[str, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    try:
        end = lines.index("---", 1)
    except ValueError:
        return {}
    result: dict[str, str] = {}
    for line in lines[1:end]:
        if ":" in line:
            key, value = line.split(":", 1)
            result[key.strip()] = value.strip()
    return result


_FRONTMATTER_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*:(?: |$)")
_BLOCK_SCALARS = {"|", ">", "|-", ">-", "|+", ">+"}
# Индикаторы, с которых plain scalar в YAML начинаться не может.
_YAML_INDICATORS = "[]{}>|*&!%@`#,?"


def frontmatter_errors(text: str) -> list[str]:
    """Строки frontmatter, на которых настоящий YAML-парсер сломается.

    `parse_frontmatter` выше режет по первому двоеточию и потому «читает» даже
    невалидный блок. Claude Code разбирает эти же файлы полноценным YAML: у
    unquoted значения с `": "` внутри блок не парсится, и агент просто исчезает
    из списка, а у скилла описание молча подменяется заголовком H1 — без
    единой ошибки в логе. Проверяем именно то, что видит загрузчик.
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return ["нет открывающего ---"]
    try:
        end = lines.index("---", 1)
    except ValueError:
        return ["нет закрывающего ---"]
    errors: list[str] = []
    for line in lines[1:end]:
        if not line.strip() or line[:1].isspace() or line.lstrip().startswith("- "):
            continue  # продолжение блочного значения или элемент списка
        if not _FRONTMATTER_KEY.match(line):
            errors.append(f"не строка `key: value`: {line[:60]}")
            continue
        key, value = line.split(":", 1)
        key, value = key.strip(), value.strip()
        if not value or value in _BLOCK_SCALARS:
            continue
        quoted = len(value) > 1 and value[0] == value[-1] and value[0] in "\"'"
        if quoted:
            continue
        if ": " in value or value.endswith(":"):
            errors.append(f"незакавыченное двоеточие в `{key}`: {value[:60]}")
        elif value[0] in _YAML_INDICATORS:
            errors.append(f"незакавыченный YAML-индикатор в `{key}`: {value[:60]}")
    return errors


def validate_toml() -> None:
    config = tomllib.loads(read(".codex/config.toml"))
    check("model_verbosity" in config, "Codex model_verbosity is top-level")
    shell = config.get("shell_environment_policy", {})
    check(
        "model_verbosity" not in shell,
        "Codex model_verbosity is not nested in shell policy",
    )
    check(shell.get("inherit") == "core", "Codex shell environment is narrow")
    serialized = json.dumps(config, ensure_ascii=False).lower()
    check(
        "danger-full-access" not in serialized and '"never"' not in serialized,
        "Codex config has no broad sandbox/approval bypass",
    )
    repowise_args = config.get("mcp_servers", {}).get("repowise", {}).get("args", [])
    check(
        all("pax historia" not in str(value).lower() for value in repowise_args),
        "Codex Repowise config is checkout-portable",
    )

    agents = list((ROOT / ".codex/agents").glob("*.toml"))
    check(bool(agents), "At least one custom Codex agent exists")
    for path in agents:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
        check(bool(data.get("name")), f"{path.name} has a name")
        check(bool(data.get("description")), f"{path.name} has a description")
        check(
            data.get("sandbox_mode") == "read-only",
            f"{path.name} is read-only",
            f"sandbox_mode={data.get('sandbox_mode')!r}",
        )

    for path in (".mcp.json", ".gemini/settings.json", ".codex/hooks.json", ".claude/settings.json"):
        check(isinstance(load_json(ROOT / path), dict), f"JSON config parses: {path}")

    check((ROOT / "scripts/hooks/guard.mjs").is_file(), "Shared guard hook exists")
    for cfg in (".claude/settings.json", ".codex/hooks.json"):
        check(
            "scripts/hooks/guard.mjs" in read(cfg),
            f"Guard hook registered in {cfg}",
        )


def validate_living_docs() -> None:
    """Живые документы не растут без предела.

    Правило «TODO — только живой backlog, DECISIONS — только свежее плюс индекс»
    существует с 2026-07-11 и за три недели не выполнилось НИ РАЗУ: журнал вырос
    с ~560 до 6724 строк, потому что проверять его было некому, а само правило
    живёт в шапке файла, а не в своде. Порог здесь — не эстетика, а механизм:
    он превращает «когда вспомнится» в красный тест.

    Лечение при срабатывании — не поднять порог, а перенести старое:
    записи журнала уходят в `docs/decisions/<YYYY-MM>.md` дословно, завершённые
    пункты backlog удаляются (их история уже в журнале).
    """
    for path, limit in (("docs/DECISIONS.md", 2_000), ("docs/TODO.md", 1_400)):
        target = ROOT / path
        if not target.is_file():
            check(False, f"Living doc exists: {path}")
            continue
        lines = target.read_text(encoding="utf-8").count("\n") + 1
        check(lines <= limit, f"{path} stays under {limit} lines (now {lines})")

    # Штамп свежести «Last updated:» — одна короткая строка, не сводка сессии.
    #
    # Заведено 2026-08-01 по факту: лимит выше меряет СТРОКИ, и сводки сессий
    # переехали в однострочный штамп — мержи накопили в DECISIONS.md пять
    # штампов по ~38 000 символов (в TODO.md — 9 400, в POLITICS.md — 1 100),
    # файлы стали нечитаемы при зелёном пороге. Лимит строк без лимита длины
    # строки — ворота для Гудхарта; содержимое штампов дублировало обычные
    # записи журнала, то есть терялась только читаемость, не информация.
    # Архив/провенанс/bootstrap исключены: они фиксируют прошлое как есть.
    stamp_hits: list[str] = []
    for doc in sorted((ROOT / "docs").rglob("*.md")):
        rel = str(doc.relative_to(ROOT)).replace("\\", "/")
        if rel.startswith(("docs/decisions/", "docs/provenance/", "docs/agent/")):
            continue
        stamps = [
            (number, line)
            for number, line in enumerate(
                doc.read_text(encoding="utf-8", errors="replace").splitlines(), start=1
            )
            if line.startswith("Last updated:")
        ]
        if len(stamps) > 1:
            stamp_hits.append(f"{rel}: {len(stamps)} stamps (expected 1)")
        for number, line in stamps:
            if len(line) > 300:
                stamp_hits.append(f"{rel}:{number} ({len(line)} chars)")
    check(
        not stamp_hits,
        "Last updated stamps are single and short (<=300 chars)",
        "; ".join(stamp_hits[:5]),
    )


def validate_no_conflict_markers() -> None:
    """Неразрешённые маркеры конфликта в отслеживаемых текстовых файлах.

    Заведено 2026-07-31 по факту: в `main` три часа пролежал `docs/DECISIONS.md`
    с четырьмя маркерами и продублированной записью. Мерж сообщил о конфликте,
    но сообщение потерялось в обрезанном выводе, а `git add -A docs` внёс файл
    как есть — ни один тест такого не видит, потому что для кода маркеры лежали
    в документации, а для документации их никто не читал.

    Проверка дешёвая и абсолютная: `<<<<<<< `, `>>>>>>> ` и одинокий `=======`
    в начале строки не встречаются в осмысленном тексте проекта. Исключение —
    сам этот файл, где они записаны как данные.
    """
    markers = ("<<<<<<< ", ">>>>>>> ")
    suffixes = {".md", ".ts", ".tsx", ".js", ".json", ".py", ".yml", ".yaml"}
    hits: list[str] = []

    for candidate in ROOT.rglob("*"):
        if not candidate.is_file() or candidate.suffix not in suffixes:
            continue
        if any(part in SKIP_TREE_DIRS for part in candidate.parts):
            continue
        if candidate.resolve() == Path(__file__).resolve():
            continue
        try:
            text = candidate.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            if line.startswith(markers) or line.rstrip() == "=======":
                hits.append(f"{candidate.relative_to(ROOT)}:{number}")
                break

    check(
        not hits,
        "no unresolved merge conflict markers"
        + (f" (found in {', '.join(hits[:5])})" if hits else ""),
    )


CODE_SUFFIXES = (".ts", ".tsx", ".py")


def _repo_code_files() -> set[str]:
    """Все файлы кода репозитория, путями от корня, через индекс git.

    ПОЧЕМУ НЕ СПИСОК КОРНЕЙ. Раньше множество собиралось обходом пяти каталогов
    (`server/src`, `client/src`, `shared/src`, `scripts`, `.agent`), и корень,
    заведённый позже, в него не попадал: на 2026-08-03 в списке не было
    `server/scripts`, поэтому `runCampaignWithLLM.ts` и `probeMigratedVerbs.ts`
    для проверки НЕ СУЩЕСТВОВАЛИ. Пока ссылки на них писались с путём, их
    спасала проверка «файл есть на диске», и дефект был не виден.

    ПОЧЕМУ НЕ ОБХОД ДЕРЕВА. `ROOT.rglob("*")` зашёл бы в `node_modules`, а в
    linked worktree там лежат junction на пакеты главного checkout
    (`scripts/worktree-new.ps1`) — обход пошёл бы по ссылкам наружу и стоил бы
    минуты. Индекс git знает ровно содержимое репозитория и ничего сверх него.

    Untracked-файлы добавлены отдельным вызовом: только что созданный и ещё не
    закоммиченный файл — законная цель ссылки из документа той же правки.

    Если git недоступен, проверка не падает и не молчит: возвращается прежнее
    множество по корням — уже, но честнее, чем пустое.
    """
    files: set[str] = set()
    for args in (["ls-files"], ["ls-files", "--others", "--exclude-standard"]):
        try:
            out = subprocess.run(
                ["git", *args],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=True,
            ).stdout
        except (OSError, subprocess.CalledProcessError):
            # Упал второй вызов (untracked), а первый дал индекс — отдаём его:
            # он и есть основная часть. Пустой результат заменяем обходом корней.
            if files:
                return files
            return {
                str(p.relative_to(ROOT)).replace("\\", "/")
                for base in ("server/src", "client/src", "shared/src", "scripts", ".agent")
                if (ROOT / base).is_dir()
                for p in (ROOT / base).rglob("*")
                if p.is_file() and p.suffix in CODE_SUFFIXES
            }
        files.update(f for f in out.splitlines() if f.endswith(CODE_SUFFIXES))
    return files


def validate_rot() -> None:
    """Гниение документации: ссылки на код, которого нет, и просроченные срезы.

    Проверяется РАСПАД, а не поломка. Половина находок аудита 2026-07-30 — этот
    класс: документ обещает расширять тест, документ называет «мёртвым кодом»
    функции, которых никогда не существовало, раздел помечен «актуально на» и с
    тех пор не пересматривался. Такие расхождения не роняют ни один тест и живут
    месяцами, искажая оценку трудоёмкости следующей задачи.

    Пути к ДАННЫМ намеренно не проверяются: слой сценария бывает не наполнен, и
    это штатное состояние (`diplomacy.json` на 2026-07-30).
    """
    code_ref = re.compile(r"`([\w./-]+\.(?:ts|tsx|py))`")
    # Документы часто пишут путь сокращённо («commands/economy.ts» вместо
    # «server/src/commands/economy.ts»), и это законный стиль. Поэтому ссылка
    # засчитана, если ей соответствует ХОТЬ ОДИН реальный файл по окончанию
    # пути; ловим только те, которым не соответствует ничего.
    existing = _repo_code_files()
    # Голое имя без пути («LLMResponseValidator.ts») — тот же вид ссылки, и
    # проверяется по basename. До 2026-08-03 такие пропускались вовсе, и
    # удаление файла оставляло их жить: интеграция ветки `actions-to-primitives`
    # нашла ШЕСТЬ упоминаний удалённого `LLMResponseValidator.ts` в живых
    # нормативных документах (`LLM_RULES.md`, `AI_RULES.md`, `WAR.md`,
    # `TECH_TREE.md`, `PRIMITIVES.md`, `plans/13`) — все пережили удаление,
    # потому что проверять их было некому.
    existing_names = {full.rsplit("/", 1)[-1] for full in existing}
    missing: list[str] = []
    for doc in sorted((ROOT / "docs").rglob("*.md")):
        # Архив и провенанс фиксируют ПРОШЛОЕ состояние: путь, верный на момент
        # записи, там законно расходится с сегодняшним деревом.
        rel = str(doc.relative_to(ROOT)).replace("\\", "/")
        if rel.startswith(("docs/decisions/", "docs/provenance/", "docs/agent/")):
            continue
        text = doc.read_text(encoding="utf-8", errors="replace")
        for line in text.splitlines():
            for ref in set(code_ref.findall(line)):
                if ref.startswith(("http", "<")):
                    continue
                if "*" in ref or "…" in ref:
                    continue
                if (ROOT / ref).exists():
                    continue
                if "/" in ref:
                    if any(full.endswith("/" + ref) for full in existing):
                        continue
                elif ref in existing_names:
                    continue
                # Документ, который САМ сообщает об исчезновении файла, не гниёт:
                # «удалён целиком», «заменяет X», «X → новая шапка» — это история
                # и планы замены, а не ссылка на несуществующее.
                lowered = line.lower()
                # Плюс планы: файл, который предлагается СОЗДАТЬ, ещё не обязан
                # существовать — иначе проверка запретила бы планировать.
                markers = (
                    "удал", "заменя", "→", "устарел", "не существов",
                    "создать", "предлаг", "планир",
                )
                if any(m in lowered for m in markers):
                    continue
                missing.append(f"{doc.relative_to(ROOT)} -> {ref}")
    # Счётчик в детали, а не только первая пятёрка: без него «показано 5» и
    # «найдено 5» неразличимы, и объём уборки виден только после правки первых.
    check(
        not missing,
        "docs reference only existing code files",
        (f"{len(missing)} шт., первые: " + "; ".join(sorted(missing)[:5])) if missing else "",
    )

    # Адрес `файл.ts:123`, указывающий за конец файла. Заведено 2026-08-09 по
    # четырём случаям одного дня: карта разделов `docs/TODO.md` разошлась на
    # девять строк в момент отправки (влилась чужая ветка); вердикт домена
    # называл `GeminiProvider.ts:235`, где конвертация на 200 — оба числа были
    # верны в СВОИХ деревьях; `diagnose_seas_iho.py:216-219` описывал ловушку,
    # и ловушка всё равно сработала.
    #
    # Проверяется только выход ЗА КОНЕЦ файла, а не «та ли там строка»: второе
    # без исполнения не установить, а первое — грубая, но честная граница.
    # Ссылка на строку живёт дольше правки соседнего файла, поэтому устойчивый
    # адрес — заголовок раздела или имя символа, а номер строки — расходник.
    line_ref = re.compile(r"`([\w./-]+\.(?:ts|tsx|py|mjs|json|md)):(\d+)")
    overshoot: list[str] = []
    for doc in sorted((ROOT / "docs").rglob("*.md")):
        rel = str(doc.relative_to(ROOT)).replace("\\", "/")
        if rel.startswith(("docs/decisions/", "docs/provenance/", "docs/agent/")):
            continue
        for ref, num in set(line_ref.findall(doc.read_text(encoding="utf-8", errors="replace"))):
            target = ROOT / ref
            if not target.is_file():
                matches = [f for f in _repo_code_files() if f.endswith("/" + ref)]
                if len(matches) != 1:
                    continue  # неоднозначный или несуществующий путь ловит проверка выше
                target = ROOT / matches[0]
            total = target.read_text(encoding="utf-8", errors="replace").count("\n") + 1
            if int(num) > total:
                overshoot.append(f"{doc.relative_to(ROOT)} -> {ref}:{num} (в файле {total})")
    check(
        not overshoot,
        "docs line references stay inside their file",
        (f"{len(overshoot)} шт., первые: " + "; ".join(sorted(overshoot)[:5])) if overshoot else "",
    )

    stale_marker = re.compile(r"актуально на (\d{4})-(\d{2})-(\d{2})")
    today = _dt.date.today()
    stale: list[str] = []
    for doc in sorted((ROOT / "docs").rglob("*.md")):
        text = doc.read_text(encoding="utf-8", errors="replace")
        for year, month, day in stale_marker.findall(text):
            marked = _dt.date(int(year), int(month), int(day))
            age = (today - marked).days
            if age > 90:
                stale.append(f"{doc.relative_to(ROOT)} ({age} дней)")
    check(not stale, "no snapshot older than 90 days", "; ".join(sorted(stale)[:5]))


def validate_audit_freshness() -> None:
    """Область, которую давно не смотрели, называет тест, а не пользователь.

    Правило чистки живых документов существовало три недели и не выполнилось ни
    разу: напоминать было некому. Здесь тот же механизм для аудитов — срок жизни
    у каждой области свой, потому что формулы гниют быстрее лицензий.

    Красный тест лечится не поднятием срока, а прогоном скилла `project-health`
    и записью результата в реестр.
    """
    registry_path = ROOT / ".agent/audits/registry.json"
    if not registry_path.is_file():
        check(False, "Audit registry exists")
        return

    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    areas = registry.get("areas", [])
    check(bool(areas), "Audit registry lists areas")

    today = _dt.date.today()
    for area in areas:
        title = area.get("id", "?")
        report = area.get("report", "")
        if report and "#" not in report:
            check((ROOT / report).exists(), f"audit report exists: {title}")
        try:
            last = _dt.date.fromisoformat(area["lastAudited"])
        except (KeyError, ValueError):
            check(False, f"audit date is parseable: {title}")
            continue
        age = (today - last).days
        limit = int(area.get("maxAgeDays", 60))
        check(age <= limit, f"audit fresh: {title} ({age}d / {limit}d)")


def normalized_size(path: Path) -> int:
    """Размер файла в байтах ПО СОДЕРЖИМОМУ, с окончаниями строк как в git (LF).

    Заведено 2026-07-31 по факту расхождения: `core.autocrlf=true` выгружает
    файлы с CRLF, и `AGENTS.md` весил 16 328 байт в репозитории и 16 526 на
    диске. Один и тот же коммит был зелёным в linked worktree, куда файл попал
    с LF, и красным в основном checkout — то есть проверка мерила настройку
    git пользователя, а не текст правил.
    """
    raw = path.read_bytes()
    return len(raw.replace(b"\r\n", b"\n"))


def validate_instructions_and_skills() -> None:
    root_agents = ROOT / "AGENTS.md"
    check(normalized_size(root_agents) <= 16_384, "Root AGENTS.md stays under 16 KiB")
    for module in ("client", "server", "shared", "scripts/map"):
        scoped = f"{module}/AGENTS.md"
        check((ROOT / scoped).is_file(), f"Scoped instruction exists: {scoped}")

        # Claude Code грузит вложенные CLAUDE.md по требованию, но НЕ AGENTS.md.
        # Без этого моста правила модуля зависели от памяти модели: замер по
        # 8 сессиям дал одно чтение на восемь сессий. Мост молча исчезает при
        # рефакторинге каталога — видно только здесь.
        bridge = ROOT / module / "CLAUDE.md"
        check(bridge.is_file(), f"Claude bridge exists: {module}/CLAUDE.md")
        if bridge.is_file():
            check(
                "@AGENTS.md" in bridge.read_text(encoding="utf-8"),
                f"Claude bridge imports scoped rules: {module}/CLAUDE.md",
            )

        # Потолок: обязательное-до-правки не должно снова разрастись в архив.
        # scripts/map/AGENTS.md весил 31 945 байт и не читался вовсе; разборы
        # инцидентов вынесены в скилл map-pipeline-reference.
        check(
            normalized_size(ROOT / scoped) <= 18_432,
            f"Scoped instruction stays under 18 KiB: {scoped}",
        )

    active = read("AGENTS.md") + "\n" + read(".gemini/GEMINI.md")
    for forbidden in (
        "git checkout main && git pull",
        "shared/types/",
        "порт 3001",
    ):
        check(forbidden not in active, f"Active instructions omit stale claim: {forbidden}")

    names: list[str] = []
    required_sections = (
        "## Trigger",
        "## Do not trigger",
        "## Required inputs",
        "## Workflow",
        "## Verification and failure conditions",
        "## Output",
    )
    skill_paths = sorted((ROOT / ".agents/skills").glob("*/SKILL.md"))
    check(bool(skill_paths), "Repository-local skills exist")
    for path in skill_paths:
        text = path.read_text(encoding="utf-8")
        meta = parse_frontmatter(text)
        name = meta.get("name", "")
        names.append(name)
        check(name == path.parent.name, f"Skill name matches folder: {path.parent.name}")
        check(bool(meta.get("description")), f"Skill has description: {path.parent.name}")
        for section in required_sections:
            check(section in text, f"{path.parent.name} defines {section[3:]}")
        metadata = path.parent / "agents/openai.yaml"
        if metadata.exists():
            metadata_text = metadata.read_text(encoding="utf-8")
            for key in ("display_name:", "short_description:", "default_prompt:"):
                check(key in metadata_text, f"{path.parent.name} metadata defines {key[:-1]}")
    check(len(names) == len(set(names)), "Skill names are unique")

    check(
        (ROOT / ".claude/skills/verify-change/SKILL.md").is_file(),
        "Claude verify-change mirror exists",
    )
    for mirror_path in sorted((ROOT / ".claude/skills").glob("*/SKILL.md")):
        canonical_path = ROOT / ".agents/skills" / mirror_path.parent.name / "SKILL.md"
        if canonical_path.exists():
            check(
                canonical_path.read_text(encoding="utf-8")
                == mirror_path.read_text(encoding="utf-8"),
                f"Claude mirror matches canonical skill: {mirror_path.parent.name}",
            )

    agent_paths = sorted((ROOT / ".claude/agents").glob("*.md"))
    check(bool(agent_paths), "At least one custom Claude agent exists")
    for path in (
        *agent_paths,
        *skill_paths,
        *sorted((ROOT / ".claude/skills").glob("*/SKILL.md")),
    ):
        errors = frontmatter_errors(path.read_text(encoding="utf-8"))
        check(
            not errors,
            f"Frontmatter is loadable YAML: {path.relative_to(ROOT).as_posix()}",
            "; ".join(errors),
        )

    claude_reviewer = ROOT / ".claude/agents/ui-reviewer.md"
    check(claude_reviewer.is_file(), "Claude read-only UI reviewer exists")
    reviewer_text = claude_reviewer.read_text(encoding="utf-8")
    reviewer_meta = parse_frontmatter(reviewer_text)
    reviewer_tools = reviewer_meta.get("tools", "")
    check(
        all(tool not in reviewer_tools for tool in ("Edit", "Write", "Bash")),
        "Claude UI reviewer has no write tools",
    )
    check(
        not (ROOT / ".claude/agents/ui-designer.md").exists()
        and not (ROOT / ".codex/agents/ui-designer.toml").exists(),
        "Mixed reviewer/writer agent definitions are removed",
    )

    legacy_prompt = read("docs/agent/MASTER_PROMPT.md")
    check("HISTORICAL / SUPERSEDED" in legacy_prompt, "Legacy master prompt is historical")
    check(
        "при конфликте побеждает этот файл" not in legacy_prompt,
        "Legacy master prompt does not self-assign precedence",
    )


def validate_orchestrator_roles() -> None:
    """Роль оркестратора держится хуком, а хук молча деградирует.

    `role-guard.mjs` при отсутствии секции `## Якорь` в уставе не падает, а
    просто перестаёт напоминать роль: сессия внешне работает, но защита от
    сползания роли выключена. Такой отказ невидим в работе и виден только
    здесь. Проверяется проводка хука в обоих событиях и структура уставов.
    """
    check((ROOT / "scripts/hooks/role-guard.mjs").is_file(), "Role guard hook exists")
    check(
        (ROOT / "scripts/hooks/test-role-guard.mjs").is_file(),
        "Role guard hook has a live test",
    )

    settings = load_json(ROOT / ".claude/settings.json")
    hooks = settings.get("hooks", {}) if isinstance(settings, dict) else {}
    for event in ("PreToolUse", "UserPromptSubmit"):
        wired = json.dumps(hooks.get(event, []), ensure_ascii=False)
        check("role-guard.mjs" in wired, f"Role guard is wired into {event}")

    for path in (
        ".agent/roles/README.md",
        ".agent/orchestration/README.md",
        # На этот прогон ссылается якорь роли `lead`: пропавший скрипт делает
        # инструкцию невыполнимой, а роль — слепой к пересечениям веток.
        "scripts/worktree-report.mjs",
    ):
        check((ROOT / path).is_file(), f"Role infrastructure doc exists: {path}")

    # Статусы реестра — контракт между документом и регулярками хука.
    ledger_doc = read(".agent/orchestration/README.md")
    hook_source = read("scripts/hooks/role-guard.mjs")
    for status in ("выдано", "на аудите", "возвращено"):
        check(
            f"Статус:\\s*{status}" in hook_source or f"Статус:\\s*{status}\\s*$" in hook_source,
            f"Role guard counts ledger status: {status}",
        )
        check(status in ledger_doc, f"Ledger format documents status: {status}")

    required_sections = (
        "## Якорь",
        "## Область",
        "## Что решает сам, что несёт пользователю",
        "## Кому выдаёт задания",
        "## Приёмка",
        "## Типовые ловушки",
    )
    charters = sorted(
        p for p in (ROOT / ".agent/roles").glob("*.md") if p.name != "README.md"
    )
    check(bool(charters), "At least one role charter exists")
    roles_readme = read(".agent/roles/README.md")
    for path in charters:
        text = path.read_text(encoding="utf-8")
        name = path.stem
        # Роль, которой нет в таблице README, не находит ни пользователь, ни
        # соседняя сессия: `!роль` покажет её, но чем она отличается — нет.
        check(f"`{name}`" in roles_readme, f"Role {name} is listed in roles README")
        for section in required_sections:
            check(section in text, f"Role {name} defines {section[3:]}")
        if "## Якорь" not in text:
            continue  # уже провалено выше; мерить нечего
        anchor = text.split("## Якорь", 1)[1].split("\n## ", 1)[0].strip()
        check(bool(anchor), f"Role {name} anchor is not empty")
        # Якорь уходит в контекст КАЖДЫЙ ход: длинный якорь — постоянный
        # налог на сессию, поэтому порог держится жёстким.
        check(len(anchor) <= 900, f"Role {name} anchor stays compact ({len(anchor)} chars)")


def validate_session_guard() -> None:
    """Якорь сессии держится хуком, а хук молча деградирует.

    `session-guard.mjs` fail-open: при внутренней ошибке он не падает, а просто
    перестаёт возвращать якорь. Сессия после сжатия выглядит рабочей, но правило
    «после сжатия — session-handoff» снова живёт только текстом, который сжатие
    и съело. Такой отказ невидим в работе и виден только здесь.
    """
    hook = ROOT / "scripts/hooks/session-guard.mjs"
    check(hook.is_file(), "Session guard hook exists")
    check(
        (ROOT / "scripts/hooks/test-session-guard.mjs").is_file(),
        "Session guard hook has a live test",
    )

    settings = load_json(ROOT / ".claude/settings.json")
    hooks = settings.get("hooks", {}) if isinstance(settings, dict) else {}
    for event in ("PreCompact", "SessionStart"):
        wired = json.dumps(hooks.get(event, []), ensure_ascii=False)
        check("session-guard.mjs" in wired, f"Session guard is wired into {event}")

    source = hook.read_text(encoding="utf-8") if hook.is_file() else ""
    # Якорь обязан нести контракт проверок сам: после сжатия он неизвестен.
    for command in ("run_public_evals.py", "npx tsc --noEmit", "session-handoff"):
        check(command in source, f"Session anchor carries: {command}")
    # Негативный контроль хука: на обычном старте якорь не вставляется, иначе он
    # становится фоном, который перестают читать.
    check(
        '"compact"' in source and '"resume"' in source,
        "Session anchor is limited to compact/resume starts",
    )


def validate_experiment_layer() -> None:
    # CHARTER.proposed.md удалён аудитом 2026-08-01: провисел в статусе
    # PROPOSED без движения с 2026-07-23, а всё нормативное содержимое
    # дублировало AGENTS.md (12 правил, сверено построчно). Границы держит
    # AGENTS.md; проверки текста charter удалены вместе с файлом.
    required = (
        ".agent/PLANS.md",
        ".agent/EVOLUTION.md",
        ".agent/audits/baseline.md",
        ".agent/audits/agents-audit.md",
        ".agent/audits/docs-audit.md",
        ".agent/run-record.schema.json",
    )
    for path in required:
        check((ROOT / path).is_file(), f"Experiment artifact exists: {path}")

    schema = load_json(ROOT / ".agent/run-record.schema.json")
    required_keys = set(schema.get("required", [])) if isinstance(schema, dict) else set()
    records = sorted((ROOT / ".agent/runs").glob("*.json"))
    check(bool(records), "At least one machine-readable run record exists")
    for path in records:
        record = load_json(path)
        missing = sorted(required_keys - set(record)) if isinstance(record, dict) else ["object"]
        check(not missing, f"Run record matches required fields: {path.name}", str(missing))

    final_record_path = ROOT / ".agent/runs/bootstrap-final.json"
    check(final_record_path.is_file(), "Final bootstrap run record exists")
    if final_record_path.is_file():
        final_record = load_json(final_record_path)
        ending_commit = final_record.get("ending_commit", "") if isinstance(final_record, dict) else ""
        check(
            bool(re.fullmatch(r"[0-9a-f]{40}", ending_commit)),
            "Final run record pins a full implementation commit SHA",
        )

    plan = read(".agent/plans/bootstrap-global-audit.md")
    evolution = read(".agent/EVOLUTION.md")
    check("Status: complete" in plan, "Global audit ExecPlan is closed")
    check("Decision: `KEEP`" in evolution, "Evolution entry records final decision")


"""
Каталоги, которых проверки не касаются.

`.reference` — локальные клоны ЧУЖИХ репозиториев (разбор Open-Historia,
2026-07-30): они не отслеживаются git (`.git/info/exclude`), существуют
только в основном checkout и ломали проверку ссылок своими внутренними
ссылками. Проверка обязана оценивать этот проект, а не то, что лежит рядом
в рабочем каталоге.
"""
SKIP_TREE_DIRS = {".git", "node_modules", "dist", "build", ".vite", ".repowise", ".reference"}

LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


def validate_markdown_links() -> None:
    broken: list[str] = []
    for path in ROOT.rglob("*.md"):
        relative = path.relative_to(ROOT)
        if any(part in SKIP_TREE_DIRS for part in relative.parts) or (
            len(relative.parts) >= 2
            and relative.parts[0] == ".claude"
            and relative.parts[1] == "worktrees"
        ):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for raw in LINK_RE.findall(text):
            target = raw.strip().strip("<>").split("#", 1)[0]
            if not target or target.startswith(("http://", "https://", "mailto:", "app://", "data:")):
                continue
            target = unquote(target)
            candidate = Path(target)
            resolved = candidate if candidate.is_absolute() else path.parent / candidate
            if not resolved.exists():
                broken.append(f"{relative}: {raw}")
    check(not broken, "Local Markdown links resolve", "; ".join(broken[:10]))


def validate_documented_workflow() -> None:
    readme = read("README.md")
    for command in (
        "npm run lint",
        "npm run build",
        "npx tsc --noEmit -p tsconfig.app.json",
        "npx tsc --noEmit -p tsconfig.json",
    ):
        check(command in readme, f"README documents command: {command}")
    check("Клиентских тестов пока нет" not in readme, "README omits stale test claim")
    check("не имеет аутентификации" in readme, "README states local-only API boundary")
    todo = read("docs/TODO.md")
    check("План 08, Шаги 2-4" not in todo, "TODO omits completed War plan status")
    check(
        "домен **Claude**" not in read("docs/UI_DESIGN.md"),
        "Current UI docs avoid permanent provider ownership",
    )
    check(
        "docs/AGENTS.md" not in read("docs/plans/10_CURRENCY_ZONES.md"),
        "Currency-zone plan omits nonexistent instruction path",
    )
    obsolete_task = read("docs/tasks/REGION_ECONOMY_FILL.md")
    check("УСТАРЕЛО" in obsolete_task, "Obsolete region-economy task is marked")
    map_orchestrator = read("scripts/map/make_1946.py")
    check(
        map_orchestrator.find('"build/build_china_1946_v2.py"')
        < map_orchestrator.find('"build/build_asia_1946.py"'),
        "Full map rebuild orders China before dependent Asia step",
    )
    check("→" not in map_orchestrator, "Map CLI help is Windows CP1251-safe")
    check(
        "python3 .agent/evals/public/run_public_evals.py"
        in read(".github/workflows/doc-guardrails.yml"),
        "CI runs public agent evals",
    )


def main() -> int:
    validators = (
        validate_toml,
        validate_living_docs,
        validate_no_conflict_markers,
        validate_rot,
        validate_audit_freshness,
        validate_instructions_and_skills,
        validate_orchestrator_roles,
        validate_session_guard,
        validate_experiment_layer,
        validate_markdown_links,
        validate_documented_workflow,
    )
    for validator in validators:
        try:
            validator()
        except Exception as exc:  # report all public checks, not only the first
            FAILURES.append(f"{validator.__name__} raised {type(exc).__name__}: {exc}")

    print(f"Public agent evals: {len(PASSES)} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print(f"FAIL: {failure}")
    if FAILURES:
        return 1
    print("PASS: repository-local agent configuration checks are clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
