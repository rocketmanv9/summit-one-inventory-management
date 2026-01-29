# PowerShell script to replace getUserIdFromHeaders usage with userId from createUserClient

$files = @(
    "src\app\api\inventory\reservations\[id]\fulfill\route.ts",
    "src\app\api\inventory\reservations\[id]\release\route.ts",
    "src\app\api\inventory\reservations\[id]\undo-fulfill\route.ts",
    "src\app\api\inventory\reservations\[id]\undo-release\route.ts",
    "src\app\api\settings\tenant\route.ts",
    "src\app\api\inventory\cycle-counts\[id]\start\route.ts",
    "src\app\api\inventory\cycle-counts\[id]\submit\route.ts",
    "src\app\api\inventory\rfid\devices\route.ts",
    "src\app\api\inventory\rfid\tags\assign\route.ts",
    "src\app\api\inventory\cycle-counts\[id]\lines\[line_id]\decide\route.ts",
    "src\app\api\supply-chain\receipts\route.ts",
    "src\app\api\supply-chain\receipts\[id]\route.ts",
    "src\app\api\inventory\assets\[id]\assign\route.ts",
    "src\app\api\inventory\assets\[id]\return\route.ts",
    "src\app\api\inventory\assets\[id]\route.ts",
    "src\app\api\inventory\locations\[id]\route.ts",
    "src\app\api\inventory\categories\[id]\route.ts",
    "src\app\api\inventory\receiving\draft\route.ts",
    "src\app\api\inventory\transfers\route.ts",
    "src\app\api\inventory\receiving\[id]\reverse\route.ts",
    "src\app\api\inventory\receiving\[id]\confirm\route.ts",
    "src\app\api\inventory\receiving\route.ts",
    "src\app\api\inventory\purchasing\route.ts",
    "src\app\api\inventory\locations\route.ts",
    "src\app\api\inventory\cycle-counts\route.ts",
    "src\app\api\inventory\categories\route.ts"
)

$rootPath = "c:\Users\grant\summit-one-inventory-management"

foreach ($file in $files) {
    $filePath = Join-Path $rootPath $file
    
    if (Test-Path $filePath) {
        $content = Get-Content $filePath -Raw
        
        # Remove getUserIdFromHeaders from imports
        $content = $content -replace ', getUserIdFromHeaders', ''
        $content = $content -replace 'getUserIdFromHeaders, ', ''
        
        # Replace pattern: const { supabase, tenantId } = await createUserClient(request);
        #                  const userId = getUserIdFromHeaders(request.headers);
        # With:            const { supabase, tenantId, userId } = await createUserClient(request);
        
        $pattern1 = 'const \{ supabase, tenantId \} = await createUserClient\(request\);\s*\n\s*const userId = getUserIdFromHeaders\(request\.headers\);'
        $replacement1 = 'const { supabase, tenantId, userId } = await createUserClient(request);'
        $content = $content -replace $pattern1, $replacement1
        
        # Also handle variant with role
        $pattern2 = 'const \{ supabase, tenantId, role \} = await createUserClient\(request\);\s*\n\s*const userId = getUserIdFromHeaders\(request\.headers\);'
        $replacement2 = 'const { supabase, tenantId, role, userId } = await createUserClient(request);'
        $content = $content -replace $pattern2, $replacement2
        
        # Save the file
        Set-Content -Path $filePath -Value $content -NoNewline
        Write-Host "Updated: $file" -ForegroundColor Green
    } else {
        Write-Host "File not found: $file" -ForegroundColor Yellow
    }
}

Write-Host "`nDone! Updated $($files.Count) files." -ForegroundColor Cyan
