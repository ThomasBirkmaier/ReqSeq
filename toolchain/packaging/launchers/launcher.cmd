@echo off
rem Command line, MCP server and web UI of the delivery (ADR-0020): the CLI in lib\ on the delivery's own Node in
rem runtime\. NODE_OPTIONS is unset, so options from the environment cannot change the program.
setlocal
set "NODE_OPTIONS="
"%~dp0..\runtime\node.exe" "%~dp0..\lib\dist\bin.js" %*
exit /b %ERRORLEVEL%
