#!/usr/bin/env node

// Update script for API error handlers
// This will find all API route files and add the error handler

const fs = require('fs');
const path = require('path');

const apiDir = 'src/app/api';
const errorHandlerImport = "import { handleApiError } from '@/lib/api-error-handler';";

function findAllRouteFiles(dir) {
  let routes = [];
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory() && !file.startsWith('.')) {
      routes = routes.concat(findAllRouteFiles(fullPath));
    } else if (file === 'route.ts') {
      routes.push(fullPath);
    }
  }
  
  return routes;
}

function updateRouteFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // Skip if already updated
  if (content.includes('handleApiError')) {
    return false;
  }
  
  // Skip if doesn't use createUserClient
  if (!content.includes('createUserClient')) {
    return false;
  }
  
  // Add the import
  const importLine = "import { handleApiError } from '@/lib/api-error-handler';\n";
  content = content.replace(
    /^(import .* from .*);\n/m,
    (match) => match + importLine
  );
  
  // Replace generic error handlers
  content = content.replace(
    /} catch \(error\) {\s+console\.error\('Unexpected error:', error\);\s+return NextResponse\.json\(\s+{ error: 'Internal server error' },\s+{ status: 500 }\s+\);\s+}/g,
    '} catch (error) {\n    return handleApiError(error);\n  }'
  );
  
  fs.writeFileSync(filePath, content);
  return true;
}

const routes = findAllRouteFiles(apiDir);
let updated = 0;

for (const route of routes) {
  if (updateRouteFile(route)) {
    updated++;
    console.log(`Updated: ${route}`);
  }
}

console.log(`\nTotal updated: ${updated} files`);
