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

    Осиротевший каталог — лежит на диске, но в git не зарегистрирован — скрипт
    тоже берёт. Так выглядит дерево, чьё удаление упало на полпути: git успевает
    снять `.git`, и прежняя версия на второй заход отвечала «is not a working
    tree», то есть отказывалась убирать то, что сама и оставила. Ссылки при этом
    снимаются тем же кодом, что и обычно, — это и есть причина вести сироту
    через скрипт, а не рукам. Спросить git, сохранена ли там работа, уже
    невозможно, поэтому уцелевшие ФАЙЛЫ останавливают проход до -Force.

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
    ЧТО именно скрипт отказался стирать. Для осиротевшего каталога снимает
    запрет на уцелевшие файлы.

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

function Normalize([string] $path) {
    return ([System.IO.Path]::GetFullPath($path)).TrimEnd([char]92, [char]47).ToLowerInvariant()
}

# Осиротевший каталог — тот, что лежит на диске без регистрации в git. Так
# выглядит дерево, чьё удаление упало на полпути: git успевает снять `.git`,
# и следующий заход получает «is not a working tree» — то есть скрипт своим
# же отказом создаёт состояние, которое сам потом брать отказывался. Замер
# 2026-08-20: в .claude/worktrees так накопилось 20 каталогов при четырёх
# живых деревьях, и в четырёх из них уцелело по 379 junction'ов в
# node_modules главного checkout — мина под любое рекурсивное удаление.
# Поэтому сироту ведём через ТОТ ЖЕ код снятия ссылок, а не мимо него.
$registered = @(git -C $root worktree list --porcelain 2>$null |
                Where-Object { $_ -like 'worktree *' } |
                ForEach-Object { Normalize ($_ -replace '^worktree\s+', '') })
$isOrphan = $registered -notcontains (Normalize $treePath)
if ($isOrphan) {
    Write-Host "Каталог не зарегистрирован как worktree — убираю как осиротевший: $treePath" -ForegroundColor Yellow
}

# Скрипт запущен изнутри удаляемого дерева — git откажет, а каталог останется
# заблокирован текущим процессом.
$here = (Get-Location).Path
if ($here.StartsWith($treePath, [StringComparison]::OrdinalIgnoreCase)) {
    Fail "ты внутри удаляемого дерева. Перейди в '$root' и повтори."
}

# Для сироты `git -C $treePath` ответил бы про ГЛАВНЫЙ checkout: каталог лежит
# внутри него, и git ушёл бы вверх по дереву. Ответ про чужой репозиторий хуже
# отсутствия ответа, поэтому проверки ветки и чистоты здесь не выполняются —
# их место занимает запрет на уцелевшие файлы ниже.
$branch = $null
if (-not $isOrphan) {
    $branch = (git -C $treePath rev-parse --abbrev-ref HEAD 2>$null)
    if ($LASTEXITCODE -ne 0) { $branch = $null }
}

if (-not $Force -and -not $isOrphan) {
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

# Источники карты (2026-08-07). Здесь reparse point — САМ каталог
# scripts/map/sources, а не его содержимое, поэтому цикл выше его не видел:
# он перебирает ДЕТЕЙ перечисленных корней. Ссылка ведёт в общее хранилище
# PAXMAP_SOURCES_STORE, и рекурсивное удаление по ней снесло бы game_map.json,
# источники и _frozen_out — 120 МБ, из которых 82 невоспроизводимы.
$sourcesLink = Join-Path $treePath 'scripts/map/sources'
if (Test-Path $sourcesLink) {
    $item = Get-Item -LiteralPath $sourcesLink -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        try {
            [System.IO.Directory]::Delete($sourcesLink, $false)
            Write-Host 'Снята ссылка на хранилище источников карты' -ForegroundColor Green
        }
        catch {
            Write-Host "  не снялась ссылка: $sourcesLink" -ForegroundColor Yellow
        }
    }
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

if ($isOrphan) {
    # Регистрации нет — снимать в git нечего. Но и спросить git, сохранена ли
    # работа, тоже нельзя: уцелевшие ФАЙЛЫ поэтому останавливают проход.
    $orphanFiles = @(Get-ChildItem -Path $treePath -Recurse -File -Force -ErrorAction SilentlyContinue)
    if ($orphanFiles.Count -gt 0 -and -not $Force) {
        Write-Host "В осиротевшем каталоге $($orphanFiles.Count) файлов:" -ForegroundColor Yellow
        $orphanFiles | Select-Object -First 5 | ForEach-Object { Write-Host "  $($_.FullName)" }
        Fail 'без git не отличить брошенную работу от артефактов сборки — посмотри сам и повтори с -Force'
    }
}
else {
    $removeArgs = @('-C', $root, 'worktree', 'remove', $treePath)
    if ($Force) { $removeArgs += '--force' }
    & git @removeArgs
    if ($LASTEXITCODE -ne 0) { Fail 'git worktree remove не отработал' }
}

# git оставляет пустые каталоги, если внутри были игнорируемые файлы.
$leftoverReason = ''
if (Test-Path $treePath) {
    $leftoverFiles = @(Get-ChildItem -Path $treePath -Recurse -File -Force -ErrorAction SilentlyContinue)
    if ($leftoverFiles.Count -eq 0 -or $Force) {
        # -ErrorAction Stop, а не SilentlyContinue: на Windows каталог не
        # отдаётся, пока на него открыт хоть один handle (терминал или
        # редактор внутри дерева), и проглоченная ошибка — единственная
        # причина, по которой каталоги копились молча.
        try {
            Remove-Item -Path $treePath -Recurse -Force -Confirm:$false -ErrorAction Stop
        }
        catch {
            $leftoverReason = $_.Exception.Message
        }
    }
    else {
        $leftoverReason = "внутри осталось файлов: $($leftoverFiles.Count)"
    }
}

git -C $root worktree prune

# Отчёт по факту, а не по намерению. Замер 2026-08-20: в .claude/worktrees
# лежало 20 осиротевших каталогов при четырёх живых деревьях — регистрацию
# git снимал, каталог оставался, а скрипт печатал зелёное «Дерево убрано»
# в обеих ветках выше. Зелёная строка теперь стоит только за проверенным
# фактом, а уцелевший каталог — ненулевой код возврата: обёртка
# worktree-prune.ps1 читает его и не запишет такой проход в успех.
$treeSurvived = Test-Path $treePath
if ($treeSurvived) {
    Write-Host "Регистрация дерева снята, но КАТАЛОГ ОСТАЛСЯ: $treePath" -ForegroundColor Yellow
    if ($leftoverReason) { Write-Host "  причина: $leftoverReason" -ForegroundColor Yellow }
    # Советовать рекурсивный Remove-Item нельзя: в осиротевшем дереве ссылки
    # могут быть не сняты, и рекурсия уйдёт в главный checkout. Зовём скрипт.
    Write-Host "  освободи каталог (закрой терминалы внутри) и повтори: ./scripts/worktree-drop.ps1 $Name" -ForegroundColor Yellow
}
else {
    Write-Host "Дерево убрано: $treePath" -ForegroundColor Green
}

if ($DeleteBranch -and $branch -and $branch -ne 'HEAD') {
    $deleteFlag = if ($Force) { '-D' } else { '-d' }
    git -C $root branch $deleteFlag $branch
    if ($LASTEXITCODE -eq 0) { Write-Host "Ветка удалена: $branch" -ForegroundColor Green }
    else { Write-Host "Ветка '$branch' не удалена — см. сообщение git выше." -ForegroundColor Yellow }
}
elseif ($branch -and $branch -ne 'HEAD') {
    Write-Host "Ветка '$branch' осталась. Удалить: git -C `"$root`" branch -d $branch" -ForegroundColor DarkGray
}

if ($treeSurvived) { exit 1 }
