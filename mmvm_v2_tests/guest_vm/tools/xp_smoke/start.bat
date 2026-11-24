@echo off
rem Run from the test CD. Copy into C: so every guest disk write hits the overlay.
if not exist C:\GVM_SMOKE mkdir C:\GVM_SMOKE
if not exist C:\GVM_SMOKE\WWW mkdir C:\GVM_SMOKE\WWW
copy /Y "%~dp0GUEST.EXE" C:\GVM_SMOKE\GUEST.EXE
copy /Y "%~dp0NODE_WEB.JS" C:\GVM_SMOKE\NODE_WEB.JS
copy /Y "%~dp0WWW\*" C:\GVM_SMOKE\WWW\
cd /d C:\GVM_SMOKE
echo Starting the guest VM HTTP server on port 8000.
GUEST.EXE NODE_WEB.JS --directory WWW 8000
echo Server exited with status %ERRORLEVEL%.
pause
