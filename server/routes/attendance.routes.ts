import { Router, Response } from 'express';
import { requireAuth, requireStaff, AuthenticatedRequest } from '../middleware/auth.ts';
import { attendanceService } from '../services/attendance.service.ts';
import { verifyOfficeNetwork } from '../services/network.service.ts';
import { auditService } from '../services/audit.service.ts';
import { sendSuccess, sendError, ApiErrorCode } from '../utils/apiResponse.ts';

const router = Router();

/**
 * GET /api/attendance/today
 * Retrieves today's attendance state for the authenticated staff member
 */
router.get('/today', requireAuth, requireStaff, (req: AuthenticatedRequest, res: Response) => {
  try {
    const staffId = req.user!.id;
    const todayData = attendanceService.getTodayAttendance(staffId);
    return sendSuccess(res, todayData);
  } catch (error) {
    console.error('[AttendanceRoutes] getToday error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve attendance status.');
  }
});

/**
 * POST /api/attendance/check-in
 * Secure Check-In endpoint for authenticated staff
 * Identity is strictly derived from server session (req.user.id)
 * Office network verification is strictly enforced
 */
router.post('/check-in', requireAuth, requireStaff, (req: AuthenticatedRequest, res: Response) => {
  try {
    const staffId = req.user!.id;
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // 1. Enforce Office Network / IP Verification
    const networkVerification = verifyOfficeNetwork(req);
    if (!networkVerification.isOfficeNetwork) {
      // Record security audit log for off-network check-in attempt
      auditService.log({
        actorId: staffId,
        action: 'CHECK_IN_OFFICE_NETWORK_DENIED',
        targetUserId: staffId,
        ipAddress: networkVerification.detectedIp,
        userAgent,
        metadata: {
          maskedDetectedIp: networkVerification.maskedDetectedIp,
          reason: 'OFFICE_ACCESS_REQUIRED',
          proxyHeadersDetected: networkVerification.proxyHeadersDetected,
          proxyHopCount: networkVerification.proxyHopCount,
        },
      });

      return sendError(
        res,
        403,
        ApiErrorCode.OFFICE_ACCESS_REQUIRED,
        'Attendance actions are only available from an authorized office network.'
      );
    }

    // 2. Execute attendance check-in
    const result = attendanceService.checkIn({
      staffId,
      clientIp: networkVerification.detectedIp,
      userAgent,
      verificationMethod: networkVerification.verificationMethod,
    });

    if (!result.success || !result.attendance) {
      return sendError(
        res,
        400,
        result.errorCode || ApiErrorCode.VALIDATION_ERROR,
        result.errorMessage || 'Check-in failed.'
      );
    }

    return sendSuccess(
      res,
      {
        attendance: result.attendance,
        state: result.state,
        message: 'Checked in successfully.',
      },
      201
    );
  } catch (error) {
    console.error('[AttendanceRoutes] checkIn error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'An error occurred while processing check-in.');
  }
});

/**
 * POST /api/attendance/check-out
 * Secure Check-Out endpoint for authenticated staff
 * Office network verification is strictly enforced
 */
router.post('/check-out', requireAuth, requireStaff, (req: AuthenticatedRequest, res: Response) => {
  try {
    const staffId = req.user!.id;
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // 1. Enforce Office Network / IP Verification
    const networkVerification = verifyOfficeNetwork(req);
    if (!networkVerification.isOfficeNetwork) {
      // Record security audit log for off-network check-out attempt
      auditService.log({
        actorId: staffId,
        action: 'CHECK_OUT_OFFICE_NETWORK_DENIED',
        targetUserId: staffId,
        ipAddress: networkVerification.detectedIp,
        userAgent,
        metadata: {
          maskedDetectedIp: networkVerification.maskedDetectedIp,
          reason: 'OFFICE_ACCESS_REQUIRED',
          proxyHeadersDetected: networkVerification.proxyHeadersDetected,
          proxyHopCount: networkVerification.proxyHopCount,
        },
      });

      return sendError(
        res,
        403,
        ApiErrorCode.OFFICE_ACCESS_REQUIRED,
        'Attendance actions are only available from an authorized office network.'
      );
    }

    // 2. Execute attendance check-out
    const result = attendanceService.checkOut({
      staffId,
      clientIp: networkVerification.detectedIp,
      userAgent,
      verificationMethod: networkVerification.verificationMethod,
    });

    if (!result.success || !result.attendance) {
      return sendError(
        res,
        400,
        result.errorCode || ApiErrorCode.VALIDATION_ERROR,
        result.errorMessage || 'Check-out failed.'
      );
    }

    return sendSuccess(res, {
      attendance: result.attendance,
      state: result.state,
      formattedDuration: result.formattedDuration,
      message: 'Checked out successfully.',
    });
  } catch (error) {
    console.error('[AttendanceRoutes] checkOut error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'An error occurred while processing check-out.');
  }
});

/**
 * GET /api/attendance/my-history
 * Retrieves authenticated staff member's personal attendance history
 */
router.get('/my-history', requireAuth, requireStaff, (req: AuthenticatedRequest, res: Response) => {
  try {
    const staffId = req.user!.id;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 30;
    const safeLimit = isNaN(limit) || limit <= 0 ? 30 : Math.min(limit, 100);

    const history = attendanceService.getStaffHistory(staffId, safeLimit);

    return sendSuccess(res, {
      history,
      count: history.length,
    });
  } catch (error) {
    console.error('[AttendanceRoutes] getStaffHistory error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to retrieve attendance history.');
  }
});

export default router;
