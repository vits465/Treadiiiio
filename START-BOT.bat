@echo off
setlocal

echo.
echo  ========================================================
echo   TRADING BOT - FULL SYSTEM START
echo   Keep this window OPEN to keep the bot running!
echo  ========================================================
echo.

cd /d "d:\Frerlancing\Treding Bot"

REM Kill any existing node/python processes to free up ports
echo [1/4] Clearing old processes...
taskkill /F /IM node.exe /T >nul 2>&1
taskkill /F /IM python.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul

REM Kill pm2 daemon if running
echo [2/4] Stopping old PM2 daemon...
pm2 kill >nul 2>&1
timeout /t 2 /nobreak >nul

REM Start everything
echo [3/4] Starting all services with PM2...
pm2 start ecosystem.config.js
pm2 save

REM Show status
echo.
echo [4/4] System Status:
pm2 list

echo.
echo  ========================================================
echo   ALL SYSTEMS ONLINE!
echo.
echo   Dashboard (Local):  http://localhost:3000
echo   API Server:         http://localhost:4000
echo   ML Service:         http://localhost:8000
echo.  
echo   DO NOT CLOSE this window!
echo   Bot will stop if you close it.
echo  ========================================================
echo.

REM Keep window alive and show live logs
pm2 logs --lines 50

