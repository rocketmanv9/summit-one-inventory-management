#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Dev tool authentication helper - Exchange ticket for JWT

.DESCRIPTION
    This script exchanges a Core SSO ticket for an inventory service JWT.
    Use the JWT in your API requests for authenticated access.

.PARAMETER Ticket
    The 32-character ticket from Core SSO

.PARAMETER InventoryUrl
    The inventory service URL (default: http://localhost:3000)

.EXAMPLE
    .\dev-auth.ps1 -Ticket "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

.EXAMPLE
    $jwt = .\dev-auth.ps1 -Ticket "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
    Invoke-RestMethod -Uri "http://localhost:3000/api/inventory/items" -Headers @{Authorization="Bearer $jwt"}
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$Ticket,
    
    [Parameter(Mandatory=$false)]
    [string]$InventoryUrl = "http://localhost:3000"
)

# Validate ticket format
if ($Ticket.Length -ne 32) {
    Write-Error "Invalid ticket: must be exactly 32 characters (got $($Ticket.Length))"
    exit 1
}

Write-Host "🔐 Authenticating with ticket..." -ForegroundColor Cyan

try {
    # Exchange ticket (don't follow redirects)
    $response = Invoke-WebRequest `
        -Uri "$InventoryUrl/auth/callback?ticket=$Ticket" `
        -Method GET `
        -MaximumRedirection 0 `
        -ErrorAction SilentlyContinue

    # Extract redirect location
    $redirectUrl = $response.Headers.Location

    if (-not $redirectUrl) {
        Write-Error "No redirect URL received from server"
        exit 1
    }

    # Extract JWT from redirect URL
    if ($redirectUrl -match 'access_token=([^&]+)') {
        $jwt = $matches[1]
        
        Write-Host "✅ Authentication successful!" -ForegroundColor Green
        Write-Host ""
        Write-Host "JWT obtained (expires in 7 days)" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Use in PowerShell:" -ForegroundColor White
        Write-Host "  `$jwt = '$jwt'" -ForegroundColor Gray
        Write-Host "  `$headers = @{ Authorization = 'Bearer `$jwt'; apikey = `$env:NEXT_PUBLIC_SUPABASE_ANON_KEY }" -ForegroundColor Gray
        Write-Host "  Invoke-RestMethod -Uri '$InventoryUrl/api/inventory/items' -Headers `$headers" -ForegroundColor Gray
        Write-Host ""
        Write-Host "Use in cURL:" -ForegroundColor White
        Write-Host "  curl $InventoryUrl/api/inventory/items \\" -ForegroundColor Gray
        Write-Host "    -H 'Authorization: Bearer $jwt' \\" -ForegroundColor Gray
        Write-Host "    -H 'apikey: YOUR_ANON_KEY'" -ForegroundColor Gray
        Write-Host ""
        
        # Return JWT for pipeline usage
        return $jwt
    }
    else {
        Write-Error "Failed to extract JWT from redirect URL: $redirectUrl"
        exit 1
    }
}
catch {
    Write-Error "Authentication failed: $_"
    exit 1
}
