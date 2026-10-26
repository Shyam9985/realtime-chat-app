/*
 * Debug logging gated behind the SHOW_LOG environment variable (.env):
 *   SHOW_LOG=true  -> debug logs are printed
 *   anything else  -> silent
 *
 * Only DEBUG output goes through here. Error logging stays on console.error
 * everywhere, so failures are never hidden by the flag.
 */

const chalk = require('chalk');
const util = require('util');

// read per call so a .env change takes effect on the next nodemon restart
const isEnabled = () => String(process.env.SHOW_LOG).toLowerCase() === 'true';

// debug log, printed only when SHOW_LOG=true
exports.log = (...args) => {
    if (isEnabled()) console.log(...args);
};

// two-part debug log: a bold heading on a colored background, then the body beneath it.
// example: logBlock('[get users model] query:', qry, '| params:', params)
// the body is joined into ONE string before printing - passing pieces straight to
// console.log would treat %d/%i inside SQL (DATE_FORMAT patterns) as printf placeholders
exports.logBlock = (heading, ...body) => {
    if (!isEnabled()) return;
    console.log(chalk.bgBlue.white(` ${heading} `), body.map((part) => (typeof part === 'string' ? part : util.inspect(part))).join(' '));
};
