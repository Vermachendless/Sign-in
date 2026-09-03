import { Router, Response } from 'express';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth.ts';
import { adminService } from '../services/admin.service.ts';
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

export default router;
