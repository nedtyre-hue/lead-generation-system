$server = Start-Process -FilePath "npm" -ArgumentList "run dev" -WorkingDirectory "server" -PassThru -WindowStyle Minimized
$client = Start-Process -FilePath "npm" -ArgumentList "run dev" -WorkingDirectory "client" -PassThru -WindowStyle Minimized

Write-Host "Server PID: $($server.Id)"
Write-Host "Client PID: $($client.Id)"
Wait-Process -Id $server.Id, $client.Id
