import { upsertPeer } from '../db/index'
import { logger } from '../utils/logger'

// libp2p is ESM-only. new Function() prevents tsc from compiling import() to require()
// which breaks ESM-only packages when module=CommonJS.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

async function loadLibp2p() {
  const [
    { createLibp2p },
    { tcp },
    { yamux },
    { noise },
    { kadDHT },
    { ping },
  ] = await Promise.all([
    dynamicImport('libp2p'),
    dynamicImport('@libp2p/tcp'),
    dynamicImport('@chainsafe/libp2p-yamux'),
    dynamicImport('@libp2p/noise'),
    dynamicImport('@libp2p/kad-dht'),
    dynamicImport('@libp2p/ping'),
  ])
  return { createLibp2p, tcp, yamux, noise, kadDHT, ping }
}

interface MeshNode {
  peerId: { toString(): string };
  getMultiaddrs(): Array<{ toString(): string }>;
  getConnections(peerId?: unknown): Array<{ remoteAddr?: { toString(): string } }>;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  addEventListener(event: string, handler: (evt: { detail: { toString(): string } }) => void): void;
  removeEventListener(event: string, handler: (evt: { detail: { toString(): string } }) => void): void;
  _peerConnectListener?: (evt: { detail: { toString(): string } }) => void;
  [key: string]: unknown;
}
let node: MeshNode | null = null;

export async function startMeshNode(): Promise<void> {
  try {
    const { createLibp2p, tcp, yamux, noise, kadDHT, ping } = await loadLibp2p()

    const n = await createLibp2p({
      addresses: { listen: ['/ip4/0.0.0.0/tcp/4001'] },
      transports: [tcp()],
      streamMuxers: [yamux()],
      connectionEncrypters: [noise()],
      connectionManager: { maxConnections: 50 },
      services: { dht: kadDHT({ clientMode: false }), ping: ping() },
    }) as unknown as MeshNode

    await n.start()

    logger.info(
      {
        peerId: n.peerId.toString(),
        addrs: n.getMultiaddrs().map((a) => a.toString()),
      },
      'Mesh node started',
    )

    const onPeerConnect = (evt: { detail: { toString(): string } }) => {
      try {
        const peerId = evt.detail.toString()
        const connections = n.getConnections(evt.detail)
        const addr = connections[0]?.remoteAddr?.toString() ?? ''
        upsertPeer(peerId, addr)
        logger.info({ peerId }, 'Mesh peer connected')
      } catch (err) {
        logger.warn({ err }, 'Mesh: peer:connect handler error — ignored')
      }
    }
    n.addEventListener('peer:connect', onPeerConnect)
    n._peerConnectListener = onPeerConnect
    node = n
  } catch (err) {
    logger.error({ err }, 'Failed to start mesh node — continuing without P2P')
  }
}

export async function stopMeshNode(): Promise<void> {
  if (node) {
    if (node._peerConnectListener) {
      try {
        node.removeEventListener('peer:connect', node._peerConnectListener)
      } catch (err) {
        logger.warn({ err }, 'Mesh: could not remove peer:connect listener')
      }
    }
    try {
      await node.stop()
      logger.info('Mesh node stopped')
    } catch (err) {
      logger.error({ err }, 'Mesh node stop failed — continuing shutdown')
    }
    node = null
  }
}

export function getMeshNode(): MeshNode | null {
  return node
}
