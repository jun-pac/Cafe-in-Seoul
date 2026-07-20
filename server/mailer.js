'use strict';

// Sends admin alert emails (e.g. when a user proposes a cafe/view-spot) via SMTP.
// No-ops gracefully if SMTP env is not configured.
const nodemailer = require('nodemailer');

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, ALERT_EMAIL, ADMIN_EMAILS } = process.env;
const HAS_MAIL = !!(SMTP_HOST && SMTP_USER && SMTP_PASSWORD);

const transport = HAS_MAIL
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465, // 465 = implicit TLS; 587 = STARTTLS
      auth: { user: SMTP_USER, pass: (SMTP_PASSWORD || '').replace(/\s+/g, '') }, // gmail app pw is shown with spaces
    })
  : null;

function recipients() {
  const set = new Set();
  (ALERT_EMAIL || '').split(',').forEach((e) => e.trim() && set.add(e.trim()));
  (ADMIN_EMAILS || '').split(',').forEach((e) => e.trim() && set.add(e.trim()));
  return [...set];
}

async function sendAdminAlert(subject, text) {
  if (!transport) return false;
  const to = recipients();
  if (!to.length) return false;
  try {
    await transport.sendMail({ from: `Cafe in Seoul <${SMTP_USER}>`, to: to.join(','), subject, text });
    return true;
  } catch (e) {
    console.error('admin alert email failed:', e.message);
    return false;
  }
}

module.exports = { sendAdminAlert, HAS_MAIL };
