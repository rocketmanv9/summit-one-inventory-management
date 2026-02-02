# Get all route.ts files dynamically
$routeFiles = Get-ChildItem -Path .\src\app\api -Filter route.ts -Recurse | Select-Object -ExpandProperty FullName

$results = @()
foreach ($file in $routeFiles) {
  $lines = Get-Content $file -ErrorAction SilentlyContinue
  if ($lines) {
    for ($i = 0; $i -lt $lines.Count; $i++) {
      $line = $lines[$i]
      # Match both formats: "export async function POST(" and "export async function POST(request: NextRequest)"
      if ($line -match "export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)") {
        $method = $matches[1]
        $hasIdempotency = $false
        $idempotencyLine = 0
        
        # Check next 30 lines for requireIdempotencyKey
        for ($j = $i; $j -lt [Math]::Min($i + 30, $lines.Count); $j++) {
          if ($lines[$j] -match "requireIdempotencyKey") {
            $hasIdempotency = $true
            $idempotencyLine = $j + 1
            break
          }
        }
        
        # Convert to relative path
        $relativePath = $file -replace [regex]::Escape($PWD.Path + "\"), ""
        $route = $relativePath -replace "src\\app\\api\\", "/api/" -replace "\\", "/" -replace "/route\.ts", ""
        
        $results += [PSCustomObject]@{
          Route = $route
          Method = $method
          HandlerLine = $i + 1
          HasIdempotency = $hasIdempotency
          IdempotencyLine = $idempotencyLine
          File = $relativePath
        }
      }
    }
  }
}

# Output CSV
Write-Output "Route,Method,requireIdempotencyKey?,Evidence"
foreach ($r in $results | Sort-Object Route, Method) {
  $evidence = if ($r.HasIdempotency) { "$($r.File):$($r.IdempotencyLine)" } else { "MISSING" }
  $hasIt = if ($r.HasIdempotency) { "Yes" } else { "NO" }
  Write-Output "$($r.Route),$($r.Method),$hasIt,$evidence"
}

# Summary
Write-Host "`n`n============================================" -ForegroundColor Cyan
Write-Host "IDEMPOTENCY AUDIT SUMMARY" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Total Mutating Handlers: $($results.Count)" -ForegroundColor Yellow
Write-Host "With Idempotency Key Enforcement: $($results | Where-Object { $_.HasIdempotency } | Measure-Object | Select-Object -ExpandProperty Count)" -ForegroundColor Green
Write-Host "WITHOUT Idempotency Key (MISSING): $($results | Where-Object { -not $_.HasIdempotency } | Measure-Object | Select-Object -ExpandProperty Count)" -ForegroundColor Red
Write-Host "============================================`n" -ForegroundColor Cyan

# Show missing ones
$missing = $results | Where-Object { -not $_.HasIdempotency }
if ($missing) {
  Write-Host "Handlers WITHOUT idempotency enforcement:" -ForegroundColor Red
  foreach ($m in $missing) {
    Write-Host "  - $($m.Route) [$($m.Method)] at $($m.File):$($m.HandlerLine)" -ForegroundColor Yellow
  }
}
