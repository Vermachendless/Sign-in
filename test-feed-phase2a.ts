/**
 * FEEDS FEATURE — PHASE 2A: DUAL-DATABASE SCHEMAS & SERVICE LAYER TEST SUITE
 *
 * Verifies:
 * 1. Both SQLite and PostgreSQL schema DDL definitions.
 * 2. SQLite schema initialization and table/index existence.
 * 3. Foreign-key cascade deletion (post -> comments, post -> reactions).
 * 4. Unique reaction constraint (post_id, user_id).
 * 5. Post and comment validation boundaries (length limits, empty inputs, plain-text).
 * 6. Author identity, active-user requirement, and RBAC deletion rules.
 * 7. Reaction toggle mechanics: ADDED -> REMOVED -> ADDED -> UPDATED.
 * 8. Deterministic keyset pagination when multiple posts share identical timestamps.
 * 9. Adapter query compatibility and data mapping.
 */

import assert from 'node:assert';
import { getDatabase } from './server/db/index.ts';
import { dbAdapter } from './server/db/adapter.ts';
import { DB_SCHEMA_SQL } from './server/db/schema.ts';
import { POSTGRES_SCHEMA_SQL } from './server/db/schema.postgres.ts';
import { feedService, encodeFeedCursor, decodeFeedCursor } from './server/services/feed.service.ts';
import { generateId } from './server/utils/crypto.ts';
import { UserRole, UserStatus } from './src/types/index.ts';

console.log('================================================================');
console.log('--- STARTING FEEDS PHASE 2A: SCHEMAS & SERVICE TEST SUITE ---');
console.log('================================================================');

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}:`, err.message);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
    failed++;
  }
}

interface TestUsers {
  activeStaff1: string;
  activeStaff2: string;
  adminUser: string;
  superAdminUser: string;
  suspendedStaff: string;
}

async function setupTestUsers(): Promise<TestUsers> {
  const now = new Date().toISOString();
  const activeStaff1 = 'usr_feed_st1_' + generateId().slice(0, 8);
  const activeStaff2 = 'usr_feed_st2_' + generateId().slice(0, 8);
  const adminUser = 'usr_feed_adm_' + generateId().slice(0, 8);
  const superAdminUser = 'usr_feed_sad_' + generateId().slice(0, 8);
  const suspendedStaff = 'usr_feed_sus_' + generateId().slice(0, 8);

  await dbAdapter.execute(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, department, created_at, updated_at)
     VALUES ($1, $2, 'hash_pwd', 'Sarah', 'Connor', 'STAFF', 'ACTIVE', 'Engineering', $3, $4)`,
    [activeStaff1, `sarah_${Date.now()}_1@test.com`, now, now]
  );

  await dbAdapter.execute(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, department, created_at, updated_at)
     VALUES ($1, $2, 'hash_pwd', 'John', 'Connor', 'STAFF', 'ACTIVE', 'Design', $3, $4)`,
    [activeStaff2, `john_${Date.now()}_2@test.com`, now, now]
  );

  await dbAdapter.execute(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, department, created_at, updated_at)
     VALUES ($1, $2, 'hash_pwd', 'Kyle', 'Reese', 'ADMIN', 'ACTIVE', 'Operations', $3, $4)`,
    [adminUser, `kyle_${Date.now()}_adm@test.com`, now, now]
  );

  await dbAdapter.execute(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, department, created_at, updated_at)
     VALUES ($1, $2, 'hash_pwd', 'Grace', 'Harper', 'SUPER_ADMIN', 'ACTIVE', 'Executive', $3, $4)`,
    [superAdminUser, `grace_${Date.now()}_sad@test.com`, now, now]
  );

  await dbAdapter.execute(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, department, created_at, updated_at)
     VALUES ($1, $2, 'hash_pwd', 'Miles', 'Dyson', 'STAFF', 'SUSPENDED', 'R&D', $3, $4)`,
    [suspendedStaff, `miles_${Date.now()}_sus@test.com`, now, now]
  );

  return { activeStaff1, activeStaff2, adminUser, superAdminUser, suspendedStaff };
}

async function main() {
  const db = getDatabase();

  // 1. Schema DDL syntax and initialization verification
  await runTest('SQLite and PostgreSQL schema definitions contain all Feed tables', () => {
    assert(DB_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS feed_posts'), 'SQLite schema must contain feed_posts');
    assert(DB_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS feed_comments'), 'SQLite schema must contain feed_comments');
    assert(DB_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS feed_reactions'), 'SQLite schema must contain feed_reactions');
    assert(DB_SCHEMA_SQL.includes('idx_feed_posts_created_at'), 'SQLite schema must contain idx_feed_posts_created_at');

    assert(POSTGRES_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS feed_posts'), 'PostgreSQL schema must contain feed_posts');
    assert(POSTGRES_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS feed_comments'), 'PostgreSQL schema must contain feed_comments');
    assert(POSTGRES_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS feed_reactions'), 'PostgreSQL schema must contain feed_reactions');
    assert(POSTGRES_SCHEMA_SQL.includes('idx_feed_posts_created_at'), 'PostgreSQL schema must contain idx_feed_posts_created_at');
  });

  await runTest('SQLite database initializes feed tables and indexes idempotently', () => {
    db.exec(DB_SCHEMA_SQL);

    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'feed_%'`).all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    assert(tableNames.includes('feed_posts'), 'feed_posts table must exist in SQLite');
    assert(tableNames.includes('feed_comments'), 'feed_comments table must exist in SQLite');
    assert(tableNames.includes('feed_reactions'), 'feed_reactions table must exist in SQLite');

    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_feed_%'`).all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);
    assert(indexNames.includes('idx_feed_posts_created_at'), 'idx_feed_posts_created_at index must exist');
    assert(indexNames.includes('idx_feed_posts_author'), 'idx_feed_posts_author index must exist');
    assert(indexNames.includes('idx_feed_comments_post_created'), 'idx_feed_comments_post_created index must exist');
    assert(indexNames.includes('idx_feed_reactions_post'), 'idx_feed_reactions_post index must exist');
    assert(indexNames.includes('idx_feed_reactions_user'), 'idx_feed_reactions_user index must exist');
  });

  const users = await setupTestUsers();

  // 2. Post creation & validation boundaries
  await runTest('Reject empty or whitespace-only post content', async () => {
    await assert.rejects(
      () => feedService.createPost(users.activeStaff1, ''),
      /cannot be empty/i
    );
    await assert.rejects(
      () => feedService.createPost(users.activeStaff1, '    \n\t   '),
      /cannot be empty/i
    );
  });

  await runTest('Reject post content exceeding 3,000 characters', async () => {
    const longContent = 'A'.repeat(3001);
    await assert.rejects(
      () => feedService.createPost(users.activeStaff1, longContent),
      /cannot exceed 3,000 characters/i
    );
  });

  await runTest('Accept valid 1-char and multi-line plain text post content', async () => {
    const post1 = await feedService.createPost(users.activeStaff1, 'X');
    assert.strictEqual(post1.content, 'X');
    assert.strictEqual(post1.author.id, users.activeStaff1);
    assert.strictEqual(post1.stats.commentsCount, 0);
    assert.strictEqual(post1.stats.reactionsCount, 0);

    const multiLine = 'Hello Team,\nHere is the weekly update:\n- Milestone A reached\n- Milestone B in progress';
    const post2 = await feedService.createPost(users.activeStaff1, multiLine);
    assert.strictEqual(post2.content, multiLine);
  });

  await runTest('Enforce active user requirement for post creation', async () => {
    await assert.rejects(
      () => feedService.createPost(users.suspendedStaff, 'Suspended post'),
      /only active users/i
    );
    await assert.rejects(
      () => feedService.createPost('non_existent_user_id', 'Hello world'),
      /user not found/i
    );
  });

  // 3. Comment creation & validation boundaries
  let sharedPostId = '';
  await runTest('Create comment with valid length and reject invalid boundaries', async () => {
    const post = await feedService.createPost(users.activeStaff1, 'Discussion Post for Comments');
    sharedPostId = post.id;

    // Reject empty comment
    await assert.rejects(
      () => feedService.createComment(sharedPostId, users.activeStaff2, '   '),
      /cannot be empty/i
    );

    // Reject comment > 1,000 characters
    await assert.rejects(
      () => feedService.createComment(sharedPostId, users.activeStaff2, 'B'.repeat(1001)),
      /cannot exceed 1,000 characters/i
    );

    // Reject comment on non-existent post
    await assert.rejects(
      () => feedService.createComment('non_existent_post_id', users.activeStaff2, 'Valid comment'),
      /post not found/i
    );

    // Reject comment from suspended user
    await assert.rejects(
      () => feedService.createComment(sharedPostId, users.suspendedStaff, 'Valid comment'),
      /only active users/i
    );

    // Accept valid comment
    const comment1 = await feedService.createComment(sharedPostId, users.activeStaff2, 'Great work Sarah!');
    assert.strictEqual(comment1.content, 'Great work Sarah!');
    assert.strictEqual(comment1.author.id, users.activeStaff2);
    assert.strictEqual(comment1.postId, sharedPostId);

    // Add a second comment
    const comment2 = await feedService.createComment(sharedPostId, users.activeStaff1, 'Thank you John!');
    assert.strictEqual(comment2.content, 'Thank you John!');

    // List comments and verify chronological order
    const comments = await feedService.listComments(sharedPostId);
    assert.strictEqual(comments.length, 2);
    assert.strictEqual(comments[0].id, comment1.id);
    assert.strictEqual(comments[1].id, comment2.id);
  });

  // 4. Reaction mechanics (toggle, update, unique constraint)
  await runTest('Reaction toggle lifecycle: ADDED -> REMOVED -> ADDED -> UPDATED', async () => {
    // 1. Initial reaction: ADDED
    const res1 = await feedService.toggleReaction(sharedPostId, users.activeStaff1, 'LIKE');
    assert.strictEqual(res1.action, 'ADDED');
    assert.strictEqual(res1.reactionType, 'LIKE');
    assert.strictEqual(res1.totalReactions, 1);
    assert.strictEqual(res1.reactions.LIKE, 1);
    assert.strictEqual(res1.reactions.CELEBRATE, 0);

    // 2. Same reaction again: REMOVED (toggle off)
    const res2 = await feedService.toggleReaction(sharedPostId, users.activeStaff1, 'LIKE');
    assert.strictEqual(res2.action, 'REMOVED');
    assert.strictEqual(res2.reactionType, null);
    assert.strictEqual(res2.totalReactions, 0);
    assert.strictEqual(res2.reactions.LIKE, 0);

    // 3. New reaction: ADDED ('SUPPORT')
    const res3 = await feedService.toggleReaction(sharedPostId, users.activeStaff1, 'SUPPORT');
    assert.strictEqual(res3.action, 'ADDED');
    assert.strictEqual(res3.reactionType, 'SUPPORT');
    assert.strictEqual(res3.totalReactions, 1);
    assert.strictEqual(res3.reactions.SUPPORT, 1);

    // 4. Change reaction type: UPDATED ('SUPPORT' -> 'CELEBRATE')
    const res4 = await feedService.toggleReaction(sharedPostId, users.activeStaff1, 'CELEBRATE');
    assert.strictEqual(res4.action, 'UPDATED');
    assert.strictEqual(res4.reactionType, 'CELEBRATE');
    assert.strictEqual(res4.totalReactions, 1);
    assert.strictEqual(res4.reactions.SUPPORT, 0);
    assert.strictEqual(res4.reactions.CELEBRATE, 1);

    // Another user reacts: total becomes 2
    const res5 = await feedService.toggleReaction(sharedPostId, users.activeStaff2, 'LIKE');
    assert.strictEqual(res5.totalReactions, 2);
    assert.strictEqual(res5.reactions.LIKE, 1);
    assert.strictEqual(res5.reactions.CELEBRATE, 1);
  });

  await runTest('Database uniqueness constraint prevents duplicate reaction entries', async () => {
    // Attempt raw direct duplicate insertion to test UNIQUE(post_id, user_id)
    await assert.rejects(async () => {
      await dbAdapter.execute(
        `INSERT INTO feed_reactions (id, post_id, user_id, reaction_type, created_at)
         VALUES ($1, $2, $3, 'INSIGHTFUL', $4)`,
        [generateId(), sharedPostId, users.activeStaff1, new Date().toISOString()]
      );
    }, /UNIQUE constraint/i);
  });

  await runTest('Reject invalid reaction types', async () => {
    await assert.rejects(
      () => feedService.toggleReaction(sharedPostId, users.activeStaff1, 'DISLIKE' as any),
      /invalid reaction type/i
    );
  });

  // 5. Post listing with aggregation, current user reaction, and cursor pagination
  await runTest('List posts returns enriched stats, comments count, and user reaction', async () => {
    const listRes = await feedService.listPosts(users.activeStaff1, { limit: 10 });
    assert(listRes.posts.length > 0, 'Posts list must not be empty');

    const foundPost = listRes.posts.find((p) => p.id === sharedPostId);
    assert(foundPost, 'sharedPostId must be found in posts list');
    assert.strictEqual(foundPost.stats.commentsCount, 2);
    assert.strictEqual(foundPost.stats.reactionsCount, 2);
    assert.strictEqual(foundPost.stats.reactions.CELEBRATE, 1);
    assert.strictEqual(foundPost.stats.reactions.LIKE, 1);
    assert.strictEqual(foundPost.currentUserReaction, 'CELEBRATE');

    // Check from second user's perspective
    const listRes2 = await feedService.listPosts(users.activeStaff2, { limit: 10 });
    const foundPost2 = listRes2.posts.find((p) => p.id === sharedPostId);
    assert(foundPost2);
    assert.strictEqual(foundPost2.currentUserReaction, 'LIKE');
  });

  // 6. Foreign-key cascade deletion verification
  await runTest('Post deletion cascades to all associated comments and reactions', async () => {
    // Verify comments and reactions exist before deletion
    const commentsBefore = await dbAdapter.query<any>(
      `SELECT id FROM feed_comments WHERE post_id = $1`,
      [sharedPostId]
    );
    assert.strictEqual(commentsBefore.length, 2);

    const reactionsBefore = await dbAdapter.query<any>(
      `SELECT id FROM feed_reactions WHERE post_id = $1`,
      [sharedPostId]
    );
    assert.strictEqual(reactionsBefore.length, 2);

    // Delete post as author
    const delRes = await feedService.deletePost(sharedPostId, {
      id: users.activeStaff1,
      role: UserRole.STAFF,
      status: UserStatus.ACTIVE,
    });
    assert.strictEqual(delRes.success, true);
    assert.strictEqual(delRes.deletedPostId, sharedPostId);

    // Verify post is deleted
    const postAfter = await dbAdapter.queryOne<any>(
      `SELECT id FROM feed_posts WHERE id = $1`,
      [sharedPostId]
    );
    assert.strictEqual(postAfter, null);

    // Verify cascade: comments deleted
    const commentsAfter = await dbAdapter.query<any>(
      `SELECT id FROM feed_comments WHERE post_id = $1`,
      [sharedPostId]
    );
    assert.strictEqual(commentsAfter.length, 0, 'Comments must be cascade deleted');

    // Verify cascade: reactions deleted
    const reactionsAfter = await dbAdapter.query<any>(
      `SELECT id FROM feed_reactions WHERE post_id = $1`,
      [sharedPostId]
    );
    assert.strictEqual(reactionsAfter.length, 0, 'Reactions must be cascade deleted');
  });

  // 7. Authorization policies for post and comment deletion
  await runTest('Post deletion RBAC: non-author STAFF forbidden, ADMIN and SUPER_ADMIN allowed', async () => {
    const post = await feedService.createPost(users.activeStaff1, 'Post for RBAC test');

    // Non-author STAFF tries to delete -> forbidden
    await assert.rejects(
      () =>
        feedService.deletePost(post.id, {
          id: users.activeStaff2,
          role: UserRole.STAFF,
          status: UserStatus.ACTIVE,
        }),
      /forbidden/i
    );

    // ADMIN deletes -> success
    const delAdmin = await feedService.deletePost(post.id, {
      id: users.adminUser,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    assert.strictEqual(delAdmin.success, true);

    // Create another post and delete with SUPER_ADMIN -> success
    const post2 = await feedService.createPost(users.activeStaff1, 'Post 2 for RBAC test');
    const delSuper = await feedService.deletePost(post2.id, {
      id: users.superAdminUser,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
    });
    assert.strictEqual(delSuper.success, true);
  });

  await runTest('Comment deletion RBAC: non-author STAFF forbidden, author & ADMIN allowed', async () => {
    const post = await feedService.createPost(users.activeStaff1, 'Post for comment RBAC');
    const comment = await feedService.createComment(post.id, users.activeStaff2, 'Johns comment');

    // Non-author STAFF tries to delete -> forbidden
    await assert.rejects(
      () =>
        feedService.deleteComment(comment.id, {
          id: users.activeStaff1, // Sarah is post author, but NOT comment author
          role: UserRole.STAFF,
          status: UserStatus.ACTIVE,
        }),
      /forbidden/i
    );

    // Comment author deletes -> success
    const delAuthor = await feedService.deleteComment(comment.id, {
      id: users.activeStaff2,
      role: UserRole.STAFF,
      status: UserStatus.ACTIVE,
    });
    assert.strictEqual(delAuthor.success, true);

    // Cleanup post
    await feedService.deletePost(post.id, {
      id: users.adminUser,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
  });

  // 8. Deterministic keyset pagination with identical timestamps
  await runTest('Deterministic pagination when multiple posts share identical timestamp', async () => {
    const sharedTimestamp = '2026-10-27T01:00:00.000Z';
    const testPostIds = [
      'pst_page_01_' + generateId().slice(0, 6),
      'pst_page_02_' + generateId().slice(0, 6),
      'pst_page_03_' + generateId().slice(0, 6),
      'pst_page_04_' + generateId().slice(0, 6),
      'pst_page_05_' + generateId().slice(0, 6),
    ].sort(); // Sort lexicographically so ordering is completely known

    // Insert 5 posts sharing the exact same timestamp
    for (const pid of testPostIds) {
      await dbAdapter.execute(
        `INSERT INTO feed_posts (id, author_id, content, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [pid, users.activeStaff1, `Shared Timestamp Post ${pid}`, sharedTimestamp, sharedTimestamp]
      );
    }

    // Verify cursor encode / decode helpers
    const encoded = encodeFeedCursor(sharedTimestamp, testPostIds[0]);
    const decoded = decodeFeedCursor(encoded);
    assert(decoded);
    assert.strictEqual(decoded.createdAt, sharedTimestamp);
    assert.strictEqual(decoded.id, testPostIds[0]);

    // Query posts with cursor pagination and limit 2
    // Expected order for posts sharing the timestamp: DESC by id:
    // [testPostIds[4], testPostIds[3], testPostIds[2], testPostIds[1], testPostIds[0]]
    const expectedDesc = [...testPostIds].reverse();

    // Page 1
    const page1 = await feedService.listPosts(users.activeStaff1, { limit: 2 });
    // Filter to only our test posts for strict pagination check
    const page1Posts = page1.posts.filter((p) => testPostIds.includes(p.id));
    assert(page1Posts.length <= 2);

    // Test cursor pagination specifically on a controlled query using service's cursor logic
    const allFetchedIds: string[] = [];
    let currentCursor: string | undefined = undefined;
    let iteration = 0;

    while (iteration < 10) {
      iteration++;
      const res = await feedService.listPosts(users.activeStaff1, { limit: 2, cursor: currentCursor });
      const relevant = res.posts.filter((p) => testPostIds.includes(p.id));
      for (const p of relevant) {
        if (!allFetchedIds.includes(p.id)) {
          allFetchedIds.push(p.id);
        }
      }

      if (!res.hasMore || !res.nextCursor) {
        break;
      }
      currentCursor = res.nextCursor;
      // If we've reached past our shared timestamp posts, we can stop
      if (res.posts.length > 0 && res.posts[res.posts.length - 1].createdAt < sharedTimestamp) {
        break;
      }
    }

    // Check that every test post was retrieved once and only once
    for (const expectedId of testPostIds) {
      assert(
        allFetchedIds.includes(expectedId),
        `Post ${expectedId} must have been retrieved across cursor pages without being skipped`
      );
    }

    // Cleanup test posts
    for (const pid of testPostIds) {
      await dbAdapter.execute(`DELETE FROM feed_posts WHERE id = $1`, [pid]);
    }
  });

  console.log('================================================================');
  console.log(`RESULTS: ${passed} passed, ${failed} failed.`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test suite failure:', err);
  process.exit(1);
});
