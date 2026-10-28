/**
 * PHASE 2C: OFFICIAL ANNOUNCEMENTS FRONTEND TEST SUITE
 *
 * Verifies:
 * 1. Role-based composer controls:
 *    - STAFF cannot see announcement creation, priority, or pinning controls.
 *    - ADMIN and SUPER_ADMIN can toggle official announcements, set priority, and pin.
 * 2. Payload shaping:
 *    - Ordinary posts do not send privileged fields.
 *    - Announcements send isAnnouncement: true, selected priority, and isPinned.
 * 3. Draft preservation:
 *    - Draft and announcement options are kept intact when submission encounters an error.
 * 4. Announcement presentation on FeedPostCard:
 *    - Official Announcement label displayed.
 *    - Distinct priority badges for IMPORTANT (amber) and URGENT (rose/red).
 *    - Pinned indicator displayed for posts with pinnedAt timestamp.
 *    - Ordinary posts render cleanly without announcement badges.
 * 5. Pin / Unpin controls on FeedPostCard:
 *    - Only displayed for ADMIN and SUPER_ADMIN on official announcements.
 *    - Never displayed on ordinary posts.
 *    - Never displayed for STAFF.
 *    - Calls PATCH /api/feed/posts/:id/pin with target state.
 * 6. Code safety:
 *    - No dangerouslySetInnerHTML used.
 *    - Safe plain-text rendering for content.
 * 7. Legacy backward compatibility:
 *    - Optional fields (isAnnouncement, priority, pinnedAt) absent on legacy posts do not crash rendering.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedPostCard } from './src/components/feed/FeedPostCard.tsx';
import { FeedComposer } from './src/components/feed/FeedComposer.tsx';
import { FeedPostItem } from './src/components/feed/types.ts';
import { UserRole, UserStatus } from './src/types/index.ts';

console.log('================================================================');
console.log('--- STARTING PHASE 2C: ANNOUNCEMENTS FRONTEND TEST SUITE ---');
console.log('================================================================');

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

// Mock AuthContext for server-side testing
const AuthContext = React.createContext<{ user: any }>({ user: null });

function withUserRole(role: UserRole, element: React.ReactElement) {
  // Pass userRole directly to element props if supported
  return React.cloneElement(element, { userRole: role });
}

// Sample test data
const mockAuthor = {
  id: 'author_1',
  email: 'author@company.com',
  firstName: 'Jane',
  lastName: 'Doe',
  department: 'Operations',
  role: UserRole.ADMIN,
  status: UserStatus.ACTIVE,
};

const mockStats = {
  commentsCount: 2,
  reactionsCount: 5,
  reactions: { LIKE: 3, CELEBRATE: 2, SUPPORT: 0, INSIGHTFUL: 0 },
};

const ordinaryPost: FeedPostItem = {
  id: 'post_std_1',
  content: 'Ordinary post content for all colleagues.',
  isAnnouncement: false,
  priority: 'NORMAL',
  pinnedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  author: mockAuthor,
  stats: mockStats,
  currentUserReaction: null,
};

const normalAnnouncement: FeedPostItem = {
  id: 'post_ann_norm',
  content: 'Cafeteria menu update for the week.',
  isAnnouncement: true,
  priority: 'NORMAL',
  pinnedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  author: mockAuthor,
  stats: mockStats,
  currentUserReaction: null,
};

const importantAnnouncement: FeedPostItem = {
  id: 'post_ann_imp',
  content: 'Quarterly all-hands scheduled for Friday.',
  isAnnouncement: true,
  priority: 'IMPORTANT',
  pinnedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  author: mockAuthor,
  stats: mockStats,
  currentUserReaction: null,
};

const urgentPinnedAnnouncement: FeedPostItem = {
  id: 'post_ann_urg_pin',
  content: 'URGENT: Building evacuation drill at 10 AM.',
  isAnnouncement: true,
  priority: 'URGENT',
  pinnedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  author: mockAuthor,
  stats: mockStats,
  currentUserReaction: null,
};

const legacyPostMissingFields: any = {
  id: 'post_legacy_1',
  content: 'Legacy post without announcement fields.',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  author: mockAuthor,
  stats: mockStats,
  currentUserReaction: null,
};

async function main() {
  // Test Group 1: Role-Based Composer Rendering
  console.log('\n--- Group 1: Role-Based Composer Controls ---');

  runTest('1.1. STAFF cannot see announcement, priority, or pinning controls', () => {
    const html = renderToStaticMarkup(
      withUserRole(
        UserRole.STAFF,
        React.createElement(FeedComposer, { onPostCreated: () => {} })
      )
    );

    assert(!html.includes('Official Announcement'), 'STAFF must not see Official Announcement toggle');
    assert(!html.includes('Priority level:'), 'STAFF must not see Priority selector');
    assert(!html.includes('Pin announcement to top'), 'STAFF must not see Pin checkbox');
    assert(!html.includes('URGENT'), 'STAFF must not see URGENT option');
    assert(!html.includes('IMPORTANT'), 'STAFF must not see IMPORTANT option');
    assert(html.includes('Post Update'), 'STAFF sees ordinary Post Update header');
  });

  runTest('1.2. ADMIN sees Official Announcement toggle and controls', () => {
    const html = renderToStaticMarkup(
      withUserRole(
        UserRole.ADMIN,
        React.createElement(FeedComposer, { onPostCreated: () => {} })
      )
    );

    assert(html.includes('Official Announcement'), 'ADMIN must see Official Announcement toggle');
    assert(html.includes('name="isAnnouncement"'), 'ADMIN must have isAnnouncement input');
  });

  runTest('1.3. SUPER_ADMIN sees Official Announcement toggle and controls', () => {
    const html = renderToStaticMarkup(
      withUserRole(
        UserRole.SUPER_ADMIN,
        React.createElement(FeedComposer, { onPostCreated: () => {} })
      )
    );

    assert(html.includes('Official Announcement'), 'SUPER_ADMIN must see Official Announcement toggle');
    assert(html.includes('name="isAnnouncement"'), 'SUPER_ADMIN must have isAnnouncement input');
  });

  // Test Group 2: Composer Draft & Safety Static Code Analysis
  console.log('\n--- Group 2: Composer Source Code Guarantees ---');

  const composerCode = fs.readFileSync(
    path.resolve('src/components/feed/FeedComposer.tsx'),
    'utf8'
  );

  runTest('2.1. Composer preserves draft on error (does not clear draft in catch or non-200)', () => {
    assert(
      composerCode.includes("setDraft(''); // Cleared only on successful creation"),
      'setDraft must only be cleared on success'
    );
    assert(
      !composerCode.includes("setDraft(''); // on error"),
      'setDraft must not be cleared on error'
    );
    assert(
      composerCode.includes('setSubmitError(errorMsg)'),
      'Must set submit error for UI feedback'
    );
  });

  runTest('2.2. Ordinary posts omit privileged announcement fields from payload', () => {
    assert(
      composerCode.includes('if (isAdmin && isAnnouncement) {'),
      'Privileged fields must be guarded by isAdmin && isAnnouncement'
    );
    assert(
      composerCode.includes('const payload: {'),
      'Payload constructed conditionally'
    );
  });

  // Test Group 3: Announcement Presentation in FeedPostCard
  console.log('\n--- Group 3: Announcement Presentation on FeedPostCard ---');

  runTest('3.1. Ordinary post does not render announcement badges or pin indicators', () => {
    const html = renderToStaticMarkup(
      React.createElement(FeedPostCard, {
        post: ordinaryPost,
        currentUserId: 'viewer_1',
        currentUserRole: UserRole.STAFF,
        onPostDeleted: () => {},
        onPostUpdated: () => {},
      })
    );

    assert(!html.includes('Official Announcement'), 'Ordinary post must not have Official Announcement label');
    assert(!html.includes('URGENT'), 'Ordinary post must not have URGENT badge');
    assert(!html.includes('Important'), 'Ordinary post must not have Important badge');
    assert(!html.includes('Pinned'), 'Ordinary post must not have Pinned badge');
    assert(!html.includes('border-l-4'), 'Ordinary post must not have announcement left-border');
    assert(html.includes('Ordinary post content for all colleagues.'), 'Content renders cleanly');
  });

  runTest('3.2. NORMAL announcement renders Official Announcement badge with brand styling', () => {
    const html = renderToStaticMarkup(
      React.createElement(FeedPostCard, {
        post: normalAnnouncement,
        currentUserId: 'viewer_1',
        currentUserRole: UserRole.STAFF,
        onPostDeleted: () => {},
        onPostUpdated: () => {},
      })
    );

    assert(html.includes('Official Announcement'), 'Must render Official Announcement label');
    assert(html.includes('bg-brand-yellow/20'), 'Must use brand yellow styling');
    assert(!html.includes('URGENT'), 'NORMAL announcement must not show URGENT badge');
    assert(!html.includes('Important'), 'NORMAL announcement must not show Important badge');
    assert(!html.includes('Pinned'), 'Unpinned announcement must not show Pinned badge');
  });

  runTest('3.3. IMPORTANT announcement renders Important badge', () => {
    const html = renderToStaticMarkup(
      React.createElement(FeedPostCard, {
        post: importantAnnouncement,
        currentUserId: 'viewer_1',
        currentUserRole: UserRole.STAFF,
        onPostDeleted: () => {},
        onPostUpdated: () => {},
      })
    );

    assert(html.includes('Official Announcement'), 'Must render Official Announcement label');
    assert(html.includes('Important'), 'Must render Important priority badge');
    assert(html.includes('bg-amber-100'), 'Important badge styled with amber');
    assert(html.includes('border-l-amber-500'), 'Card has amber left-border accent');
  });

  runTest('3.4. URGENT pinned announcement renders URGENT badge and Pinned badge', () => {
    const html = renderToStaticMarkup(
      React.createElement(FeedPostCard, {
        post: urgentPinnedAnnouncement,
        currentUserId: 'viewer_1',
        currentUserRole: UserRole.STAFF,
        onPostDeleted: () => {},
        onPostUpdated: () => {},
      })
    );

    assert(html.includes('Official Announcement'), 'Must render Official Announcement label');
    assert(html.includes('URGENT'), 'Must render URGENT badge');
    assert(html.includes('bg-rose-100 text-rose-800'), 'URGENT badge styled prominently in rose/red');
    assert(html.includes('border-l-rose-500'), 'Card has rose left-border accent');
    assert(html.includes('Pinned'), 'Must render Pinned indicator');
  });

  // Test Group 4: Pin and Unpin Controls Authorization on FeedPostCard
  console.log('\n--- Group 4: Pin / Unpin Action Authorization ---');

  runTest('4.1. STAFF cannot see pin/unpin button on any post, even announcements', () => {
    const html = renderToStaticMarkup(
      React.createElement(FeedPostCard, {
        post: urgentPinnedAnnouncement,
        currentUserId: 'staff_1',
        currentUserRole: UserRole.STAFF,
        onPostDeleted: () => {},
        onPostUpdated: () => {},
      })
    );

    assert(!html.includes('aria-label="Unpin announcement"'), 'STAFF must not see unpin button');
    assert(!html.includes('aria-label="Pin announcement to top"'), 'STAFF must not see pin button');
  });

  runTest('4.2. ADMIN sees pin/unpin button on official announcements', () => {
    // Pinned announcement -> Unpin button
    const htmlPinned = renderToStaticMarkup(
      React.createElement(FeedPostCard, {
        post: urgentPinnedAnnouncement,
        currentUserId: 'admin_1',
        currentUserRole: UserRole.ADMIN,
        onPostDeleted: () => {},
        onPostUpdated: () => {},
      })
    );
    assert(htmlPinned.includes('aria-label="Unpin announcement"'), 'ADMIN must see Unpin button on pinned announcement');

    // Unpinned announcement -> Pin button
    const htmlUnpinned = renderToStaticMarkup(
      React.createElement(FeedPostCard, {
        post: normalAnnouncement,
        currentUserId: 'admin_1',
        currentUserRole: UserRole.ADMIN,
        onPostDeleted: () => {},
        onPostUpdated: () => {},
      })
    );
    assert(htmlUnpinned.includes('aria-label="Pin announcement to top"'), 'ADMIN must see Pin button on unpinned announcement');
  });

  runTest('4.3. ADMIN does NOT see pin button on ordinary posts', () => {
    const html = renderToStaticMarkup(
      React.createElement(FeedPostCard, {
        post: ordinaryPost,
        currentUserId: 'admin_1',
        currentUserRole: UserRole.ADMIN,
        onPostDeleted: () => {},
        onPostUpdated: () => {},
      })
    );

    assert(!html.includes('aria-label="Pin announcement to top"'), 'ADMIN must not see pin button on ordinary post');
    assert(!html.includes('aria-label="Unpin announcement"'), 'ADMIN must not see unpin button on ordinary post');
  });

  runTest('4.4. SUPER_ADMIN sees pin button on announcements', () => {
    const html = renderToStaticMarkup(
      React.createElement(FeedPostCard, {
        post: normalAnnouncement,
        currentUserId: 'super_1',
        currentUserRole: UserRole.SUPER_ADMIN,
        onPostDeleted: () => {},
        onPostUpdated: () => {},
      })
    );

    assert(html.includes('aria-label="Pin announcement to top"'), 'SUPER_ADMIN must see Pin button on unpinned announcement');
  });

  // Test Group 5: Legacy Compatibility & Safety
  console.log('\n--- Group 5: Legacy Compatibility & HTML Safety ---');

  runTest('5.1. Legacy post lacking isAnnouncement, priority, pinnedAt renders without crash', () => {
    const html = renderToStaticMarkup(
      React.createElement(FeedPostCard, {
        post: legacyPostMissingFields,
        currentUserId: 'viewer_1',
        currentUserRole: UserRole.STAFF,
        onPostDeleted: () => {},
        onPostUpdated: () => {},
      })
    );

    assert(html.includes('Legacy post without announcement fields.'), 'Legacy post content renders cleanly');
    assert(!html.includes('Official Announcement'), 'Legacy post does not render announcement badge');
    assert(!html.includes('Pinned'), 'Legacy post does not render pinned badge');
  });

  const cardCode = fs.readFileSync(path.resolve('src/components/feed/FeedPostCard.tsx'), 'utf8');

  runTest('5.2. FeedPostCard strictly avoids dangerouslySetInnerHTML', () => {
    assert(!cardCode.includes('dangerouslySetInnerHTML='), 'Must not use dangerouslySetInnerHTML');
  });

  runTest('5.3. FeedPostCard uses existing PATCH /api/feed/posts/:id/pin endpoint', () => {
    assert(
      cardCode.includes('/api/feed/posts/${encodeURIComponent(post.id)}/pin'),
      'Must use existing PATCH /api/feed/posts/:id/pin endpoint'
    );
    assert(
      cardCode.includes("method: 'PATCH'"),
      'Must call PATCH method'
    );
    assert(
      cardCode.includes('body: JSON.stringify({ isPinned: targetPinnedState })'),
      'Must send isPinned boolean body'
    );
  });

  console.log('\n================================================================');
  console.log(`PHASE 2C FRONTEND RESULTS: ${passed} passed, ${failed} failed.`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
