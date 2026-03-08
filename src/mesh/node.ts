import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { yamux } from '@chainsafe/libp2p-yamux'
import { noise } from '@libp2p/noise'
import { kadDHT } from '@libp2p/kad-dht'
import { ping } from '@libp2p/ping'
import { upsertPeer } from '../db/index'
import { logger } from '../utils/logger'

type Libp2pNode = Awaited<ReturnType<typeof createLibp2p>>

let node: Libp2pNode | null = null

export async function startMeshNode(): Promise<void> {
  node = await createLibp2p({
    addresses: { listen: ['/ip4/0.0.0.0/tcp/4001'] },
    transports: [tcp()],
    streamMuxers: [yamux()],
    connectionEncrypters: [noise()],
    services: { dht: kadDHT({ clientMode: false }), ping: ping() },
  })

  await node.start()

  logger.info(
    {
      peerId: node.peerId.toString(),
      addrs: node.getMultiaddrs().map((a) => a.toString()),
    },
    'Mesh node started',
  )

  node.addEventListener('peer:connect', (evt) => {
    const peerId = evt.detail.toString()
    const connections = node!.getConnections(evt.detail)
    const addr = connections[0]?.remoteAddr?.toString() ?? ''
    upsertPeer(peerId, addr)
    logger.info({ peerId }, 'Mesh peer connected')
  })
}

export async function stopMeshNode(): Promise<void> {
  if (node) {
    await node.stop()
    logger.info('Mesh node stopped')
    node = null
  }
}

export function getMeshNode(): Libp2pNode | null {
  return node
}
