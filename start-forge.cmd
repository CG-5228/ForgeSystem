@echo off
title FORGE server
cd /d "%~dp0"
echo Starting FORGE... dashboard: http://localhost:4000
start "" http://localhost:4000
"C:\Program Files\nodejs\node.exe" server\server.js
pause
