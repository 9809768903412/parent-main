const { Resend } = require('resend');

let resendClient = null;

function getResendClient() {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is missing');
  }
  resendClient = new Resend(apiKey);
  return resendClient;
}

function getFromAddress() {
  return process.env.RESEND_FROM || process.env.SMTP_FROM || 'no-reply@impexlink.local';
}

async function sendEmail({ to, subject, text, html }) {
  const from = getFromAddress();
  const client = getResendClient();
  await client.emails.send({ from, to, subject, text, html });
}

async function sendOtpEmail(to, otp) {
  const from = process.env.SMTP_FROM || 'no-reply@impexlink.local';
  const subject = 'ImpexLink login verification code';
  const text = `Your ImpexLink login code is ${otp}. It expires in 10 minutes.`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>ImpexLink Login Verification</h2>
      <p>Use the code below to complete your login:</p>
      <div style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${otp}</div>
      <p>This code expires in 10 minutes.</p>
      <p style="color:#666;font-size:12px;">If you did not attempt to log in, you can ignore this email.</p>
    </div>
  `;
  await sendEmail({ from, to, subject, text, html });
}

async function sendVerificationEmail(to, otp) {
  const from = process.env.SMTP_FROM || 'no-reply@impexlink.local';
  const subject = 'Verify your ImpexLink account';
  const text = `Your ImpexLink verification code is ${otp}. It expires in 15 minutes.`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>Verify your ImpexLink account</h2>
      <p>Use the code below to verify your email:</p>
      <div style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${otp}</div>
      <p>This code expires in 15 minutes.</p>
      <p style="color:#666;font-size:12px;">If you did not request this, ignore this email.</p>
    </div>
  `;
  await sendEmail({ from, to, subject, text, html });
}

async function sendPasswordResetEmail(to, otp) {
  const from = process.env.SMTP_FROM || 'no-reply@impexlink.local';
  const subject = 'Reset your ImpexLink password';
  const text = `Your ImpexLink password reset code is ${otp}. It expires in 15 minutes.`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>Reset your ImpexLink password</h2>
      <p>Use the code below to reset your password:</p>
      <div style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${otp}</div>
      <p>This code expires in 15 minutes.</p>
      <p style="color:#666;font-size:12px;">If you did not request this, ignore this email.</p>
    </div>
  `;
  await sendEmail({ from, to, subject, text, html });
}

module.exports = { sendOtpEmail, sendVerificationEmail, sendPasswordResetEmail };
