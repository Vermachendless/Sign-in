import { dbAdapter } from '../db/adapter.ts';
import { generateId } from '../utils/crypto.ts';
import {
  ConversationParticipant,
  ConversationRecord,
  DirectMessageRecord,
  ConversationSummaryItem,
  ConversationListResponse,
  DirectMessageListResponse,
  UserRole,
  UserStatus,
} from '../../src/types/index.ts';

interface RawMessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  is_read: boolean | number;
  read_at: string | null;
  created_at: string;
}

interface RawConversationRow {
  id: string;
  participant1_id: string;
  participant2_id: string;
  last_message_text: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export class MessageService {
  /**
   * Maps raw database conversation row to ConversationRecord
   */
  private mapConversation(row: RawConversationRow): ConversationRecord {
    return {
      id: row.id,
      participant1Id: row.participant1_id,
      participant2Id: row.participant2_id,
      lastMessageText: row.last_message_text || null,
      lastMessageAt: row.last_message_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Maps raw database message row to DirectMessageRecord
   */
  private mapMessage(row: RawMessageRow): DirectMessageRecord {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      recipientId: row.recipient_id,
      content: row.content,
      isRead: Boolean(row.is_read),
      readAt: row.read_at || null,
      createdAt: row.created_at,
    };
  }

  /**
   * Search and list eligible active colleagues, excluding the caller.
   */
  public async listContacts(userId: string, search?: string): Promise<ConversationParticipant[]> {
    if (!userId) {
      throw new Error('userId is required to list contacts.');
    }

    let sql = `
      SELECT id, email, first_name, last_name, department, role, status
      FROM users
      WHERE id != $1 AND status = 'ACTIVE'
    `;
    const params: (string | number)[] = [userId];

    if (search && search.trim()) {
      const term = `%${search.trim().slice(0, 50)}%`;
      sql += ` AND (first_name LIKE $2 OR last_name LIKE $3 OR email LIKE $4 OR department LIKE $5)`;
      params.push(term, term, term, term);
    }

    sql += ` ORDER BY first_name ASC, last_name ASC LIMIT 50`;

    const rows = await dbAdapter.query<any>(sql, params);

    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      firstName: r.first_name,
      lastName: r.last_name,
      department: r.department || null,
      role: r.role as UserRole,
      status: r.status as UserStatus,
    }));
  }

  /**
   * Create or retrieve a direct 1-to-1 conversation between the caller and an eligible colleague.
   * Enforces canonical participant ordering: participant1_id < participant2_id.
   * Prohibits self-conversations and handles concurrent creation conflicts safely.
   */
  public async getOrCreateConversation(
    userId: string,
    recipientId: string
  ): Promise<{ conversation: ConversationRecord; isNew: boolean }> {
    if (!userId) {
      throw new Error('Caller userId is required.');
    }
    const cleanRecipientId = recipientId?.trim();
    if (!cleanRecipientId) {
      throw new Error('Recipient userId is required.');
    }
    if (cleanRecipientId === userId) {
      throw new Error('Self-conversations are not permitted.');
    }

    // Validate recipient existence and active status
    const recipient = await dbAdapter.queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM users WHERE id = $1',
      [cleanRecipientId]
    );
    if (!recipient) {
      throw new Error('Recipient account does not exist.');
    }
    if (recipient.status !== 'ACTIVE') {
      throw new Error('Cannot start conversation with an inactive or suspended user.');
    }

    // Canonical ordering: participant1Id is always strictly less than participant2Id
    const participant1Id = userId < cleanRecipientId ? userId : cleanRecipientId;
    const participant2Id = userId < cleanRecipientId ? cleanRecipientId : userId;

    // Check if conversation already exists
    const existing = await dbAdapter.queryOne<RawConversationRow>(
      `SELECT id, participant1_id, participant2_id, last_message_text, last_message_at, created_at, updated_at
       FROM conversations
       WHERE participant1_id = $1 AND participant2_id = $2`,
      [participant1Id, participant2Id]
    );

    if (existing) {
      return { conversation: this.mapConversation(existing), isNew: false };
    }

    const convId = generateId();
    const nowIso = new Date().toISOString();

    try {
      await dbAdapter.execute(
        `INSERT INTO conversations (
           id, participant1_id, participant2_id, last_message_text, last_message_at, created_at, updated_at
         ) VALUES ($1, $2, $3, NULL, NULL, $4, $5)`,
        [convId, participant1Id, participant2Id, nowIso, nowIso]
      );

      return {
        conversation: {
          id: convId,
          participant1Id,
          participant2Id,
          lastMessageText: null,
          lastMessageAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        isNew: true,
      };
    } catch {
      // Handle concurrent insert collision gracefully
      const recheck = await dbAdapter.queryOne<RawConversationRow>(
        `SELECT id, participant1_id, participant2_id, last_message_text, last_message_at, created_at, updated_at
         FROM conversations
         WHERE participant1_id = $1 AND participant2_id = $2`,
        [participant1Id, participant2Id]
      );
      if (recheck) {
        return { conversation: this.mapConversation(recheck), isNew: false };
      }
      throw new Error('Failed to create or retrieve conversation.');
    }
  }

  /**
   * Retrieve a conversation by ID, verifying that the caller is one of the participants.
   * Returns null if conversation does not exist or caller is unauthorized.
   */
  public async getConversationById(userId: string, conversationId: string): Promise<ConversationRecord | null> {
    if (!userId || !conversationId) return null;

    const row = await dbAdapter.queryOne<RawConversationRow>(
      `SELECT id, participant1_id, participant2_id, last_message_text, last_message_at, created_at, updated_at
       FROM conversations
       WHERE id = $1 AND (participant1_id = $2 OR participant2_id = $2)`,
      [conversationId, userId]
    );

    return row ? this.mapConversation(row) : null;
  }

  /**
   * List conversations for the authenticated user, ordered by latest message activity.
   */
  public async listConversations(
    userId: string,
    options?: { page?: number; limit?: number }
  ): Promise<ConversationListResponse> {
    if (!userId) {
      throw new Error('userId is required to list conversations.');
    }

    const page = Math.max(1, Math.floor(Number(options?.page) || 1));
    const limit = Math.min(50, Math.max(1, Math.floor(Number(options?.limit) || 20)));
    const offset = (page - 1) * limit;

    const countRow = await dbAdapter.queryOne<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM conversations WHERE participant1_id = $1 OR participant2_id = $1`,
      [userId]
    );
    const total = Number(countRow?.count || 0);

    const rows = await dbAdapter.query<any>(
      `SELECT 
         c.id, c.participant1_id, c.participant2_id, c.last_message_text, c.last_message_at, c.created_at, c.updated_at,
         u.id as other_id, u.email as other_email, u.first_name as other_first_name, u.last_name as other_last_name,
         u.department as other_department, u.role as other_role, u.status as other_status,
         (SELECT COUNT(*) FROM direct_messages dm WHERE dm.conversation_id = c.id AND dm.recipient_id = $1 AND dm.is_read = FALSE) as unread_count,
         (SELECT dm.id FROM direct_messages dm WHERE dm.conversation_id = c.id ORDER BY dm.created_at DESC, dm.id DESC LIMIT 1) as last_msg_id,
         (SELECT dm.sender_id FROM direct_messages dm WHERE dm.conversation_id = c.id ORDER BY dm.created_at DESC, dm.id DESC LIMIT 1) as last_msg_sender_id,
         (SELECT dm.content FROM direct_messages dm WHERE dm.conversation_id = c.id ORDER BY dm.created_at DESC, dm.id DESC LIMIT 1) as last_msg_content,
         (SELECT dm.created_at FROM direct_messages dm WHERE dm.conversation_id = c.id ORDER BY dm.created_at DESC, dm.id DESC LIMIT 1) as last_msg_created_at
       FROM conversations c
       JOIN users u ON u.id = (CASE WHEN c.participant1_id = $1 THEN c.participant2_id ELSE c.participant1_id END)
       WHERE c.participant1_id = $1 OR c.participant2_id = $1
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const conversations: ConversationSummaryItem[] = rows.map((r) => ({
      id: r.id,
      otherParticipant: {
        id: r.other_id,
        email: r.other_email,
        firstName: r.other_first_name,
        lastName: r.other_last_name,
        department: r.other_department || null,
        role: r.other_role as UserRole,
        status: r.other_status as UserStatus,
      },
      lastMessage: r.last_msg_id
        ? {
            id: r.last_msg_id,
            senderId: r.last_msg_sender_id,
            content: r.last_msg_content,
            createdAt: r.last_msg_created_at,
          }
        : null,
      unreadCount: Number(r.unread_count || 0),
      updatedAt: r.last_message_at || r.updated_at || r.created_at,
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      conversations,
      total,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages,
    };
  }

  /**
   * Retrieve paginated message history for a conversation.
   * Returns null if the caller is not a participant.
   */
  public async listMessages(
    userId: string,
    conversationId: string,
    options?: { page?: number; limit?: number }
  ): Promise<DirectMessageListResponse | null> {
    if (!userId || !conversationId) return null;

    const conversation = await this.getConversationById(userId, conversationId);
    if (!conversation) {
      return null;
    }

    const page = Math.max(1, Math.floor(Number(options?.page) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(options?.limit) || 30)));
    const offset = (page - 1) * limit;

    const countRow = await dbAdapter.queryOne<{ count: number | string }>(
      'SELECT COUNT(*) as count FROM direct_messages WHERE conversation_id = $1',
      [conversationId]
    );
    const total = Number(countRow?.count || 0);

    const rows = await dbAdapter.query<RawMessageRow>(
      `SELECT id, conversation_id, sender_id, recipient_id, content, is_read, read_at, created_at
       FROM direct_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset]
    );

    // Return messages chronologically (oldest to newest) for standard chat view presentation
    const messages = rows.map((r) => this.mapMessage(r)).reverse();
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      messages,
      total,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages,
    };
  }

  /**
   * Send a direct message in a conversation.
   * Validates plain-text content length (1–2000 chars), derives sender from auth,
   * checks active recipient status, and atomically commits message + conversation activity preview.
   */
  public async sendMessage(
    userId: string,
    conversationId: string,
    rawContent: string
  ): Promise<DirectMessageRecord | null> {
    if (!userId || !conversationId) return null;

    const content = rawContent?.trim();
    if (!content || content.length === 0) {
      throw new Error('Message content cannot be empty.');
    }
    if (content.length > 2000) {
      throw new Error('Message exceeds maximum limit of 2000 characters.');
    }

    const conversation = await this.getConversationById(userId, conversationId);
    if (!conversation) {
      return null;
    }

    const recipientId =
      conversation.participant1Id === userId ? conversation.participant2Id : conversation.participant1Id;

    // Validate recipient account status
    const recipient = await dbAdapter.queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM users WHERE id = $1',
      [recipientId]
    );
    if (!recipient || recipient.status !== 'ACTIVE') {
      throw new Error('Cannot send message: Recipient account is inactive or suspended.');
    }

    const messageId = generateId();
    const nowIso = new Date().toISOString();
    const previewSnippet = content.length > 120 ? content.slice(0, 117) + '...' : content;

    await dbAdapter.transaction(async (tx) => {
      // 1. Insert direct_messages record
      await tx.execute(
        `INSERT INTO direct_messages (
           id, conversation_id, sender_id, recipient_id, content, is_read, read_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, FALSE, NULL, $6)`,
        [messageId, conversationId, userId, recipientId, content, nowIso]
      );

      // 2. Update conversation activity preview atomically
      await tx.execute(
        `UPDATE conversations
         SET last_message_text = $1,
             last_message_at = $2,
             updated_at = $3
         WHERE id = $4`,
        [previewSnippet, nowIso, nowIso, conversationId]
      );
    });

    return {
      id: messageId,
      conversationId,
      senderId: userId,
      recipientId,
      content,
      isRead: false,
      readAt: null,
      createdAt: nowIso,
    };
  }

  /**
   * Mark incoming messages in a conversation as read for the authenticated recipient.
   * Does NOT mark the sender's own sent messages. Safe to repeat.
   */
  public async markConversationAsRead(
    userId: string,
    conversationId: string
  ): Promise<{ markedCount: number; unreadCount: number } | null> {
    if (!userId || !conversationId) return null;

    const conversation = await this.getConversationById(userId, conversationId);
    if (!conversation) {
      return null;
    }

    const nowIso = new Date().toISOString();

    const updateResult = await dbAdapter.execute(
      `UPDATE direct_messages
       SET is_read = TRUE,
           read_at = COALESCE(read_at, $1)
       WHERE conversation_id = $2 AND recipient_id = $3 AND is_read = FALSE`,
      [nowIso, conversationId, userId]
    );

    const unreadCount = await this.getUnreadCount(userId);

    return {
      markedCount: updateResult.rowCount,
      unreadCount,
    };
  }

  /**
   * Return the total unread message count for the authenticated recipient.
   */
  public async getUnreadCount(userId: string): Promise<number> {
    if (!userId) return 0;

    const row = await dbAdapter.queryOne<{ count: number | string }>(
      `SELECT COUNT(*) as count
       FROM direct_messages
       WHERE recipient_id = $1 AND is_read = FALSE`,
      [userId]
    );

    return Number(row?.count || 0);
  }
}

export const messageService = new MessageService();
