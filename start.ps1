# Быстрый запуск Geopolis: поднимает server (Express, :3000) и client (Vite,
# :5173) каждый в своём окне PowerShell и открывает игру в браузере.
#
# Использование:
#   .\start.ps1              — обычный запуск
#   .\start.ps1 -Install     — сначала npm install в server/ и client/
#
# Остановка: закрыть оба открывшихся окна (или Ctrl+C в каждом).

param(
    [switch]$Install
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

if ($Install) {
    Write-Host "Устанавливаю зависимости server/..." -ForegroundColor Cyan
    Push-Location (Join-Path $root "server")
    npm install
    Pop-Location

    Write-Host "Устанавливаю зависимости client/..." -ForegroundColor Cyan
    Push-Location (Join-Path $root "client")
    npm install
    Pop-Location
}

if (-not (Test-Path (Join-Path $root "server\node_modules"))) {
    Write-Host "server/node_modules не найден — запусти '.\start.ps1 -Install' один раз." -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path (Join-Path $root "client\node_modules"))) {
    Write-Host "client/node_modules не найден — запусти '.\start.ps1 -Install' один раз." -ForegroundColor Yellow
    exit 1
}

Write-Host "Запускаю сервер (порт 3000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\server'; npm run dev"

Write-Host "Запускаю клиент (порт 5173)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\client'; npm run dev"

Write-Host "Жду, пока клиент поднимется..." -ForegroundColor Cyan
Start-Sleep -Seconds 4

Start-Process "http://localhost:5173"

Write-Host "Готово. Игра открывается в браузере: http://localhost:5173" -ForegroundColor Green
Write-Host "Чтобы остановить — закрой оба открывшихся окна PowerShell." -ForegroundColor Green
