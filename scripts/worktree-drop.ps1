<#
.SYNOPSIS
    Убирает worktree задачи: снимает ссылки на зависимости и удаляет дерево.

.DESCRIPTION
    Прямой `git worktree remove` для дерева, собранного worktree-new.ps1,
    небезопасен: внутри node_modules лежат junction на пакеты главного
    checkout, и рекурсивное удаление рискует пройти по ссылке и снести
    оригинал. Скрипт сначала снимает каждую ссылку через Directory.Delete —
    он удаляет саму ссылку, не трогая цель, — и только затем зовёт git.

    По умолчанию отказывается удалять дерево с незакоммиченными изменениями и
    ветку, не влитую в основание. Оба отказа снимаются флагом -Force, и оба
    существуют, чтобы одна опечатка в имени не стёрла чужую живую работу.

.PARAMETER Name
    Имя задачи — то же, что передавалось в worktree-new.ps1.

.PARAMETER Base
    Ветка, относительно которой проверяется влитость. По умолчанию main.

.PARAMETER DeleteBranch
    Удалить и саму ветку после дерева. Влитая ветка удаляется через -d,
    невлитая потребует ещё и -Force.

.PARAMETER Force
    Удалять несмотря на незакоммиченные изменения и невлитость. Дерево живой
    сессии выглядит именно так — прежде чем передавать этот флаг, посмотри,
    ЧТО именно скрипт отказался стирать.

.EXAMPLE
    ./scripts/worktree-drop.ps1 alliance-affinity -DeleteBranch
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string] $Name,

    [string] $Base = 'main',

    [switch] $DeleteBranch,

    [switch] $Force
)

$ErrorActionPreference = 'Stop'

function Fail([string] $message) {
    Write-Host "ОШИБКА: $message" -ForegroundColor Red
    exit 1
}

$commonDir = (git rev-parse --path-format=absolute --git-common-dir 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $commonDir) { Fail 'не репозиторий git' }
$root = Split-Path -Parent $commonDir

$treePath = Join-Path $root ".claude/worktrees/$Name"
if (-not (Test-Path $treePath)) { Fail "дерева '$treePath' нет" }

# Скрипт запущен изнутри удаляемого дерева — git откажет, а каталог останется
# заблокирован текущим процессом.
$here = (Get-Location).Path
if ($here.StartsWith($treePath, [StringComparison]::OrdinalIgnoreCase)) {
    Fail "ты внутри удаляемого дерева. Перейди в '$root' и повтори."
}

$branch = (git -C $treePath rev-parse --abbrev-ref HEAD 2>$null)
if ($LASTEXITCODE -ne 0) { $branch = $null }

if (-not $Force) {
    $dirty = @(git -C $treePath status --porcelain 2>$null)
    if ($dirty.Count -gt 0) {
        Write-Host "В дереве $($dirty.Count) незакоммиченных изменений:" -ForegroundColor Yellow
        $dirty | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" }
        Fail 'сохрани или отбрось их, либо повтори с -Force'
    }

    if ($branch -and $branch -ne 'HEAD') {
        git -C $root merge-base --is-ancestor $branch $Base 2>$null
        if ($LASTEXITCODE -ne 0) {
            Fail "ветка '$branch' не влита в '$Base' — её работа пропадёт. Повтори с -Force, если это осознанно."
        }
    }
}

# Снятие ссылок. Directory.Delete($path, $false) на reparse point удаляет
# только саму точку; рекурсивные удалялки в этом месте доверия не заслуживают.
$removedLinks = 0
$linkRoots = @(
    (Join-Path $treePath 'node_modules'),
    (Join-Path $treePath 'client/node_modules'),
    (Join-Path $treePath 'server/node_modules'),
    (Join-Path $treePath 'shared/node_modules')
)

foreach ($linkRoot in $linkRoots) {
    if (-not (Test-Path $linkRoot)) { continue }
    $entries = @(Get-ChildItem -Path $linkRoot -Force -ErrorAction SilentlyContinue)
    foreach ($entry in $entries) {
        if ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            try {
                [System.IO.Directory]::Delete($entry.FullName, $false)
                $removedLinks++
            }
            catch {
                Write-Host "  не снялась ссылка: $($entry.FullName)" -ForegroundColor Yellow
            }
        }
    }
}

if ($removedLinks -gt 0) {
    Write-Host "Снято ссылок на пакеты: $removedLinks" -ForegroundColor Green
}

# Остались ли reparse points: git пойдёт удалять дерево рекурсивно, и уцелевшая
# ссылка — единственный способ добраться до пакетов главного checkout.
$survivors = @(Get-ChildItem -Path $treePath -Recurse -Force -ErrorAction SilentlyContinue |
               Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint })
if ($survivors.Count -gt 0) {
    Write-Host "Осталось несняных ссылок: $($survivors.Count)" -ForegroundColor Red
    $survivors | Select-Object -First 5 | ForEach-Object { Write-Host "  $($_.FullName)" }
    Fail 'удаление остановлено: рекурсивное удаление могло бы пройти по ссылке в главный checkout'
}

$removeArgs = @('-C', $root, 'worktree', 'remove', $treePath)
if ($Force) { $removeArgs += '--force' }
& git @removeArgs
if ($LASTEXITCODE -ne 0) { Fail 'git worktree remove не отработал' }

# git оставляет пустые каталоги, если внутри были игнорируемые файлы.
if (Test-Path $treePath) {
    $leftoverFiles = @(Get-ChildItem -Path $treePath -Recurse -File -Force -ErrorAction SilentlyContinue)
    if ($leftoverFiles.Count -eq 0) {
        Remove-Item -Path $treePath -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue
    }
    else {
        Write-Host "Каталог не пуст ($($leftoverFiles.Count) файлов) — оставлен: $treePath" -ForegroundColor Yellow
    }
}

git -C $root worktree prune
Write-Host "Дерево убрано: $treePath" -ForegroundColor Green

if ($DeleteBranch -and $branch -and $branch -ne 'HEAD') {
    $deleteFlag = if ($Force) { '-D' } else { '-d' }
    git -C $root branch $deleteFlag $branch
    if ($LASTEXITCODE -eq 0) { Write-Host "Ветка удалена: $branch" -ForegroundColor Green }
    else { Write-Host "Ветка '$branch' не удалена — см. сообщение git выше." -ForegroundColor Yellow }
}
elseif ($branch -and $branch -ne 'HEAD') {
    Write-Host "Ветка '$branch' осталась. Удалить: git -C `"$root`" branch -d $branch" -ForegroundColor DarkGray
}
