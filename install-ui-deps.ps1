# Quick Install Script for UI Dependencies
# Run this to install all missing dependencies at once

Write-Host "Installing shadcn/ui components..." -ForegroundColor Cyan

# Check if shadcn is initialized
if (!(Test-Path "components.json")) {
    Write-Host "Initializing shadcn/ui..." -ForegroundColor Yellow
    npx shadcn@latest init
}

# Install all required UI components
Write-Host "Installing UI components: dialog, button, input, label, textarea, select, alert, tabs..." -ForegroundColor Yellow
npx shadcn@latest add dialog button input label textarea select alert tabs

# Install sonner for toast notifications
Write-Host "Installing sonner for toast notifications..." -ForegroundColor Yellow
npm install sonner

Write-Host "`n✅ All dependencies installed!" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "1. Restart your TypeScript language server (VS Code: Ctrl+Shift+P -> 'TypeScript: Restart TS Server')"
Write-Host "2. Run 'npm run dev' to start the development server"
Write-Host "3. All 20 import errors should now be resolved!"
