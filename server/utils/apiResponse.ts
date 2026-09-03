import { Response } from 'express';

export enum ApiErrorCode {
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
  OFFICE_ACCESS_REQUIRED = 'OFFICE_ACCESS_REQUIRED',
  ALREADY_CHECKED_IN = 'ALREADY_CHECKED_IN',
  NOT_CHECKED_IN = 'NOT_CHECKED_IN',
  NO_ACTIVE_CHECK_IN = 'NO_ACTIVE_CHECK_IN',
  ALREADY_CHECKED_OUT = 'ALREADY_CHECKED_OUT',
  ATTENDANCE_NOT_FOUND = 'ATTENDANCE_NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
  });
}

export function sendError(
  res: Response,
  statusCode: number,
  code: ApiErrorCode | string,
  message: string,
  errors?: Record<string, string>
) {
  return res.status(statusCode).json({
    success: false,
    code,
    message,
    ...(errors ? { errors } : {}),
  });
}
