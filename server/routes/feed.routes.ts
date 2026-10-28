import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.ts';
import { feedService, decodeFeedCursor } from '../services/feed.service.ts';
import { sendSuccess, sendError, ApiErrorCode } from '../utils/apiResponse.ts';
import {
  FeedReactionType,
  UserStatus,
  UserRole,
  AnnouncementPriority,
} from '../../src/types/index.ts';

const router = Router();

// Protect all feed endpoints with authentication middleware
router.use(requireAuth);

const ALLOWED_REACTIONS: readonly string[] = [
  'LIKE',
  'CELEBRATE',
  'SUPPORT',
  'INSIGHTFUL',
];

/**
 * GET /api/feed/posts
 * Retrieve paginated posts with author profiles, aggregated reaction counts,
 * comments count, and the authenticated user's current reaction.
 * Query params: limit (1-50, default 20), cursor (deterministic keyset cursor).
 */
router.get('/posts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    let limit = 20;

    if (req.query.limit !== undefined) {
      const parsedLimit = Number(req.query.limit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        return sendError(
          res,
          400,
          ApiErrorCode.VALIDATION_ERROR,
          'Limit must be an integer between 1 and 50.'
        );
      }
      limit = parsedLimit;
    }

    let cursor: string | undefined = undefined;
    if (req.query.cursor !== undefined) {
      const rawCursor = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : '';
      if (rawCursor) {
        const decoded = decodeFeedCursor(rawCursor);
        if (!decoded) {
          return sendError(
            res,
            400,
            ApiErrorCode.VALIDATION_ERROR,
            'Invalid pagination cursor.'
          );
        }
        cursor = rawCursor;
      }
    }

    const result = await feedService.listPosts(userId, { limit, cursor });
    return sendSuccess(res, result);
  } catch (error: any) {
    console.error('[FeedRoutes] listPosts error:', error?.message || error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve feed posts.');
  }
});

/**
 * POST /api/feed/posts
 * Publish a new post or official announcement. Content is validated as plain text (1-3,000 chars).
 * Identity is derived strictly from req.user.id (anti-spoofing).
 * Only ADMIN and SUPER_ADMIN can create official announcements, set elevated priority, or pin posts.
 */
router.post('/posts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.status !== UserStatus.ACTIVE && user.status !== 'ACTIVE') {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, 'Only active users can create posts.');
    }

    const { content, isAnnouncement, priority, isPinned } = req.body || {};
    if (typeof content !== 'string') {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Post content must be a string.');
    }

    const trimmed = content.trim();
    if (trimmed.length < 1) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Post content cannot be empty.');
    }

    if (trimmed.length > 3000) {
      return sendError(
        res,
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'Post content cannot exceed 3,000 characters.'
      );
    }

    if (isAnnouncement !== undefined && typeof isAnnouncement !== 'boolean') {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'isAnnouncement must be a boolean.');
    }

    if (isPinned !== undefined && typeof isPinned !== 'boolean') {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'isPinned must be a boolean.');
    }

    if (priority !== undefined) {
      if (typeof priority !== 'string' || !['NORMAL', 'IMPORTANT', 'URGENT'].includes(priority)) {
        return sendError(
          res,
          400,
          ApiErrorCode.VALIDATION_ERROR,
          "Invalid priority. Must be one of: 'NORMAL', 'IMPORTANT', 'URGENT'."
        );
      }
    }

    const wantsAnnouncement = Boolean(isAnnouncement);
    const wantsElevatedPriority = priority !== undefined && priority !== 'NORMAL';
    const wantsPin = Boolean(isPinned);

    // Enforce role authorization: STAFF cannot create announcements, set elevated priority, or pin
    if (wantsAnnouncement || wantsElevatedPriority || wantsPin) {
      if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
        return sendError(
          res,
          403,
          ApiErrorCode.FORBIDDEN,
          'Only administrators can create announcements, set elevated priority, or pin posts.'
        );
      }
    }

    if (wantsPin && !wantsAnnouncement) {
      return sendError(
        res,
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'Only official announcements can be pinned.'
      );
    }

    if (wantsElevatedPriority && !wantsAnnouncement) {
      return sendError(
        res,
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'Elevated priority is only permitted for official announcements.'
      );
    }

    const post = await feedService.createPost(user.id, trimmed, {
      isAnnouncement: wantsAnnouncement,
      priority: priority as AnnouncementPriority,
      isPinned: wantsPin,
    });
    return sendSuccess(res, { post }, 201);
  } catch (error: any) {
    console.error('[FeedRoutes] createPost error:', error?.message || error);
    if (error?.message?.includes('Forbidden') || error?.message?.includes('Only administrators')) {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, error.message);
    }
    if (error?.message?.includes('active users')) {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, error.message);
    }
    if (
      error?.message?.includes('content') ||
      error?.message?.includes('empty') ||
      error?.message?.includes('priority') ||
      error?.message?.includes('Only official announcements') ||
      error?.message?.includes('Elevated priority')
    ) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, error.message);
    }
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to create feed post.');
  }
});

/**
 * PATCH /api/feed/posts/:id/pin
 * Pin or unpin an official announcement.
 * Restricted strictly to ADMIN and SUPER_ADMIN.
 * Body: { isPinned: boolean }
 */
router.patch('/posts/:id/pin', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.status !== UserStatus.ACTIVE && user.status !== 'ACTIVE') {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, 'Only active users can pin or unpin posts.');
    }

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      return sendError(
        res,
        403,
        ApiErrorCode.FORBIDDEN,
        'Only administrators can pin or unpin posts.'
      );
    }

    const postId = req.params.id;
    if (!postId || typeof postId !== 'string' || postId.trim().length === 0) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Post ID is required.');
    }

    const { isPinned } = req.body || {};
    if (typeof isPinned !== 'boolean') {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'isPinned must be a boolean.');
    }

    const post = await feedService.setPostPinned(postId.trim(), isPinned, {
      id: user.id,
      role: user.role,
      status: user.status,
    });

    return sendSuccess(res, { post });
  } catch (error: any) {
    console.error('[FeedRoutes] setPostPinned error:', error?.message || error);
    if (error?.message === 'Post not found.') {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Post not found.');
    }
    if (error?.message?.includes('Forbidden') || error?.message?.includes('administrators')) {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, error.message);
    }
    if (error?.message?.includes('Only official announcements')) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, error.message);
    }
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to update post pin status.');
  }
});

/**
 * PATCH /api/feed/posts/:id
 * General post update endpoint (supporting { isPinned: boolean }).
 */
router.patch('/posts/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.status !== UserStatus.ACTIVE && user.status !== 'ACTIVE') {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, 'Only active users can update posts.');
    }

    const postId = req.params.id;
    if (!postId || typeof postId !== 'string' || postId.trim().length === 0) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Post ID is required.');
    }

    const { isPinned } = req.body || {};
    if (isPinned !== undefined) {
      if (typeof isPinned !== 'boolean') {
        return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'isPinned must be a boolean.');
      }

      if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
        return sendError(
          res,
          403,
          ApiErrorCode.FORBIDDEN,
          'Only administrators can pin or unpin posts.'
        );
      }

      const post = await feedService.setPostPinned(postId.trim(), isPinned, {
        id: user.id,
        role: user.role,
        status: user.status,
      });

      return sendSuccess(res, { post });
    }

    return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'No valid update fields provided.');
  } catch (error: any) {
    console.error('[FeedRoutes] updatePost error:', error?.message || error);
    if (error?.message === 'Post not found.') {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Post not found.');
    }
    if (error?.message?.includes('Forbidden') || error?.message?.includes('administrators')) {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, error.message);
    }
    if (error?.message?.includes('Only official announcements')) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, error.message);
    }
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to update post.');
  }
});

/**
 * DELETE /api/feed/posts/:id
 * Delete a post according to RBAC policy: Post Author, ADMIN, or SUPER_ADMIN.
 */
router.delete('/posts/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.status !== UserStatus.ACTIVE && user.status !== 'ACTIVE') {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, 'Only active users can delete posts.');
    }

    const postId = req.params.id;
    if (!postId || typeof postId !== 'string' || postId.trim().length === 0) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Post ID is required.');
    }

    const result = await feedService.deletePost(postId.trim(), {
      id: user.id,
      role: user.role,
      status: user.status,
    });

    return sendSuccess(res, result);
  } catch (error: any) {
    console.error('[FeedRoutes] deletePost error:', error?.message || error);
    if (error?.message === 'Post not found.') {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Post not found.');
    }
    if (error?.message?.includes('Forbidden') || error?.message?.includes('permission')) {
      return sendError(
        res,
        403,
        ApiErrorCode.FORBIDDEN,
        'You do not have permission to delete this post.'
      );
    }
    if (error?.message?.includes('active users')) {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, error.message);
    }
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to delete feed post.');
  }
});

/**
 * GET /api/feed/posts/:postId/comments
 * List comments for a post in chronological order (oldest to newest).
 * Query params: limit (1-100, default 50), offset (non-negative integer, default 0).
 */
router.get('/posts/:postId/comments', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const postId = req.params.postId;
    if (!postId || typeof postId !== 'string' || postId.trim().length === 0) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Post ID is required.');
    }

    let limit = 50;
    let offset = 0;

    if (req.query.limit !== undefined) {
      const parsedLimit = Number(req.query.limit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        return sendError(
          res,
          400,
          ApiErrorCode.VALIDATION_ERROR,
          'Limit must be an integer between 1 and 100.'
        );
      }
      limit = parsedLimit;
    }

    if (req.query.offset !== undefined) {
      const parsedOffset = Number(req.query.offset);
      if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
        return sendError(
          res,
          400,
          ApiErrorCode.VALIDATION_ERROR,
          'Offset must be a non-negative integer.'
        );
      }
      offset = parsedOffset;
    }

    const comments = await feedService.listComments(postId.trim(), { limit, offset });
    return sendSuccess(res, { comments });
  } catch (error: any) {
    console.error('[FeedRoutes] listComments error:', error?.message || error);
    if (error?.message === 'Post not found.') {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Post not found.');
    }
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve comments.');
  }
});

/**
 * POST /api/feed/posts/:postId/comments
 * Add a comment to a post. Plain-text content between 1 and 1,000 characters.
 * Identity is derived strictly from req.user.id.
 */
router.post('/posts/:postId/comments', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.status !== UserStatus.ACTIVE && user.status !== 'ACTIVE') {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, 'Only active users can create comments.');
    }

    const postId = req.params.postId;
    if (!postId || typeof postId !== 'string' || postId.trim().length === 0) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Post ID is required.');
    }

    const { content } = req.body || {};
    if (typeof content !== 'string') {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Comment content must be a string.');
    }

    const trimmed = content.trim();
    if (trimmed.length < 1) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Comment content cannot be empty.');
    }

    if (trimmed.length > 1000) {
      return sendError(
        res,
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'Comment content cannot exceed 1,000 characters.'
      );
    }

    const comment = await feedService.createComment(postId.trim(), user.id, trimmed);
    return sendSuccess(res, { comment }, 201);
  } catch (error: any) {
    console.error('[FeedRoutes] createComment error:', error?.message || error);
    if (error?.message === 'Post not found.') {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Post not found.');
    }
    if (error?.message?.includes('active users')) {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, error.message);
    }
    if (error?.message?.includes('content') || error?.message?.includes('empty')) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, error.message);
    }
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to create comment.');
  }
});

/**
 * DELETE /api/feed/comments/:id
 * Delete a comment according to RBAC policy: Comment Author, ADMIN, or SUPER_ADMIN.
 */
router.delete('/comments/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.status !== UserStatus.ACTIVE && user.status !== 'ACTIVE') {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, 'Only active users can delete comments.');
    }

    const commentId = req.params.id;
    if (!commentId || typeof commentId !== 'string' || commentId.trim().length === 0) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Comment ID is required.');
    }

    const result = await feedService.deleteComment(commentId.trim(), {
      id: user.id,
      role: user.role,
      status: user.status,
    });

    return sendSuccess(res, result);
  } catch (error: any) {
    console.error('[FeedRoutes] deleteComment error:', error?.message || error);
    if (error?.message === 'Comment not found.') {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Comment not found.');
    }
    if (error?.message?.includes('Forbidden') || error?.message?.includes('permission')) {
      return sendError(
        res,
        403,
        ApiErrorCode.FORBIDDEN,
        'You do not have permission to delete this comment.'
      );
    }
    if (error?.message?.includes('active users')) {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, error.message);
    }
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to delete comment.');
  }
});

/**
 * POST /api/feed/posts/:postId/reactions
 * Toggle a reaction on a post.
 * Body: { reactionType: 'LIKE' | 'CELEBRATE' | 'SUPPORT' | 'INSIGHTFUL' }
 */
router.post('/posts/:postId/reactions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.status !== UserStatus.ACTIVE && user.status !== 'ACTIVE') {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, 'Only active users can react to posts.');
    }

    const postId = req.params.postId;
    if (!postId || typeof postId !== 'string' || postId.trim().length === 0) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Post ID is required.');
    }

    const { reactionType } = req.body || {};
    if (
      !reactionType ||
      typeof reactionType !== 'string' ||
      !ALLOWED_REACTIONS.includes(reactionType)
    ) {
      return sendError(
        res,
        400,
        ApiErrorCode.VALIDATION_ERROR,
        `Invalid reaction type. Must be one of: ${ALLOWED_REACTIONS.join(', ')}.`
      );
    }

    const result = await feedService.toggleReaction(
      postId.trim(),
      user.id,
      reactionType as FeedReactionType
    );

    return sendSuccess(res, result);
  } catch (error: any) {
    console.error('[FeedRoutes] toggleReaction error:', error?.message || error);
    if (error?.message === 'Post not found.') {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Post not found.');
    }
    if (error?.message?.includes('active users')) {
      return sendError(res, 403, ApiErrorCode.FORBIDDEN, error.message);
    }
    if (error?.message?.includes('Invalid reaction type')) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, error.message);
    }
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to toggle reaction.');
  }
});

export default router;
