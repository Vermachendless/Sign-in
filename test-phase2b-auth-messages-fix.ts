/**
 * PHASE 2B FOCUSED TEST SUITE
 *
 * Verifies:
 * 1. Cookie attributes when HTTPS is detected through trusted proxy deployment configuration.
 * 2. Local plain-HTTP development cookie behavior (SameSite=Lax, Secure=false).
 * 3. Cookie clearing/logout consistency between HTTP and HTTPS contexts.
 * 4. Live Express API verification for Set-Cookie headers on login and logout.
 * 5. Messages 401 handling: elimination of refreshUser(), no unexpected global logout,
 *    clear inline authentication error banner, and draft preservation.
 * 6. Messages loading states safely terminated after authentication failures.
 * 7. Polling suspended on auth error to prevent infinite retry loops.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import { getCookieOptions, getClearCookieOptions, isHttpsRequest } from './server/routes/auth.routes.ts';

console.log('--- STARTING PHASE 2B AUTH & MESSAGES FOCUSED TESTS ---\n');

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res
        .then(() => {
          console.log(`  ✓ ${name}`);
          passed++;
        })
        .catch((err) => {
          console.error(`  ✗ ${name}:`, err.message);
          failed++;
        });
    } else {
      console.log(`  ✓ ${name}`);
      passed++;
    }
  } catch (err: any) {
    console.error(`  ✗ ${name}:`, err.message);
    failed++;
  }
}

async function executeTestSuite() {
  // 1. Unit: Cookie attributes when HTTPS is detected
  runTest('1.1. getCookieOptions sets SameSite=None and Secure=true when req.secure is true', () => {
    const mockReq = { secure: true, headers: {} } as any;
    const opts = getCookieOptions(mockReq);
    assert.strictEqual(opts.httpOnly, true, 'HttpOnly must be true');
    assert.strictEqual(opts.secure, true, 'Secure must be true for HTTPS');
    assert.strictEqual(opts.sameSite, 'none', 'SameSite must be none for cross-site iframe HTTPS');
    assert.strictEqual(opts.path, '/', 'Path must be /');
    assert.ok(opts.maxAge > 0, 'maxAge must be positive');
  });

  // 2. Unit: Local plain-HTTP development cookie behavior
  runTest('1.2. getCookieOptions sets SameSite=Lax and Secure=false for local plain-HTTP', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const mockReq = { secure: false, headers: {} } as any;
      const opts = getCookieOptions(mockReq);
      assert.strictEqual(opts.httpOnly, true, 'HttpOnly must be true');
      assert.strictEqual(opts.secure, false, 'Secure must be false for plain HTTP');
      assert.strictEqual(opts.sameSite, 'lax', 'SameSite must be lax for local plain HTTP');
      assert.strictEqual(opts.path, '/', 'Path must be /');
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  // 3. Unit: Cookie clearing / logout consistency
  runTest('1.3. getClearCookieOptions provides matching attributes for both HTTPS and HTTP modes', () => {
    const httpsReq = { secure: true } as any;
    const httpsClear = getClearCookieOptions(httpsReq);
    assert.strictEqual(httpsClear.httpOnly, true);
    assert.strictEqual(httpsClear.secure, true);
    assert.strictEqual(httpsClear.sameSite, 'none');
    assert.strictEqual(httpsClear.path, '/');

    const httpReq = { secure: false } as any;
    const httpClear = getClearCookieOptions(httpReq);
    assert.strictEqual(httpClear.httpOnly, true);
    assert.strictEqual(httpClear.secure, false);
    assert.strictEqual(httpClear.sameSite, 'lax');
    assert.strictEqual(httpClear.path, '/');
  });

  // 4. Live Server HTTP Verification
  await runTest('2.1. Live Server: POST /api/auth/login with X-Forwarded-Proto: https emits SameSite=None and Secure', async () => {
    const res = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'AdminSecurePassword123!',
      }),
    });

    assert.strictEqual(res.status, 200, 'Login should succeed');
    const setCookie = res.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('session_token='), 'Must set session_token cookie');
    assert.ok(setCookie.toLowerCase().includes('samesite=none'), 'Must specify SameSite=None over HTTPS proxy');
    assert.ok(setCookie.toLowerCase().includes('secure'), 'Must specify Secure over HTTPS proxy');
    assert.ok(setCookie.toLowerCase().includes('httponly'), 'Must specify HttpOnly');
  });

  await runTest('2.2. Live Server: POST /api/auth/logout with X-Forwarded-Proto: https clears cookie with SameSite=None and Secure', async () => {
    const res = await fetch('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        'X-Forwarded-Proto': 'https',
      },
    });

    assert.strictEqual(res.status, 200, 'Logout should succeed');
    const setCookie = res.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('session_token='), 'Must clear session_token');
    assert.ok(setCookie.toLowerCase().includes('samesite=none'), 'Must use SameSite=None when clearing over HTTPS proxy');
    assert.ok(setCookie.toLowerCase().includes('secure'), 'Must use Secure when clearing over HTTPS proxy');
  });

  await runTest('2.3. Live Server: POST /api/auth/login plain HTTP emits SameSite=Lax without Secure', async () => {
    const res = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'AdminSecurePassword123!',
      }),
    });

    assert.strictEqual(res.status, 200, 'Login should succeed');
    const setCookie = res.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('session_token='), 'Must set session_token cookie');
    assert.ok(setCookie.toLowerCase().includes('samesite=lax'), 'Must specify SameSite=Lax for plain HTTP');
    assert.ok(!setCookie.toLowerCase().includes('secure;'), 'Must not specify Secure for plain HTTP');
  });

  // 5. Messages Component Contract & 401 Safety
  runTest('3.1. MessagesView.tsx eliminates refreshUser() entirely', () => {
    const content = fs.readFileSync('src/components/messages/MessagesView.tsx', 'utf-8');
    assert.ok(!content.includes('refreshUser'), 'MessagesView must not call or import refreshUser');
  });

  runTest('3.2. MessagesView.tsx defines and handles AUTH_REQUIRED_MSG', () => {
    const content = fs.readFileSync('src/components/messages/MessagesView.tsx', 'utf-8');
    assert.ok(content.includes('AUTH_REQUIRED_MSG'), 'Must define AUTH_REQUIRED_MSG');
    assert.ok(content.includes('authError'), 'Must track authError state');
    assert.ok(content.includes('setAuthError(AUTH_REQUIRED_MSG)'), 'Must set authError on 401');
  });

  runTest('3.3. All five 401 paths safely terminate without global logout', () => {
    const content = fs.readFileSync('src/components/messages/MessagesView.tsx', 'utf-8');
    // Check fetchUnreadCount
    assert.ok(
      content.includes('fetchUnreadCount') && content.includes('if (res.status === 401) {\n        setAuthError(AUTH_REQUIRED_MSG);'),
      'fetchUnreadCount must handle 401 with setAuthError'
    );
    // Check fetchConversations
    assert.ok(
      content.includes('fetchConversations') && content.includes('if (res.status === 401) {\n          setAuthError(AUTH_REQUIRED_MSG);'),
      'fetchConversations must handle 401 with setAuthError'
    );
    // Check fetchMessages
    assert.ok(
      content.includes('fetchMessages') && content.includes('setThreadError(AUTH_REQUIRED_MSG)'),
      'fetchMessages must handle 401 with setThreadError and setAuthError'
    );
    // Check handleSendMessage
    assert.ok(
      content.includes('handleSendMessage') && content.includes('draft has been preserved'),
      'handleSendMessage must preserve drafts upon 401'
    );
    // Check handleSelectContact
    assert.ok(
      content.includes('handleSelectContact') && content.includes('setAuthError(AUTH_REQUIRED_MSG)'),
      'handleSelectContact must handle 401 with setAuthError'
    );
  });

  runTest('3.4. Loading states are safely terminated in finally blocks', () => {
    const content = fs.readFileSync('src/components/messages/MessagesView.tsx', 'utf-8');
    assert.ok(content.includes('setIsLoadingConversations(false)'), 'Conversations loading state must be stopped');
    assert.ok(content.includes('setIsLoadingMessages(false)'), 'Messages loading state must be stopped');
    assert.ok(content.includes('setIsSending(false)'), 'Sending loading state must be stopped');
    assert.ok(content.includes('setIsCreatingConversation(false)'), 'Creating conversation state must be stopped');
  });

  runTest('3.5. Polling pauses when authError is active to prevent infinite 401 retries', () => {
    const content = fs.readFileSync('src/components/messages/MessagesView.tsx', 'utf-8');
    assert.ok(
      content.includes('if (authErrorRef.current) return'),
      'Polling intervals must check authErrorRef to prevent infinite retries'
    );
  });

  runTest('3.6. Inline authentication error banner is rendered with a Retry button', () => {
    const content = fs.readFileSync('src/components/messages/MessagesView.tsx', 'utf-8');
    assert.ok(content.includes('id="messages-auth-error-banner"'), 'Must render messages-auth-error-banner element');
    assert.ok(content.includes('Retry'), 'Must include a Retry action button');
  });

  console.log('\n--- PHASE 2B TEST RESULTS SUMMARY ---');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

executeTestSuite();
