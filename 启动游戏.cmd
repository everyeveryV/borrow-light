@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\.bin\vite.cmd" (
  call npm install --cache "%CD%\.npm-cache" --offline=false
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo 借个光即将打开。游玩时请保持此窗口开启。
call npm run dev -- --open
pause
