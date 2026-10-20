param(
    [string]$State = 'C:\Users\paule\Desktop\Pauly Cee Stream Server',
    [string]$Xml = 'C:\Users\paule\Desktop\fullRBexport.xml'
)
$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $State 'processes.json'
$record = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$($record.server)"
$server = Join-Path $PSScriptRoot 'server.py'
if (-not (Test-Path -LiteralPath $Xml)) { throw 'Library XML is missing.' }
if (-not $process -or $process.CommandLine -notlike '*server.py*' -or $process.CommandLine -notlike "*$State*") {
    throw 'Cannot verify the recorded audio server. Nothing was stopped.'
}
$python = $process.ExecutablePath
Stop-Process -Id $record.server
$started = Start-Process -FilePath $python -ArgumentList @('-u',('"'+$server+'"'),'--xml',('"'+$Xml+'"'),'--state',('"'+$State+'"'),'--port','4190','--public') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $State 'server-full.log') -RedirectStandardError (Join-Path $State 'server-full-errors.log')
$record.server = $started.Id
$record | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding Ascii
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $library = Invoke-RestMethod -Uri 'http://127.0.0.1:4190/library' -TimeoutSec 3
        Write-Output "Audio backend restarted: $($library.tracks.Count) tracks. Public tunnel and address unchanged."
        exit 0
    } catch { Start-Sleep -Milliseconds 500 }
}
throw 'Backend did not become ready. Check server-full-errors.log in the runtime folder.'
