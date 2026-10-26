/*
 * Date helpers and the project's date/time formats.
 *
 * Two conventions live here so nothing else has to know them:
 *   - VALUES travel as YYYY-MM-DD strings (what <input type="date"> and MySQL DATE speak)
 *     and are always interpreted in the SERVER'S LOCAL timezone. new Date('2026-09-18')
 *     would be UTC midnight, which is the previous evening anywhere ahead of UTC - in IST
 *     that rejected every entry made between midnight and 05:30. date-fns parse/format
 *     never make that assumption.
 *   - DISPLAY is dd-MM-yyyy for dates and dd-MM-yyyy HH:mm:ss (24-hour) for timestamps, in both
 *     node (date-fns tokens) and MySQL (DATE_FORMAT tokens). Use these constants instead
 *     of retyping the pattern.
 */
const { format, parse, isValid, addDays, addYears, differenceInCalendarDays, eachDayOfInterval } = require('date-fns');

// value format: how a day is stored and sent over the wire
const DAY_FORMAT = 'yyyy-MM-dd';
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// display formats: date-fns tokens for node, DATE_FORMAT tokens for SQL, same output
const DISPLAY_DATE_FORMAT = 'dd-MM-yyyy';                  // 18-09-2026
const DISPLAY_DATETIME_FORMAT = 'dd-MM-yyyy HH:mm:ss';     // 18-09-2026 22:35:12
const SQL_DISPLAY_DATE_FORMAT = '%d-%m-%Y';
const SQL_DISPLAY_DATETIME_FORMAT = '%d-%m-%Y %H:%i:%s';

// Date -> YYYY-MM-DD in local time
const formatLocal = (date) => format(date, DAY_FORMAT);

// YYYY-MM-DD -> Date at LOCAL midnight (date-fns parse never assumes UTC)
const parseLocal = (value) => parse(value, DAY_FORMAT, new Date());

// today as YYYY-MM-DD in local time
const todayLocal = () => formatLocal(new Date());

// the same, shifted by a number of years (used for far-future defaults)
const yearsFromTodayLocal = (years) => formatLocal(addYears(new Date(), years));

// a YYYY-MM-DD shifted by a number of days (negative to go back)
const addDaysLocal = (value, days) => formatLocal(addDays(parseLocal(value), days));

// inclusive day count between two YYYY-MM-DD values ('2026-09-12' .. '2026-09-18' = 7)
const daysBetweenLocal = (from, to) => differenceInCalendarDays(parseLocal(to), parseLocal(from)) + 1;

// every YYYY-MM-DD from `from` to `to` inclusive
const eachDayLocal = (from, to) => eachDayOfInterval({ start: parseLocal(from), end: parseLocal(to) }).map(formatLocal);

// true when the value is a well formed, real calendar date. the regex keeps the shape strict
// (parse alone would accept '2026-9-8'); parse rejects impossible days like 2026-02-30
const isValidDateOnly = (value) => DATE_ONLY_RE.test(value) && isValid(parseLocal(value));

// display helpers for logs and messages (models format in SQL with the SQL_* constants)
const displayDate = (date) => format(date, DISPLAY_DATE_FORMAT);
const displayDateTime = (date) => format(date, DISPLAY_DATETIME_FORMAT);

module.exports = {
    todayLocal, yearsFromTodayLocal, addDaysLocal, daysBetweenLocal, eachDayLocal, isValidDateOnly,
    displayDate, displayDateTime,
    DAY_FORMAT, DATE_ONLY_RE,
    DISPLAY_DATE_FORMAT, DISPLAY_DATETIME_FORMAT, SQL_DISPLAY_DATE_FORMAT, SQL_DISPLAY_DATETIME_FORMAT
};
