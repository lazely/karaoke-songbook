@echo off
setlocal

rem Karaoke songbook - local server for phone access.
rem Uses the node path that Windows Firewall already allows.
set "NODE_EXE=%LOCALAPPDATA%\nvm\v24.6.0\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo Starting server...
echo.
"%NODE_EXE%" "%~dp0server.js"
echo.
echo Server stopped.
pause
