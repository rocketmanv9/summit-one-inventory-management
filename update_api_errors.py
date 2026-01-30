#!/usr/bin/env python3
"""Update all API route files to use proper error handling"""

import os
import re
from pathlib import Path

api_dir = Path("src/app/api")
updated_count = 0

# Find all route.ts files
for route_file in api_dir.rglob("route.ts"):
    with open(route_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Skip if already updated
    if 'handleApiError' in content:
        continue
    
    # Skip if doesn't use createUserClient
    if 'createUserClient' not in content:
        continue
    
    original_content = content
    
    # Add the error handler import
    if "import { createUserClient } from '@/lib/db-middleware';" in content:
        content = content.replace(
            "import { createUserClient } from '@/lib/db-middleware';",
            "import { createUserClient } from '@/lib/db-middleware';\nimport { handleApiError } from '@/lib/api-error-handler';"
        )
    
    # Replace common error handler patterns
    # Pattern 1: With console.error
    pattern1 = r'}\s+catch\s+\(\s*error\s*\)\s+\{\s+console\.error\([^)]+\);\s+return\s+NextResponse\.json\(\s+\{\s+error:\s+["\']Internal server error["\']\s+\},\s+\{\s+status:\s+500\s+\}\s+\);\s+\}'
    if re.search(pattern1, content):
        content = re.sub(pattern1, '} catch (error) {\n    return handleApiError(error);\n  }', content)
    
    # Pattern 2: With error: any type
    pattern2 = r'}\s+catch\s+\(\s*error:\s*any\s*\)\s+\{\s+console\.error\([^)]+\);\s+return\s+NextResponse\.json\(\s+\{\s+error:\s+["\']Internal server error["\']\s+\},\s+\{\s+status:\s+500\s+\}\s+\);\s+\}'
    if re.search(pattern2, content):
        content = re.sub(pattern2, '} catch (error: any) {\n    return handleApiError(error);\n  }', content)
    
    if content != original_content:
        with open(route_file, 'w', encoding='utf-8') as f:
            f.write(content)
        updated_count += 1
        print(f"Updated: {str(route_file)}")

print(f"\nTotal files updated: {updated_count}")
