import { logger } from './logger';

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
    .key-box { background: #000; border: 1px solid #00ff88; padding: 20px; margin: 24px 0; }
    .key-label { color: #555; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
    .key-value { color: #00ff88; font-size: 14px; word-break: break-all; }
    .stats { display: flex; gap: 0; margin: 24px 0; border: 1px solid #1e1e1e; }
    .stat { flex: 1; padding: 16px; border-right: 1px solid #1e1e1e; text-align: center; }
    .stat:last-child { border-right: none; }
    .stat-num { color: #00ff88; font-size: 22px; font-weight: bold; display: block; }
    .stat-label { color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
    .code-block { background: #000; border: 1px solid #1e1e1e; padding: 16px; font-size: 12px; color: #888; margin: 24px 0; overflow-x: auto; }
    .code-block span { color: #00ff88; }
    .footer { margin-top: 40px; padding-top: 24px; border-top: 1px solid #1e1e1e; color: #555; font-size: 11px; }
    a { color: #00ff88; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🦀 ClawNet</div>
    <h1>Your API key is ready.</h1>
    <p class="sub">Thanks for your $${amountPaid} purchase. Your credits have been loaded and your key is active immediately.</p>

    <div class="key-box">
      <div class="key-label">Your API Key</div>
      <div class="key-value">${apiKey}</div>
    </div>

    <table style="width:100%;border-collapse:collapse;border:1px solid #1e1e1e;margin:24px 0">
      <tr>
        <td style="padding:16px;border-right:1px solid #1e1e1e;text-align:center">
          <span style="color:#00ff88;font-size:22px;font-weight:bold;display:block">${credits.toLocaleString()}</span>
          <span style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:1px">Queries Available</span>
        </td>
        <td style="padding:16px;border-right:1px solid #1e1e1e;text-align:center">
          <span style="color:#00ff88;font-size:22px;font-weight:bold;display:block">$${amountPaid}</span>
          <span style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:1px">Credits Loaded</span>
        </td>
        <td style="padding:16px;text-align:center">
          <span style="color:#00ff88;font-size:22px;font-weight:bold;display:block">Never</span>
          <span style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:1px">Expires</span>
        </td>
      </tr>
    </table>

    <p style="color:#888;font-size:12px;margin-bottom:8px">Start immediately:</p>
    <div class="code-block">
curl -X POST https://api.claw-net.org/v1/orchestrate \<br>
&nbsp;&nbsp;-H <span>"X-API-Key: ${apiKey}"</span> \<br>
&nbsp;&nbsp;-H <span>"Content-Type: application/json"</span> \<br>
&nbsp;&nbsp;-d <span>'{"query":"Is BONK safe to buy right now?"}'</span>
    </div>

    <p style="color:#888;font-size:12px">Check your balance anytime: <a href="https://api.claw-net.org/v1/balance">api.claw-net.org/v1/balance</a></p>
    <p style="color:#888;font-size:12px">Need more credits? <a href="https://buy.stripe.com/fZufZigsDgva6HZ5Vk08g00">Top up here</a></p>

    <div class="footer">
      © 2026 ClawNet · <a href="mailto:hello@claw-net.org">hello@claw-net.org</a><br>
      Keep this email — your API key is only sent once.
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