@echo off
rem Command line and MCP server of the delivery (ADR-0014): the CLI on the delivery's Electron binary as plain Node.
rem @PRODUCT@ is filled in from names.json by scripts/package/stage.mjs.
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\@PRODUCT@.exe" "%~dp0..\resources\cli\dist\bin.js" %*
exit /b %ERRORLEVEL%
