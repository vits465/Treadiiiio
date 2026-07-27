@echo off
setlocal

echo.
echo  ========================================================
echo   TRADING BOT - FULL SYSTEM START
echo   Keep this window OPEN to keep the bot running!
echo  ========================================================
echo.

cd /d "%~dp0"

REM Clean up old PM2 processes
echo [1/4] Clearing existing PM2 processes...
call npx pm2 delete all >nul 2>&1
ping -n 3 127.0.0.1 >nul

REM Build TypeScript engine
echo [2/4] Building engine code...
call npm run build

REM Start everything with PM2
echo [3/4] Starting all services with PM2...
call npx pm2 start ecosystem.config.js
call npx pm2 save

echo.
echo [4/4] Current Status:
call npx pm2 list

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
echo  To check status: open new CMD and type: npx pm2 list
echo  To see live logs: npx pm2 logs
echo  To stop the bot:  npx pm2 kill
echo.
pause


