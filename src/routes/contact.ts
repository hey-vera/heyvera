// src/routes/contact.ts
import { Hono } from 'hono'
import { z } from 'zod'
import { Resend } from 'resend'
import { logger } from '../utils/logger'
import { verifyToken } from '@clerk/backend'
import { env } from '../config/index'

const contact = new Hono()

const ContactSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().max(254).trim().toLowerCase(),
  subject: z.enum(['general', 'billing', 'technical', 'partnership', 'other']),
  message: z.string().min(10).max(2000).trim(),
  website: z.string().optional(),
})

type ContactInput = z.infer<typeof ContactSchema>

const SUBJECT_LABELS: Record<ContactInput['subject'], string> = {
  general: 'General Inquiry',
  billing: 'Billing & Credits',
  technical: 'Technical Support',
  partnership: 'Partnership',
  other: 'Other',
}

// In-memory rate limiter: max 3 submissions per user per 10 minutes
const submissionLog = new Map<string, number[]>()
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 3

const MAX_TRACKED_KEYS = 50_000

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const timestamps = (submissionLog.get(key) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS
  )
  if (timestamps.length >= RATE_MAX) return true
  timestamps.push(now)
  // Prevent unbounded memory growth from unique keys
  if (submissionLog.size >= MAX_TRACKED_KEYS && !submissionLog.has(key)) {
    const oldest = submissionLog.keys().next().value
    if (oldest) submissionLog.delete(oldest)
  }
  submissionLog.set(key, timestamps)
  return false
}

setInterval(() => {
  const now = Date.now()
  for (const [key, timestamps] of submissionLog.entries()) {
    const fresh = timestamps.filter((t) => now - t < RATE_WINDOW_MS)
    if (fresh.length === 0) submissionLog.delete(key)
    else submissionLog.set(key, fresh)
  }
}, 60 * 60 * 1000)

contact.post('/v1/contact', async (c) => {
  // 1. Require Clerk JWT
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required. Please sign in to contact support.' }, 401)
  }

  const token = authHeader.slice(7)
  let verifiedEmail: string
  let verifiedUserId: string

  try {
    const payload = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY ?? '',
    })
    verifiedUserId = payload.sub
    verifiedEmail = ((payload as any).email ?? '').toLowerCase()
    // Wallet users have no email in JWT — allowed through, use form-supplied email
  } catch {
    return c.json({ error: 'Invalid or expired session. Please sign in again.' }, 401)
  }

  // 2. Parse + validate body
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

  // 3. Honeypot check
  if (data.website && data.website.length > 0) {
    logger.warn({ msg: 'Honeypot triggered on contact form' })
    return c.json({ ok: true, message: 'Message received.' })
  }

  // 4. Rate limit by verified user ID — not IP, not submitted email
  if (isRateLimited(verifiedUserId)) {
    return c.json(
      { error: 'Too many submissions. Please wait 10 minutes and try again.' },
      429
    )
  }

  const resend = new Resend(env.RESEND_API_KEY)
  const adminEmail = env.ADMIN_EMAIL ?? 'admin@claw-net.org'
  const subjectLabel = SUBJECT_LABELS[data.subject]
  const timestamp = new Date().toISOString()

  try {
    // Notify admin — email is verified, safe to trust
    const replyToEmail = verifiedEmail || data.email
    const authProvider = verifiedEmail ? 'Google / GitHub (verified)' : 'Solana wallet (Web3)'
    const emailDisplay = verifiedEmail
      ? `${escapeHtml(verifiedEmail)} <span style="color:#555;font-size:11px;">(verified via Clerk)</span>`
      : `${escapeHtml(data.email)} <span style="color:#ffaa00;font-size:11px;">(user-supplied — wallet user)</span>`

    await resend.emails.send({
      from: env.RESEND_FROM ?? 'noreply@claw-net.org',
      to: adminEmail,
      replyTo: replyToEmail,
      subject: `[ClawNet Contact] ${subjectLabel} from ${data.name}`,
      html: `
        <div style="font-family:monospace;max-width:600px;padding:24px;background:#0a0a0a;color:#e0e0e0;border:1px solid #1a1a1a;border-radius:8px;">
          <h2 style="color:#00ff88;margin-top:0;">New Contact Form Submission</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:6px 0;color:#888;width:120px;">Name</td><td style="color:#fff;">${escapeHtml(data.name)}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Reply-to</td><td>${emailDisplay}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Auth via</td><td style="color:#fff;">${authProvider}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Subject</td><td style="color:#fff;">${subjectLabel}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Clerk ID</td><td style="color:#555;font-size:12px;">${verifiedUserId}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Time</td><td style="color:#555;font-size:12px;">${timestamp}</td></tr>
          </table>
          <div style="margin-top:16px;padding:16px;background:#111;border-left:3px solid #00ff88;border-radius:4px;">
            <p style="margin:0;white-space:pre-wrap;color:#e0e0e0;">${escapeHtml(data.message)}</p>
          </div>
          <p style="margin-top:16px;font-size:12px;color:#555;">Hit reply to respond directly to ${escapeHtml(data.name)}.</p>
        </div>
      `,
    })

// Confirmation to user — only if we have a verified email (wallet users may not)
    const confirmTo = verifiedEmail || data.email
    if (confirmTo) await resend.emails.send({
      from: env.RESEND_FROM ?? 'noreply@claw-net.org',
      to: confirmTo,
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

    logger.info({ msg: 'Contact form submitted', subject: data.subject, userId: verifiedUserId })
    return c.json({ ok: true, message: "Message sent. We'll be in touch within 24–48 hours." })
  } catch (err) {
    logger.error({ msg: 'Contact form email failed', err })
    return c.json({ error: 'Failed to send message. Please try again.' }, 500)
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