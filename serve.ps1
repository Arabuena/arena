$port = 5500
$root = (Get-Location).Path
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving $root on http://localhost:$port/"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
  $path = Join-Path $root $rel
  if (Test-Path $path -PathType Container) { $path = Join-Path $path 'index.html' }
  if (!(Test-Path $path)) {
    $res.StatusCode = 404
    $buf = [Text.Encoding]::UTF8.GetBytes('Not Found')
    $res.OutputStream.Write($buf,0,$buf.Length)
    $res.Close()
    continue
  }
  $bytes = [IO.File]::ReadAllBytes($path)
  $ext = [IO.Path]::GetExtension($path).ToLower()
  switch ($ext) {
    '.html' { $res.ContentType = 'text/html' }
    '.htm'  { $res.ContentType = 'text/html' }
    '.css'  { $res.ContentType = 'text/css' }
    '.js'   { $res.ContentType = 'application/javascript' }
    '.svg'  { $res.ContentType = 'image/svg+xml' }
    default { $res.ContentType = 'application/octet-stream' }
  }
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes,0,$bytes.Length)
  $res.Close()
}