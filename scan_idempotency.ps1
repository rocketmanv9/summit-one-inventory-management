$files = @(
  "src\app\api\inventory\items\route.ts",
  "src\app\api\dashboards\route.ts",
  "src\app\api\inventory\reservations\[id]\route.ts",
  "src\app\api\inventory\transfers\[id]\ship\route.ts",
  "src\app\api\widgets\data\route.ts",
  "src\app\api\inventory\transfers\[id]\receive\route.ts",
  "src\app\api\widgets\layout\route.ts",
  "src\app\api\inventory\transfers\[id]\cancel\route.ts",
  "src\app\api\inventory\transfers\[id]\route.ts",
  "src\app\api\dashboards\[id]\widgets\[widgetId]\route.ts",
  "src\app\api\dev-session\route.ts",
  "src\app\api\dashboards\[id]\widgets\route.ts",
  "src\app\api\dashboards\[id]\route.ts",
  "src\app\api\inventory\reservations\[id]\fulfill\route.ts",
  "src\app\api\inventory\reservations\[id]\release\route.ts",
  "src\app\api\inventory\categories\[id]\route.ts",
  "src\app\api\inventory\transfers\[id]\undo-cancel\route.ts",
  "src\app\api\inventory\cycle-counts\[id]\start\route.ts",
  "src\app\api\inventory\cycle-counts\[id]\submit\route.ts",
  "src\app\api\inventory\cycle-counts\[id]\approve\route.ts",
  "src\app\api\settings\tenant\route.ts",
  "src\app\api\inventory\reservations\[id]\undo-fulfill\route.ts",
  "src\app\api\inventory\reservations\[id]\undo-release\route.ts",
  "src\app\api\inventory\location-types\[id]\route.ts",
  "src\app\api\inventory\cycle-counts\[id]\lines\[line_id]\route.ts",
  "src\app\api\inventory\assignment-types\[id]\route.ts",
  "src\app\api\inventory\rfid\tags\assign\route.ts",
  "src\app\api\inventory\rfid\tags\capture\route.ts",
  "src\app\api\inventory\rfid\devices\route.ts",
  "src\app\api\inventory\rfid\devices\authenticate\route.ts",
  "src\app\api\inventory\rfid\devices\sync\route.ts",
  "src\app\api\inventory\rfid\devices\heartbeat\route.ts",
  "src\app\api\inventory\rfid\cycle-counts\submit\route.ts",
  "src\app\api\inventory\rfid\bulk-assignment\start\route.ts",
  "src\app\api\inventory\rfid\bulk-assignment\[session_id]\add-tag\route.ts",
  "src\app\api\inventory\rfid\bulk-assignment\[session_id]\complete\route.ts",
  "src\app\api\inventory\assets\[id]\assign\route.ts",
  "src\app\api\inventory\assets\[id]\return\route.ts",
  "src\app\api\supply-chain\receipts\[id]\validate\route.ts",
  "src\app\api\supply-chain\receipts\[id]\confirm\route.ts",
  "src\app\api\inventory\transfers\[id]\undo-ship\route.ts",
  "src\app\api\inventory\transfers\[id]\reverse\route.ts",
  "src\app\api\inventory\transfers\[id]\reverse-receipt\route.ts",
  "src\app\api\inventory\cycle-counts\[id]\lines\[line_id]\decide\route.ts",
  "src\app\api\inventory\cycle-counts\[id]\lines\[line_id]\assets\route.ts",
  "src\app\api\inventory\purchasing\[id]\route.ts",
  "src\app\api\webhooks\core-events\route.ts",
  "src\app\api\supply-chain\receipts\route.ts",
  "src\app\api\supply-chain\receipts\[id]\route.ts",
  "src\app\api\inventory\locations\[id]\route.ts",
  "src\app\api\inventory\vendors\[id]\route.ts",
  "src\app\api\inventory\vendor-items\[id]\route.ts",
  "src\app\api\inventory\transfers\route.ts",
  "src\app\api\inventory\vendor-items\route.ts",
  "src\app\api\inventory\locations\route.ts",
  "src\app\api\inventory\reservations\route.ts",
  "src\app\api\inventory\movements\[id]\reverse\route.ts",
  "src\app\api\inventory\receiving\[id]\reverse\route.ts",
  "src\app\api\inventory\receiving\route.ts",
  "src\app\api\inventory\receiving\[id]\confirm\route.ts",
  "src\app\api\inventory\receiving\draft\route.ts",
  "src\app\api\inventory\purchasing\route.ts",
  "src\app\api\inventory\cycle-counts\route.ts",
  "src\app\api\inventory\items\[id]\route.ts",
  "src\app\api\inventory\location-types\route.ts",
  "src\app\api\inventory\categories\route.ts",
  "src\app\api\inventory\abc-classification\calculate\route.ts",
  "src\app\api\inventory\assets\route.ts",
  "src\app\api\inventory\assets\[id]\route.ts",
  "src\app\api\inventory\alerts\[id]\dismiss\route.ts",
  "src\app\api\inventory\alerts\[id]\acknowledge\route.ts",
  "src\app\api\inventory\assignment-types\route.ts",
  "src\app\api\inventory\alerts\refresh\route.ts",
  "src\app\api\inventory\accounting\expenses\[id]\route.ts",
  "src\app\api\inventory\accounting\expenses\[id]\match\route.ts",
  "src\app\api\auth\dev-login\route.ts",
  "src\app\api\auth\session\route.ts",
  "src\app\api\auth\logout\route.ts",
  "src\app\api\inventory\vendors\route.ts"
)

$results = @()
foreach ($file in $files) {
  $lines = Get-Content $file -ErrorAction SilentlyContinue
  if ($lines) {
    for ($i = 0; $i -lt $lines.Count; $i++) {
      $line = $lines[$i]
      if ($line -match "export async function (POST|PUT|PATCH|DELETE)") {
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
        
        $route = $file -replace "src\\app\\api\\", "/api/" -replace "\\", "/" -replace "/route\.ts", ""
        $results += [PSCustomObject]@{
          Route = $route
          Method = $method
          HandlerLine = $i + 1
          HasIdempotency = $hasIdempotency
          IdempotencyLine = $idempotencyLine
          File = $file
        }
      }
    }
  }
}

Write-Output "Route,Method,requireIdempotencyKey?,Evidence"
foreach ($r in $results | Sort-Object Route, Method) {
  $evidence = if ($r.HasIdempotency) { "$($r.File):$($r.IdempotencyLine)" } else { "MISSING" }
  $hasIt = if ($r.HasIdempotency) { "Yes" } else { "NO" }
  Write-Output "$($r.Route),$($r.Method),$hasIt,$evidence"
}

Write-Host "`n`nSummary:" -ForegroundColor Cyan
Write-Host "Total Handlers: $($results.Count)" -ForegroundColor Yellow
Write-Host "With Idempotency: $($results | Where-Object { $_.HasIdempotency } | Measure-Object | Select-Object -ExpandProperty Count)" -ForegroundColor Green
Write-Host "WITHOUT Idempotency: $($results | Where-Object { -not $_.HasIdempotency } | Measure-Object | Select-Object -ExpandProperty Count)" -ForegroundColor Red
