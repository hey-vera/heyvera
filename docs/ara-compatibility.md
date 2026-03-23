# ARA Compatibility Evaluation (Flaw 16)

## What is ARA?

AWS AI Registry for Agents — an open spec for agent artifact packaging and discovery. Published February 25, 2026 by AWS.

ARA defines how to package agent metadata (name, description, capabilities, endpoints) into a standard format that registries can index and search.

## AID ↔ ARA Compatibility

AID agent metadata is expressible as an ARA artifact. The mapping is straightforward:

| ARA Field | AID Equivalent |
|-----------|---------------|
| `agentId` | `did` (did:key:z...) |
| `name` | `displayName` from aid_keys |
| `description` | From heartbeat service listing |
| `capabilities` | From `aid_capabilities` table |
| `endpoints` | From heartbeat `services` array |
| `version` | AID protocol version (1.0.0) |
| `metadata` | AID trust extension (score, verdict, attestations) |

## Integration Approach

**Phase 2 target:** Add ARA-compatible metadata export.

```
GET /v1/aid/:did/ara → returns AID agent data in ARA artifact format
```

The AID trust extension goes into ARA's `metadata` field:
```json
{
  "agentId": "did:key:z6Mk...",
  "name": "My Trading Agent",
  "metadata": {
    "aidTrust": {
      "trustScore": 87,
      "verdict": "trusted",
      "attestationCount": 1247,
      "heartbeatUrl": "https://api.claw-net.org/aid/heartbeat"
    }
  }
}
```

## Assessment

ARA is complementary — it's a packaging format, not a trust layer. AID provides the trust data that ARA packages carry. No conflict, natural integration point.

**Priority:** Low. ARA adoption is early. Build when AWS shows real traction with ARA in agent marketplaces.

**Effort:** ~1 day (simple JSON mapping endpoint).
