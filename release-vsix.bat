@echo off
setlocal

cd /d "%~dp0"

where dotnet >nul 2>nul
if errorlevel 1 (
    echo Error: The .NET SDK was not found on PATH.
    exit /b 1
)

for /f "tokens=1 delims=." %%V in ('dotnet --version') do set "DOTNET_SDK_MAJOR=%%V"
if %DOTNET_SDK_MAJOR% LSS 8 (
    echo Error: The .NET 8 SDK or newer is required to package the extension.
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo Error: Node.js was not found on PATH.
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo Error: npm was not found on PATH.
    exit /b 1
)

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 20 (
    echo Error: Node.js 20 or newer is required; found version %NODE_MAJOR%.
    exit /b 1
)

if not exist "extension\node_modules" (
    echo Error: Extension dependencies are missing. Run npm install in the extension directory first.
    exit /b 1
)

echo Building, packaging, and verifying the VSIX...
pushd "extension"
call npm run release:check
if errorlevel 1 goto :failed

popd
echo VSIX release completed successfully. Package written to extension\.
exit /b 0

:failed
set "RELEASE_EXIT_CODE=%ERRORLEVEL%"
popd
echo VSIX release failed with exit code %RELEASE_EXIT_CODE%.
exit /b %RELEASE_EXIT_CODE%
