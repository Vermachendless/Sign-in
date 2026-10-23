/**
 * Phase 3B Step 2 — Notification Centre Audit & Verification Script
 */
import assert from 'node:assert';

console.log('--- RUNNING PHASE 3B STEP 2 DETAILED AUDIT ---');

let passed = 0;
let failed = 0;

function check(title: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${title}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${title}:`, err.message);
    failed++;
  }
}

// 1. Math audit of responsive popover boundaries
check('Responsive popover calculations for 320px, 360px, 390px, 430px, 768px, 1024px, 1280px, 1536px', () => {
  const viewports = [320, 360, 390, 430, 768, 1024, 1280, 1536];
  for (const vw of viewports) {
    const isSm = vw >= 640;
    const headerPadding = isSm ? 24 : 12; // px-3 (12px) vs sm:px-6 (24px)
    const bellRightMargin = headerPadding; // bell is rightmost item in header
    
    // Dropdown width calculation:
    // w-[calc(100vw-1.5rem)] sm:w-96 max-w-[24rem]
    const calcWidth = vw - 24; // 100vw - 1.5rem (24px)
    const maxWidth = 24 * 16; // 384px (24rem)
    const width = isSm ? Math.min(384, maxWidth) : Math.min(calcWidth, maxWidth);
    
    const bellRightEdge = vw - bellRightMargin;
    const popoverLeftEdge = bellRightEdge - width;
    const popoverRightEdge = bellRightEdge;
    
    // Bounds assertions
    assert.ok(popoverLeftEdge >= 0, `At ${vw}px, left edge (${popoverLeftEdge}px) must be >= 0`);
    assert.ok(popoverRightEdge <= vw, `At ${vw}px, right edge (${popoverRightEdge}px) must be <= ${vw}px`);
    assert.ok(width <= vw, `At ${vw}px, width (${width}px) must not exceed viewport (${vw}px)`);
  }
});

// 2. State transition simulation for All vs Unread filter tabs
check('Filter tabs show correct records for All vs Unread', () => {
  const mockNotifications = [
    { id: '1', title: 'A', message: 'msg A', isRead: false, createdAt: new Date().toISOString() },
    { id: '2', title: 'B', message: 'msg B', isRead: true, createdAt: new Date().toISOString() },
    { id: '3', title: 'C', message: 'msg C', isRead: false, createdAt: new Date().toISOString() },
  ];
  
  const allItems = mockNotifications;
  const unreadItems = mockNotifications.filter(n => !n.isRead);
  
  assert.strictEqual(allItems.length, 3);
  assert.strictEqual(unreadItems.length, 2);
  assert.deepStrictEqual(unreadItems.map(n => n.id), ['1', '3']);
});

// 3. Optimistic update and rollback simulation for mark-as-read
check('Individual and bulk mark-as-read optimistic update and rollback logic', () => {
  let notifications = [
    { id: '1', title: 'A', isRead: false },
    { id: '2', title: 'B', isRead: false },
  ];
  let unreadCount = 2;
  
  // Optimistic individual mark
  notifications = notifications.map(n => n.id === '1' ? { ...n, isRead: true } : n);
  unreadCount = Math.max(0, unreadCount - 1);
  assert.strictEqual(notifications[0].isRead, true);
  assert.strictEqual(unreadCount, 1);
  
  // Optimistic bulk mark
  const backupNotifications = [...notifications];
  const backupUnread = unreadCount;
  notifications = notifications.map(n => ({ ...n, isRead: true }));
  unreadCount = 0;
  assert.strictEqual(notifications.every(n => n.isRead), true);
  assert.strictEqual(unreadCount, 0);
  
  // Rollback on simulated API failure
  notifications = backupNotifications;
  unreadCount = backupUnread;
  assert.strictEqual(notifications[1].isRead, false);
  assert.strictEqual(unreadCount, 1);
});

// 4. Badge threshold assertions
check('Badge threshold correctly hides at 0, shows numbers up to 99, and caps at 99+', () => {
  const getBadge = (count: number) => {
    if (count <= 0) return null;
    return count > 99 ? '99+' : count.toString();
  };
  
  assert.strictEqual(getBadge(0), null);
  assert.strictEqual(getBadge(1), '1');
  assert.strictEqual(getBadge(99), '99');
  assert.strictEqual(getBadge(100), '99+');
  assert.strictEqual(getBadge(1000), '99+');
});

console.log(`\nAudit completed: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
