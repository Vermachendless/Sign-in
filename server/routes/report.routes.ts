import { Router, Response } from 'express';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth.ts';
import { reportService } from '../services/report.service.ts';
import { sendSuccess, sendError, ApiErrorCode } from '../utils/apiResponse.ts';
import { getDatabase } from '../db/index.ts';
import { AttendanceReportQuery } from '../../src/types/index.ts';

const router = Router();

// Enforce strict authentication and Administrator role for all report endpoints
router.use(requireAuth, requireAdmin);

/**
 * GET /api/admin/reports/departments
 * Returns distinct departments for populating dropdown filters
 */
router.get('/departments', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT DISTINCT department 
      FROM users 
      WHERE department IS NOT NULL AND TRIM(department) != ''
      ORDER BY department ASC
    `).all() as Array<{ department: string }>;

    const departments = rows.map((r) => r.department);
    return sendSuccess(res, { departments });
  } catch (error) {
    console.error('[ReportRoutes] /departments error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to fetch departments list.');
  }
});

/**
 * GET /api/admin/reports/attendance
 * Generates filtered attendance report with summary metrics and pagination
 */
router.get('/attendance', (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const ipAddress = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const {
      startDate,
      endDate,
      preset,
      staffId,
      department,
      accountStatus,
      attendanceStatus,
      page,
      limit,
      sort,
      order,
    } = req.query;

    const query: AttendanceReportQuery = {
      startDate: typeof startDate === 'string' ? startDate : undefined,
      endDate: typeof endDate === 'string' ? endDate : undefined,
      preset: typeof preset === 'string' ? preset : undefined,
      staffId: typeof staffId === 'string' ? staffId : undefined,
      department: typeof department === 'string' ? department : undefined,
      accountStatus: typeof accountStatus === 'string' ? accountStatus : undefined,
      attendanceStatus: typeof attendanceStatus === 'string' ? attendanceStatus : undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      sort: typeof sort === 'string' ? sort : 'date',
      order: typeof order === 'string' ? (order.toLowerCase() === 'asc' ? 'asc' : 'desc') : 'desc',
    };

    const report = reportService.getAttendanceReport(actor, query, ipAddress, userAgent);

    if (!report.success || !report.data) {
      return sendError(
        res,
        400,
        report.errorCode || ApiErrorCode.VALIDATION_ERROR,
        report.errorMessage || 'Failed to generate attendance report.'
      );
    }

    return sendSuccess(res, report.data);
  } catch (error) {
    console.error('[ReportRoutes] /attendance error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to process attendance report query.');
  }
});

/**
 * GET /api/admin/reports/attendance/summary
 * Returns summary statistics for the filtered period
 */
router.get(['/attendance/summary', '/summary'], (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const ipAddress = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const {
      startDate,
      endDate,
      preset,
      staffId,
      department,
      accountStatus,
      attendanceStatus,
    } = req.query;

    const query: AttendanceReportQuery = {
      startDate: typeof startDate === 'string' ? startDate : undefined,
      endDate: typeof endDate === 'string' ? endDate : undefined,
      preset: typeof preset === 'string' ? preset : undefined,
      staffId: typeof staffId === 'string' ? staffId : undefined,
      department: typeof department === 'string' ? department : undefined,
      accountStatus: typeof accountStatus === 'string' ? accountStatus : undefined,
      attendanceStatus: typeof attendanceStatus === 'string' ? attendanceStatus : undefined,
      page: 1,
      limit: 1,
    };

    const report = reportService.getAttendanceReport(actor, query, ipAddress, userAgent);

    if (!report.success || !report.data) {
      return sendError(
        res,
        400,
        report.errorCode || ApiErrorCode.VALIDATION_ERROR,
        report.errorMessage || 'Failed to calculate report summary.'
      );
    }

    return sendSuccess(res, {
      summary: report.data.summary,
      filters: report.data.filters,
    });
  } catch (error) {
    console.error('[ReportRoutes] /attendance/summary error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to calculate attendance report summary.');
  }
});

/**
 * GET /api/admin/reports/attendance/export.csv
 * GET /api/admin/reports/export.csv
 * Exports filtered report dataset to CSV with formula injection protection
 */
router.get(['/attendance/export.csv', '/export.csv', '/attendance/export/csv'], (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const ipAddress = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const {
      startDate,
      endDate,
      preset,
      staffId,
      department,
      accountStatus,
      attendanceStatus,
      sort,
      order,
    } = req.query;

    const query: AttendanceReportQuery = {
      startDate: typeof startDate === 'string' ? startDate : undefined,
      endDate: typeof endDate === 'string' ? endDate : undefined,
      preset: typeof preset === 'string' ? preset : undefined,
      staffId: typeof staffId === 'string' ? staffId : undefined,
      department: typeof department === 'string' ? department : undefined,
      accountStatus: typeof accountStatus === 'string' ? accountStatus : undefined,
      attendanceStatus: typeof attendanceStatus === 'string' ? attendanceStatus : undefined,
      sort: typeof sort === 'string' ? sort : 'date',
      order: typeof order === 'string' ? (order.toLowerCase() === 'asc' ? 'asc' : 'desc') : 'desc',
    };

    const result = reportService.generateCsvExport(actor, query, ipAddress, userAgent);

    if (!result.success || !result.csvContent) {
      return sendError(
        res,
        400,
        result.errorCode || ApiErrorCode.VALIDATION_ERROR,
        result.errorMessage || 'Failed to export CSV report.'
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).send(result.csvContent);
  } catch (error) {
    console.error('[ReportRoutes] CSV Export error:', error);
    return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to generate CSV export file.');
  }
});

/**
 * GET /api/admin/reports/attendance/export.xlsx
 * GET /api/admin/reports/export.xlsx
 * GET /api/admin/reports/attendance/export.xls
 * Exports filtered report dataset to Excel-compatible Spreadsheet format
 */
router.get(
  ['/attendance/export.xlsx', '/export.xlsx', '/attendance/export.xls', '/export.xls', '/attendance/export/excel'],
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const actor = req.user!;
      const ipAddress = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '');
      const userAgent = req.headers['user-agent'] || 'Unknown';

      const {
        startDate,
        endDate,
        preset,
        staffId,
        department,
        accountStatus,
        attendanceStatus,
        sort,
        order,
      } = req.query;

      const query: AttendanceReportQuery = {
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
        preset: typeof preset === 'string' ? preset : undefined,
        staffId: typeof staffId === 'string' ? staffId : undefined,
        department: typeof department === 'string' ? department : undefined,
        accountStatus: typeof accountStatus === 'string' ? accountStatus : undefined,
        attendanceStatus: typeof attendanceStatus === 'string' ? attendanceStatus : undefined,
        sort: typeof sort === 'string' ? sort : 'date',
        order: typeof order === 'string' ? (order.toLowerCase() === 'asc' ? 'asc' : 'desc') : 'desc',
      };

      const result = reportService.generateExcelExport(actor, query, ipAddress, userAgent);

      if (!result.success || !result.excelContent) {
        return sendError(
          res,
          400,
          result.errorCode || ApiErrorCode.VALIDATION_ERROR,
          result.errorMessage || 'Failed to export Excel report.'
        );
      }

      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      return res.status(200).send(result.excelContent);
    } catch (error) {
      console.error('[ReportRoutes] Excel Export error:', error);
      return sendError(res, 500, ApiErrorCode.INTERNAL_ERROR, 'Failed to generate Excel export file.');
    }
  }
);

export default router;
