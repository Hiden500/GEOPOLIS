<#
.SYNOPSIS
    Прогон с LLM из любого worktree: env из главного checkout, прокси — по
    необходимости, старт команды только после готовности модели.

.DESCRIPTION
    Закрывает затык «дерево не может само прогнать модель» (сессия
    actions-to-primitives, 2026-08-03): у linked worktree нет server/.env (он
    живёт только в главном checkout и не попадает в git), а модельный прокси
    никто не поднимает.

    Что делает:
      1. Читает <main>/server/.env В ПЕРЕМЕННЫЕ ПРОЦЕССА — на диск дерева
         ничего не пишется, копий файла с ключом по деревьям не остаётся,
         значения не печатаются. Уже заданные переменные окружения НЕ
         перетираются: явный override сильнее файла.
      2. Проверяет эндпоинт. Если не отвечает — запускает
         D:\CLIProxy\cli-proxy-api.exe СВЁРНУТЫМ. Уже работающий прокси (свой
         или чужой сессии) не перезапускается и НИКОГДА не закрывается — он
         общий ресурс машины, как и сам эндпоинт.
      3. Ждёт готовности. Готовность — не «порт открыт», а «нужная модель есть
         в списке /v1/models»: между стартом процесса и загрузкой моделей есть
         окно, в котором прогон упал бы на первом же ходу.
      4. Запускает команду из server/ ТЕКУЩЕГО дерева. Без команды — sanity:
         listLocalModels.

.PARAMETER Model
    Имя модели, готовность которой ждём. Порядок приоритета: параметр →
    LOCAL_LLM_MODEL (окружение, затем .env) → gemini-3.6-flash-high.

.PARAMETER ReadyTimeoutSec
    Сколько ждать готовности модели после старта прокси. По умолчанию 180.

.PARAMETER Run
    Команда прогона ОДНОЙ СТРОКОЙ в кавычках, выполняется из server/ текущего
    дерева. Именно строкой: PowerShell иначе съедает --model/--mode прогона,
    префиксно матча их на параметр -Model самого скрипта (поймано живым
    тестом 2026-08-03).

.EXAMPLE
    # из любого дерева; скрипт можно звать по абсолютному пути из main
    pwsh -File "D:/Pax Historia LOCAL/scripts/llm-run.ps1"

.EXAMPLE
    pwsh -File "D:/Pax Historia LOCAL/scripts/llm-run.ps1" -Run "npx tsx scripts/runCampaignWithLLM.ts --years 2"

.EXAMPLE
    pwsh -File "D:/Pax Historia LOCAL/scripts/llm-run.ps1" -Model gemini-3.5-flash-low -Run "npx tsx scripts/benchLocalModels.ts --model gemini-3.5-flash-low --runs 10 --mode schema" 
#>
[CmdletBinding()]
param(
    [string] $Model,

    [int] $ReadyTimeoutSec = 180,

    [string] $Run
)

$ErrorActionPreference = 'Stop'
$ProxyExe = 'D:\CLIProxy\cli-proxy-api.exe'

function Fail([string] $message) {
    Write-Host "ОШИБКА: $message" -ForegroundColor Red
    exit 1
}

# --- 1. Корни: main (за .env) и текущее дерево (за код прогона) -------------

$commonDir = (git rev-parse --path-format=absolute --git-common-dir 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $commonDir) { Fail 'не репозиторий git' }
$mainRoot = Split-Path -Parent $commonDir
$treeRoot = (git rev-parse --show-toplevel)

# --- 2. env из main в ПРОЦЕСС; файл не копируется, значения не печатаются ---

$envPath = Join-Path $mainRoot 'server/.env'
$loaded = @()
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*(#|$)') { continue }
        $key, $value = $line -split '=', 2
        if ($null -eq $value) { continue }
        $key = $key.Trim(); $value = $value.Trim()
        # Окружение сильнее файла: LOCAL_LLM_MODEL=x llm-run.ps1 обязан победить.
        if (-not [Environment]::GetEnvironmentVariable($key)) {
            Set-Item -Path "env:$key" -Value $value
            $loaded += $key
        }
    }
}

if ($Model) { $env:LOCAL_LLM_MODEL = $Model }
if (-not $env:LOCAL_LLM_MODEL) { $env:LOCAL_LLM_MODEL = 'gemini-3.6-flash-high' }
$wanted = $env:LOCAL_LLM_MODEL

$base = if ($env:LOCAL_LLM_BASE_URL) { $env:LOCAL_LLM_BASE_URL.TrimEnd('/') }
        else { 'http://localhost:8317/v1' }

Write-Host "дерево:   $treeRoot"
Write-Host "env:      $envPath -> переменных подхвачено: $($loaded.Count) (имена: $($loaded -join ', '))"
Write-Host "эндпоинт: $base | модель: $wanted"

# --- 3. Готовность: нужная модель в /v1/models ------------------------------

function Get-ModelIds {
    $headers = @{}
    if ($env:LOCAL_LLM_API_KEY) { $headers.Authorization = "Bearer $($env:LOCAL_LLM_API_KEY)" }
    try {
        $response = Invoke-RestMethod -Uri "$base/models" -Headers $headers -TimeoutSec 5
        return @($response.data | ForEach-Object { $_.id })
    } catch {
        return $null   # эндпоинт не отвечает / отвергает — различает вызывающий
    }
}

$ids = Get-ModelIds
if ($null -eq $ids) {
    # Эндпоинт молчит — поднимаем прокси. Свёрнутым: прогон фоновая работа,
    # окно на переднем плане мешало бы пользователю.
    if (-not (Test-Path $ProxyExe)) { Fail "эндпоинт $base молчит, а $ProxyExe не найден" }
    Write-Host "прокси не отвечает — запускаю $ProxyExe (свёрнутым)"
    Start-Process -FilePath $ProxyExe -WorkingDirectory (Split-Path $ProxyExe) -WindowStyle Minimized | Out-Null

    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
    while ($true) {
        Start-Sleep -Seconds 2
        $ids = Get-ModelIds
        if ($null -ne $ids -and $ids -contains $wanted) { break }
        if ((Get-Date) -gt $deadline) {
            if ($null -eq $ids) { Fail "прокси не поднялся за $ReadyTimeoutSec с (эндпоинт $base не отвечает). Ключ: LOCAL_LLM_API_KEY $(if ($env:LOCAL_LLM_API_KEY) {'задан'} else {'НЕ задан'})" }
            Fail "прокси поднялся, но модели '$wanted' нет за $ReadyTimeoutSec с. Доступны: $($ids -join ', ')"
        }
    }
    Write-Host "прокси готов, модель '$wanted' в списке"
} elseif ($ids -contains $wanted) {
    # Уже работает — чей бы ни был, не перезапускаем и не закрываем.
    Write-Host "прокси уже работает (моделей: $($ids.Count)), '$wanted' доступна — не трогаю"
} else {
    Fail "эндпоинт отвечает, но модели '$wanted' нет. Доступны: $($ids -join ', ')"
}

# --- 4. Прогон из server/ текущего дерева -----------------------------------

$serverDir = Join-Path $treeRoot 'server'
if (-not (Test-Path $serverDir)) { Fail "в дереве нет server/: $serverDir" }

Push-Location $serverDir
try {
    if ($Run) {
        Write-Host "запускаю: $Run`n"
        Invoke-Expression $Run
        exit $LASTEXITCODE
    } else {
        Write-Host "команда не задана — проверка связи (listLocalModels)`n"
        npx tsx scripts/listLocalModels.ts
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}
