$files = @(
  'src\app\api\inventory\reservations\[id]\fulfill\route.ts',
  'src\app\api\inventory\reservations\[id]\release\route.ts',
  'src\app\api\inventory\reservations\[id]\route.ts',
  'src\app\api\inventory\reservations\[id]\undo-fulfill\route.ts',
  'src\app\api\inventory\reservations\[id]\undo-release\route.ts',
  'src\app\api\inventory\rfid\bulk-assignment\[session_id]\add-tag\route.ts',
  'src\app\api\inventory\rfid\bulk-assignment\[session_id]\complete\route.ts',
  'src\app\api\inventory\transfers\[id]\undo-cancel\route.ts',
  'src\app\api\inventory\vendors\[id]\items\route.ts',
  'src\app\api\supply-chain\purchase-orders\[id]\receipts\route.ts',
  'src\app\api\supply-chain\purchase-orders\[id]\receiving\route.ts',
  'src\app\api\supply-chain\receipts\[id]\confirm\route.ts',
  'src\app\api\supply-chain\receipts\[id]\route.ts',
  'src\app\api\supply-chain\receipts\[id]\validate\route.ts'
)
foreach ($file in $files) {
    $fullPath = "c:\Users\grant\summit-one-inventory-management\$file"
    $content = [System.IO.File]::ReadAllText($fullPath)
    $content = $content.Replace('{ params }: { params: { id: string } }', '{ params }: { params: Promise<{ id: string }> }')
    $content = $content.Replace('{ params }: { params: { session_id: string } }', '{ params }: { params: Promise<{ session_id: string }> }')
    $content = $content.Replace('const { id } = params;', 'const { id } = await params;')
    $content = $content.Replace('const { session_id } = params;', 'const { session_id } = await params;')
    [System.IO.File]::WriteAllText($fullPath, $content)
}
Write-Host "Fixed all remaining files"
