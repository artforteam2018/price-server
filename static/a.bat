@echo off

set MYDIR=%cd%

for %%f in (%MYDIR%) do set myfolder=%%~nxf
if "%myfolder%" == "renderer" (
	cd ../../static
	node --max-old-space-size=6000 backend.js
) else (
	cd resources/app/dist/electron/static
	node --max-old-space-size=6000 backend.js
)