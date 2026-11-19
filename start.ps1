$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$env:HOST='0.0.0.0'
$env:PORT='4186'
node server.mjs
