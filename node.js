const express = require('express');
const os = require('os');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const logger = require('./server/middleware/loggerMdlwre');
const { requestId, requestLogger } = require('./server/middleware/requestLoggerMdlwre');
const cookieParser = require('cookie-parser');
const response = require('./server/utils/response.utils');
const RESPONSE_STATUS = require('./server/utils/standard.messages');
const apiRoutes = require('./server/routes/apiRoutes');
const dbConfig = require('./server/config/db.config');
const expressSession = require('express-session');
const mySqlStore = require('express-mysql-session')(expressSession);
const { logBlock } = require('./server/utils/log.utils');

// startup banner: the machine facts a bug report from another box can't be read without.
// gated by SHOW_LOG like every other debug line
const toGb = (bytes) => (bytes / 1024 ** 3).toFixed(2);

const logSystemInfo = () => {
    console.log('========================= System information =========================\n');
    
    // what the code runs on; pid is what you kill when nodemon leaves a stray process
    logBlock('[system] runtime:', `node ${process.version} | pid ${process.pid} | ${os.type()} ${os.platform()} ${os.arch()}`);

    // what the pool (7 connections) and the 50mb body limit are sized against. cpus() reports
    // the host inside a container, availableParallelism what we may actually use
    logBlock('[system] capacity:', `${os.availableParallelism()} of ${os.cpus().length} cpus usable | memory ${toGb(os.freemem())} GB free of ${toGb(os.totalmem())} GB`);

    // cwd matters: db.config reads './certs/ca.pem' relative to it, so the wrong start folder
    // fails on the cert, not the database. uptime tells a reboot from a restart
    logBlock('[system] location:', `host ${os.hostname()} | cwd ${process.cwd()} | machine up ${(os.uptime() / 3600).toFixed(1)} h`);
        
    console.log('\n========================= End of system information =========================');

};

logSystemInfo();

// schedule module
require('./server/utils/schedule.utils');

// creating express app
const app = express();

// request id + metrics log come first so EVERY request is tagged and logged,
// including ones rejected later by cors, body parsing or the 404 handler
app.use(requestId);
app.use(requestLogger);

// content security policy 
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'"],
                imgSrc: ["'self'", "data:"],
                objectSrc: ["'none'"],
                fontSrc: ["'self'"],
                connectSrc: ["'self'"],
                mediaSrc: ["'self'"],
                frameAncestors: ["'none'"],
                baseUri: ["'self'"]
            }
        }
    })
);


// browser origins allowed to call the api come from .env (comma separated) so each
// environment names its own without a code change; the vite dev server is the fallback
const clientOrigins = (process.env.CLIENT_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
const allowedOrigins = clientOrigins.length ? clientOrigins : ['http://localhost:8081'];
// cors setup
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'access-token', 'x-file-name', 'x-request-id'],
    exposedHeaders: ['access-token', 'new-access-token', 'x-request-id'],
    credentials: true,
    maxAge: 18000 // 30 minutes
};

// enable cors
app.use(cors(corsOptions));

// middlewares
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'server/public')));
app.use(logger);

// Wait for teh database to connect 
async function makeSureDbConnected() {
    try {
        const connection = await dbConfig.pool.getConnection();
        logBlock('[db] connection:', 'Database connected successfully and ready to use!');
        connection.release();
    } catch (error) {
        console.error('Database connection failed:', error);
        process.exit(1);
    }
}
makeSureDbConnected();

// create a session store 
const sessionStore = new mySqlStore({
    clearExpired: true,
    checkExpirationInterval: 600000,
    expiration: process.env.EXPRESS_SESSION_EXPIRES,
}, dbConfig.pool);

// express session middleware setup
const sessionConfig = {
    store: sessionStore,
    rolling: true,
    secret: process.env.EXPRESS_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'yaapzone-cookie',
    cookie: {
        maxAge: Number(process.env.EXPRESS_SESSION_EXPIRES),
        httpOnly: true,
        sameSite: 'lax'
    }
}

if (process.env.NODE_ENV === 'production') {
    // the setting name has a SPACE - 'trust-proxy' is silently ignored by express.
    // with it on, req.ip is taken from x-forwarded-for (one proxy hop). only turn it
    // on when a proxy really is in front, otherwise clients can fake their ip
    app.set('trust proxy', 1);
    sessionConfig.cookie.secure = true;
}

app.use(expressSession(sessionConfig));

// routes 
app.use('/apiv1', apiRoutes);
// handling unknown roots
app.all('*splat', (req, res) => {
    console.log('In Global Router handler function');
    response.sendErrorResponse(req, res, 'Requested resource not available :' + req.originalUrl, RESPONSE_STATUS.NOT_FOUND, { function: 'global route handler' });
});

// global error handling
app.use((error, req, res, next) => {
    console.log('In Global error handler : ', error);
    // real error message goes to the metrics log; the client only sees the generic message below
    res.locals.error = error?.message || String(error);
    response.sendErrorResponse(req, res, 'Unable to process request. please try after some time !', RESPONSE_STATUS.INTERNAL_SERVER_ERROR, { location: 'Global error' })
});

module.exports = { app, allowedOrigins };