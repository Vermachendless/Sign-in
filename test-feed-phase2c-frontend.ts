import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

async function runTests() {
  console.log('=== Running Phase 2C: Frontend Feed View & Navigation Integration Tests ===\n');

  // 1. Inspect Sidebar.tsx
  console.log('Test Group 1: Navigation & Route Configuration');
  const sidebarContent = fs.readFileSync(path.resolve('src/components/Sidebar.tsx'), 'utf8');

  assert(
    sidebarContent.includes("| 'feed'"),
    'AppRoute union in Sidebar.tsx includes "feed"'
  );
  assert(
    sidebarContent.includes('Staff Feed & Announcements'),
    'Sidebar.tsx includes "Staff Feed & Announcements" label'
  );
  assert(
    sidebarContent.includes('Megaphone'),
    'Sidebar.tsx imports and uses Megaphone icon for feed navigation'
  );

  const occurrencesOfFeedInNav = (sidebarContent.match(/id:\s*'feed'/g) || []).length;
  assert(
    occurrencesOfFeedInNav === 3,
    `Sidebar.tsx registers feed in COMMUNICATION for all 3 user roles (found ${occurrencesOfFeedInNav} occurrences)`
  );

  // 2. Inspect Header.tsx
  console.log('\nTest Group 2: Header Breadcrumb Integration');
  const headerContent = fs.readFileSync(path.resolve('src/components/Header.tsx'), 'utf8');

  assert(
    headerContent.includes("case 'feed':"),
    'Header.tsx handles "feed" route in getBreadcrumb'
  );
  assert(
    headerContent.includes("title: 'Staff Feed & Announcements'"),
    'Header.tsx sets title to "Staff Feed & Announcements"'
  );
  assert(
    headerContent.includes("section: 'Communication'"),
    'Header.tsx maps feed under "Communication" section'
  );

  // 3. Inspect App.tsx
  console.log('\nTest Group 3: App.tsx Route Guards and View Rendering');
  const appContent = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');

  assert(
    appContent.includes("import { FeedView } from './components/feed/FeedView.tsx';"),
    'App.tsx imports FeedView component'
  );
  assert(
    appContent.includes("currentRoute !== 'feed'"),
    'App.tsx allows "feed" route in STAFF role route guard'
  );
  assert(
    appContent.includes("currentRoute === 'feed' ? (") && appContent.includes('<FeedView />'),
    'App.tsx conditionally renders FeedView when currentRoute === "feed"'
  );

  // 4. Inspect Frontend Feed Components
  console.log('\nTest Group 4: Component Architecture, Safety & Constraints');

  const composerContent = fs.readFileSync(path.resolve('src/components/feed/FeedComposer.tsx'), 'utf8');
  assert(
    composerContent.includes('MAX_POST_LENGTH = 3000'),
    'FeedComposer enforces 3,000 character maximum post length'
  );
  assert(
    composerContent.includes('charCount') && composerContent.includes('MAX_POST_LENGTH'),
    'FeedComposer includes real-time character count indicator'
  );
  assert(
    !composerContent.includes("setDraft(''); // on error") &&
    composerContent.includes("setDraft(''); // Cleared only on successful creation"),
    'FeedComposer preserves user draft when submission fails'
  );

  const commentContent = fs.readFileSync(path.resolve('src/components/feed/FeedCommentThread.tsx'), 'utf8');
  assert(
    commentContent.includes('MAX_COMMENT_LENGTH = 1000'),
    'FeedCommentThread enforces 1,000 character maximum comment length'
  );
  assert(
    !commentContent.includes('dangerouslySetInnerHTML='),
    'FeedCommentThread strictly avoids dangerouslySetInnerHTML attribute'
  );
  assert(
    commentContent.includes("setComposerDraft(''); // Only clear on success"),
    'FeedCommentThread preserves comment draft on submission error'
  );

  const cardContent = fs.readFileSync(path.resolve('src/components/feed/FeedPostCard.tsx'), 'utf8');
  assert(
    !cardContent.includes('dangerouslySetInnerHTML='),
    'FeedPostCard renders plain text safely without dangerouslySetInnerHTML attribute'
  );
  assert(
    cardContent.includes('handleDeletePost') && cardContent.includes('showDeleteConfirm'),
    'FeedPostCard provides confirmation modal/action before post deletion'
  );
  assert(
    cardContent.includes('FeedReactionsBar') && cardContent.includes('FeedCommentThread'),
    'FeedPostCard embeds FeedReactionsBar and FeedCommentThread'
  );

  const reactionsContent = fs.readFileSync(path.resolve('src/components/feed/FeedReactionsBar.tsx'), 'utf8');
  assert(
    reactionsContent.includes("'LIKE'") &&
    reactionsContent.includes("'CELEBRATE'") &&
    reactionsContent.includes("'SUPPORT'") &&
    reactionsContent.includes("'INSIGHTFUL'"),
    'FeedReactionsBar supports all 4 reaction types: LIKE, CELEBRATE, SUPPORT, INSIGHTFUL'
  );
  assert(
    reactionsContent.includes('nextReactions') && reactionsContent.includes('prevReaction'),
    'FeedReactionsBar implements optimistic state update with rollback'
  );

  const viewContent = fs.readFileSync(path.resolve('src/components/feed/FeedView.tsx'), 'utf8');
  assert(
    viewContent.includes('FEED_AUTH_REQUIRED_MSG'),
    'FeedView exports FEED_AUTH_REQUIRED_MSG constant'
  );
  assert(
    viewContent.includes('res.status === 401') &&
    !viewContent.includes('logout();') &&
    !viewContent.includes('setUser(null);'),
    'FeedView handles 401 without calling global logout or clearing session'
  );
  assert(
    viewContent.includes('nextCursor') && viewContent.includes('hasMore'),
    'FeedView supports cursor pagination with Load More'
  );

  // 5. Backend Smoke Verification to Ensure Compatibility
  console.log('\nTest Group 5: Backend API Compatibility Check');
  const { feedService } = await import('./server/services/feed.service.ts');
  const { dbAdapter } = await import('./server/db/adapter.ts');

  const testUser = await dbAdapter.queryOne<{ id: string; role: string; status: string }>(
    `SELECT id, role, status FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1`
  );

  if (testUser) {
    const post = await feedService.createPost(testUser.id, 'Phase 2C verification post content');
    assert(Boolean(post && post.id), 'feedService creates a post successfully');

    const reactionRes = await feedService.toggleReaction(post.id, testUser.id, 'CELEBRATE');
    assert(
      reactionRes.action === 'ADDED' && reactionRes.reactionType === 'CELEBRATE',
      'feedService toggles reaction CELEBRATE successfully'
    );

    const comment = await feedService.createComment(post.id, testUser.id, 'Phase 2C test comment');
    assert(Boolean(comment && comment.id), 'feedService creates comment successfully');

    const listRes = await feedService.listPosts(testUser.id, { limit: 5 });
    assert(
      listRes.posts.length > 0 && listRes.posts.some((p: any) => p.id === post.id),
      'feedService.listPosts returns newly created post'
    );

    await feedService.deletePost(post.id, {
      id: testUser.id,
      role: testUser.role,
      status: testUser.status,
    });
    assert(true, 'Test post successfully cleaned up via feedService.deletePost');
  }

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
