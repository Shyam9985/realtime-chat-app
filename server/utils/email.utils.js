const nodemailer = require('nodemailer');
const authMdl = require('../models/authMdl');

exports.get6DigitOtp = () => {
    return parseInt(Math.random(9) * 1000000);
}

exports.sendEmail = async (mailIds = [], data, user) => {

    const results = [];

    try {

        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com', port: 587, secure: false,
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
        });

        for (const email of mailIds) {
            try {

                //send mail
                const mailRes = await transporter.sendMail({ from: process.env.EMAIL_USER, to: email, subject: data.subject, html: data.body });

                // insert audit record
                const auditRes = await authMdl.logEMail({ to: email, subject: data.subject, body: data.body, status: 'SUCCESS', messageId: mailRes.messageId, response: mailRes, key: data.key, reason: data.reason }, user);

                // store response
                results.push({ email, success: true, messageId: mailRes.messageId, response: mailRes.response, messageKey: auditRes?.insertId });

            } catch (error) {

                // insert audit record
                const auditRes = await authMdl.logEMail({ to: email, subject: data.subject, body: data.body, status: 'FAILED', response: error, errorMessage: error.message, key: data.key, reason: data.reason }, user);
                // store response
                results.push({ email, success: false, messageId: null, error: error.message, messageKey: auditRes?.insertId });

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