import { dbAdapter } from '../db/adapter.ts';
import { generateId } from '../utils/crypto.ts';
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
 * Base64url deterministic cursor encoder
 */
export function encodeFeedCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');
}

/**
 * Deterministic cursor decoder with backward-compatible delimiter fallback
 */
export function decodeFeedCursor(cursor: string): { createdAt: string; id: string } | null {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // Fallback delimiter parsing
    const parts = cursor.split('|');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { createdAt: parts[0], id: parts[1] };
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
   * List posts with author details, comment counts, reaction counts by type,
   * and the calling user's reaction. Uses deterministic keyset pagination (created_at DESC, id DESC).
   */
  public async listPosts(
    userId: string,
    options: ListPostsOptions = {}
  ): Promise<FeedPostListResponse> {
    if (!userId) {
      throw new Error('userId is required to list posts.');
    }

    const limit = Math.min(Math.max(1, Number(options.limit) || 20), 50);
    const fetchLimit = limit + 1; // Fetch 1 extra to detect next page

    let sql = `
      SELECT 
        p.id,
        p.author_id,
        p.content,
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

    const params: any[] = [userId];

    if (options.cursor) {
      const decoded = decodeFeedCursor(options.cursor);
      if (decoded) {
        sql += ` WHERE (p.created_at < $2 OR (p.created_at = $2 AND p.id < $3))`;
        params.push(decoded.createdAt, decoded.id);
      }
    }

    sql += ` ORDER BY p.created_at DESC, p.id DESC LIMIT $${params.length + 1}`;
    params.push(fetchLimit);

    const rows = await dbAdapter.query<any>(sql, params);

    const hasMore = rows.length > limit;
    const postRows = hasMore ? rows.slice(0, limit) : rows;

    const posts: FeedPostItem[] = postRows.map((row) => ({
      id: row.id,
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
    }));

    let nextCursor: string | null = null;
    if (hasMore && postRows.length > 0) {
      const lastPost = postRows[postRows.length - 1];
      nextCursor = encodeFeedCursor(formatTimestamp(lastPost.created_at), lastPost.id);
    }

    return {
      posts,
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

    return {
      id: row.id,
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
   * Create a post. Validates author active status and trimmed content length (1-3,000 chars).
   */
  public async createPost(authorId: string, content: string): Promise<FeedPostItem> {
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

    const id = generateId();
    const now = new Date().toISOString();

    await dbAdapter.execute(
      `INSERT INTO feed_posts (id, author_id, content, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, author.id, trimmed, now, now]
    );

    return {
      id,
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
