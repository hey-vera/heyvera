# Aider Commands

Use this file when starting a packet with Aider.

## Rule

Enter Aider commands one at a time.

Do not paste command examples, prompt text, and commentary together in
one blob.

## Packet 1

Enter these lines separately:

```text
/read frontend-plan/PACKET-1-EXEC.md
/add src/App.tsx src/index.css
```

Then type this prompt:

```text
Build only Packet 1 from PACKET-1-EXEC.md. Stop after the packet.
```

## Packet 2

Enter these lines separately:

```text
/read frontend-plan/PACKET-2-EXEC.md
/add src/App.tsx src/index.css src/components/Navbar.tsx
```

Then type this prompt:

```text
Build only Packet 2 from PACKET-2-EXEC.md. Stop after the packet.
```

## Packet 3

Enter these lines separately:

```text
/read frontend-plan/PACKET-3-EXEC.md
/add src/App.tsx src/index.css src/components/Navbar.tsx
```

If Packet 2 added section components, add those too.

Then type this prompt:

```text
Build only Packet 3 from PACKET-3-EXEC.md. Stop after the packet.
```

## Wrong Pattern

Do not paste something like this into Aider:

```text
/read ...
/add ...
Prompt:
Build only Packet 2...
```

That makes Aider try to parse plain words as search terms.

## Handoff Commands

After a packet, from `web/` run:

```bash
npm run proof
npm run status:update -- "Packet N" yes
```

Then commit and push.
