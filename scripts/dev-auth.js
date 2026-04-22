#!/usr/bin/env node
/**
 * dev-auth.js - Dev tool authentication helper
 * Exchange Core SSO ticket for inventory service JWT
 * 
 * Usage:
 *   node dev-auth.js <ticket>
 *   
 * Example:
 *   node dev-auth.js a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
 *   
 * Or import as module:
 *   const { authenticate } = require('./dev-auth.js');
 *   const jwt = await authenticate('ticket-here');
 */

const https = require('https');
const http = require('http');

/**
 * Exchange ticket for JWT
 * @param {string} ticket - 32-character SSO ticket
 * @param {string} inventoryUrl - Inventory service URL
 * @returns {Promise<string>} JWT token
 */
async function authenticate(ticket, inventoryUrl = 'http://localhost:3000') {
  if (!ticket || ticket.length !== 32) {
    throw new Error(`Invalid ticket: must be exactly 32 characters (got ${ticket?.length || 0})`);
  }

  const url = `${inventoryUrl}/auth/callback?ticket=${ticket}`;
  
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    
    const req = lib.get(url, { 
      // Don't follow redirects automatically
      maxRedirects: 0
    }, (res) => {
      // Expect 302 redirect
      if (res.statusCode !== 302 && res.statusCode !== 301) {
        reject(new Error(`Unexpected status code: ${res.statusCode}`));
        return;
      }

      const redirectUrl = res.headers.location;
      
      if (!redirectUrl) {
        reject(new Error('No redirect URL in response'));
        return;
      }

      // Extract JWT from redirect URL
      const match = redirectUrl.match(/access_token=([^&]+)/);
      
      if (!match || !match[1]) {
        reject(new Error(`Failed to extract JWT from redirect: ${redirectUrl}`));
        return;
      }

      resolve(match[1]);
    });

    req.on('error', (err) => {
      reject(new Error(`Request failed: ${err.message}`));
    });

    req.end();
  });
}

/**
 * Make authenticated API request
 * @param {string} jwt - JWT token
 * @param {string} endpoint - API endpoint path
 * @param {string} inventoryUrl - Inventory service URL
 * @param {string} anonKey - Supabase anon key
 * @returns {Promise<any>} Response data
 */
async function makeAuthenticatedRequest(jwt, endpoint, inventoryUrl = 'http://localhost:3000', anonKey = null) {
  const url = `${inventoryUrl}${endpoint}`;
  
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const parsedUrl = new URL(url);
    
    const headers = {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json'
    };

    if (anonKey) {
      headers['apikey'] = anonKey;
    }

    const req = lib.get(parsedUrl, {
      headers
    }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          resolve(data); // Return raw if not JSON
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Request failed: ${err.message}`));
    });

    req.end();
  });
}

// CLI Mode
if (require.main === module) {
  const ticket = process.argv[2];
  const inventoryUrl = process.env.INVENTORY_URL || 'http://localhost:3000';

  if (!ticket) {
    console.error('\x1b[31mUsage:\x1b[0m node dev-auth.js <ticket>');
    console.error('');
    console.error('Example:');
    console.error('  node dev-auth.js a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6');
    console.error('');
    console.error('Or use as module:');
    console.error('  const { authenticate } = require(\'./dev-auth.js\');');
    console.error('  const jwt = await authenticate(\'ticket-here\');');
    process.exit(1);
  }

  console.log('\x1b[36m🔐 Authenticating with ticket...\x1b[0m');

  authenticate(ticket, inventoryUrl)
    .then((jwt) => {
      console.log('\x1b[32m✅ Authentication successful!\x1b[0m');
      console.log('');
      console.log('\x1b[33mJWT obtained (expires in 7 days)\x1b[0m');
      console.log('');
      console.log('\x1b[0mUse in Node.js:\x1b[0m');
      console.log(`\x1b[37m  const jwt = '${jwt}';\x1b[0m`);
      console.log(`\x1b[37m  const response = await fetch('${inventoryUrl}/api/inventory/items', {\x1b[0m`);
      console.log(`\x1b[37m    headers: {\x1b[0m`);
      console.log(`\x1b[37m      'Authorization': \`Bearer \${jwt}\`,\x1b[0m`);
      console.log(`\x1b[37m      'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY\x1b[0m`);
      console.log(`\x1b[37m    }\x1b[0m`);
      console.log(`\x1b[37m  });\x1b[0m`);
      console.log('');
      console.log('\x1b[0mOr capture JWT:\x1b[0m');
      console.log(`\x1b[37m  const { authenticate } = require('./dev-auth.js');\x1b[0m`);
      console.log(`\x1b[37m  const jwt = await authenticate('${ticket}');\x1b[0m`);
      console.log('');
      console.log('\x1b[90mRaw JWT:\x1b[0m');
      console.log(jwt);
    })
    .catch((err) => {
      console.error('\x1b[31m❌ Authentication failed:\x1b[0m', err.message);
      process.exit(1);
    });
}

// Export for module usage
module.exports = {
  authenticate,
  makeAuthenticatedRequest
};
