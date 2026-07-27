# ============================================================
# start-all.ps1 — Full system restart for Trading Bot
# Usage: powershell -ExecutionPolicy Bypass -File start-all.ps1
# ============================================================

Write-Host "=============================" -ForegroundColor Cyan
Write-Host " Trading Bot Full Restart    " -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan

# 1. Clean up existing PM2 processes
Write-Host "[1/6] Cleaning up old PM2 tasks..." -ForegroundColor Yellow
pm2 delete all 2>$null
Start-Sleep -Seconds 2

# 3. Build TypeScript
Write-Host "[3/6] Building TypeScript engine..." -ForegroundColor Yellow
Set-Location "d:\Frerlancing\Treding Bot"
npm run build
if ($LASTEXITCODE -ne 0) {
  Write-Host "BUILD FAILED! Aborting." -ForegroundColor Red
  exit 1
}
Write-Host "Build OK" -ForegroundColor Green

# 4. Start all PM2 processes
Write-Host "[4/6] Starting PM2 cluster..." -ForegroundColor Yellow
pm2 start ecosystem.config.js
Start-Sleep -Seconds 3

# 5. Save PM2 process list (survives reboots)
Write-Host "[5/6] Saving PM2 state..." -ForegroundColor Yellow
pm2 save

# 6. Print status
Write-Host "[6/6] Current process status:" -ForegroundColor Yellow
pm2 list

Write-Host "" 
Write-Host "=============================" -ForegroundColor Green
Write-Host " All systems running!        " -ForegroundColor Green
Write-Host " Dashboard: http://localhost:3000" -ForegroundColor Green
Write-Host " API:       http://localhost:4000" -ForegroundColor Green
Write-Host " ML:        http://localhost:8000" -ForegroundColor Green
Write-Host "=============================" -ForegroundColor Green
