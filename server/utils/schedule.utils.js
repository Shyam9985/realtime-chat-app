const scheduler = require('node-schedule');
const authMdl = require('../models/authMdl');
const { formatDistanceToNowStrict } = require('date-fns');
const { displayDateTime } = require('./date.utils');
const { log, logBlock } = require('./log.utils');

// schedulers

if (process.env.SCHEDULE_RUN === 'true') {
    log('Schedule utilities module loaded!');
    registerJobs();
}

// schedule time logger 
function logUpcomingJobTime(jobName, job) {
    const nextRun = job.nextInvocation().toDate();

    log(`Scheduler : ${jobName}  || Next Run  : ${displayDateTime(nextRun)} || Remaining : ${formatDistanceToNowStrict(nextRun)}`);
}

//schedulers rigistry
function registerJobs() {
    log('\n', '=============== in schedules registry ===============', '\n');

    // unlocking the lockedusers (guarded so a db failure never crashes the server)
    const unlockJob = scheduler.scheduleJob('0 */60 * * * *', async () => {
        try {
            const response = await authMdl.unlockUsers();
            logBlock('[unlock users job] completed successfully - affected rows:', response?.affectedRows);
        } catch (error) {
            console.error('Unlock users job failed:', error.message);
        }
    });
    logUpcomingJobTime('Unlock users', unlockJob);

    // scheduled messages: at the start of every minute send whatever is due, and once at start-up so
    // messages that fell due while the server was asleep (Render's free plan) go out on wake
    const scheduledService = require('../services/scheduledService');
    const runScheduled = async () => {
        try {
            await scheduledService.runDueSrvc();
        } catch (error) {
            console.error('Scheduled messages job failed:', error.message);
        }
    };
    const scheduledJob = scheduler.scheduleJob('0 * * * * *', runScheduled);
    logUpcomingJobTime('Scheduled messages', scheduledJob);
    setTimeout(runScheduled, 5000);

    // register further jobs (e.g. purging expired OTPs) in the same shape

    log('\n', '=============== end of schedules registry ===============', '\n');

}
