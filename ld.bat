:server
echo (%time%) server started.
node old-back
echo (%time%) WARNING: server closed or crashed, restarting.
goto server