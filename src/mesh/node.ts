import { upsertPeer } from '../db/index'
import { logger } from '../utils/logger'

// libp2p is ESM-only. Dynamic import() uses the ESM resolver at runtime,
// bypassing the CJS ERR_PACKAGE_PATH_NOT_EXPORTED error in Node 22 + tsx.
async function loadLibp2p() {
  const [
    { createLibp2p },
    { tcp },
    { yamux },
    { noise },
    { kadDHT },
    { ping },
  ] = await Promise.all([
    import('libp2p'),
    import('@libp2p/tcp'),
    import('@chainsafe/libp2p-yamux'),
    import('@libp2p/noise'),
    import('@libp2p/kad-dht'),
    import('@libp2p/ping'),
  ])
  return { createLibp2p, tcp, yamux, noise, kadDHT, ping }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let node: any | null = null

export async function startMeshNode(): Promise<void> {
  try {
    const { createLibp2p, tcp, yamux, noise, kadDHT, ping } = await loadLibp2p()

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
        addrs: node.getMultiaddrs().map((a: { toString(): string }) => a.toString()),
      },
      'Mesh node started',
    )

    node.addEventListener('peer:connect', (evt: { detail: { toString(): string } }) => {
      const peerId = evt.detail.toString()
      const connections = node!.getConnections(evt.detail)
      const addr = connections[0]?.remoteAddr?.toString() ?? ''
      upsertPeer(peerId, addr)
      logger.info({ peerId }, 'Mesh peer connected')
    })
  } catch (err) {
    logger.error({ err }, 'Failed to start mesh node — continuing without P2P')
  }
}

export async function stopMeshNode(): Promise<void> {
  if (node) {
    await node.stop()
    logger.info('Mesh node stopped')
    node = null
  }
}

export function getMeshNode(): unknown {
  return node
}
