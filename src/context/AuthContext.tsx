import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { SafeUser, ApiResponse } from '../types/index.ts';

interface AuthContextType {
  user: SafeUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; code?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshUser = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', {
        headers: {
          Accept: 'application/json',
        },
      });

      const contentType = response.headers.get('content-type') || '';
      if (response.ok && contentType.includes('application/json')) {
        const json: ApiResponse<{ user: SafeUser }> = await response.json();
        if (json.success && json.data?.user) {
          setUser(json.data.user);
          return;
        }
      }
      setUser(null);
    } catch (err) {
      console.error('[AuthContext] Error fetching session user:', err);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');

      if (!isJson) {
        // Defensive handling for non-JSON responses (e.g. gateway 502/503 HTML or unexpected responses)
        console.warn('[AuthContext] Expected JSON response but received:', contentType || 'empty content-type');
        const errorText = !response.ok
          ? `Authentication service is currently unavailable (${response.status}). Please try again shortly.`
          : 'Unexpected server response format. Please try again.';
        return {
          success: false,
          code: 'SERVICE_UNAVAILABLE',
          error: errorText,
        };
      }

      const json: ApiResponse<{ user: SafeUser }> = await response.json();

      if (response.ok && json.success && json.data?.user) {
        setUser(json.data.user);
        return { success: true };
      }

      return {
        success: false,
        code: json.code || (response.status === 401 ? 'INVALID_CREDENTIALS' : 'AUTH_ERROR'),
        error: json.message || 'Invalid email or password.',
      };
    } catch (err) {
      console.error('[AuthContext] Login request failed:', err);
      return {
        success: false,
        code: 'NETWORK_ERROR',
        error: 'Unable to connect to authentication server. Please check your connection.',
      };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
      });
    } catch (err) {
      console.error('[AuthContext] Logout request error:', err);
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
