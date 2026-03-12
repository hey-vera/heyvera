import { logger } from './logger';
import { escapeHtml } from './html';
import { maskApiKey } from './mask';

const RESEND_API_URL = 'https://api.resend.com/emails';

export async function sendApiKeyEmail(params: {
  to: string;
  apiKey: string;
  credits: number;
  amountPaid: number;
}): Promise<void> {
  const { to, apiKey, credits, amountPaid } = params;
  const from = process.env.RESEND_FROM ?? 'noreply@claw-net.org';
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    logger.warn('RESEND_API_KEY not set — skipping email delivery');
    return;
  }

  const masked = maskApiKey(apiKey);
  const dashboardUrl = 'https://claw-net.org/dashboard.html';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Courier New', monospace; background: #080808; color: #e0e0e0; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; padding: 40px; border: 1px solid #1e1e1e; background: #111; }
    .logo { color: #00ff88; font-size: 20px; font-weight: bold; margin-bottom: 32px; }
    h1 { font-size: 22px; color: #fff; margin: 0 0 8px; }
    .sub { color: #888; font-size: 13px; margin-bottom: 32px; }
    .key-box { background: #000; border: 1px solid #333; padding: 20px; margin: 24px 0; }
    .key-label { color: #555; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
    .key-value { color: #666; font-size: 13px; word-break: break-all; font-family: 'Courier New', monospace; }
    .key-note { color: #555; font-size: 11px; margin-top: 10px; }
    .btn { display: inline-block; background: #00ff88; color: #000 !important; padding: 14px 32px; font-family: 'Courier New', monospace; font-weight: bold; font-size: 14px; text-decoration: none; margin: 24px 0; }
    .footer { margin-top: 40px; padding-top: 24px; border-top: 1px solid #1e1e1e; color: #555; font-size: 11px; }
    a { color: #00ff88; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">&#x1F9AE; ClawNet</div>
    <h1>Your API key is ready.</h1>
    <p class="sub">Thanks for your $${amountPaid} purchase. ${credits.toLocaleString()} credits are loaded and your key is active immediately.</p>

    <div class="key-box">
      <div class="key-label">Your API Key (partially visible)</div>
      <div class="key-value">${masked}</div>
      <div class="key-note">For security, your full key is only shown once in the dashboard. Log in below to copy it.</div>
    </div>

    <a href="${dashboardUrl}" class="btn">View &amp; Copy Your API Key &rarr;</a>

    <table style="width:100%;border-collapse:collapse;border:1px solid #1e1e1e;margin:24px 0">
      <tr>
        <td style="padding:16px;border-right:1px solid #1e1e1e;text-align:center">
          <span style="color:#00ff88;font-size:22px;font-weight:bold;display:block">${credits.toLocaleString()}</span>
          <span style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:1px">Credits Loaded</span>
        </td>
        <td style="padding:16px;border-right:1px solid #1e1e1e;text-align:center">
          <span style="color:#00ff88;font-size:22px;font-weight:bold;display:block">$${amountPaid}</span>
          <span style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:1px">Amount Paid</span>
        </td>
        <td style="padding:16px;text-align:center">
          <span style="color:#00ff88;font-size:22px;font-weight:bold;display:block">Never</span>
          <span style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:1px">Expires</span>
        </td>
      </tr>
    </table>

    <p style="color:#888;font-size:12px">If you lose your key, you can regenerate it anytime from the dashboard. Need more credits? <a href="https://claw-net.org/#pricing">Top up here</a>.</p>

    <div class="footer">
      &copy; 2026 ClawNet &middot; <a href="mailto:hello@claw-net.org">hello@claw-net.org</a><br>
      Your key is tied to this email address. <a href="${dashboardUrl}">Dashboard</a>
    </div>
  </div>
</body>
</html>
`;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: `🦀 Your ClawNet API key — ${credits.toLocaleString()} queries ready`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      logger.error({ to, status: res.status, err }, 'Resend email failed');
      throw new Error(`Resend error ${res.status}: ${err}`);
    }

    logger.info({ to, credits }, 'API key email sent via Resend');
  } catch (err) {
    logger.error({ err, to }, 'Failed to send API key email');
    throw err;
  }
}

export async function sendLowBalanceEmail(params: {
  to: string;
  credits: number;
  apiKey: string;
}): Promise<void> {
  const { to, credits, apiKey } = params;
  const from = process.env.RESEND_FROM ?? 'noreply@claw-net.org';
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) return;

  const maskedKey = maskApiKey(apiKey);
  const topUpUrl = 'https://claw-net.org/#pricing';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Courier New', monospace; background: #080808; color: #e0e0e0; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; padding: 40px; border: 1px solid #1e1e1e; background: #111; }
    .logo { color: #00ff88; font-size: 20px; font-weight: bold; margin-bottom: 32px; }
    h1 { font-size: 22px; color: #fff; margin: 0 0 8px; }
    p { color: #888; font-size: 13px; line-height: 1.6; }
    .balance { background: #0a0a0a; border: 1px solid #ff4444; padding: 20px; margin: 24px 0; text-align: center; }
    .balance-num { color: #ff4444; font-size: 36px; font-weight: bold; display: block; }
    .balance-label { color: #555; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
    .btn { display: inline-block; background: #00ff88; color: #000; padding: 14px 32px; font-family: 'Courier New', monospace; font-weight: bold; font-size: 14px; text-decoration: none; }
    .footer { margin-top: 32px; padding-top: 24px; border-top: 1px solid #1e1e1e; color: #444; font-size: 11px; }
    a { color: #00ff88; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🦀 ClawNet</div>
    <h1>Your credits are running low.</h1>
    <p>Key <code>${maskedKey}</code> has fewer than 500 credits remaining.</p>
    <div class="balance">
      <span class="balance-num">${credits.toLocaleString()}</span>
      <span class="balance-label">Credits Remaining</span>
    </div>
    <p>Top up now to keep your agents running without interruption.</p>
    <a href="${topUpUrl}" class="btn">Top Up Credits →</a>
    <div class="footer">
      © 2026 ClawNet · <a href="mailto:hello@claw-net.org">hello@claw-net.org</a><br>
      You're receiving this because your balance dropped below 500 credits.
    </div>
  </div>
</body>
</html>`;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject: `🦀 ClawNet: only ${credits.toLocaleString()} credits remaining`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      logger.error({ to, status: res.status, err }, 'Low-balance email failed');
    } else {
      logger.info({ to, credits }, 'Low-balance alert email sent');
    }
  } catch (err) {
    logger.error({ err, to }, 'Failed to send low-balance email');
  }
}

export async function sendAdminAlert(params: {
  subject: string;
  body: string;
}): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? 'noreply@claw-net.org';

  if (!adminEmail || !resendKey) return; // silently skip if not configured

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: adminEmail,
        subject: `🦀 ClawNet Admin: ${params.subject}`,
        html: `<pre style="font-family:monospace">${escapeHtml(params.body)}</pre>`,
      }),
    });
  } catch (err) {
    logger.warn({ err }, 'Admin alert email failed');
  }
}