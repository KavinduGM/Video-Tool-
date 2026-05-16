@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

title AI Video Creator - Setup

echo ============================================================
echo   AI Video Creator - one-click setup
echo ============================================================
echo.
echo This will:
echo   1. Make sure Node.js is installed (uses winget if missing).
echo   2. Install npm dependencies (with network retry).
echo   3. Install the HeyGen Hyperframes CLI skill.
echo.
echo No C++ compiler is needed - this build has no native modules.
echo.
echo Working folder: %CD%
echo.
pause

REM ------------------------------------------------------------
REM 1. Node.js check
REM ------------------------------------------------------------
echo.
echo [1/3] Checking for Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo   Node.js NOT found.
    echo   Trying to install Node.js LTS via winget...
    where winget >nul 2>nul
    if errorlevel 1 (
        echo.
        echo   winget is not available on this PC.
        echo   Please install Node.js LTS manually from https://nodejs.org/
        echo   then re-run this setup script.
        echo.
        pause
        exit /b 1
    )
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo   winget failed to install Node.js. Install it manually from https://nodejs.org/
        echo   then re-run this setup script.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo   Node.js installed. CLOSE this window and re-run setup.bat so the
    echo   new PATH is picked up.
    echo.
    pause
    exit /b 0
) else (
    for /f "delims=" %%v in ('node --version') do set NODE_VER=%%v
    echo   OK: Node.js !NODE_VER!
)

where npm >nul 2>nul
if errorlevel 1 (
    echo   npm is not on PATH. Close this window and reopen, then re-run setup.bat.
    pause
    exit /b 1
)

REM ------------------------------------------------------------
REM 2. npm install (with retry, longer fetch timeout)
REM ------------------------------------------------------------
echo.
echo [2/3] Installing npm dependencies (this can take a few minutes)...
echo   Setting npm fetch-timeout to 5 minutes to ride out slow networks.

call npm config set fetch-timeout 300000
call npm config set fetch-retries 5
call npm config set fetch-retry-mintimeout 20000
call npm config set fetch-retry-maxtimeout 120000

set ATTEMPT=0
:NPM_INSTALL_RETRY
set /a ATTEMPT=ATTEMPT+1
echo   Attempt !ATTEMPT! of 3...
call npm install --no-fund --no-audit
if errorlevel 1 (
    if !ATTEMPT! lss 3 (
        echo.
        echo   npm install failed - retrying in 5 seconds...
        timeout /t 5 /nobreak >nul
        goto NPM_INSTALL_RETRY
    )
    echo.
    echo   npm install FAILED after 3 attempts.
    echo.
    echo   If you see "ETIMEDOUT" or "ECONNRESET" - it's a network issue.
    echo     Check your internet connection, disable VPN/proxy, and retry.
    echo.
    echo   If you see anything else, scroll up and read the actual error.
    echo.
    pause
    exit /b 1
)

REM ------------------------------------------------------------
REM 3. Hyperframes skill
REM ------------------------------------------------------------
echo.
echo [3/3] Installing HeyGen Hyperframes CLI skill...
call npx --yes skills add heygen-com/hyperframes
if errorlevel 1 (
    echo.
    echo   Hyperframes install FAILED. The app will still launch, but rendering
    echo   will not work until 'npx hyperframes --help' succeeds. Retry:
    echo     npx skills add heygen-com/hyperframes
    pause
)

echo.
echo ============================================================
echo   Setup complete.
echo ============================================================
echo.
echo   Double-click start.bat to launch AI Video Creator.
echo.
pause
endlocal
