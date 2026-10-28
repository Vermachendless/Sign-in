import { dbAdapter } from '../db/adapter.ts';
import { generateId } from '../utils/crypto.ts';
import { notificationService } from './notification.service.ts';
import {
  FeedReactionType,
  FeedAuthor,
  FeedPostRecord,
  FeedPostItem,
  FeedCommentRecord,
  FeedCommentItem,
  FeedReactionRecord,
  FeedPostListResponse,
  ToggleReactionResult,
  UserRole,
  UserStatus,
  AnnouncementPriority,
  NotificationType,
} from '../../src/types/index.ts';

const ALLOWED_REACTIONS: readonly FeedReactionType[] = [
  'LIKE',
  'CELEBRATE',
  'SUPPORT',
  'INSIGHTFUL',
] as const;

export interface FeedActor {
  id: string;
  role: UserRole | string;
  status: UserStatus | string;
}

export interface ListPostsOptions {
  limit?: number;
  cursor?: string;
}

export interface ListCommentsOptions {
  limit?: number;
  offset?: number;
}

export interface CreatePostOptions {
  isAnnouncement?: boolean;
  priority?: AnnouncementPriority;
  isPinned?: boolean;
}

export interface FeedCursorData {
  createdAt: string;
  id: string;
  pinnedAt?: string;
  type?: 'pinned' | 'unpinned';
}

/**
 * Safely normalizes date / timestamp values from SQLite (string) or PostgreSQL (Date or string)
 */
function formatTimestamp(val: any): string {
  if (!val) return new Date().toISOString();
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return new Date(val).toISOString();
}

/**
 * Base64url deterministic cursor encoder with pinned state support
 */
export function encodeFeedCursor(
  createdAt: string,
  id: string,
  options?: { pinnedAt?: string | null; type?: 'pinned' | 'unpinned' }
): string {
  const payload: FeedCursorData = {
    createdAt,
    id,
    ...(options?.pinnedAt ? { pinnedAt: options.pinnedAt } : {}),
    type: options?.type || 'unpinned',
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Deterministic cursor decoder with backward-compatible delimiter fallback
 */
export function decodeFeedCursor(cursor: string): FeedCursorData | null {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return {
        createdAt: parsed.createdAt,
        id: parsed.id,
        pinnedAt: typeof parsed.pinnedAt === 'string' ? parsed.pinnedAt : undefined,
        type: parsed.type === 'pinned' ? 'pinned' : 'unpinned',
      };
    }
  } catch {
    // Fallback delimiter parsing
    const parts = cursor.split('|');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { createdAt: parts[0], id: parts[1], type: 'unpinned' };
    }
  }
  return null;
}

export class FeedService {
  /**
   * Helper to fetch and verify active user status.
   */
  private async getVerifiedActiveUser(userId: string): Promise<FeedAuthor> {
    if (!userId) {
      throw new Error('User ID is required.');
    }

    const row = await dbAdapter.queryOne<any>(
      `SELECT id, email, first_name, last_name, department, role, status
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (!row) {
      throw new Error('User not found.');
    }

    if (row.status !== UserStatus.ACTIVE && row.status !== 'ACTIVE') {
      throw new Error('Only active users can perform this action.');
    }

    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      department: row.department || null,
      role: row.role as UserRole,
      status: row.status as UserStatus,
    };
  }

  /**
   * Maps raw database row with user join and reaction aggregation to standard FeedPostItem
   */
  private mapPostRow(row: any): FeedPostItem {
    return {
      id: row.id,
      content: row.content,
      isAnnouncement: Boolean(row.is_announcement),
      priority: (row.priority as AnnouncementPriority) || 'NORMAL',
      pinnedAt: row.pinned_at ? formatTimestamp(row.pinned_at) : null,
      createdAt: formatTimestamp(row.created_at),
      updatedAt: formatTimestamp(row.updated_at),
      author: {
        id: row.author_id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        department: row.department || null,
        role: row.author_role as UserRole,
        status: row.author_status as UserStatus,
      },
      stats: {
        commentsCount: Number(row.comments_count || 0),
        reactionsCount: Number(row.reactions_count || 0),
        reactions: {
          LIKE: Number(row.like_count || 0),
          CELEBRATE: Number(row.celebrate_count || 0),
          SUPPORT: Number(row.support_count || 0),
          INSIGHTFUL: Number(row.insightful_count || 0),
        },
      },
      currentUserReaction: (row.current_user_reaction as FeedReactionType) || null,
    };
  }

  /**
   * Dispatches in-app notifications to active colleagues when an IMPORTANT or URGENT
   * announcement is successfully published. Excludes the post author.
   * Handled with failure containment: does not fail or roll back the announcement.
   */
  private async dispatchAnnouncementNotifications(post: FeedPostItem): Promise<void> {
    try {
      const activeColleagues = await dbAdapter.query<{ id: string }>(
        `SELECT id FROM users WHERE status = 'ACTIVE' AND id != $1`,
        [post.author.id]
      );

      if (!activeColleagues || activeColleagues.length === 0) {
        return;
      }

      const isUrgent = post.priority === 'URGENT';
      const title = isUrgent
        ? '[URGENT] Official Announcement'
        : '[Important] Official Announcement';

      const rawContent = post.content.replace(/\s+/g, ' ').trim();
      const truncatedMessage =
        rawContent.length > 120 ? `${rawContent.slice(0, 117).trim()}...` : rawContent;

      const metadata = {
        postId: post.id,
        priority: post.priority,
        isAnnouncement: true,
        authorName: `${post.author.firstName} ${post.author.lastName}`.trim(),
        authorRole: post.author.role,
      };

      for (const colleague of activeColleagues) {
        try {
          await notificationService.createNotification({
            userId: colleague.id,
            type: NotificationType.ANNOUNCEMENT,
            title,
            message: truncatedMessage,
            metadata,
          });
        } catch (itemErr: any) {
          console.error(
            `[FeedService] Failed to notify user ${colleague.id} of announcement ${post.id}:`,
            itemErr?.message || itemErr
          );
        }
      }
    } catch (err: any) {
      console.error(
        `[FeedService] Failed to query active users for announcement ${post.id}:`,
        err?.message || err
      );
    }
  }

  /**
   * List posts with author details, comment counts, reaction counts by type,
   * and the calling user's reaction.
   * Uses two-tier deterministic ordering:
   * 1. Pinned announcements at top (pinned_at DESC, created_at DESC, id DESC).
   * 2. Chronological stream of unpinned posts (created_at DESC, id DESC).
   */
  public async listPosts(
    userId: string,
    options: ListPostsOptions = {}
  ): Promise<FeedPostListResponse> {
    if (!userId) {
      throw new Error('userId is required to list posts.');
    }

    const limit = Math.min(Math.max(1, Number(options.limit) || 20), 50);
    const cursor = options.cursor ? decodeFeedCursor(options.cursor) : null;

    const baseSelectSql = `
      SELECT 
        p.id,
        p.author_id,
        p.content,
        p.is_announcement,
        p.priority,
        p.pinned_at,
        p.created_at,
        p.updated_at,
        u.first_name,
        u.last_name,
        u.email,
        u.department,
        u.role as author_role,
        u.status as author_status,
        (SELECT COUNT(*) FROM feed_comments c WHERE c.post_id = p.id) as comments_count,
        (SELECT COUNT(*) FROM feed_reactions r WHERE r.post_id = p.id) as reactions_count,
        (SELECT COUNT(*) FROM feed_reactions r WHERE r.post_id = p.id AND r.reaction_type = 'LIKE') as like_count,
        (SELECT COUNT(*) FROM feed_reactions r WHERE r.post_id = p.id AND r.reaction_type = 'CELEBRATE') as celebrate_count,
        (SELECT COUNT(*) FROM feed_reactions r WHERE r.post_id = p.id AND r.reaction_type = 'SUPPORT') as support_count,
        (SELECT COUNT(*) FROM feed_reactions r WHERE r.post_id = p.id AND r.reaction_type = 'INSIGHTFUL') as insightful_count,
        (SELECT reaction_type FROM feed_reactions ur WHERE ur.post_id = p.id AND ur.user_id = $1) as current_user_reaction
      FROM feed_posts p
      JOIN users u ON p.author_id = u.id
    `;

    let resultPosts: FeedPostItem[] = [];
    let nextCursor: string | null = null;
    let hasMore = false;

    if (!cursor) {
      // Initial page load: fetch pinned posts (up to limit + 1)
      const pinnedRows = await dbAdapter.query<any>(
        `${baseSelectSql}
         WHERE p.pinned_at IS NOT NULL
         ORDER BY p.pinned_at DESC, p.created_at DESC, p.id DESC
         LIMIT $2`,
        [userId, limit + 1]
      );

      if (pinnedRows.length > limit) {
        // More pinned posts than requested limit: paginate pinned tier
        hasMore = true;
        const postRows = pinnedRows.slice(0, limit);
        resultPosts = postRows.map((r) => this.mapPostRow(r));
        const lastPost = resultPosts[resultPosts.length - 1];
        nextCursor = encodeFeedCursor(lastPost.createdAt, lastPost.id, {
          pinnedAt: lastPost.pinnedAt,
          type: 'pinned',
        });
      } else {
        // All pinned posts fit in page 1
        const pinnedPostItems = pinnedRows.map((r) => this.mapPostRow(r));
        const remainingLimit = limit - pinnedPostItems.length;

        if (remainingLimit > 0) {
          // Fill remainder of limit with unpinned posts
          const unpinnedRows = await dbAdapter.query<any>(
            `${baseSelectSql}
             WHERE p.pinned_at IS NULL
             ORDER BY p.created_at DESC, p.id DESC
             LIMIT $2`,
            [userId, remainingLimit + 1]
          );

          if (unpinnedRows.length > remainingLimit) {
            hasMore = true;
            const unpinnedSlice = unpinnedRows.slice(0, remainingLimit);
            const unpinnedItems = unpinnedSlice.map((r) => this.mapPostRow(r));
            resultPosts = [...pinnedPostItems, ...unpinnedItems];
            const lastPost = unpinnedItems[unpinnedItems.length - 1];
            nextCursor = encodeFeedCursor(lastPost.createdAt, lastPost.id, {
              type: 'unpinned',
            });
          } else {
            hasMore = false;
            const unpinnedItems = unpinnedRows.map((r) => this.mapPostRow(r));
            resultPosts = [...pinnedPostItems, ...unpinnedItems];
            nextCursor = null;
          }
        } else {
          // Exactly limit pinned posts; check if unpinned posts exist for next page
          const unpinnedCheck = await dbAdapter.queryOne<any>(
            `SELECT p.id FROM feed_posts p WHERE p.pinned_at IS NULL LIMIT 1`,
            []
          );
          hasMore = Boolean(unpinnedCheck);
          resultPosts = pinnedPostItems;
          if (hasMore) {
            const lastPost = pinnedPostItems[pinnedPostItems.length - 1];
            nextCursor = encodeFeedCursor(lastPost.createdAt, lastPost.id, {
              pinnedAt: lastPost.pinnedAt,
              type: 'pinned',
            });
          } else {
            nextCursor = null;
          }
        }
      }
    } else if (cursor.type === 'pinned' && cursor.pinnedAt) {
      // Paginating through remaining pinned posts
      const pinnedRows = await dbAdapter.query<any>(
        `${baseSelectSql}
         WHERE p.pinned_at IS NOT NULL
           AND (
             p.pinned_at < $2
             OR (p.pinned_at = $2 AND (p.created_at < $3 OR (p.created_at = $3 AND p.id < $4)))
           )
         ORDER BY p.pinned_at DESC, p.created_at DESC, p.id DESC
         LIMIT $5`,
        [userId, cursor.pinnedAt, cursor.createdAt, cursor.id, limit + 1]
      );

      if (pinnedRows.length > limit) {
        hasMore = true;
        const postRows = pinnedRows.slice(0, limit);
        resultPosts = postRows.map((r) => this.mapPostRow(r));
        const lastPost = resultPosts[resultPosts.length - 1];
        nextCursor = encodeFeedCursor(lastPost.createdAt, lastPost.id, {
          pinnedAt: lastPost.pinnedAt,
          type: 'pinned',
        });
      } else {
        const pinnedPostItems = pinnedRows.map((r) => this.mapPostRow(r));
        const remainingLimit = limit - pinnedPostItems.length;

        if (remainingLimit > 0) {
          const unpinnedRows = await dbAdapter.query<any>(
            `${baseSelectSql}
             WHERE p.pinned_at IS NULL
             ORDER BY p.created_at DESC, p.id DESC
             LIMIT $2`,
            [userId, remainingLimit + 1]
          );

          if (unpinnedRows.length > remainingLimit) {
            hasMore = true;
            const unpinnedSlice = unpinnedRows.slice(0, remainingLimit);
            const unpinnedItems = unpinnedSlice.map((r) => this.mapPostRow(r));
            resultPosts = [...pinnedPostItems, ...unpinnedItems];
            const lastPost = unpinnedItems[unpinnedItems.length - 1];
            nextCursor = encodeFeedCursor(lastPost.createdAt, lastPost.id, {
              type: 'unpinned',
            });
          } else {
            hasMore = false;
            const unpinnedItems = unpinnedRows.map((r) => this.mapPostRow(r));
            resultPosts = [...pinnedPostItems, ...unpinnedItems];
            nextCursor = null;
          }
        } else {
          resultPosts = pinnedPostItems;
          const unpinnedCheck = await dbAdapter.queryOne<any>(
            `SELECT p.id FROM feed_posts p WHERE p.pinned_at IS NULL LIMIT 1`,
            []
          );
          hasMore = Boolean(unpinnedCheck);
          if (hasMore) {
            const lastPost = pinnedPostItems[pinnedPostItems.length - 1];
            nextCursor = encodeFeedCursor(lastPost.createdAt, lastPost.id, {
              pinnedAt: lastPost.pinnedAt,
              type: 'pinned',
            });
          } else {
            nextCursor = null;
          }
        }
      }
    } else {
      // Paginating through regular unpinned posts
      const unpinnedRows = await dbAdapter.query<any>(
        `${baseSelectSql}
         WHERE p.pinned_at IS NULL
           AND (p.created_at < $2 OR (p.created_at = $2 AND p.id < $3))
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT $4`,
        [userId, cursor.createdAt, cursor.id, limit + 1]
      );

      hasMore = unpinnedRows.length > limit;
      const postRows = hasMore ? unpinnedRows.slice(0, limit) : unpinnedRows;
      resultPosts = postRows.map((r) => this.mapPostRow(r));

      if (hasMore && postRows.length > 0) {
        const lastPost = resultPosts[resultPosts.length - 1];
        nextCursor = encodeFeedCursor(lastPost.createdAt, lastPost.id, {
          type: 'unpinned',
        });
      } else {
        nextCursor = null;
      }
    }

    return {
      posts: resultPosts,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Get a single post by ID with enriched details and current user reaction.
   */
  public async getPostById(postId: string, userId?: string): Promise<FeedPostItem | null> {
    if (!postId) return null;

    const currentUserId = userId || '';
    const sql = `
      SELECT 
        p.id,
        p.author_id,
        p.content,
        p.is_announcement,
        p.priority,
        p.pinned_at,
        p.created_at,
        p.updated_at,
        u.first_name,
        u.last_name,
        u.email,
        u.department,
        u.role as author_role,
        u.status as author_status,
        (SELECT COUNT(*) FROM feed_comments c WHERE c.post_id = p.id) as comments_count,
        (SELECT COUNT(*) FROM feed_reactions r WHERE r.post_id = p.id) as reactions_count,
        (SELECT COUNT(*) FROM feed_reactions r WHERE r.post_id = p.id AND r.reaction_type = 'LIKE') as like_count,
        (SELECT COUNT(*) FROM feed_reactions r WHERE r.post_id = p.id AND r.reaction_type = 'CELEBRATE') as celebrate_count,
        (SELECT COUNT(*) FROM feed_reactions r WHERE r.post_id = p.id AND r.reaction_type = 'SUPPORT') as support_count,
        (SELECT COUNT(*) FROM feed_reactions r WHERE r.post_id = p.id AND r.reaction_type = 'INSIGHTFUL') as insightful_count,
        (SELECT reaction_type FROM feed_reactions ur WHERE ur.post_id = p.id AND ur.user_id = $1) as current_user_reaction
      FROM feed_posts p
      JOIN users u ON p.author_id = u.id
      WHERE p.id = $2
    `;

    const row = await dbAdapter.queryOne<any>(sql, [currentUserId, postId]);
    if (!row) return null;

    return this.mapPostRow(row);
  }

  /**
   * Create a post. Validates author active status and trimmed content length (1-3,000 chars).
   * Supports official announcements with priority and pinning for ADMIN and SUPER_ADMIN.
   */
  public async createPost(
    authorId: string,
    content: string,
    options?: CreatePostOptions
  ): Promise<FeedPostItem> {
    const author = await this.getVerifiedActiveUser(authorId);

    if (typeof content !== 'string') {
      throw new Error('Post content must be a string.');
    }

    const trimmed = content.trim();
    if (trimmed.length < 1) {
      throw new Error('Post content cannot be empty.');
    }

    if (trimmed.length > 3000) {
      throw new Error('Post content cannot exceed 3,000 characters.');
    }

    const isAnnouncement = Boolean(options?.isAnnouncement);
    let priority: AnnouncementPriority = 'NORMAL';
    if (options?.priority !== undefined) {
      if (!['NORMAL', 'IMPORTANT', 'URGENT'].includes(options.priority)) {
        throw new Error("Invalid priority. Must be one of: 'NORMAL', 'IMPORTANT', 'URGENT'.");
      }
      priority = options.priority;
    }

    const isPinned = Boolean(options?.isPinned);

    // If privileged announcement capabilities are requested, verify author has admin rights
    if (isAnnouncement || priority !== 'NORMAL' || isPinned) {
      if (author.role !== UserRole.ADMIN && author.role !== UserRole.SUPER_ADMIN) {
        throw new Error(
          'Forbidden: Only administrators can publish announcements, set elevated priority, or pin posts.'
        );
      }
    }

    // Only official announcements can be pinned
    if (isPinned && !isAnnouncement) {
      throw new Error('Only official announcements can be pinned.');
    }

    // Elevated priority only for announcements
    if (priority !== 'NORMAL' && !isAnnouncement) {
      throw new Error('Elevated priority is only permitted for official announcements.');
    }

    const id = generateId();
    const now = new Date().toISOString();
    const pinnedAt = isPinned ? now : null;

    const isAnnouncementDbVal = dbAdapter.isPostgres() ? isAnnouncement : (isAnnouncement ? 1 : 0);

    await dbAdapter.execute(
      `INSERT INTO feed_posts (
        id, author_id, content, is_announcement, priority, pinned_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, author.id, trimmed, isAnnouncementDbVal, priority, pinnedAt, now, now]
    );

    const post: FeedPostItem = {
      id,
      content: trimmed,
      isAnnouncement,
      priority,
      pinnedAt,
      createdAt: now,
      updatedAt: now,
      author: {
        id: author.id,
        email: author.email,
        firstName: author.firstName,
        lastName: author.lastName,
        department: author.department || null,
        role: author.role,
        status: author.status,
      },
      stats: {
        commentsCount: 0,
        reactionsCount: 0,
        reactions: {
          LIKE: 0,
          CELEBRATE: 0,
          SUPPORT: 0,
          INSIGHTFUL: 0,
        },
      },
      currentUserReaction: null,
    };

    if (isAnnouncement && (priority === 'IMPORTANT' || priority === 'URGENT')) {
      try {
        await this.dispatchAnnouncementNotifications(post);
      } catch (notifErr: any) {
        console.error(
          `[FeedService] Failed to dispatch announcement notifications for post ${post.id}:`,
          notifErr?.message || notifErr
        );
      }
    }

    return post;
  }

  /**
   * Set or remove pinned status for an official announcement.
   * Only ADMIN and SUPER_ADMIN may pin or unpin posts.
   * Only official announcements can be pinned.
   */
  public async setPostPinned(
    postId: string,
    isPinned: boolean,
    actor: FeedActor
  ): Promise<FeedPostItem> {
    if (!actor || !actor.id) {
      throw new Error('Authenticated actor is required.');
    }

    if (actor.status !== UserStatus.ACTIVE && actor.status !== 'ACTIVE') {
      throw new Error('Only active users can perform this action.');
    }

    if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
      throw new Error('Forbidden: Only administrators can pin or unpin posts.');
    }

    const post = await dbAdapter.queryOne<any>(
      `SELECT id, is_announcement, pinned_at FROM feed_posts WHERE id = $1`,
      [postId]
    );

    if (!post) {
      throw new Error('Post not found.');
    }

    if (isPinned && !Boolean(post.is_announcement)) {
      throw new Error('Only official announcements can be pinned.');
    }

    const now = new Date().toISOString();
    const pinnedAt = isPinned ? (post.pinned_at ? formatTimestamp(post.pinned_at) : now) : null;

    await dbAdapter.execute(
      `UPDATE feed_posts SET pinned_at = $1, updated_at = $2 WHERE id = $3`,
      [pinnedAt, now, postId]
    );

    const updated = await this.getPostById(postId, actor.id);
    if (!updated) {
      throw new Error('Failed to retrieve updated post.');
    }

    return updated;
  }

  /**
   * Delete a post. Only the post author, ADMIN, or SUPER_ADMIN may delete.
   * Actor must be ACTIVE.
   */
  public async deletePost(
    postId: string,
    actor: FeedActor
  ): Promise<{ success: boolean; deletedPostId: string }> {
    if (!actor || !actor.id) {
      throw new Error('Authenticated actor is required.');
    }

    if (actor.status !== UserStatus.ACTIVE && actor.status !== 'ACTIVE') {
      throw new Error('Only active users can perform this action.');
    }

    const post = await dbAdapter.queryOne<any>(
      `SELECT id, author_id FROM feed_posts WHERE id = $1`,
      [postId]
    );

    if (!post) {
      throw new Error('Post not found.');
    }

    const isAuthor = post.author_id === actor.id;
    const isAdmin = actor.role === UserRole.ADMIN || actor.role === UserRole.SUPER_ADMIN;

    if (!isAuthor && !isAdmin) {
      throw new Error('Forbidden: You do not have permission to delete this post.');
    }

    await dbAdapter.execute(`DELETE FROM feed_posts WHERE id = $1`, [postId]);

    return {
      success: true,
      deletedPostId: postId,
    };
  }

  /**
   * List comments for a post in chronological order (oldest first).
   */
  public async listComments(
    postId: string,
    options: ListCommentsOptions = {}
  ): Promise<FeedCommentItem[]> {
    if (!postId) {
      throw new Error('postId is required to list comments.');
    }

    const post = await dbAdapter.queryOne<any>(`SELECT id FROM feed_posts WHERE id = $1`, [postId]);
    if (!post) {
      throw new Error('Post not found.');
    }

    const limit = Math.min(Math.max(1, Number(options.limit) || 50), 100);
    const offset = Math.max(0, Number(options.offset) || 0);

    const sql = `
      SELECT 
        c.id,
        c.post_id,
        c.author_id,
        c.content,
        c.created_at,
        c.updated_at,
        u.first_name,
        u.last_name,
        u.email,
        u.department,
        u.role as author_role,
        u.status as author_status
      FROM feed_comments c
      JOIN users u ON c.author_id = u.id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT $2 OFFSET $3
    `;

    const rows = await dbAdapter.query<any>(sql, [postId, limit, offset]);

    return rows.map((row) => ({
      id: row.id,
      postId: row.post_id,
      content: row.content,
      createdAt: formatTimestamp(row.created_at),
      updatedAt: formatTimestamp(row.updated_at),
      author: {
        id: row.author_id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        department: row.department || null,
        role: row.author_role as UserRole,
        status: row.author_status as UserStatus,
      },
    }));
  }

  /**
   * Create a comment on a post. Validates author active status and trimmed content length (1-1,000 chars).
   */
  public async createComment(
    postId: string,
    authorId: string,
    content: string
  ): Promise<FeedCommentItem> {
    const author = await this.getVerifiedActiveUser(authorId);

    const post = await dbAdapter.queryOne<any>(`SELECT id FROM feed_posts WHERE id = $1`, [postId]);
    if (!post) {
      throw new Error('Post not found.');
    }

    if (typeof content !== 'string') {
      throw new Error('Comment content must be a string.');
    }

    const trimmed = content.trim();
    if (trimmed.length < 1) {
      throw new Error('Comment content cannot be empty.');
    }

    if (trimmed.length > 1000) {
      throw new Error('Comment content cannot exceed 1,000 characters.');
    }

    const id = generateId();
    const now = new Date().toISOString();

    await dbAdapter.execute(
      `INSERT INTO feed_comments (id, post_id, author_id, content, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, postId, author.id, trimmed, now, now]
    );

    return {
      id,
      postId,
      content: trimmed,
      createdAt: now,
      updatedAt: now,
      author: {
        id: author.id,
        email: author.email,
        firstName: author.firstName,
        lastName: author.lastName,
        department: author.department || null,
        role: author.role,
        status: author.status,
      },
    };
  }

  /**
   * Delete a comment. Only the comment author, ADMIN, or SUPER_ADMIN may delete.
   * Actor must be ACTIVE.
   */
  public async deleteComment(
    commentId: string,
    actor: FeedActor
  ): Promise<{ success: boolean; deletedCommentId: string }> {
    if (!actor || !actor.id) {
      throw new Error('Authenticated actor is required.');
    }

    if (actor.status !== UserStatus.ACTIVE && actor.status !== 'ACTIVE') {
      throw new Error('Only active users can perform this action.');
    }

    const comment = await dbAdapter.queryOne<any>(
      `SELECT id, post_id, author_id FROM feed_comments WHERE id = $1`,
      [commentId]
    );

    if (!comment) {
      throw new Error('Comment not found.');
    }

    const isAuthor = comment.author_id === actor.id;
    const isAdmin = actor.role === UserRole.ADMIN || actor.role === UserRole.SUPER_ADMIN;

    if (!isAuthor && !isAdmin) {
      throw new Error('Forbidden: You do not have permission to delete this comment.');
    }

    await dbAdapter.execute(`DELETE FROM feed_comments WHERE id = $1`, [commentId]);

    return {
      success: true,
      deletedCommentId: commentId,
    };
  }

  /**
   * Toggle a reaction on a post:
   * - Insert when absent
   * - Remove when same type selected again
   * - Update to new type when different type selected
   */
  public async toggleReaction(
    postId: string,
    userId: string,
    reactionType: FeedReactionType
  ): Promise<ToggleReactionResult> {
    if (!ALLOWED_REACTIONS.includes(reactionType)) {
      throw new Error(
        `Invalid reaction type. Must be one of: ${ALLOWED_REACTIONS.join(', ')}`
      );
    }

    await this.getVerifiedActiveUser(userId);

    const post = await dbAdapter.queryOne<any>(`SELECT id FROM feed_posts WHERE id = $1`, [postId]);
    if (!post) {
      throw new Error('Post not found.');
    }

    const existing = await dbAdapter.queryOne<any>(
      `SELECT id, reaction_type FROM feed_reactions WHERE post_id = $1 AND user_id = $2`,
      [postId, userId]
    );

    let action: 'ADDED' | 'REMOVED' | 'UPDATED';
    let finalReactionType: FeedReactionType | null = null;

    if (!existing) {
      const id = generateId();
      const now = new Date().toISOString();
      await dbAdapter.execute(
        `INSERT INTO feed_reactions (id, post_id, user_id, reaction_type, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, postId, userId, reactionType, now]
      );
      action = 'ADDED';
      finalReactionType = reactionType;
    } else if (existing.reaction_type === reactionType) {
      await dbAdapter.execute(`DELETE FROM feed_reactions WHERE id = $1`, [existing.id]);
      action = 'REMOVED';
      finalReactionType = null;
    } else {
      await dbAdapter.execute(
        `UPDATE feed_reactions SET reaction_type = $1 WHERE id = $2`,
        [reactionType, existing.id]
      );
      action = 'UPDATED';
      finalReactionType = reactionType;
    }

    // Retrieve fresh aggregated reaction stats for this post
    const statsRow = await dbAdapter.queryOne<any>(
      `SELECT 
        (SELECT COUNT(*) FROM feed_reactions WHERE post_id = $1) as total_count,
        (SELECT COUNT(*) FROM feed_reactions WHERE post_id = $1 AND reaction_type = 'LIKE') as like_count,
        (SELECT COUNT(*) FROM feed_reactions WHERE post_id = $1 AND reaction_type = 'CELEBRATE') as celebrate_count,
        (SELECT COUNT(*) FROM feed_reactions WHERE post_id = $1 AND reaction_type = 'SUPPORT') as support_count,
        (SELECT COUNT(*) FROM feed_reactions WHERE post_id = $1 AND reaction_type = 'INSIGHTFUL') as insightful_count
      `,
      [postId]
    );

    return {
      action,
      reactionType: finalReactionType,
      reactions: {
        LIKE: Number(statsRow?.like_count || 0),
        CELEBRATE: Number(statsRow?.celebrate_count || 0),
        SUPPORT: Number(statsRow?.support_count || 0),
        INSIGHTFUL: Number(statsRow?.insightful_count || 0),
      },
      totalReactions: Number(statsRow?.total_count || 0),
    };
  }
}

export const feedService = new FeedService();
