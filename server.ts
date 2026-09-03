import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import dotenv from 'dotenv';
import { getDatabase } from './server/db/index.ts';
import { seedDatabase } from './server/db/seed.ts';
import { securityHeaders } from './server/middleware/security.ts';
import authRoutes from './server/routes/auth.routes.ts';
import devRoutes from './server/routes/dev.routes.ts';
import attendanceRoutes from './server/routes/attendance.routes.ts';
import adminRoutes from './server/routes/admin.routes.ts';

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

  app.listen(PORT, HOST, () => {
    console.log(`[Server] Running on http://${HOST}:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('[Server] Fatal startup error:', error);
  process.exit(1);
});
