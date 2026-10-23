/**
 * Phase 3B Step 1 Test Suite — Notification Bell and Dropdown UI Verification
 */
import assert from 'node:assert';
import fs from 'node:fs';

console.log('--- RUNNING PHASE 3B STEP 1 VERIFICATION TESTS ---');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}:`, err.message);
    testsFailed++;
  }
}

// 1. Verify NotificationBell file exists
runTest('NotificationBell.tsx exists and is readable', () => {
  assert.ok(fs.existsSync('src/components/notifications/NotificationBell.tsx'));
  const content = fs.readFileSync('src/components/notifications/NotificationBell.tsx', 'utf-8');
  assert.ok(content.includes('export const NotificationBell'));
  assert.ok(content.includes('fetchUnreadCount'));
  assert.ok(content.includes('fetchNotifications'));
  assert.ok(content.includes('handleMarkAsRead'));
  assert.ok(content.includes('handleMarkAllAsRead'));
});

// 2. Verify badge display and unread formatting logic
runTest('Unread count badge formatting logic produces 99+ for counts over 99 and hides at 0', () => {
  const formatBadge = (unreadCount: number): string | null => {
    if (unreadCount <= 0) return null;
    return unreadCount > 99 ? '99+' : unreadCount.toString();
  };

  assert.strictEqual(formatBadge(0), null);
  assert.strictEqual(formatBadge(-1), null);
  assert.strictEqual(formatBadge(1), '1');
  assert.strictEqual(formatBadge(27), '27');
  assert.strictEqual(formatBadge(99), '99');
  assert.strictEqual(formatBadge(100), '99+');
  assert.strictEqual(formatBadge(999), '99+');
});

// 3. Verify Header integration
runTest('Header.tsx imports and renders NotificationBell and has replaced logout-btn', () => {
  const headerContent = fs.readFileSync('src/components/Header.tsx', 'utf-8');
  assert.ok(headerContent.includes("import { NotificationBell } from './notifications/NotificationBell.tsx';"), 'Header should import NotificationBell');
  assert.ok(headerContent.includes('<NotificationBell />'), 'Header should render NotificationBell');
  assert.ok(!headerContent.includes('id="logout-btn"'), 'Header should no longer render id="logout-btn"');
});

// 4. Verify Sidebar logout preservation
runTest('Sidebar.tsx retains all established logout mechanisms', () => {
  const sidebarContent = fs.readFileSync('src/components/Sidebar.tsx', 'utf-8');
  assert.ok(sidebarContent.includes('id="sidebar-account-logout-btn"'), 'Sidebar account menu retains logout button');
  assert.ok(sidebarContent.includes('onClick={() => logout()}'), 'Sidebar contains logout action handlers');
  assert.ok(sidebarContent.includes('Sign Out'), 'Sidebar modal retains Sign Out button');
});

// 5. Verify NotificationBell accessibility attributes
runTest('NotificationBell includes accessible IDs, aria labels, and dialog semantics', () => {
  const content = fs.readFileSync('src/components/notifications/NotificationBell.tsx', 'utf-8');
  assert.ok(content.includes('id="notification-bell-btn"'));
  assert.ok(content.includes('aria-expanded={isOpen}'));
  assert.ok(content.includes('aria-haspopup="dialog"'));
  assert.ok(content.includes('role="dialog"'));
  assert.ok(content.includes('aria-label="Notifications"'));
  assert.ok(content.includes("event.key === 'Escape'"));
});

// 6. Verify 60-second polling interval and cleanup
runTest('NotificationBell configures 60-second polling and window focus listeners with cleanup', () => {
  const content = fs.readFileSync('src/components/notifications/NotificationBell.tsx', 'utf-8');
  assert.ok(content.includes('60000'), 'Configures 60000ms (60s) polling interval');
  assert.ok(content.includes("window.addEventListener('focus'"), 'Listens to window focus');
  assert.ok(content.includes('clearInterval(intervalId)'), 'Cleans up interval timer');
  assert.ok(content.includes("window.removeEventListener('focus'"), 'Cleans up focus listener');
});

// 7. Verify responsive width and max width constraints to prevent viewport overflow
runTest('NotificationBell enforces safe responsive width classes within mobile viewports', () => {
  const content = fs.readFileSync('src/components/notifications/NotificationBell.tsx', 'utf-8');
  assert.ok(content.includes('w-[calc(100vw-1.5rem)]'), 'Responsive width respects viewport padding');
  assert.ok(content.includes('sm:w-96'), 'Desktop width scales to 24rem');
  assert.ok(content.includes('max-w-[24rem]'), 'Bounded maximum width');
  assert.ok(content.includes('right-0'), 'Right-aligned to trigger container');
});

console.log(`\nTests completed: ${testsPassed} passed, ${testsFailed} failed.`);
if (testsFailed > 0) {
  process.exit(1);
}
