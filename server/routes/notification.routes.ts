import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.ts';
import { notificationService } from '../services/notification.service.ts';
import { sendSuccess, sendError, ApiErrorCode } from '../utils/apiResponse.ts';

const router = Router();

// Protect all notification endpoints with existing authentication middleware
router.use(requireAuth);

/**
 * GET /api/notifications
 * Returns the authenticated user's notifications, newest first, with bounded pagination.
 * User ID is strictly derived from req.user!.id.
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const unreadOnly = req.query.unreadOnly === 'true';

    const result = await notificationService.listNotifications(userId, {
      page,
      limit,
      unreadOnly,
    });

    return sendSuccess(res, result);
  } catch (error) {
    console.error('[NotificationRoutes] listNotifications error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve notifications.');
  }
});

/**
 * GET /api/notifications/unread-count
 * Returns the unread notification count for the authenticated user.
 * Placed before any parameterized routes to prevent route collision.
 */
router.get('/unread-count', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const unreadCount = await notificationService.getUnreadCount(userId);

    return sendSuccess(res, { unreadCount });
  } catch (error) {
    console.error('[NotificationRoutes] getUnreadCount error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve unread notification count.');
  }
});

/**
 * PATCH /api/notifications/mark-all-read
 * Marks all notifications for the authenticated user as read.
 * Placed before /:id/read to prevent route collision.
 */
router.patch('/mark-all-read', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const result = await notificationService.markAllAsRead(userId);

    return sendSuccess(res, result);
  } catch (error) {
    console.error('[NotificationRoutes] markAllAsRead error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to mark all notifications as read.');
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Marks a single notification as read if owned by the authenticated user.
 * Returns 404 NOT_FOUND if the notification does not exist OR belongs to another user
 * (defending against ID enumeration / authorization probing).
 */
router.patch('/:id/read', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Invalid notification ID.');
    }

    const notification = await notificationService.markAsRead(userId, id.trim());

    if (!notification) {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Notification not found.');
    }

    return sendSuccess(res, { notification });
  } catch (error) {
    console.error('[NotificationRoutes] markAsRead error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to update notification status.');
  }
});

export default router;
