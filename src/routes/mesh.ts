import { Hono } from 'hono'
import { getPeers } from '../db/index'
import { getMeshNode } from '../mesh/node'
import { checkApiKey } from '../middleware/auth'

const meshRouter = new Hono()

meshRouter.get('/peers', checkApiKey, (c) => {
  // getMeshNode() returns `unknown` to avoid importing ESM-only libp2p types here
  const n = getMeshNode() as { peerId: { toString(): string }; getMultiaddrs(): { toString(): string }[] } | null
  return c.json({
    nodeId: n?.peerId.toString() ?? null,
    listening: n?.getMultiaddrs().map((a) => a.toString()) ?? [],
    peers: getPeers(),
  })
})

export { meshRouter }
