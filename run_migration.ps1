# Execute SQL Migration Script
# This script runs the schema fix migration directly against Supabase production

$connectionString = "Host=aws-0-us-east-1.pooler.supabase.com;Port=6543;Database=postgres;Username=postgres.cwmsvmywairkwdmvkdmw;Password=d.4UhxCQfqp4y*8;SSL Mode=Require;Trust Server Certificate=true"

$sqlFile = "supabase\migrations\20260122000001_fix_schema_api_mismatches.sql"
$sql = Get-Content $sqlFile -Raw

Write-Host "Connecting to Supabase production database..." -ForegroundColor Cyan

try {
    # Load Npgsql if available, otherwise use System.Data.SqlClient as fallback
    Add-Type -Path "C:\Program Files\PostgreSQL\*\lib\Npgsql.dll" -ErrorAction SilentlyContinue
    
    $connection = New-Object Npgsql.NpgsqlConnection($connectionString)
    $connection.Open()
    
    Write-Host "✓ Connected successfully" -ForegroundColor Green
    Write-Host "Executing migration..." -ForegroundColor Cyan
    
    $command = $connection.CreateCommand()
    $command.CommandText = $sql
    $command.CommandTimeout = 300
    
    $result = $command.ExecuteNonQuery()
    
    Write-Host "✓ Migration executed successfully!" -ForegroundColor Green
    Write-Host "Rows affected: $result" -ForegroundColor Gray
    
    $connection.Close()
    
    Write-Host "`n=== MIGRATION COMPLETE ===" -ForegroundColor Green
    Write-Host "All API schema mismatches have been fixed!" -ForegroundColor Green
    
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "`nFallback: Please run the SQL manually in Supabase SQL Editor" -ForegroundColor Yellow
    Write-Host "1. Go to: https://supabase.com/dashboard/project/cwmsvmywairkwdmvkdmw/sql" -ForegroundColor Yellow
    Write-Host "2. Copy contents of: $sqlFile" -ForegroundColor Yellow
    Write-Host "3. Paste and click Run" -ForegroundColor Yellow
    exit 1
}
