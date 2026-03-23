# AID Trust Gate — GitHub Action

Check an agent's AID trust score before deploying. Block deploys if trust drops below threshold.

## Usage

```yaml
# .github/workflows/deploy.yml
name: Deploy with Trust Gate
on: push

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check agent trust score
        id: trust
        uses: aidprotocol/trust-gate@v1
        with:
          did: ${{ secrets.AGENT_DID }}
          min-score: '60'

      - name: Deploy
        if: steps.trust.outputs.passed == 'true'
        run: npm run deploy

      - name: Report trust score
        run: |
          echo "Trust score: ${{ steps.trust.outputs.score }}"
          echo "Verdict: ${{ steps.trust.outputs.verdict }}"
          echo "Attestations: ${{ steps.trust.outputs.attestation-count }}"
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `did` | Yes | — | Agent DID to check (`did:key:z...`) |
| `min-score` | No | `40` | Minimum trust score required (0-100) |
| `api-url` | No | `https://api.claw-net.org` | AID trust API URL |
| `fail-on-error` | No | `true` | Fail the step if trust API is unreachable |

## Outputs

| Output | Description |
|--------|-------------|
| `score` | Current trust score (0-100) |
| `verdict` | Trust verdict (`new`, `building`, `caution`, `standard`, `trusted`, `proceed`) |
| `passed` | Whether the trust gate passed (`true`/`false`) |
| `attestation-count` | Number of attestations on record |

## How It Works

1. Queries the AID trust API for the agent's current trust score
2. Compares score against `min-score` threshold
3. Sets outputs with score, verdict, and pass/fail status
4. Fails the step if score is below threshold (blocking the deploy)

No dependencies, no private keys needed — just a DID and a public API call.

## License

MIT — [AID Protocol](https://aidprotocol.org)
