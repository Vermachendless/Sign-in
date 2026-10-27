import { UserRole, UserStatus } from '../../types/index.ts';

export type FeedReactionType = 'LIKE' | 'CELEBRATE' | 'SUPPORT' | 'INSIGHTFUL';

export interface FeedAuthor {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  department?: string | null;
  role: UserRole;
  status?: UserStatus;
}

export interface FeedPostStats {
  commentsCount: number;
  reactionsCount: number;
  reactions: Record<FeedReactionType, number>;
}

export interface FeedPostItem {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: FeedAuthor;
  stats: FeedPostStats;
  currentUserReaction: FeedReactionType | null;
}

export interface FeedCommentItem {
  id: string;
  postId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: FeedAuthor;
}

export interface FeedPostListResponseData {
  posts: FeedPostItem[];
  nextCursor?: string | null;
  hasMore: boolean;
}

export interface ToggleReactionResponseData {
  action: 'ADDED' | 'REMOVED' | 'UPDATED';
  reactionType: FeedReactionType | null;
  reactions: Record<FeedReactionType, number>;
  totalReactions: number;
}
