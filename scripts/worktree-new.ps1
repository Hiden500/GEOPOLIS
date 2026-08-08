<#
.SYNOPSIS
    Создаёт linked worktree для задачи агента и подключает зависимости ссылками.

.DESCRIPTION
    Новое дерево приходит без node_modules, и установка занимает минуты. Скрипт
    создаёт в дереве собственную папку node_modules, а внутрь кладёт junction
    (ссылку на папку) на каждый пакет главного checkout. Пакеты общие — место и
    время не тратятся; кэши сборщика (.vite, .tmp) создаются заново внутри
    своей папки, поэтому параллельные деревья за них не дерутся.

    Обратная сторона: пакеты общие физически. `npm install` внутри дерева
    изменит зависимости главного checkout. Ветке нужны другие версии — заводи
    дерево с -NoLink и ставь свои.

.PARAMETER Name
    Имя задачи: и каталог дерева, и хвост имени ветки. Только строчные буквы,
    цифры и дефис.

.PARAMETER Base
    Ветка-основание. По умолчанию main.

.PARAMETER Prefix
    Префикс ветки по модели-исполнителю. По умолчанию claude.

.PARAMETER NoLink
    Не подключать зависимости. Дерево останется без node_modules — сессия
    ставит их сама. Нужен, когда ветка меняет package.json.

.EXAMPLE
    ./scripts/worktree-new.ps1 alliance-affinity

.EXAMPLE
    ./scripts/worktree-new.ps1 deps-upgrade -NoLink
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string] $Name,

    [string] $Base = 'main',

    [string] $Prefix = 'claude',

    [switch] $NoLink
)

$ErrorActionPreference = 'Stop'

# Модули с собственными зависимостями. Держать в согласии с package.json на
# верхнем уровне модулей: лишнее имя просто пропускается, забытое — оставит
# дерево без части пакетов.
$MODULES = @('.', 'client', 'server')

# Служебные каталоги сборщиков внутри node_modules. Они не пакеты, а кэш:
# ссылку на них делать нельзя, иначе параллельные деревья пишут в один файл.
$CACHE_ENTRIES = @('.vite', '.vite-temp', '.tmp', '.cache', '.vitest')

function Fail([string] $message) {
    Write-Host "ОШИБКА: $message" -ForegroundColor Red
    exit 1
}

if ($Name -notmatch '^[a-z0-9]+(-[a-z0-9]+)*$') {
    Fail "имя '$Name' недопустимо. Разрешены строчные буквы, цифры и дефис: milestone-1-lifecycle"
}

# Главный checkout, а не то дерево, из которого запущен скрипт: --git-common-dir
# указывает на общий каталог .git, он лежит в корне главного checkout.
$commonDir = (git rev-parse --path-format=absolute --git-common-dir 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $commonDir) { Fail 'не репозиторий git' }
$root = Split-Path -Parent $commonDir

$branch = "$Prefix/$Name"
$treePath = Join-Path $root ".claude/worktrees/$Name"

git -C $root show-ref --verify --quiet "refs/heads/$branch"
if ($LASTEXITCODE -eq 0) { Fail "ветка '$branch' уже существует. Возьми другое имя или удали ветку." }
if (Test-Path $treePath) { Fail "каталог '$treePath' занят. Убери его: ./scripts/worktree-drop.ps1 $Name" }

git -C $root show-ref --verify --quiet "refs/heads/$Base"
if ($LASTEXITCODE -ne 0) { Fail "ветки-основания '$Base' нет" }

Write-Host "Дерево: $treePath" -ForegroundColor Cyan
Write-Host "Ветка:  $branch (от $Base)" -ForegroundColor Cyan

git -C $root worktree add $treePath -b $branch $Base
if ($LASTEXITCODE -ne 0) { Fail 'git worktree add не отработал' }

if ($NoLink) {
    Write-Host ''
    Write-Host 'Зависимости не подключены (-NoLink). Поставь их в дереве сам.' -ForegroundColor Yellow
}
else {
    Write-Host ''
    $totalLinked = 0
    $failed = @()

    foreach ($module in $MODULES) {
        $sourceModules = if ($module -eq '.') { Join-Path $root 'node_modules' }
                         else { Join-Path $root "$module/node_modules" }
        if (-not (Test-Path $sourceModules)) { continue }

        $entries = @(Get-ChildItem -Path $sourceModules -Directory -Force -ErrorAction SilentlyContinue |
                     Where-Object { $CACHE_ENTRIES -notcontains $_.Name })
        if ($entries.Count -eq 0) { continue }

        $targetModules = if ($module -eq '.') { Join-Path $treePath 'node_modules' }
                         else { Join-Path $treePath "$module/node_modules" }
        New-Item -ItemType Directory -Path $targetModules -Force | Out-Null

        $linked = 0
        foreach ($entry in $entries) {
            $link = Join-Path $targetModules $entry.Name
            try {
                New-Item -ItemType Junction -Path $link -Target $entry.FullName -ErrorAction Stop | Out-Null
                $linked++
            }
            catch {
                $failed += "$module/node_modules/$($entry.Name)"
            }
        }

        # npm читает .package-lock.json внутри node_modules, определяя,
        # актуально ли дерево зависимостей. Без него часть команд решит
        # переустановить всё заново.
        $sourceLock = Join-Path $sourceModules '.package-lock.json'
        if (Test-Path $sourceLock) {
            Copy-Item -Path $sourceLock -Destination (Join-Path $targetModules '.package-lock.json') -Force
        }

        $label = if ($module -eq '.') { 'корень' } else { $module }
        Write-Host ("  {0,-8} {1} пакетов подключено" -f $label, $linked) -ForegroundColor Green
        $totalLinked += $linked
    }

    if ($failed.Count -gt 0) {
        Write-Host ''
        Write-Host "Не удалось подключить $($failed.Count) записей:" -ForegroundColor Yellow
        $failed | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
        Write-Host '  Проверь права на создание junction или запусти с -NoLink.' -ForegroundColor Yellow
    }

    if ($totalLinked -eq 0) {
        Write-Host '  Зависимостей в главном checkout нет — поставь их в дереве сам.' -ForegroundColor Yellow
    }
    else {
        Write-Host ''
        Write-Host '  Пакеты общие с главным checkout. `npm install` внутри дерева' -ForegroundColor DarkYellow
        Write-Host '  изменит их для всех — меняешь зависимости, заводи дерево с -NoLink.' -ForegroundColor DarkYellow
    }
}

# --- Источники карты: junction на общее хранилище -----------------------------
# Внешние входы пайплайна (game_map.json 37 МБ, geoBoundaries ADM2, IHO,
# исторические шейпы) в git не лежат: на GitHub вместо них реестр со ссылками,
# `docs/provenance/MAP_GEOMETRY_PROVENANCE.md`. Хранилище одно на машину,
# путь — в PAXMAP_SOURCES_STORE. Тот же приём, что с node_modules: данные не
# дублируются по деревьям.
$store = $env:PAXMAP_SOURCES_STORE
$sourcesLink = Join-Path $treePath 'scripts/map/sources'
if ($store -and (Test-Path $store)) {
    if (Test-Path $sourcesLink) {
        # Каталог уже есть — значит в ветке остался отслеживаемый файл внутри
        # sources/ и git создал папку при checkout. Junction не встанет, а
        # пайплайн найдёт только этот файл и промолчит. Так и случилось
        # 2026-08-07 с germany_occupation_zones_1946.json: он был закоммичен
        # раньше, чем появилось правило .gitignore, а на уже отслеживаемое
        # правило не действует. Поэтому предупреждение громкое и с диагнозом.
        $tracked = git -C $treePath ls-files 'scripts/map/sources' 2>$null
        Write-Host ''
        Write-Host '  ИСТОЧНИКИ НЕ ПОДКЛЮЧЕНЫ: scripts/map/sources уже существует.' -ForegroundColor Red
        if ($tracked) {
            Write-Host '  Причина — внутри есть файлы под git:' -ForegroundColor Red
            $tracked | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
            Write-Host '  Источникам в git не место: git rm --cached их и положи в хранилище.' -ForegroundColor Red
        }
        Write-Host '  Пайплайн карты увидит только содержимое этой папки, а не хранилище.' -ForegroundColor Red
    }
    else {
        try {
            New-Item -ItemType Junction -Path $sourcesLink -Target $store -ErrorAction Stop | Out-Null
            Write-Host ''
            Write-Host "  Источники карты подключены: scripts/map/sources -> $store" -ForegroundColor Green
        }
        catch {
            Write-Host ''
            Write-Host "  Не удалось подключить источники карты: $_" -ForegroundColor Yellow
        }
    }
}
else {
    Write-Host ''
    Write-Host '  PAXMAP_SOURCES_STORE не задана — источники карты НЕ подключены.' -ForegroundColor Yellow
    Write-Host '  Пайплайн карты в этом дереве не соберётся. Как завести хранилище —' -ForegroundColor Yellow
    Write-Host '  docs/provenance/MAP_GEOMETRY_PROVENANCE.md.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '--- шапка для промта сессии ---' -ForegroundColor Cyan
Write-Host ''
Write-Host "**WORKTREE: ``$treePath``**"
Write-Host ''
Write-Host "cwd инструментов между ходами соскальзывает в основной checkout — всегда"
Write-Host "абсолютные пути и ``git -C `"$treePath`"``. Основной checkout не редактируй."
Write-Host "``git add`` поимённо. Локальные коммиты после проверок; push и merge — только"
Write-Host "с разрешения пользователя. На ``Edit|Write|Bash`` стоит guard-хук — не обходи,"
if ($NoLink) {
    Write-Host "доложи если заблокирует. Зависимости в дереве не установлены — поставь их сам."
}
else {
    Write-Host "доложи если заблокирует. Зависимости уже подключены, ставить не нужно."
}
Write-Host ''
Write-Host '--- по завершении задачи ---' -ForegroundColor Cyan
Write-Host "./scripts/worktree-drop.ps1 $Name"
