import { dbAdapter } from '../db/adapter.ts';
import { generateId } from '../utils/crypto.ts';
import {
  NotificationRecord,
  CreateNotificationInput,
  NotificationListResponse,
} from '../../src/types/index.ts';

interface RawNotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  metadata: string | null;
  is_read: boolean | number;
  read_at: string | null;
  created_at: string;
}

export class NotificationService {
  /**
   * Maps raw database row to application NotificationRecord
   */
  private mapRow(row: RawNotificationRow): NotificationRecord {
    let parsedMetadata: Record<string, any> | null = null;
    if (row.metadata) {
      try {
        parsedMetadata = JSON.parse(row.metadata);
      } catch {
        parsedMetadata = null;
      }
    }

    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      title: row.title,
      message: row.message,
      metadata: parsedMetadata,
      isRead: Boolean(row.is_read),
      readAt: row.read_at || null,
      createdAt: row.created_at,
    };
  }

  /**
   * Internal service method to create a persistent notification for a user.
   * Validates required fields, serializes metadata, and persists with default unread status.
   */
  public async createNotification(input: CreateNotificationInput): Promise<NotificationRecord> {
    const userId = input.userId?.trim();
    if (!userId) {
      throw new Error('Notification recipient userId is required.');
    }

    const type = input.type?.trim();
    if (!type) {
      throw new Error('Notification type is required.');
    }

    const title = input.title?.trim();
    if (!title || title.length === 0) {
      throw new Error('Notification title is required.');
    }
    if (title.length > 255) {
      throw new Error('Notification title cannot exceed 255 characters.');
    }

    const message = input.message?.trim();
    if (!message || message.length === 0) {
      throw new Error('Notification message is required.');
    }

    let serializedMetadata: string | null = null;
    if (input.metadata !== undefined && input.metadata !== null) {
      if (typeof input.metadata === 'object') {
        serializedMetadata = JSON.stringify(input.metadata);
      } else if (typeof input.metadata === 'string') {
        serializedMetadata = input.metadata;
      }
    }

    const id = generateId();
    const createdAt = new Date().toISOString();

    await dbAdapter.execute(
      `
      INSERT INTO notifications (
        id, user_id, type, title, message, metadata, is_read, read_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, FALSE, NULL, $7)
      `,
      [id, userId, type, title, message, serializedMetadata, createdAt]
    );

    return {
      id,
      userId,
      type,
      title,
      message,
      metadata: input.metadata || null,
      isRead: false,
      readAt: null,
      createdAt,
    };
  }

  /**
   * Lists the authenticated user's notifications, newest first, with bounded pagination.
   * Strictly enforces recipient ownership: user A can only ever access their own notifications.
   */
  public async listNotifications(
    userId: string,
    options?: { page?: number; limit?: number; unreadOnly?: boolean }
  ): Promise<NotificationListResponse> {
    if (!userId) {
      throw new Error('userId is required to list notifications.');
    }

    const page = Math.max(1, Math.floor(Number(options?.page) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(options?.limit) || 20)));
    const offset = (page - 1) * limit;
    const unreadOnly = Boolean(options?.unreadOnly);

    let whereClause = 'WHERE user_id = $1';
    if (unreadOnly) {
      whereClause += ' AND is_read = FALSE';
    }

    // Retrieve matching page of notifications
    const rows = await dbAdapter.query<RawNotificationRow>(
      `
      SELECT id, user_id, type, title, message, metadata, is_read, read_at, created_at
      FROM notifications
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );

    // Retrieve total matching count
    const totalRow = await dbAdapter.queryOne<{ total: string | number }>(
      `
      SELECT COUNT(*) as total
      FROM notifications
      ${whereClause}
      `,
      [userId]
    );
    const total = Number(totalRow?.total || 0);

    // Retrieve unread count for user (regardless of unreadOnly filter)
    const unreadCount = await this.getUnreadCount(userId);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    const hasMore = page < totalPages;

    return {
      notifications: rows.map((r) => this.mapRow(r)),
      total,
      unreadCount,
      page,
      limit,
      totalPages,
      hasMore,
    };
  }

  /**
   * Retrieves the unread notification count for a specific user.
   * Strictly filtered by user_id.
   */
  public async getUnreadCount(userId: string): Promise<number> {
    if (!userId) return 0;

    const row = await dbAdapter.queryOne<{ count: string | number }>(
      `
      SELECT COUNT(*) as count
      FROM notifications
      WHERE user_id = $1 AND is_read = FALSE
      `,
      [userId]
    );

    return Number(row?.count || 0);
  }

  /**
   * Marks a single notification as read.
   * Strictly enforces that the notification belongs to the specified userId.
   * Preserves original read_at timestamp if already marked as read.
   * Returns null if notification does not exist or does not belong to the user.
   */
  public async markAsRead(userId: string, notificationId: string): Promise<NotificationRecord | null> {
    if (!userId || !notificationId) return null;

    const nowIso = new Date().toISOString();

    const result = await dbAdapter.execute(
      `
      UPDATE notifications
      SET is_read = TRUE,
          read_at = COALESCE(read_at, $1)
      WHERE id = $2 AND user_id = $3
      `,
      [nowIso, notificationId, userId]
    );

    if (result.rowCount === 0) {
      return null;
    }

    const updatedRow = await dbAdapter.queryOne<RawNotificationRow>(
      `
      SELECT id, user_id, type, title, message, metadata, is_read, read_at, created_at
      FROM notifications
      WHERE id = $1 AND user_id = $2
      `,
      [notificationId, userId]
    );

    return updatedRow ? this.mapRow(updatedRow) : null;
  }

  /**
   * Marks all unread notifications for a user as read.
   * Strictly filtered by user_id.
   * Sets read_at to now for previously unread rows.
   */
  public async markAllAsRead(userId: string): Promise<{ updatedCount: number }> {
    if (!userId) return { updatedCount: 0 };

    const nowIso = new Date().toISOString();

    const result = await dbAdapter.execute(
      `
      UPDATE notifications
      SET is_read = TRUE,
          read_at = COALESCE(read_at, $1)
      WHERE user_id = $2 AND is_read = FALSE
      `,
      [nowIso, userId]
    );

    return {
      updatedCount: Number(result.rowCount || 0),
    };
  }
}

export const notificationService = new NotificationService();
