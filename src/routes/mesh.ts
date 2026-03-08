import { Hono } from 'hono'
import { getPeers } from '../db/index'
import { getMeshNode } from '../mesh/node'

const meshRouter = new Hono()

meshRouter.get('/peers', (c) => {
  const meshNode = getMeshNode()
  return c.json({
    nodeId: meshNode?.peerId.toString() ?? null,
    listening: meshNode?.getMultiaddrs().map((a) => a.toString()) ?? [],
    peers: getPeers(),
  })
})

export { meshRouter }
