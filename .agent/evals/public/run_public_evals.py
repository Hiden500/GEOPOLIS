"""Public, dependency-free regression checks for Geopolis agent configuration."""

from __future__ import annotations

import json
import re
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


def validate_instructions_and_skills() -> None:
    root_agents = ROOT / "AGENTS.md"
    check(root_agents.stat().st_size <= 16_384, "Root AGENTS.md stays under 16 KiB")
    for path in (
        "client/AGENTS.md",
        "server/AGENTS.md",
        "shared/AGENTS.md",
        "scripts/map/AGENTS.md",
    ):
        check((ROOT / path).is_file(), f"Scoped instruction exists: {path}")

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

    canonical = read(".agents/skills/verify-change/SKILL.md")
    mirror = read(".claude/skills/verify-change/SKILL.md")
    check(canonical == mirror, "Claude verify-change mirror matches canonical skill")

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


def validate_experiment_layer() -> None:
    required = (
        ".agent/CHARTER.proposed.md",
        ".agent/PLANS.md",
        ".agent/EVOLUTION.md",
        ".agent/audits/baseline.md",
        ".agent/audits/agents-audit.md",
        ".agent/audits/docs-audit.md",
        ".agent/run-record.schema.json",
    )
    for path in required:
        check((ROOT / path).is_file(), f"Experiment artifact exists: {path}")

    charter = read(".agent/CHARTER.proposed.md")
    check("PROPOSAL" in charter, "Charter is explicitly marked as a proposal")
    check("не является неизменяемой" in charter, "Charter disclaims fake immutability")
    check("protected surfaces" in charter, "Charter proposes explicit protected surfaces")

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


LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


def validate_markdown_links() -> None:
    broken: list[str] = []
    for path in ROOT.rglob("*.md"):
        relative = path.relative_to(ROOT)
        if any(part in {".git", "node_modules", "dist", ".repowise"} for part in relative.parts) or (
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
        validate_instructions_and_skills,
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
