import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import dotenv from 'dotenv';
import { getDatabase, closeDatabase } from './server/db/index.ts';
import { seedDatabase } from './server/db/seed.ts';
import { securityHeaders } from './server/middleware/security.ts';
import authRoutes from './server/routes/auth.routes.ts';
import devRoutes from './server/routes/dev.routes.ts';
import attendanceRoutes from './server/routes/attendance.routes.ts';
import adminRoutes from './server/routes/admin.routes.ts';
import eventRoutes from './server/routes/event.routes.ts';
import accessRoutes from './server/routes/access.routes.ts';
import visitorRoutes from './server/routes/visitor.routes.ts';
import receptionRoutes from './server/routes/reception.routes.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

async function startServer() {
  const app = express();

  // Trust proxy for containerized / Cloud Run / Nginx reverse proxy environment
  app.set('trust proxy', true);

  // Core middlewares
  app.use(securityHeaders);
  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Initialize SQLite database and run idempotent seeding
  try {
    getDatabase();
    await seedDatabase();
    console.log('[Database] Initialized and verified successfully.');
  } catch (dbError) {
    console.error('[Database] Initialization error:', dbError);
  }

  // Health check endpoint
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'Employee Attendance & Office Access Management System',
      timestamp: new Date().toISOString(),
      timezone: process.env.TIMEZONE || 'Africa/Lagos',
    });
  });

  // Development-only diagnostic routes
  app.use('/api/dev', devRoutes);

  // Authentication & RBAC API routes
  app.use('/api/auth', authRoutes);

  // Attendance & Check-In / Check-Out API routes
  app.use('/api/attendance', attendanceRoutes);

  // Administrator & Staff Management API routes
  app.use('/api/admin', adminRoutes);

  // Event Management & Approval API routes (Phase 6B)
  app.use('/api/events', eventRoutes);

  // Secure Access Pass & Verification API routes (Phase 6C)
  app.use('/api/access', accessRoutes);

  // Staff Visitor Access & Visitor Invitations API routes (Phase 6E)
  app.use('/api/visitor-visits', visitorRoutes);

  // Reception Access Verification & Check-In / Check-Out API routes (Phase 6F)
  app.use('/api/reception', receptionRoutes);

  // Global API error handler
  app.use('/api/*', (err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error('[API Error Handler]:', err);
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'An internal server error occurred.',
    });
  });

  // Vite middleware for development vs Static serving for production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`[Server] Running on http://${HOST}:${PORT}`);
  });

  // Graceful shutdown handling for container termination (Cloud Run / Docker)
  const shutdown = (signal: string) => {
    console.log(`[Server] Received ${signal}. Starting graceful shutdown...`);
    server.close(() => {
      console.log('[Server] HTTP server closed. Closing database connections...');
      closeDatabase();
      console.log('[Server] Database closed cleanly. Exiting process.');
      process.exit(0);
    });

    // Force exit if not closed within 10 seconds
    setTimeout(() => {
      console.error('[Server] Graceful shutdown timed out. Forcing termination.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((error) => {
  console.error('[Server] Fatal startup error:', error);
  process.exit(1);
});
