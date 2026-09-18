@echo off
setlocal
cd /d "%~dp0"
set "PORT=4021"
title x402 Local Server - Keep This Window Open
echo Starting x402 with normal Robinhood RPC access...
echo Keep this window open while testing.
echo.
node --watch server.js
echo.
echo The server stopped. Press any key to close this window.
pause >nul
