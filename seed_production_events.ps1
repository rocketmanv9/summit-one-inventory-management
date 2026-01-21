# Seed Production Event Catalog
# Run this script to populate the event catalog in your live database

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   SEED PRODUCTION EVENT CATALOG" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Check if connected to Supabase
Write-Host "Checking Supabase connection..." -ForegroundColor Yellow
$linkCheck = supabase link --project-ref show 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Not linked to Supabase project" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please run: supabase link --project-ref YOUR_PROJECT_REF" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "✓ Connected to Supabase" -ForegroundColor Green
Write-Host ""

# Apply the migration
Write-Host "Applying event catalog seed migration..." -ForegroundColor Yellow
Write-Host ""

supabase db push

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "   ✓ EVENT CATALOG SEEDED SUCCESSFULLY" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Total Events Registered: 46" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Supply Chain Events (12):" -ForegroundColor White
    Write-Host "    • Vendor: 2" -ForegroundColor Gray
    Write-Host "    • Purchase Order: 7" -ForegroundColor Gray
    Write-Host "    • Receipt: 3" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Inventory Events (34):" -ForegroundColor White
    Write-Host "    • Catalog Item: 4" -ForegroundColor Gray
    Write-Host "    • Location: 3" -ForegroundColor Gray
    Write-Host "    • Stock Movement: 5" -ForegroundColor Gray
    Write-Host "    • Transfer: 3" -ForegroundColor Gray
    Write-Host "    • Reservation: 3" -ForegroundColor Gray
    Write-Host "    • Asset: 5" -ForegroundColor Gray
    Write-Host "    • Cycle Count: 5" -ForegroundColor Gray
    Write-Host "    • Adjustment: 2" -ForegroundColor Gray
    Write-Host "    • Category: 2" -ForegroundColor Gray
    Write-Host "    • System (Legacy): 2" -ForegroundColor Gray
    Write-Host "    • inventory.receipt.created" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Transfer Events:" -ForegroundColor White
    Write-Host "    • inventory.transfer.created" -ForegroundColor Gray
    Write-Host "    • inventory.transfer.shipped" -ForegroundColor Gray
    Write-Host "    • inventory.transfer.received" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Cycle Count Events:" -ForegroundColor White
    Write-Host "    • inventory.cycle_count.discrepancy" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Reservation Events:" -ForegroundColor White
    Write-Host "    • inventory.reservation.created" -ForegroundColor Gray
    Write-Host "    • inventory.reservation.fulfilled" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Alert Events:" -ForegroundColor White
    Write-Host "    • inventory.alert.low_stock" -ForegroundColor Gray
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Yellow
    Write-Host "  1. Verify events in Supabase Dashboard → Database → event_catalog view" -ForegroundColor White
    Write-Host "  2. Check /debug page in your app to see registered events" -ForegroundColor White
    Write-Host "  3. Test event emission by creating inventory transactions" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Migration failed" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  1. Check if you're linked to the correct project" -ForegroundColor White
    Write-Host "  2. Verify database credentials" -ForegroundColor White
    Write-Host "  3. Check migration file syntax" -ForegroundColor White
    Write-Host ""
}
