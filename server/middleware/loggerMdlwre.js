const morgan = require("morgan");
const chalk = require("chalk");


morgan.token("colored-status", (req, res) => {
    const status = res.statusCode;

    if (status >= 500) return chalk.red(status);
    if (status >= 400) return chalk.yellow(status);
    if (status >= 300) return chalk.cyan(status);

    return chalk.green(status);
});

const logger = morgan((tokens, req, res) => {
    return `[ ${chalk.yellow(new Date().toLocaleString())}, ${chalk.blue(tokens.method(req, res))} ]: ${chalk.magenta(tokens.url(req, res))} | ${ tokens["colored-status"](req, res)} | ${chalk.white(tokens["response-time"](req, res) + " ms")}`
    
});

module.exports = logger;