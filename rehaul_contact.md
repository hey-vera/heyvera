# Rehaul: contact-section.html

**Status:** NOT STARTED
**Current file:** `site/contact-section.html` — 193 lines, old design system
**Complexity:** Low
**Reference:** Copy shared design system CSS/nav/footer from `site/index.html`

---

## Overview

Standalone contact form partial. May be included via iframe or used standalone. Simple form: name, email, subject dropdown, message textarea, submit button. Honeypot field for spam prevention.

---

## Structure

### If standalone page:
1. Nav (shared)
2. Centered form card (max-width 600px)
3. Footer (shared)

### If partial (embedded):
Just the form card, no nav/footer.

### Form HTML
```html
<div class="card" style="max-width:600px;margin:0 auto;padding:32px">
  <h2 style="font-family:var(--font-display);font-size:22px;font-weight:600;color:var(--text-primary);margin-bottom:8px">Contact Us</h2>
  <p style="font-size:14px;color:var(--text-tertiary);margin-bottom:24px">Have a question or feedback? We'd love to hear from you.</p>

  <form id="contact-form" onsubmit="return submitContact(event)">
    <div style="margin-bottom:16px">
      <label style="font-size:12px;font-weight:500;color:var(--text-tertiary);display:block;margin-bottom:6px">Name</label>
      <input type="text" class="input" name="name" required style="width:100%">
    </div>
    <div style="margin-bottom:16px">
      <label style="font-size:12px;font-weight:500;color:var(--text-tertiary);display:block;margin-bottom:6px">Email</label>
      <input type="email" class="input" name="email" required style="width:100%">
    </div>
    <div style="margin-bottom:16px">
      <label style="font-size:12px;font-weight:500;color:var(--text-tertiary);display:block;margin-bottom:6px">Subject</label>
      <select class="input" name="subject" required style="width:100%">
        <option value="">Select a topic...</option>
        <option value="billing">Billing & Credits</option>
        <option value="technical">Technical Issue</option>
        <option value="marketplace">Marketplace</option>
        <option value="partnership">Partnership</option>
        <option value="other">Other</option>
      </select>
    </div>
    <div style="margin-bottom:16px">
      <label style="font-size:12px;font-weight:500;color:var(--text-tertiary);display:block;margin-bottom:6px">Message</label>
      <textarea class="input" name="message" required rows="5" style="width:100%;resize:vertical"></textarea>
    </div>
    <!-- Honeypot — hidden from real users -->
    <div style="position:absolute;left:-9999px" aria-hidden="true">
      <input type="text" name="website" tabindex="-1" autocomplete="off">
    </div>
    <button type="submit" class="btn btn-primary" style="width:100%">Send Message</button>
  </form>
  <div id="contact-result" style="display:none;margin-top:16px;padding:12px;border-radius:var(--radius-md);font-size:13px"></div>
</div>
```

---

## Preserve
- Form submission logic (POST to contact endpoint)
- Honeypot field (`name="website"`, hidden)
- Clerk auth gate if present (check current JS)
- Subject dropdown options
- Success/error result display

## Remove
- Inline styles using old color variables
- Monospace font on form fields
- Any `#00ff88` references

---

## Verification Checklist

- [ ] Form renders cleanly
- [ ] All fields validate (required)
- [ ] Honeypot field hidden but present in DOM
- [ ] Submit sends to correct endpoint
- [ ] Success/error states display
- [ ] Input focus states use accent color ring
- [ ] No old design system remnants
