import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.ts';
import { messageService } from '../services/message.service.ts';
import { sendSuccess, sendError, ApiErrorCode } from '../utils/apiResponse.ts';

const router = Router();

// Protect all messaging endpoints with authentication middleware
router.use(requireAuth);

/**
 * GET /api/messages/contacts
 * Search and list eligible active colleagues available to start a conversation.
 * Always excludes the caller.
 */
router.get('/contacts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const contacts = await messageService.listContacts(userId, search);
    return sendSuccess(res, { contacts });
  } catch (error: any) {
    console.error('[MessageRoutes] listContacts error:', error?.message || error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve eligible contacts.');
  }
});

/**
 * GET /api/messages/unread-count
 * Returns the authenticated user's total unread message count.
 * Declared before /:id routes to avoid route collision.
 */
router.get('/unread-count', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const unreadCount = await messageService.getUnreadCount(userId);
    return sendSuccess(res, { unreadCount });
  } catch (error: any) {
    console.error('[MessageRoutes] getUnreadCount error:', error?.message || error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve unread message count.');
  }
});

/**
 * GET /api/messages/conversations
 * List conversations belonging to the authenticated user, ordered newest first.
 */
router.get('/conversations', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));

    const result = await messageService.listConversations(userId, { page, limit });
    return sendSuccess(res, result);
  } catch (error: any) {
    console.error('[MessageRoutes] listConversations error:', error?.message || error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve conversations.');
  }
});

/**
 * POST /api/messages/conversations
 * Create or retrieve a direct 1-to-1 conversation with an eligible colleague.
 * Body: { recipientId: string }
 */
router.post('/conversations', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { recipientId } = req.body || {};

    if (!recipientId || typeof recipientId !== 'string' || recipientId.trim().length === 0) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Recipient user ID is required.');
    }

    if (recipientId.trim() === userId) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Self-conversations are not permitted.');
    }

    const result = await messageService.getOrCreateConversation(userId, recipientId.trim());
    return sendSuccess(res, { conversation: result.conversation }, result.isNew ? 201 : 200);
  } catch (error: any) {
    console.error('[MessageRoutes] getOrCreateConversation error:', error?.message || error);
    const isValidationError =
      error?.message?.includes('Self-conversations') ||
      error?.message?.includes('does not exist') ||
      error?.message?.includes('inactive or suspended');

    if (isValidationError) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, error.message);
    }

    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to create or retrieve conversation.');
  }
});

/**
 * GET /api/messages/conversations/:id/messages
 * Retrieve paginated message history for a conversation.
 * Returns 404 NOT_FOUND if conversation does not exist or caller is not a participant.
 */
router.get('/conversations/:id/messages', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id: conversationId } = req.params;

    if (!conversationId || typeof conversationId !== 'string') {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Invalid conversation ID.');
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 30));

    const result = await messageService.listMessages(userId, conversationId, { page, limit });

    if (!result) {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Conversation not found.');
    }

    return sendSuccess(res, result);
  } catch (error: any) {
    console.error('[MessageRoutes] listMessages error:', error?.message || error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve message history.');
  }
});

/**
 * POST /api/messages/conversations/:id/messages
 * Send a new direct message within a conversation.
 * Body: { content: string }
 * Derives sender exclusively from authenticated caller.
 */
router.post('/conversations/:id/messages', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id: conversationId } = req.params;
    const { content } = req.body || {};

    if (!conversationId || typeof conversationId !== 'string') {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Invalid conversation ID.');
    }

    if (typeof content !== 'string' || content.trim().length === 0) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Message content cannot be empty.');
    }

    if (content.length > 2000) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Message exceeds maximum limit of 2000 characters.');
    }

    const message = await messageService.sendMessage(userId, conversationId, content);

    if (!message) {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Conversation not found.');
    }

    return sendSuccess(res, { message }, 201);
  } catch (error: any) {
    console.error('[MessageRoutes] sendMessage error:', error?.message || error);
    const isValidationError =
      error?.message?.includes('cannot be empty') ||
      error?.message?.includes('exceeds maximum') ||
      error?.message?.includes('inactive or suspended');

    if (isValidationError) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, error.message);
    }

    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to deliver message.');
  }
});

/**
 * PATCH /api/messages/conversations/:id/read
 * Mark incoming unread messages in conversation :id as read for the authenticated recipient.
 * Returns 404 NOT_FOUND if conversation does not exist or caller is not a participant.
 */
router.patch('/conversations/:id/read', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id: conversationId } = req.params;

    if (!conversationId || typeof conversationId !== 'string') {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Invalid conversation ID.');
    }

    const result = await messageService.markConversationAsRead(userId, conversationId);

    if (!result) {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Conversation not found.');
    }

    return sendSuccess(res, result);
  } catch (error: any) {
    console.error('[MessageRoutes] markConversationAsRead error:', error?.message || error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to update read status.');
  }
});

export default router;
