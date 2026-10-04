import { Router, Response } from 'express';
import { requireAuth, requireAdmin, requireSuperAdmin, AuthenticatedRequest } from '../middleware/auth.ts';
import { adminService } from '../services/admin.service.ts';
import { auditService } from '../services/audit.service.ts';
import {
  getOfficeNetworkSettings,
  addApprovedOfficeIp,
  removeApprovedOfficeIp,
  extractClientIp,
} from '../services/network.service.ts';
import { backupService } from '../services/backup.service.ts';
import reportRoutes from './report.routes.ts';
import { sendSuccess, sendError, ApiErrorCode } from '../utils/apiResponse.ts';
import { UserRole, UserStatus } from '../../src/types/index.ts';

const router = Router();

/**
 * All admin routes require authentication and at least ADMIN role
 */
router.use(requireAuth, requireAdmin);

/**
 * Sub-router for attendance reports and export operations
 * Base path: /api/admin/reports
 */
router.use('/reports', reportRoutes);

/**
 * GET /api/admin/audit-logs
 * Retrieves immutable audit logs with pagination and search
 */
router.get('/audit-logs', (req: AuthenticatedRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const result = auditService.listLogs({ page, limit, action, search });
    return sendSuccess(res, result);
  } catch (error) {
    console.error('[AdminRoutes] getAuditLogs error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve audit log records.');
  }
});

/**
 * GET /api/admin/dashboard
 * Retrieves today's attendance summary and live staff records
 */
router.get('/dashboard', (req: AuthenticatedRequest, res: Response) => {
  try {
    const summary = adminService.getDashboardSummary();
    return sendSuccess(res, summary);
  } catch (error) {
    console.error('[AdminRoutes] getDashboard error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to load administrator dashboard data.');
  }
});

/**
 * GET /api/admin/staff
 * Lists staff members with search, status, and role filters
 */
router.get('/staff', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { search, status, role } = req.query;

    const staffList = adminService.listStaff({
      search: typeof search === 'string' ? search : undefined,
      status: typeof status === 'string' ? (status as UserStatus) : undefined,
      role: typeof role === 'string' ? (role as UserRole) : undefined,
    });

    return sendSuccess(res, {
      staff: staffList,
      count: staffList.length,
    });
  } catch (error) {
    console.error('[AdminRoutes] listStaff error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve staff directory.');
  }
});

/**
 * GET /api/admin/staff/:id
 * Retrieves detailed staff profile with lifetime stats and recent attendance
 */
router.get('/staff/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Staff ID is required.');
    }

    const detail = adminService.getStaffById(id);
    if (!detail) {
      return sendError(res, 404, ApiErrorCode.NOT_FOUND, 'Staff member not found.');
    }

    return sendSuccess(res, detail);
  } catch (error) {
    console.error('[AdminRoutes] getStaffById error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve staff details.');
  }
});

/**
 * POST /api/admin/staff
 * Creates a new staff member account
 */
router.post('/staff', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { firstName, lastName, email, password, phone, department, role, status } = req.body || {};

    const ipAddress = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = await adminService.createStaff(
      actor,
      {
        firstName,
        lastName,
        email,
        password,
        phone,
        department,
        role,
        status,
      },
      ipAddress,
      userAgent
    );

    if (!result.success || !result.user) {
      const statusCode =
        result.errorCode === ApiErrorCode.FORBIDDEN
          ? 403
          : result.errorCode === ApiErrorCode.ALREADY_EXISTS || result.errorCode === ApiErrorCode.CONFLICT
          ? 409
          : 400;

      return sendError(
        res,
        statusCode,
        result.errorCode || ApiErrorCode.VALIDATION_ERROR,
        result.errorMessage || 'Failed to create staff account.'
      );
    }

    return sendSuccess(res, { user: result.user, message: 'Staff member created successfully.' }, 201);
  } catch (error) {
    console.error('[AdminRoutes] createStaff error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'An unexpected error occurred while creating staff account.');
  }
});

/**
 * PATCH /api/admin/staff/:id
 * Updates staff account profile fields
 */
router.patch('/staff/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;
    const { firstName, lastName, email, phone, department, role } = req.body || {};

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Staff ID is required.');
    }

    const ipAddress = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = adminService.updateStaff(
      actor,
      id,
      {
        firstName,
        lastName,
        email,
        phone,
        department,
        role,
      },
      ipAddress,
      userAgent
    );

    if (!result.success || !result.user) {
      const statusCode =
        result.errorCode === ApiErrorCode.NOT_FOUND
          ? 404
          : result.errorCode === ApiErrorCode.FORBIDDEN
          ? 403
          : result.errorCode === ApiErrorCode.ALREADY_EXISTS
          ? 409
          : 400;

      return sendError(
        res,
        statusCode,
        result.errorCode || ApiErrorCode.VALIDATION_ERROR,
        result.errorMessage || 'Failed to update staff account.'
      );
    }

    return sendSuccess(res, { user: result.user, message: 'Staff account updated successfully.' });
  } catch (error) {
    console.error('[AdminRoutes] updateStaff error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'An unexpected error occurred while updating staff.');
  }
});

/**
 * PATCH /api/admin/staff/:id/status
 * Activates or deactivates/suspends a staff account
 */
router.patch('/staff/:id/status', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;
    const { status } = req.body || {};

    if (!id) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Staff ID is required.');
    }

    if (!status || !Object.values(UserStatus).includes(status)) {
      return sendError(
        res,
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'A valid status (ACTIVE, SUSPENDED, or REMOVED) is required.'
      );
    }

    const ipAddress = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = adminService.setStaffStatus(actor, id, status as UserStatus, ipAddress, userAgent);

    if (!result.success || !result.user) {
      const statusCode =
        result.errorCode === ApiErrorCode.NOT_FOUND
          ? 404
          : result.errorCode === ApiErrorCode.FORBIDDEN
          ? 403
          : 400;

      return sendError(
        res,
        statusCode,
        result.errorCode || ApiErrorCode.VALIDATION_ERROR,
        result.errorMessage || 'Failed to update staff status.'
      );
    }

    return sendSuccess(res, {
      user: result.user,
      message: `Staff member marked as ${status.toLowerCase()} successfully.`,
    });
  } catch (error) {
    console.error('[AdminRoutes] setStaffStatus error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'An unexpected error occurred while changing staff status.');
  }
});

/**
 * GET /api/admin/office-network
 * Super Admin only: Retrieves approved office network settings and current client IP evaluation
 */
router.get('/office-network', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = getOfficeNetworkSettings(req);
    return sendSuccess(res, config);
  } catch (error) {
    console.error('[AdminRoutes] getOfficeNetwork error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve office network settings.');
  }
});

/**
 * POST /api/admin/office-network
 * Super Admin only: Adds an approved public IP to system_settings.approvedOfficeIPs
 */
router.post('/office-network', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { ip } = req.body || {};

    if (!ip || typeof ip !== 'string') {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Valid IP address string is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = addApprovedOfficeIp(actor.id, ip, clientIp, userAgent);

    if (!result.success) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to add office IP.');
    }

    const config = getOfficeNetworkSettings(req);
    return sendSuccess(
      res,
      {
        ...config,
        message: `IP ${result.addedIp} added to approved office network list successfully.`,
      },
      201
    );
  } catch (error) {
    console.error('[AdminRoutes] addOfficeIp error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to add approved office IP.');
  }
});

/**
 * POST /api/admin/office-network/add-current
 * Super Admin only: Adds the server-detected public IP to system_settings.approvedOfficeIPs
 */
router.post('/office-network/add-current', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    if (!clientIp) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Could not detect client IP from current connection.');
    }

    const result = addApprovedOfficeIp(actor.id, clientIp, clientIp, userAgent);

    if (!result.success) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to add current IP.');
    }

    const config = getOfficeNetworkSettings(req);
    return sendSuccess(
      res,
      {
        ...config,
        message: `Current IP ${result.addedIp} added to approved office network list successfully.`,
      },
      200
    );
  } catch (error) {
    console.error('[AdminRoutes] addCurrentOfficeIp error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to add current detected IP.');
  }
});

/**
 * DELETE /api/admin/office-network/:ip
 * Super Admin only: Removes an approved IP from system_settings.approvedOfficeIPs
 */
router.delete('/office-network/:ip', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { ip } = req.params;

    if (!ip) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'IP address parameter is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = removeApprovedOfficeIp(actor.id, ip, clientIp, userAgent);

    if (!result.success) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to remove office IP.');
    }

    const config = getOfficeNetworkSettings(req);
    return sendSuccess(res, {
      ...config,
      message: `IP ${result.removedIp} removed from approved office network list successfully.`,
    });
  } catch (error) {
    console.error('[AdminRoutes] deleteOfficeIp error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to remove approved office IP.');
  }
});

/**
 * POST /api/admin/office-network/remove
 * Super Admin only: Alternative POST endpoint for removing an approved IP from system_settings.approvedOfficeIPs
 */
router.post('/office-network/remove', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { ip } = req.body || {};

    if (!ip || typeof ip !== 'string') {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, 'Valid IP address string is required.');
    }

    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = removeApprovedOfficeIp(actor.id, ip, clientIp, userAgent);

    if (!result.success) {
      return sendError(res, 400, ApiErrorCode.VALIDATION_ERROR, result.error || 'Failed to remove office IP.');
    }

    const config = getOfficeNetworkSettings(req);
    return sendSuccess(res, {
      ...config,
      message: `IP ${result.removedIp} removed from approved office network list successfully.`,
    });
  } catch (error) {
    console.error('[AdminRoutes] removeOfficeIp error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to remove approved office IP.');
  }
});

/**
 * POST /api/admin/backups
 * Super Admin only: Trigger atomic, consistent point-in-time database backup
 */
router.post('/backups', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { ip: clientIp } = extractClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = backupService.createBackup(actor, clientIp, userAgent);

    if (!result.success) {
      return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, result.error || 'Failed to create database backup.');
    }

    return sendSuccess(res, {
      filename: result.filename,
      fileSizeBytes: result.fileSizeBytes,
      tableCounts: result.tableCounts,
      checksumVerified: result.checksumVerified,
      message: 'Database backup created and verified successfully.',
    }, 201);
  } catch (error) {
    console.error('[AdminRoutes] createBackup error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'An error occurred during database backup.');
  }
});

/**
 * GET /api/admin/backups
 * Super Admin only: List verified backups metadata (does not expose raw files)
 */
router.get('/backups', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const backups = backupService.listBackups(actor);
    return sendSuccess(res, { backups });
  } catch (error) {
    console.error('[AdminRoutes] listBackups error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to list database backups.');
  }
});

export default router;
