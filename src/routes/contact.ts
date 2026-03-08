// src/routes/contact.ts
import { Hono } from 'hono'
import { z } from 'zod'
import { Resend } from 'resend'
import { logger } from '../utils/logger'

const contact = new Hono()

const ContactSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().max(254).trim().toLowerCase(),
  subject: z.enum(['general', 'billing', 'technical', 'partnership', 'other']),
  message: z.string().min(10).max(2000).trim(),
  website: z.string().max(0).optional(),
})

type ContactInput = z.infer<typeof ContactSchema>

const SUBJECT_LABELS: Record<ContactInput['subject'], string> = {
  general: 'General Inquiry',
  billing: 'Billing & Credits',
  technical: 'Technical Support',
  partnership: 'Partnership',
  other: 'Other',
}

// In-memory rate limiter: max 3 submissions per IP per 10 minutes
const submissionLog = new Map<string, number[]>()
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 3

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const timestamps = (submissionLog.get(ip) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS
  )
  if (timestamps.length >= RATE_MAX) return true
  timestamps.push(now)
  submissionLog.set(ip, timestamps)
  return false
}

setInterval(() => {
  const now = Date.now()
  for (const [ip, timestamps] of submissionLog.entries()) {
    const fresh = timestamps.filter((t) => now - t < RATE_WINDOW_MS)
    if (fresh.length === 0) submissionLog.delete(ip)
    else submissionLog.set(ip, fresh)
  }
}, 60 * 60 * 1000)

contact.post('/v1/contact', async (c) => {
  // Parse + validate body manually
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400)
  }

  const parsed = ContactSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid submission', details: parsed.error.flatten().fieldErrors },
      400
    )
  }

  const data = parsed.data

  // Honeypot check
  if (data.website && data.website.length > 0) {
    logger.warn({ msg: 'Honeypot triggered on contact form' })
    return c.json({ ok: true, message: 'Message received.' })
  }

  // Rate limit by IP
  const ip =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
    'unknown'

  if (isRateLimited(ip)) {
    return c.json(
      { error: 'Too many submissions. Please wait 10 minutes and try again.' },
      429
    )
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@claw-net.org'
  const subjectLabel = SUBJECT_LABELS[data.subject]
  const timestamp = new Date().toISOString()

  try {
    // 1. Notify admin
    await resend.emails.send({
      from: process.env.RESEND_FROM ?? 'noreply@claw-net.org',
      to: adminEmail,
      replyTo: data.email,
      subject: `[ClawNet Contact] ${subjectLabel} from ${data.name}`,
      html: `
        <div style="font-family:monospace;max-width:600px;padding:24px;background:#0a0a0a;color:#e0e0e0;border:1px solid #1a1a1a;border-radius:8px;">
          <h2 style="color:#00ff88;margin-top:0;">New Contact Form Submission</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:6px 0;color:#888;width:100px;">Name</td><td style="color:#fff;">${escapeHtml(data.name)}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Email</td><td><a href="mailto:${escapeHtml(data.email)}" style="color:#00ff88;">${escapeHtml(data.email)}</a></td></tr>
            <tr><td style="padding:6px 0;color:#888;">Subject</td><td style="color:#fff;">${subjectLabel}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">IP</td><td style="color:#555;font-size:12px;">${ip}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Time</td><td style="color:#555;font-size:12px;">${timestamp}</td></tr>
          </table>
          <div style="margin-top:16px;padding:16px;background:#111;border-left:3px solid #00ff88;border-radius:4px;">
            <p style="margin:0;white-space:pre-wrap;color:#e0e0e0;">${escapeHtml(data.message)}</p>
          </div>
          <p style="margin-top:16px;font-size:12px;color:#555;">Hit reply to respond directly to ${escapeHtml(data.name)}.</p>
        </div>
      `,
    })

    // 2. Confirmation to submitter
    await resend.emails.send({
      from: process.env.RESEND_FROM ?? 'noreply@claw-net.org',
      to: data.email,
      subject: `We received your message — ClawNet`,
      html: `
        <div style="font-family:monospace;max-width:600px;padding:24px;background:#0a0a0a;color:#e0e0e0;border:1px solid #1a1a1a;border-radius:8px;">
          <h2 style="color:#00ff88;margin-top:0;">Message received, ${escapeHtml(data.name)}.</h2>
          <p style="color:#aaa;line-height:1.6;">
            Thanks for reaching out about <strong style="color:#fff;">${subjectLabel}</strong>.<br>
            We typically respond within 24–48 hours.
          </p>
          <div style="margin-top:16px;padding:16px;background:#111;border-left:3px solid #333;border-radius:4px;">
            <p style="margin:0;font-size:13px;color:#666;white-space:pre-wrap;">${escapeHtml(data.message)}</p>
          </div>
          <hr style="border:none;border-top:1px solid #1a1a1a;margin:24px 0;" />
          <p style="font-size:12px;color:#555;margin:0;">
            ClawNet · <a href="https://claw-net.org" style="color:#00ff88;">claw-net.org</a>
          </p>
        </div>
      `,
    })

    logger.info({ msg: 'Contact form submitted', subject: data.subject, ip })
    return c.json({ ok: true, message: "Message sent. We'll be in touch within 24–48 hours." })
  } catch (err) {
    logger.error({ msg: 'Contact form email failed', err })
    return c.json({ error: 'Failed to send message. Please try again or email us directly.' }, 500)
  }
})

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export { contact as contactRoute }