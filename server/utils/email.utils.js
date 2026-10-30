const nodemailer = require('nodemailer');

exports.get6DigitOtp = () => {
    return parseInt(Math.random(9) * 1000000);
}

// sends the mail to each address and reports every attempt; recording them in the email log is the
// caller's job (authService), so this util never touches the database
exports.sendEmail = async (mailIds = [], data) => {

    const results = [];

    // EMAIL_SEND_DISABLED=true (the test run): nothing leaves the server, every attempt reports not sent
    if (process.env.EMAIL_SEND_DISABLED === 'true') {
        return mailIds.map((email) => ({ email, success: false, messageId: null, error: { message: 'email sending is disabled' } }));
    }

    try {

        // short timeouts: a mail server that is slow or unreachable (some hosts block outgoing mail) fails
        // within seconds instead of holding the request for nodemailer's default two minutes
        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com', port: 587, secure: false,
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
            connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
        });

        for (const email of mailIds) {
            try {

                //send mail
                const mailRes = await transporter.sendMail({ from: process.env.EMAIL_USER, to: email, subject: data.subject, html: data.body });

                // store response (the full one, for the email log)
                results.push({ email, success: true, messageId: mailRes.messageId, response: mailRes });

            } catch (error) {

                // store response
                results.push({ email, success: false, messageId: null, error });

            }
        }
        return results;
    } catch (error) {
        console.log(error);

        const err = new Error('Unable to send email. Please try again.');
        err.name = 'EmailError';
        throw err;
    }
};
