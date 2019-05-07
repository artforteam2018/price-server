:server
echo (%time%) server started.
node server
echo (%time%) WARNING: server closed or crashed, restarting.
goto server