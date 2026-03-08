import { Hono } from 'hono';
import { getDbStats } from '../db/index';
import { cacheStats } from '../cache/index';
import { getUsageStats } from '../utils/usage';
import { getCircuitStats } from '../core/circuit-breaker';
import { env } from '../config/index';

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const adminRouter = new Hono();

adminRouter.get('/dashboard', (c) => {
  const adminKey = c.req.header('X-Admin-Key');
  const expectedKey = env.ADMIN_API_KEY ?? env.API_KEYS?.split(',')[0];
  if (!adminKey || !expectedKey || adminKey !== expectedKey) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }

  const dbStats = getDbStats();
  const cache = cacheStats();
  const usage = getUsageStats();
  const circuits = getCircuitStats();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClawNet Admin Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; }
    h1 { color: #00ff88; margin-bottom: 24px; font-size: 24px; }
    h2 { color: #888; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; }
    .metric { font-size: 32px; font-weight: bold; color: #00ff88; }
    .label { font-size: 12px; color: #666; margin-top: 4px; }
    .table { width: 100%; border-collapse: collapse; }
    .table th { text-align: left; padding: 8px 12px; background: #1a1a1a; color: #666; font-size: 12px; }
    .table td { padding: 8px 12px; border-bottom: 1px solid #1a1a1a; font-size: 13px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
    .badge-green { background: #00ff8820; color: #00ff88; }
    .badge-red { background: #ff444420; color: #ff4444; }
    .badge-yellow { background: #ffaa0020; color: #ffaa00; }
    .section { margin-bottom: 32px; }
    a { color: #00ff88; text-decoration: none; margin-left: 16px; font-size: 14px; }
  </style>
</head>
<body>
  <h1>🦀 ClawNet Admin <a href="javascript:location.reload()">Refresh</a></h1>

  <div class="section">
    <h2>Overview</h2>
    <div class="grid">
      <div class="card">
        <div class="metric">${dbStats?.total ?? usage.total}</div>
        <div class="label">Total Requests</div>
      </div>
      <div class="card">
        <div class="metric">$${dbStats?.totalRevenue ?? usage.totalRevenue}</div>
        <div class="label">Total Revenue (Markup)</div>
      </div>
      <div class="card">
        <div class="metric">${dbStats?.errorRate ?? 0}%</div>
        <div class="label">Error Rate</div>
      </div>
      <div class="card">
        <div class="metric">${dbStats?.avgDurationMs ?? usage.avgDurationMs}ms</div>
        <div class="label">Avg Response Time</div>
      </div>
      <div class="card">
        <div class="metric">${usage.cacheHitRate}%</div>
        <div class="label">Cache Hit Rate</div>
      </div>
      <div class="card">
        <div class="metric">${cache.memory.items}</div>
        <div class="label">Cached Items</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Top Queries</h2>
    <table class="table">
      <tr><th>Query</th><th>Count</th></tr>
      ${dbStats?.topQueries.map((q) => `
        <tr>
          <td>${escapeHtml(q.query.slice(0, 80))}${q.query.length > 80 ? '...' : ''}</td>
          <td>${escapeHtml(String(q.count))}</td>
        </tr>
      `).join('') ?? '<tr><td colspan="2">No data yet</td></tr>'}
    </table>
  </div>

  <div class="section">
    <h2>Circuit Breakers</h2>
    <table class="table">
      <tr><th>Endpoint</th><th>State</th><th>Failures</th></tr>
      ${Object.entries(circuits).map(([id, s]) => `
        <tr>
          <td>${escapeHtml(id)}</td>
          <td><span class="badge ${s.state === 'CLOSED' ? 'badge-green' : s.state === 'OPEN' ? 'badge-red' : 'badge-yellow'}">${escapeHtml(s.state)}</span></td>
          <td>${escapeHtml(String(s.failures))}</td>
        </tr>
      `).join('') || '<tr><td colspan="3">No circuit data yet</td></tr>'}
    </table>
  </div>

  <div class="section">
    <h2>Infrastructure</h2>
    <div class="grid">
      <div class="card">
        <div class="metric">
          <span class="badge ${cache.redisConnected ? 'badge-green' : 'badge-red'}">
            ${cache.redisConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div class="label">Redis</div>
      </div>
      <div class="card">
        <div class="metric">${Math.floor(process.uptime())}s</div>
        <div class="label">Uptime</div>
      </div>
      <div class="card">
        <div class="metric">${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB</div>
        <div class="label">Memory Usage</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Feedback</h2>
    <div class="grid">
      <div class="card">
        <div class="metric">${dbStats?.feedbackCount ?? 0}</div>
        <div class="label">Total Feedback</div>
      </div>
      <div class="card">
        <div class="metric">${dbStats?.avgRating ?? 0}/5</div>
        <div class="label">Average Rating</div>
      </div>
    </div>
  </div>
</body>
</html>`;

  return c.html(html);
});