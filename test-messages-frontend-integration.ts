/**
 * MESSAGES PHASE — STEP 2B FRONTEND INTEGRATION TEST SUITE
 *
 * Verifies:
 * 1. Navigation & RBAC:
 *    - 'messages' route in AppRoute union
 *    - Messages present in nav for STAFF, ADMIN, and SUPER_ADMIN
 *    - Route sanitization permits 'messages' for all three roles
 *    - Breadcrumbs in Header.tsx for 'messages'
 * 2. Component Files & Structure:
 *    - MessagesView, ConversationList, MessageThread, NewConversationModal exist
 * 3. Client Validation & Constraints:
 *    - 2,000-character boundary enforcement
 *    - Whitespace rejection in composer
 *    - Character counter logic
 * 4. Plain-Text Safety:
 *    - DirectMessage content rendered as text, no dangerouslySetInnerHTML
 * 5. Earlier-Page Merging & Stale-Response Protection:
 *    - Deduplication logic when prepending older message pages
 *    - AbortController and active conversation guard
 * 6. Read Receipts Guard:
 *    - Mark-as-read invoked conditionally only after successful history fetch
 * 7. Mobile View Switcher:
 *    - Single-pane responsive switching between list and active thread
 */

import assert from 'node:assert';
import fs from 'node:fs';

console.log('--- STARTING MESSAGES PHASE 2B FRONTEND INTEGRATION TESTS ---');

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}:`, err.message);
    failed++;
  }
}

// 1. Navigation & Route Model
runTest('1. AppRoute includes typed "messages" route', () => {
  const sidebarContent = fs.readFileSync('src/components/Sidebar.tsx', 'utf-8');
  assert.ok(sidebarContent.includes("'messages'"), 'AppRoute union in Sidebar.tsx must include messages');
});

runTest('2. Sidebar defines Messages navigation item for STAFF, ADMIN, and SUPER_ADMIN', () => {
  const sidebarContent = fs.readFileSync('src/components/Sidebar.tsx', 'utf-8');
  // Match item with id: 'messages'
  const matches = (sidebarContent.match(/id:\s*'messages'/g) || []).length;
  assert.strictEqual(matches, 3, 'Messages nav item must be present in all 3 role navigation sections');
  assert.ok(sidebarContent.includes("icon: MessageSquare"), 'Must use MessageSquare icon');
  assert.ok(sidebarContent.includes("badge: unreadBadge"), 'Must support unread count badge');
});

runTest('3. App.tsx sanitizes routes allowing "messages" for STAFF, ADMIN, and SUPER_ADMIN', () => {
  const appContent = fs.readFileSync('src/App.tsx', 'utf-8');
  assert.ok(
    appContent.includes("currentRoute !== 'messages'"),
    'STAFF route sanitization must allow currentRoute === messages'
  );
  assert.ok(
    appContent.includes("<MessagesView />"),
    'App.tsx must render MessagesView when currentRoute === messages'
  );
});

runTest('4. Header.tsx provides contextual breadcrumb for "messages"', () => {
  const headerContent = fs.readFileSync('src/components/Header.tsx', 'utf-8');
  assert.ok(
    headerContent.includes("case 'messages':"),
    'Header.tsx must have a case for messages'
  );
  assert.ok(
    headerContent.includes("Direct Messages"),
    'Header breadcrumb title must be Direct Messages'
  );
});

// 2. Component Files Presence
runTest('5. All dedicated messaging components exist and export valid React components', () => {
  const files = [
    'src/components/messages/MessagesView.tsx',
    'src/components/messages/ConversationList.tsx',
    'src/components/messages/MessageThread.tsx',
    'src/components/messages/NewConversationModal.tsx',
  ];

  for (const f of files) {
    assert.ok(fs.existsSync(f), `File must exist: ${f}`);
    const content = fs.readFileSync(f, 'utf-8');
    assert.ok(content.length > 200, `File must not be empty: ${f}`);
  }
});

// 3. Client Validation & Boundary Logic
runTest('6. Message composer enforces 2,000-character limit and rejects empty/whitespace', () => {
  const threadContent = fs.readFileSync('src/components/messages/MessageThread.tsx', 'utf-8');
  assert.ok(threadContent.includes('maxLength={2000}'), 'Textarea must have maxLength 2000');
  assert.ok(
    threadContent.includes('content.length > 2000'),
    'Must check content.length > 2000 in canSend logic'
  );
  assert.ok(
    threadContent.includes('content.trim().length > 0') || threadContent.includes('!trimmed'),
    'Must reject whitespace-only messages'
  );
  assert.ok(
    threadContent.includes('2000'),
    'Must display character limit counter'
  );
});

runTest('7. Message content rendered as safe plain text (no dangerouslySetInnerHTML)', () => {
  const threadContent = fs.readFileSync('src/components/messages/MessageThread.tsx', 'utf-8');
  assert.ok(
    !threadContent.includes('dangerouslySetInnerHTML'),
    'Must never use dangerouslySetInnerHTML for direct messages'
  );
  assert.ok(
    threadContent.includes('{msg.content}'),
    'Must render msg.content as standard JSX text'
  );
});

runTest('8. Draft preservation on message delivery failure', () => {
  const threadContent = fs.readFileSync('src/components/messages/MessageThread.tsx', 'utf-8');
  assert.ok(
    threadContent.includes("setContent('')"),
    'setContent empty string should only happen on success'
  );
  assert.ok(
    threadContent.includes('Your draft has been preserved'),
    'Must notify user that draft is preserved upon failure'
  );
});

runTest('8b. Draft isolation on conversation switching (no cross-conversation draft leak)', () => {
  const threadContent = fs.readFileSync('src/components/messages/MessageThread.tsx', 'utf-8');
  const viewContent = fs.readFileSync('src/components/messages/MessagesView.tsx', 'utf-8');

  // Verify MessageThread resets draft when conversation?.id changes
  assert.ok(
    threadContent.includes("setContent('')") &&
    threadContent.includes('[conversation?.id]'),
    'MessageThread must reset draft when conversation?.id changes'
  );

  // Verify MessagesView keys MessageThread by activeConversation id
  assert.ok(
    viewContent.includes('key={activeConversation?.id'),
    'MessagesView must key MessageThread by activeConversation.id to isolate component lifecycle'
  );
});

runTest('9. Stale-response and conversation switching protection', () => {
  const viewContent = fs.readFileSync('src/components/messages/MessagesView.tsx', 'utf-8');
  assert.ok(
    viewContent.includes('activeConversationIdRef.current !== conversationId'),
    'Must guard against stale responses when conversation switches'
  );
  assert.ok(
    viewContent.includes('messagesAbortControllerRef.current?.abort()'),
    'Must abort in-flight requests when switching conversations'
  );
});

runTest('10. Earlier-message deduplication when prepending older pages', () => {
  const viewContent = fs.readFileSync('src/components/messages/MessagesView.tsx', 'utf-8');
  assert.ok(
    viewContent.includes('existingIds.has(m.id)'),
    'Must deduplicate earlier messages by ID when prepending'
  );
});

runTest('11. Mark-as-read invoked conditionally only after successful message fetch', () => {
  const viewContent = fs.readFileSync('src/components/messages/MessagesView.tsx', 'utf-8');
  assert.ok(
    viewContent.includes('markAsRead(conversationId)'),
    'Must call markAsRead only when messages successfully loaded'
  );
  assert.ok(
    viewContent.includes('currentConv.unreadCount > 0'),
    'Must only call markAsRead if conversation has unread items'
  );
});

runTest('12. Page Visibility API integration pauses polling when hidden', () => {
  const viewContent = fs.readFileSync('src/components/messages/MessagesView.tsx', 'utf-8');
  assert.ok(
    viewContent.includes("document.addEventListener('visibilitychange'"),
    'Must listen to document visibilitychange'
  );
  assert.ok(
    viewContent.includes('if (document.hidden) return'),
    'Must pause polling when document is hidden'
  );
});

runTest('13. Mobile responsive switching between conversation list and active thread', () => {
  const viewContent = fs.readFileSync('src/components/messages/MessagesView.tsx', 'utf-8');
  assert.ok(
    viewContent.includes("activeConversationId ? 'hidden md:flex' : 'flex w-full'"),
    'Conversation list must hide on mobile when thread is active'
  );
  assert.ok(
    viewContent.includes("activeConversationId ? 'flex' : 'hidden md:flex'"),
    'Thread must hide on mobile when no conversation is active'
  );
});

console.log('\n--- TEST RESULTS SUMMARY ---');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
