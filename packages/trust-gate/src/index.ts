/**
 * @aidprotocol/trust-gate — GitHub Action for AID trust scoring
 *
 * Checks an agent's AID trust score before deployment.
 * Blocks the deploy if trust drops below the configured threshold.
 *
 * Usage in .github/workflows/deploy.yml:
 *
 *   - name: Check agent trust
 *     uses: aidprotocol/trust-gate@v1
 *     with:
 *       did: ${{ secrets.AGENT_DID }}
 *       min-score: '60'
 *
 *   - name: Deploy (only if trust gate passed)
 *     if: steps.trust.outputs.passed == 'true'
 *     run: npm run deploy
 */

interface TrustResponse {
  trustScore?: number;
  score?: number;
  verdict?: string;
  attestationCount?: number;
  capabilities?: string[];
}

async function run(): Promise<void> {
  // Read inputs from environment (GitHub Actions sets INPUT_ env vars)
  const did = process.env.INPUT_DID || '';
  const minScore = parseInt(process.env['INPUT_MIN-SCORE'] || '40', 10);
  const apiUrl = process.env['INPUT_API-URL'] || 'https://api.claw-net.org';
  const failOnError = (process.env['INPUT_FAIL-ON-ERROR'] || 'true') === 'true';

  if (!did) {
    setFailed('Input "did" is required');
    return;
  }

  if (!did.startsWith('did:')) {
    setFailed(`Invalid DID format: ${did}`);
    return;
  }

  console.log(`🔍 Checking AID trust score for ${did}`);
  console.log(`   Minimum required: ${minScore}`);
  console.log(`   API: ${apiUrl}`);

  try {
    const url = `${apiUrl}/v1/aid/${encodeURIComponent(did)}/trust`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'aidprotocol/trust-gate' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const msg = `Trust API returned ${res.status}: ${res.statusText}`;
      if (failOnError) {
        setFailed(msg);
      } else {
        console.log(`⚠️  ${msg} — continuing (fail-on-error: false)`);
        setOutput('passed', 'false');
        setOutput('score', '0');
        setOutput('verdict', 'unknown');
      }
      return;
    }

    const data = (await res.json()) as TrustResponse;
    const score = data.trustScore ?? data.score ?? 0;
    const verdict = data.verdict ?? 'new';
    const attestationCount = data.attestationCount ?? 0;

    // Set outputs
    setOutput('score', String(score));
    setOutput('verdict', verdict);
    setOutput('attestation-count', String(attestationCount));

    const passed = score >= minScore;
    setOutput('passed', String(passed));

    if (passed) {
      console.log(`✅ Trust gate PASSED — score: ${score} (${verdict}), attestations: ${attestationCount}`);
    } else {
      const msg = `Trust gate FAILED — score: ${score} (${verdict}) < minimum ${minScore}`;
      console.log(`❌ ${msg}`);
      setFailed(msg);
    }
  } catch (err: any) {
    const msg = `Trust API error: ${err.message || err}`;
    if (failOnError) {
      setFailed(msg);
    } else {
      console.log(`⚠️  ${msg} — continuing (fail-on-error: false)`);
      setOutput('passed', 'false');
      setOutput('score', '0');
      setOutput('verdict', 'unknown');
    }
  }
}

// ─── GitHub Actions helpers (no @actions/core dependency) ───────────────────

function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const fs = require('fs');
    fs.appendFileSync(outputFile, `${name}=${value}\n`);
  }
  // Also log for local testing
  console.log(`  ::set-output name=${name}::${value}`);
}

function setFailed(message: string): void {
  console.log(`::error::${message}`);
  process.exitCode = 1;
}

run();
