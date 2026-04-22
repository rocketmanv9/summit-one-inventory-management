#!/usr/bin/env python3
"""
dev-auth.py - Dev tool authentication helper
Exchange Core SSO ticket for inventory service JWT

Usage:
    python dev-auth.py <ticket>
    
Example:
    python dev-auth.py a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
    
Or import as module:
    from dev_auth import authenticate
    jwt = authenticate('ticket-here')
"""

import sys
import re
import os
import requests
from typing import Optional


def authenticate(ticket: str, inventory_url: str = 'http://localhost:3000') -> str:
    """
    Exchange SSO ticket for JWT
    
    Args:
        ticket: 32-character SSO ticket from Core
        inventory_url: Inventory service URL
        
    Returns:
        JWT token string
        
    Raises:
        ValueError: If ticket is invalid or exchange fails
    """
    if not ticket or len(ticket) != 32:
        raise ValueError(f'Invalid ticket: must be exactly 32 characters (got {len(ticket) if ticket else 0})')
    
    # Exchange ticket (don't follow redirects)
    url = f'{inventory_url}/auth/callback?ticket={ticket}'
    response = requests.get(url, allow_redirects=False)
    
    # Expect redirect
    if response.status_code not in (301, 302):
        raise ValueError(f'Unexpected status code: {response.status_code}')
    
    # Extract redirect URL
    redirect_url = response.headers.get('Location', '')
    
    if not redirect_url:
        raise ValueError('No redirect URL in response')
    
    # Extract JWT from redirect URL
    match = re.search(r'access_token=([^&]+)', redirect_url)
    
    if not match:
        raise ValueError(f'Failed to extract JWT from redirect: {redirect_url}')
    
    return match.group(1)


def make_authenticated_request(
    jwt: str,
    endpoint: str,
    inventory_url: str = 'http://localhost:3000',
    anon_key: Optional[str] = None,
    method: str = 'GET',
    data: Optional[dict] = None
) -> dict:
    """
    Make authenticated API request
    
    Args:
        jwt: JWT token
        endpoint: API endpoint path (e.g., '/api/inventory/items')
        inventory_url: Inventory service URL
        anon_key: Supabase anon key (optional)
        method: HTTP method (GET, POST, etc.)
        data: Request body for POST/PUT/PATCH
        
    Returns:
        Response JSON as dict
    """
    url = f'{inventory_url}{endpoint}'
    
    headers = {
        'Authorization': f'Bearer {jwt}',
        'Content-Type': 'application/json'
    }
    
    if anon_key:
        headers['apikey'] = anon_key
    
    response = requests.request(method, url, headers=headers, json=data)
    response.raise_for_status()
    
    return response.json()


def main():
    """CLI entry point"""
    if len(sys.argv) < 2:
        print('\033[31mUsage:\033[0m python dev-auth.py <ticket>')
        print('')
        print('Example:')
        print('  python dev-auth.py a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6')
        print('')
        print('Or use as module:')
        print('  from dev_auth import authenticate')
        print('  jwt = authenticate(\'ticket-here\')')
        sys.exit(1)
    
    ticket = sys.argv[1]
    inventory_url = os.getenv('INVENTORY_URL', 'http://localhost:3000')
    
    print('\033[36m🔐 Authenticating with ticket...\033[0m')
    
    try:
        jwt = authenticate(ticket, inventory_url)
        
        print('\033[32m✅ Authentication successful!\033[0m')
        print('')
        print('\033[33mJWT obtained (expires in 7 days)\033[0m')
        print('')
        print('\033[0mUse in Python:\033[0m')
        print(f'\033[37m  jwt = \'{jwt}\'\033[0m')
        print(f'\033[37m  response = requests.get(\'{inventory_url}/api/inventory/items\',\033[0m')
        print(f'\033[37m      headers={{\033[0m')
        print(f'\033[37m          \'Authorization\': f\'Bearer {{jwt}}\',\033[0m')
        print(f'\033[37m          \'apikey\': os.getenv(\'NEXT_PUBLIC_SUPABASE_ANON_KEY\')\033[0m')
        print(f'\033[37m      }})\033[0m')
        print('')
        print('\033[0mOr use module:\033[0m')
        print(f'\033[37m  from dev_auth import authenticate, make_authenticated_request\033[0m')
        print(f'\033[37m  jwt = authenticate(\'{ticket}\')\033[0m')
        print(f'\033[37m  data = make_authenticated_request(jwt, \'/api/inventory/items\')\033[0m')
        print('')
        print('\033[90mRaw JWT:\033[0m')
        print(jwt)
        
    except Exception as e:
        print(f'\033[31m❌ Authentication failed:\033[0m {e}')
        sys.exit(1)


if __name__ == '__main__':
    main()
