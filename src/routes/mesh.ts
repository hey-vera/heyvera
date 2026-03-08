import { Hono } from 'hono'
import { getPeers } from '../db/index'
import { getMeshNode } from '../mesh/node'
import { checkApiKey } from '../middleware/auth'

const meshRouter = new Hono()

meshRouter.get('/peers', checkApiKey, (c) => {
  const meshNode = getMeshNode()
  return c.json({
    nodeId: meshNode?.peerId.toString() ?? null,
    listening: meshNode?.getMultiaddrs().map((a) => a.toString()) ?? [],
    peers: getPeers(),
  })
})

export { meshRouter }
