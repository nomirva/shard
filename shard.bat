@echo off
bun run %~dp0 %*
if errorlevel 1 (
    exit /b %errorlevel%
)