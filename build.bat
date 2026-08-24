@echo off
setlocal

cd /d "%~dp0"

where dotnet >nul 2>nul
if errorlevel 1 (
    echo Error: The .NET SDK was not found on PATH.
    exit /b 1
)

dotnet --list-sdks | findstr /B /C:"11." >nul
if errorlevel 1 (
    echo Error: The .NET 11 SDK is required to build the runner.
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

echo Publishing self-contained .NET 11 runners...
pushd "extension"
call npm run build:runner
if errorlevel 1 goto :failed

echo Compiling the VS Code extension...
call npm run compile
if errorlevel 1 goto :failed

popd
echo Build completed successfully.
exit /b 0

:failed
set "BUILD_EXIT_CODE=%ERRORLEVEL%"
popd
echo Build failed with exit code %BUILD_EXIT_CODE%.
exit /b %BUILD_EXIT_CODE%
