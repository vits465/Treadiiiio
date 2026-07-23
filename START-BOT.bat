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
ping -n 3 127.0.0.1 >nul

REM Kill pm2 daemon if running
echo [2/4] Stopping old PM2 daemon...
pm2 kill >nul 2>&1
ping -n 3 127.0.0.1 >nul

REM Start everything
echo [3/4] Starting all services with PM2...
pm2 start ecosystem.config.js
pm2 save

echo.
echo [4/4] Current Status:
pm2 list

echo.
echo  ========================================================
echo   ALL SYSTEMS ONLINE!
echo.
echo   Dashboard (Local):  http://localhost:3000
echo   API Server:         http://localhost:4000
echo   ML Service:         http://localhost:8000
echo.
echo   Vercel Dashboard:   https://treadiiiio.vercel.app
echo  ========================================================
echo.
echo  Bot is running in the background via PM2.
echo  You can close this window safely.
echo  To check status: open new CMD and type: pm2 list
echo  To see live logs: pm2 logs
echo  To stop the bot:  pm2 kill
echo.
pause

