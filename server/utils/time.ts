/**
 * Date and Time utilities for attendance management
 * Handles company timezone (default: Africa/Lagos) and working duration calculations
 */

export const COMPANY_TIMEZONE = process.env.TIMEZONE || 'Africa/Lagos';

/**
 * Returns today's date in YYYY-MM-DD format based on the configured company timezone
 */
export function getTodayDateString(tz = COMPANY_TIMEZONE): string {
  try {
    // 'en-CA' outputs YYYY-MM-DD
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Safely calculates working duration in seconds and formatted string (e.g. "8h 31m")
 * Guarantees zero/safe result for invalid, reversed, or missing timestamps
 */
export function calculateWorkingDuration(
  checkInIso: string | null | undefined,
  checkOutIso: string | null | undefined
): { totalSeconds: number; formatted: string } {
  if (!checkInIso || !checkOutIso) {
    return { totalSeconds: 0, formatted: '0h 0m' };
  }

  const start = new Date(checkInIso).getTime();
  const end = new Date(checkOutIso).getTime();

  if (isNaN(start) || isNaN(end) || end < start) {
    return { totalSeconds: 0, formatted: '0h 0m' };
  }

  const totalSeconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return {
    totalSeconds,
    formatted: `${hours}h ${minutes}m`,
  };
}

/**
 * Formats an ISO date/timestamp string for display in the company timezone
 * Example output: "08:42 AM"
 */
export function formatTimeInTimezone(isoString: string | null | undefined, tz = COMPANY_TIMEZONE): string {
  if (!isoString) return '--:--';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '--:--';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return '--:--';
  }
}

/**
 * Formats a date string (YYYY-MM-DD or ISO) into human-readable date
 * Example output: "Sep 2, 2026"
 */
export function formatDateInTimezone(dateStr: string | null | undefined, tz = COMPANY_TIMEZONE): string {
  if (!dateStr) return '--';
  try {
    // If it's a date string like '2026-09-02', parse year/month/day
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-').map(Number);
      const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      return new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(d);
    }
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateStr;
  }
}

/**
 * Validates whether a string is a strict YYYY-MM-DD date and represents a real calendar date
 */
export function isValidDateString(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Returns number of calendar days between two YYYY-MM-DD dates inclusive (e.g. same day = 1)
 */
export function getDaysBetweenDates(startDate: string, endDate: string): number {
  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return 1;
  }
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  const diffMs = endUtc - startUtc;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Computes startDate and endDate (YYYY-MM-DD) for preset date ranges in the company timezone
 */
export function getDateRangeForPreset(
  preset: string,
  tz = COMPANY_TIMEZONE
): { startDate: string; endDate: string } {
  const todayStr = getTodayDateString(tz);
  const [year, month, day] = todayStr.split('-').map(Number);

  // Helper to format Date as YYYY-MM-DD
  const formatUtcDate = (d: Date): string => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dayStr = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dayStr}`;
  };

  const todayDateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  switch (preset.toLowerCase().replace(/[-_]/g, '')) {
    case 'today':
      return { startDate: todayStr, endDate: todayStr };

    case 'yesterday': {
      const yesterday = new Date(todayDateObj.getTime() - 24 * 60 * 60 * 1000);
      const yStr = formatUtcDate(yesterday);
      return { startDate: yStr, endDate: yStr };
    }

    case 'thisweek': {
      // Day of week: 0 is Sunday, 1 is Monday ... 6 is Saturday
      const dayOfWeek = todayDateObj.getUTCDay();
      // Calculate Monday of this week (if Sunday (0), Monday was 6 days ago; else dayOfWeek - 1 days ago)
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(todayDateObj.getTime() - diffToMonday * 24 * 60 * 60 * 1000);
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      return {
        startDate: formatUtcDate(monday),
        endDate: formatUtcDate(sunday),
      };
    }

    case 'lastweek': {
      const dayOfWeek = todayDateObj.getUTCDay();
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const thisMonday = new Date(todayDateObj.getTime() - diffToMonday * 24 * 60 * 60 * 1000);
      const lastMonday = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
      const lastSunday = new Date(lastMonday.getTime() + 6 * 24 * 60 * 60 * 1000);
      return {
        startDate: formatUtcDate(lastMonday),
        endDate: formatUtcDate(lastSunday),
      };
    }

    case 'thismonth': {
      const firstDay = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
      // Last day of current month: day 0 of next month
      const lastDay = new Date(Date.UTC(year, month, 0, 12, 0, 0));
      return {
        startDate: formatUtcDate(firstDay),
        endDate: formatUtcDate(lastDay),
      };
    }

    case 'lastmonth': {
      // First day of previous month
      const firstDay = new Date(Date.UTC(year, month - 2, 1, 12, 0, 0));
      // Last day of previous month
      const lastDay = new Date(Date.UTC(year, month - 1, 0, 12, 0, 0));
      return {
        startDate: formatUtcDate(firstDay),
        endDate: formatUtcDate(lastDay),
      };
    }

    default:
      return { startDate: todayStr, endDate: todayStr };
  }
}

