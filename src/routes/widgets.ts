import { Hono } from 'hono';
import { getDb } from '../db/index';

export const widgetsRouter = new Hono();

// ─── Helpers ────────────────────────────────────────────────────────────────────

interface SkillRow {
  id: string;
  name: string;
  description: string;
  credit_cost: number;
  invoke_count: number;
  avg_rating: number | null;
  rating_count: number;
}

function getSkillRow(skillId: string): SkillRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, name, description, credit_cost, invoke_count, avg_rating, rating_count
       FROM skills WHERE id = ?`,
    )
    .get(skillId) as SkillRow | undefined;
}

function ratingColor(rating: number): string {
  if (rating >= 4.0) return '#4c1';
  if (rating >= 3.0) return '#dfb317';
  return '#e05d44';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── SVG Badge ──────────────────────────────────────────────────────────────────

widgetsRouter.get('/badge/:skillId', (c) => {
  const skill = getSkillRow(c.req.param('skillId'));
  if (!skill) return c.text('Skill not found', 404);

  const rating = skill.avg_rating != null ? skill.avg_rating.toFixed(1) : 'N/A';
  const color = skill.avg_rating != null ? ratingColor(skill.avg_rating) : '#999';
  const leftLabel = 'ClawNet';
  const rightLabel = `${escapeXml(skill.name)} \u2605${rating}`;

  // Approximate character widths (Verdana 11px ~ 7px per char)
  const leftWidth = leftLabel.length * 7 + 14;
  const rightWidth = rightLabel.length * 7 + 14;
  const totalWidth = leftWidth + rightWidth;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
  <rect width="${leftWidth}" height="20" fill="#555"/>
  <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/>
  <text x="${leftWidth / 2}" y="14" fill="#fff" text-anchor="middle" font-family="Verdana" font-size="11">${leftLabel}</text>
  <text x="${leftWidth + rightWidth / 2}" y="14" fill="#fff" text-anchor="middle" font-family="Verdana" font-size="11">${rightLabel}</text>
</svg>`;

  return c.body(svg, 200, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=300',
  });
});

// ─── HTML Card ──────────────────────────────────────────────────────────────────

widgetsRouter.get('/card/:skillId', (c) => {
  const skill = getSkillRow(c.req.param('skillId'));
  if (!skill) return c.text('Skill not found', 404);

  const format = c.req.query('format');
  const rating = skill.avg_rating != null ? skill.avg_rating.toFixed(1) : 'N/A';
  const stars = skill.avg_rating != null
    ? '\u2605'.repeat(Math.round(skill.avg_rating)) + '\u2606'.repeat(5 - Math.round(skill.avg_rating))
    : '\u2606\u2606\u2606\u2606\u2606';

  const cardHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:transparent}
.card{background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:8px;padding:16px;max-width:320px;font-size:14px}
.card-name{font-size:16px;font-weight:600;color:#fff;margin-bottom:4px}
.card-desc{color:#aaa;font-size:12px;margin-bottom:10px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-stats{display:flex;gap:12px;margin-bottom:10px;font-size:12px}
.stat{display:flex;flex-direction:column;align-items:center}
.stat-value{font-weight:600;color:#fff}
.stat-label{color:#888;font-size:10px}
.stars{color:#f5c518;font-size:13px;margin-bottom:8px}
.try-btn{display:inline-block;background:#6c5ce7;color:#fff;text-decoration:none;padding:6px 14px;border-radius:4px;font-size:12px;font-weight:500}
.try-btn:hover{background:#7c6cf7}
.footer{margin-top:10px;text-align:center;font-size:10px;color:#666}
.footer a{color:#888;text-decoration:none}
</style></head>
<body>
<div class="card">
  <div class="card-name">${escapeHtml(skill.name)}</div>
  <div class="card-desc">${escapeHtml(skill.description)}</div>
  <div class="stars">${stars} ${rating}</div>
  <div class="card-stats">
    <div class="stat"><span class="stat-value">${skill.invoke_count.toLocaleString()}</span><span class="stat-label">invocations</span></div>
    <div class="stat"><span class="stat-value">${skill.credit_cost} cr</span><span class="stat-label">per call</span></div>
    <div class="stat"><span class="stat-value">${skill.rating_count}</span><span class="stat-label">ratings</span></div>
  </div>
  <a class="try-btn" href="https://claw-net.org/v1/skills/${encodeURIComponent(skill.id)}/invoke" target="_blank">Try it</a>
  <div class="footer"><a href="https://claw-net.org" target="_blank">Powered by ClawNet</a></div>
</div>
</body></html>`;

  // If format=js, return as a script that injects the card
  if (format === 'js') {
    const escaped = cardHtml.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    const js = `(function(){var d=document.getElementById('clawnet-widget-${escapeHtml(skill.id)}');if(d){d.innerHTML='${escaped}';}})();`;
    return c.body(js, 200, {
      'Content-Type': 'application/javascript',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    });
  }

  return c.html(cardHtml, 200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
  });
});

// ─── Embed Snippet ──────────────────────────────────────────────────────────────

widgetsRouter.get('/embed/:skillId', (c) => {
  const skillId = c.req.param('skillId');
  const skill = getSkillRow(skillId);
  if (!skill) return c.text('Skill not found', 404);

  const snippet = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>ClawNet Widget Embed - ${escapeHtml(skill.name)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#111;color:#e0e0e0;padding:20px}
pre{background:#1a1a2e;border:1px solid #333;border-radius:6px;padding:16px;overflow-x:auto;font-size:13px;color:#a0d0a0}
h2{margin-bottom:12px}
p{color:#aaa;margin-bottom:16px}
</style></head>
<body>
<h2>Embed "${escapeHtml(skill.name)}" widget</h2>
<p>Copy and paste this snippet into your HTML:</p>
<pre>&lt;!-- ClawNet Widget: ${escapeHtml(skill.name)} --&gt;
&lt;div id="clawnet-widget-${escapeHtml(skillId)}"&gt;&lt;/div&gt;
&lt;script src="https://claw-net.org/v1/widgets/card/${encodeURIComponent(skillId)}?format=js"&gt;&lt;/script&gt;</pre>
</body></html>`;

  return c.html(snippet, 200, {
    'Access-Control-Allow-Origin': '*',
  });
});
