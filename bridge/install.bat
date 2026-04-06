@echo off
:: FireScrape Bridge — Windows Installer

echo === FireScrape Bridge Installer ===
echo.
echo Per trovare l'Extension ID:
echo   1. Apri chrome://extensions
echo   2. Attiva 'Modalita sviluppatore'
echo   3. Copia l'ID sotto 'FireScrape'
echo.

set /p EXT_ID="Extension ID: "
if "%EXT_ID%"=="" (
    echo Errore: Extension ID richiesto
    exit /b 1
)

set /p PORT="Porta HTTP [9222]: "
if "%PORT%"=="" set PORT=9222

set /p API_KEY="API Key (vuoto = nessuna auth): "

:: Percorso corrente
set SCRIPT_DIR=%~dp0
set SERVER_PATH=%SCRIPT_DIR%server.js

:: Crea wrapper batch
set WRAPPER=%SCRIPT_DIR%run-bridge.bat
(
echo @echo off
echo set FIRESCRAPE_PORT=%PORT%
echo set FIRESCRAPE_API_KEY=%API_KEY%
echo node "%SERVER_PATH%"
) > "%WRAPPER%"

:: Registry key per Native Messaging
set REG_KEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.firescrape.bridge
set MANIFEST_PATH=%SCRIPT_DIR%com.firescrape.bridge.json

:: Scrivi manifest con percorsi corretti
(
echo {
echo   "name": "com.firescrape.bridge",
echo   "description": "FireScrape Local Bridge — HTTP API on port %PORT%",
echo   "path": "%WRAPPER:\=\\%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXT_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

:: Registra nel registry
reg add "%REG_KEY%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f > nul 2>&1

echo.
echo === Installazione completata ===
echo   Manifest: %MANIFEST_PATH%
echo   Server:   %SERVER_PATH%
echo   Porta:    %PORT%
echo   API Key:  %API_KEY%
echo.
echo Riavvia Chrome per attivare il bridge.
echo.
echo Test rapido:
echo   curl http://127.0.0.1:%PORT%/api/health
echo   curl -X POST http://127.0.0.1:%PORT%/api/scrape
pause
