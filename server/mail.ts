/**
 * Outgoing email (password resets). Configure SMTP in .env; a HostGator mailbox works:
 *   SMTP_HOST=mail.yourdomain.com  SMTP_PORT=465  SMTP_USER=noreply@yourdomain.com  SMTP_PASS=...
 * Without SMTP settings, emails are printed to the server log instead of sent.
 */
import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

export const mailConfigured = () => !!process.env.SMTP_HOST;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT ?? 465);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = TLS from the start; 587 = STARTTLS
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export async function sendMail(to: string, subject: string, text: string) {
  if (!mailConfigured()) {
    console.log(`\n[mail] SMTP not configured. Would send to ${to}:\nSubject: ${subject}\n\n${text}\n`);
    return;
  }
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    text,
  });
}
