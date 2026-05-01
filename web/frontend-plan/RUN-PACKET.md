# Run Packet

Use this as the shortest operational checklist.

## Start

From `web/`:

```bash
pwd
aider --model ollama/qwen2.5-coder:14b
```

## In Aider

1. `/read frontend-plan/PACKET-N-EXEC.md`
2. `/add ...` only the packet files
3. prompt: `Build only Packet N from PACKET-N-EXEC.md. Stop after the packet.`

## After Aider Stops

From `web/`:

```bash
npm run proof
npm run status:update -- "Packet N" yes
```

Then:

```bash
git add .
git commit -m "feat: complete packet N"
git push
```

Then stop for review.
