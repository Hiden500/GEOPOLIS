<#
.SYNOPSIS
    Проход зачистки деревьев задач: зовёт worktree-drop.ps1 на каждое дерево,
    кроме тех, что названы в открытых заданиях реестра.

.DESCRIPTION
    Однострочный проход `Get-ChildItem .claude/worktrees | ForEach-Object {
    worktree-drop.ps1 $_.Name }` за один день снёс два дерева ЖИВЫХ задач.
    Защиты worktree-drop.ps1 при этом отработали верно: они охраняют
    незакоммиченное и невлитое, и данные не пропали ни разу. Но дерево выданной
    задачи, где коммитов ещё нет, и дерево отработавшей задачи для них
    неразличимы — они проверяют состояние ФАЙЛОВ, а не наличие НАМЕРЕНИЯ.

    Намерение записано в реестрах оркестраторов: задание со строкой
    `Статус: выдано` называет исполнителя — ветку, иногда путь дерева. Обёртка
    читает реестр и пропускает дерево, чьё имя каталога ИЛИ имя ветки названо в
    блоке такого задания.

    Имя каталога и хвост ветки совпадают не всегда: дерево `audit-t8` работает
    на ветке `claude/area-geometry-guard`, и реестр называет только ветку.
    Поэтому сверяются оба имени — сверка по одному имени каталога пропустила бы
    ровно тот случай, ради которого обёртка написана.

    Решение «сносить или нет» остаётся за worktree-drop.ps1: обёртка только
    фильтрует список и отчитывается. Флага -Force у неё нет и не будет —
    массовый проход с -Force это ровно тот инструмент, которым стирают чужую
    живую работу.

.PARAMETER Base
    Ветка, относительно которой worktree-drop.ps1 проверяет влитость.
    По умолчанию main.

.PARAMETER Exclude
    Имена деревьев или веток, которые пропустить сверх реестра.

.PARAMETER DeleteBranch
    Передать worktree-drop.ps1 флаг -DeleteBranch. Он удаляет ветку через -d,
    то есть только влитую: невлитая переживёт проход в любом случае.

.PARAMETER WhatIf
    Сухой проход: показать решение по каждому дереву и не тронуть ничего.

.EXAMPLE
    ./scripts/worktree-prune.ps1 -WhatIf

.EXAMPLE
    ./scripts/worktree-prune.ps1 -DeleteBranch -Exclude audit-t8
#>
[CmdletBinding()]
param(
    [string] $Base = 'main',

    [string[]] $Exclude = @(),

    [switch] $DeleteBranch,

    [switch] $WhatIf
)

$ErrorActionPreference = 'Stop'

function Fail([string] $message) {
    Write-Host "ОШИБКА: $message" -ForegroundColor Red
    exit 1
}

function Normalize([string] $path) {
    return ($path -replace '\\', '/').TrimEnd('/')
}

# Имя считается названным, если стоит отдельным словом: соседний дефис или
# буква снимают совпадение, поэтому дерево `t9` не ловится на `t9-anchor`,
# а `audit-t8` ловится внутри `.claude/worktrees/audit-t8`.
function Test-NameMentioned([string] $text, [string] $name) {
    if ([string]::IsNullOrWhiteSpace($name)) { return $false }
    $pattern = '(?<![\w-])' + [regex]::Escape($name) + '(?![\w-])'
    return [regex]::IsMatch($text, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
}

# Разбор реестра. Заголовок открывает блок; блок считается ОТКРЫТЫМ заданием,
# если `Статус: выдано` стоит в его собственной преамбуле — до первого
# вложенного заголовка, ровно как в шаблоне .agent/orchestration/README.md.
# Текст такого задания берётся вместе с вложенными подразделами: исполнитель
# бывает назван и ниже преамбулы.
function Get-OpenTasks([string] $registryDir) {
    $tasks = @()
    $files = @(Get-ChildItem -Path $registryDir -Filter '*.md' -File -ErrorAction SilentlyContinue)

    foreach ($file in $files) {
        $lines = @(Get-Content -LiteralPath $file.FullName -Encoding UTF8)

        # Заголовки внутри ``` — это шаблоны и примеры, а не записи реестра.
        $inFence = $false
        $headings = @()
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match '^\s*(```|~~~)') { $inFence = -not $inFence; continue }
            if ($inFence) { continue }
            if ($lines[$i] -match '^(#{1,6})\s') {
                $headings += [pscustomobject]@{ Index = $i; Level = $Matches[1].Length }
            }
        }

        for ($h = 0; $h -lt $headings.Count; $h++) {
            $start = $headings[$h].Index
            $level = $headings[$h].Level

            # Преамбула — до следующего заголовка любого уровня.
            $ownEnd = if ($h + 1 -lt $headings.Count) { $headings[$h + 1].Index - 1 } else { $lines.Count - 1 }

            $isOpen = $false
            for ($i = $start + 1; $i -le $ownEnd; $i++) {
                if ($lines[$i] -match '^Статус:\s*выдано\s*$') { $isOpen = $true; break }
            }
            if (-not $isOpen) { continue }

            # Полный текст задания — до следующего заголовка того же или
            # старшего уровня.
            $fullEnd = $lines.Count - 1
            for ($n = $h + 1; $n -lt $headings.Count; $n++) {
                if ($headings[$n].Level -le $level) { $fullEnd = $headings[$n].Index - 1; break }
            }

            $tasks += [pscustomobject]@{
                Source  = "$($file.Name):$($start + 1)"
                Start   = $start
                Heading = $lines[$start].TrimStart('#', ' ')
                Text    = ($lines[$start..$fullEnd] -join "`n")
            }
        }
    }

    return $tasks
}

$commonDir = (git rev-parse --path-format=absolute --git-common-dir 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $commonDir) { Fail 'не репозиторий git' }
$root = Split-Path -Parent $commonDir

$dropScript = Join-Path $PSScriptRoot 'worktree-drop.ps1'
if (-not (Test-Path $dropScript)) { Fail "рядом нет worktree-drop.ps1 ($dropScript)" }

$psExe = (Get-Process -Id $PID).Path
if (-not $psExe) { $psExe = 'pwsh' }

$registryDir = Join-Path $root '.agent/orchestration'
if (-not (Test-Path $registryDir)) {
    Fail "реестра '$registryDir' нет. Без него обёртка не отличает живую задачу от отработавшей и вырождается в тот самый однострочный проход — зачистка остановлена."
}

$openTasks = @(Get-OpenTasks $registryDir)
Write-Host "Реестр: $registryDir — открытых заданий $($openTasks.Count)" -ForegroundColor Cyan
if ($openTasks.Count -eq 0) {
    Write-Host "ВНИМАНИЕ: ни одного задания со строкой 'Статус: выдано'. Либо все приняты, либо реестр не там, где ищет скрипт. Проверь, прежде чем доверять проходу." -ForegroundColor Yellow
}

# Список деревьев берётся у git, а не из каталога: каталог показывает и то,
# что git уже забыл.
$treesRoot = Normalize (Join-Path $root '.claude/worktrees')
$here = Normalize (Get-Location).Path

$worktrees = @()
$current = $null
foreach ($line in @(git -C $root worktree list --porcelain)) {
    if ($line -like 'worktree *') {
        $current = [pscustomobject]@{ Path = Normalize $line.Substring(9); Branch = '' }
    }
    elseif ($line -like 'branch *' -and $current) {
        $current.Branch = $line.Substring(7) -replace '^refs/heads/', ''
    }
    elseif ([string]::IsNullOrWhiteSpace($line) -and $current) {
        $worktrees += $current
        $current = $null
    }
}
if ($current) { $worktrees += $current }

$targets = @($worktrees | Where-Object { (Normalize (Split-Path -Parent $_.Path)) -ieq $treesRoot })

if ($targets.Count -eq 0) {
    Write-Host "Деревьев задач нет: $treesRoot" -ForegroundColor DarkGray
    exit 0
}

$results = @()

foreach ($tree in $targets) {
    $name = Split-Path -Leaf $tree.Path
    $branch = $tree.Branch
    $label = if ($branch) { "$name ($branch)" } else { "$name (detached)" }

    if ($here -ieq $tree.Path -or $here.StartsWith("$($tree.Path)/", [StringComparison]::OrdinalIgnoreCase)) {
        $results += [pscustomobject]@{ Name = $name; Action = 'пропущено'; Reason = 'текущее дерево — из него самого зачистка невозможна' }
        Write-Host "ПРОПУСК  $label — ты внутри него" -ForegroundColor DarkGray
        continue
    }

    $hit = @($Exclude | Where-Object { $_ -ieq $name -or ($branch -and $_ -ieq $branch) })
    if ($hit.Count -gt 0) {
        $results += [pscustomobject]@{ Name = $name; Action = 'пропущено'; Reason = "-Exclude $($hit[0])" }
        Write-Host "ПРОПУСК  $label — -Exclude" -ForegroundColor DarkGray
        continue
    }

    # Из нескольких совпавших заданий в причину идёт самое конкретное:
    # текст родительского раздела включает вложенные, и без этого пропуск
    # ссылался бы на родителя, а не на задание, которое дерево и держит.
    $matched = @($openTasks | Where-Object {
        (Test-NameMentioned $_.Text $name) -or ($branch -and (Test-NameMentioned $_.Text $branch))
    })
    $guard = $matched | Sort-Object Start -Descending | Select-Object -First 1
    if ($guard) {
        $results += [pscustomobject]@{ Name = $name; Action = 'пропущено'; Reason = "открытое задание $($guard.Source)" }
        Write-Host "ПРОПУСК  $label — открытое задание: $($guard.Source) «$($guard.Heading)»" -ForegroundColor Yellow
        continue
    }

    if ($WhatIf) {
        $results += [pscustomobject]@{ Name = $name; Action = 'сухой прогон'; Reason = 'ушло бы в worktree-drop.ps1' }
        Write-Host "БЫЛО БЫ $label — передано в worktree-drop.ps1, решение за ним" -ForegroundColor Cyan
        continue
    }

    Write-Host "ЗАЧИСТКА $label" -ForegroundColor White
    $dropArgs = @($name, '-Base', $Base)
    if ($DeleteBranch) { $dropArgs += '-DeleteBranch' }

    # Отдельным процессом: worktree-drop.ps1 сообщает отказ через `exit`, и в
    # своём процессе он читается как код возврата без оглядки на то, что
    # `exit` в дочернем скрипте делает с текущей сессией.
    & $psExe -NoProfile -File $dropScript @dropArgs
    $code = $LASTEXITCODE

    if ($code -eq 0) {
        $results += [pscustomobject]@{ Name = $name; Action = 'снесено'; Reason = '' }
    }
    else {
        $results += [pscustomobject]@{ Name = $name; Action = 'отказано'; Reason = "worktree-drop.ps1 отказал (код $code) — причина в его сообщении выше" }
    }
}

$dropped = @($results | Where-Object { $_.Action -eq 'снесено' })
$refused = @($results | Where-Object { $_.Action -eq 'отказано' })
$skipped = @($results | Where-Object { $_.Action -eq 'пропущено' })
$dry = @($results | Where-Object { $_.Action -eq 'сухой прогон' })

Write-Host ''
if ($WhatIf) {
    Write-Host "Итог (-WhatIf, ничего не тронуто): деревьев $($targets.Count), ушло бы в drop $($dry.Count), пропущено $($skipped.Count)." -ForegroundColor Cyan
}
else {
    Write-Host "Итог: деревьев $($targets.Count), снесено $($dropped.Count), отказано $($refused.Count), пропущено $($skipped.Count)." -ForegroundColor Cyan
}

foreach ($r in @($skipped + $refused)) {
    Write-Host "  $($r.Name): $($r.Action) — $($r.Reason)" -ForegroundColor DarkGray
}
