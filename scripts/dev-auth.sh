#!/bin/bash
# dev-auth.sh - Dev tool authentication helper
# Exchange Core SSO ticket for inventory service JWT

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
GRAY='\033[0;37m'
NC='\033[0m' # No Color

# Configuration
INVENTORY_URL="${INVENTORY_URL:-http://localhost:3000}"

# Usage
if [ -z "$1" ]; then
    echo -e "${RED}Usage:${NC} $0 <ticket>"
    echo ""
    echo "Example:"
    echo "  $0 a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
    echo ""
    echo "Or capture JWT:"
    echo "  JWT=\$($0 a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6)"
    exit 1
fi

TICKET="$1"

# Validate ticket
if [ ${#TICKET} -ne 32 ]; then
    echo -e "${RED}Error:${NC} Invalid ticket (must be exactly 32 characters, got ${#TICKET})"
    exit 1
fi

echo -e "${CYAN}🔐 Authenticating with ticket...${NC}"

# Exchange ticket for JWT
REDIRECT=$(curl -s -I "$INVENTORY_URL/auth/callback?ticket=$TICKET" 2>&1 | grep -i location | awk '{print $2}' | tr -d '\r')

if [ -z "$REDIRECT" ]; then
    echo -e "${RED}❌ Failed to get redirect from server${NC}"
    exit 1
fi

# Extract JWT from redirect URL
JWT=$(echo "$REDIRECT" | grep -oP 'access_token=\K[^&]+' || echo "")

if [ -z "$JWT" ]; then
    echo -e "${RED}❌ Failed to extract JWT from redirect${NC}"
    echo "Redirect URL: $REDIRECT"
    exit 1
fi

echo -e "${GREEN}✅ Authentication successful!${NC}"
echo ""
echo -e "${YELLOW}JWT obtained (expires in 7 days)${NC}"
echo ""
echo -e "${NC}Use in bash:${NC}"
echo -e "${GRAY}  export JWT='$JWT'${NC}"
echo -e "${GRAY}  curl $INVENTORY_URL/api/inventory/items \\${NC}"
echo -e "${GRAY}    -H 'Authorization: Bearer \$JWT' \\${NC}"
echo -e "${GRAY}    -H 'apikey: \$NEXT_PUBLIC_SUPABASE_ANON_KEY'${NC}"
echo ""
echo -e "${NC}Or capture directly:${NC}"
echo -e "${GRAY}  JWT=\$($0 $TICKET)${NC}"
echo ""

# Return JWT (for script usage)
echo "$JWT"
