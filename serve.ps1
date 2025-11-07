param([int]$Port = 8000)
# Carregar variáveis de um arquivo .env (se existir)
$envFile = Join-Path (Get-Location).Path '.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    $kv = $line.Split('=', 2)
    if ($kv.Length -eq 2) {
      $name = $kv[0].Trim()
      $value = $kv[1].Trim()
      [Environment]::SetEnvironmentVariable($name, $value)
    }
  }
}
if (-not $PSBoundParameters.ContainsKey('Port') -and $env:PORT) { $Port = [int]$env:PORT }
$port = $Port
$root = (Get-Location).Path
Write-Host "Serving $root on http://127.0.0.1:$port/ (localhost também suportado)"

# Servidor TCP simples (não depende de URLACL)
# Escuta em IPv6 com DualMode para aceitar conexões IPv6 e IPv4 (localhost/127.0.0.1)
$endpointV6 = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::IPv6Any, $port)
$tcp = [System.Net.Sockets.TcpListener]::new($endpointV6)
try { $tcp.Server.DualMode = $true } catch {}
try { $tcp.Start() } catch { Write-Host "Falha ao iniciar TcpListener na porta $port" -ForegroundColor Red; exit 1 }
while ($true) {
  $client = $tcp.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [Text.Encoding]::ASCII)
    $requestLine = $reader.ReadLine()
    if (-not $requestLine) { $client.Close(); continue }
    # Consumir cabeçalhos até linha vazia
    while ($true) { $line = $reader.ReadLine(); if ($null -eq $line -or $line -eq '') { break } }
    $parts = $requestLine.Split(' ')
    $method = $parts[0]
    $path = if ($parts.Length -ge 2) { $parts[1] } else { '/' }
    if ($path -eq '/') { $path = '/index.html' }
    $rel = [Uri]::UnescapeDataString($path.TrimStart('/'))
    $file = Join-Path $root $rel
    if (Test-Path $file -PathType Container) { $file = Join-Path $file 'index.html' }
    if (!(Test-Path $file)) {
      $resp = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`nContent-Length: 9`r`nConnection: close`r`n`r`nNot Found"
      $bytes = [Text.Encoding]::ASCII.GetBytes($resp)
      $stream.Write($bytes, 0, $bytes.Length)
      $client.Close(); continue
    }
    $bytes = [IO.File]::ReadAllBytes($file)
    $ext = [IO.Path]::GetExtension($file).ToLower()
    switch ($ext) {
      '.html' { $ct = 'text/html' }
      '.htm'  { $ct = 'text/html' }
      '.css'  { $ct = 'text/css' }
      '.js'   { $ct = 'application/javascript' }
      '.wasm' { $ct = 'application/wasm' }
      '.svg'  { $ct = 'image/svg+xml' }
      default { $ct = 'application/octet-stream' }
    }
    # HEAD deve retornar apenas cabeçalhos
    $header = "HTTP/1.1 200 OK`r`nContent-Type: $ct`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
    $hbytes = [Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($hbytes, 0, $hbytes.Length)
    if ($method -ne 'HEAD') { $stream.Write($bytes, 0, $bytes.Length) }
  } catch {
    # ignora erros de conexão
  } finally {
    try { $client.Close() } catch {}
  }
}