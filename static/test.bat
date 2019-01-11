@echo off
cd resources/app/dist/electron/static

set MYDIR=%cd%

for %%f in (%MYDIR%) do set myfolder=%%~nxf
if "%myfolder%" == "renderer" (
	cd ../../static
) else (
	node --max-old-space-size=6000 backend.js
)
@pause