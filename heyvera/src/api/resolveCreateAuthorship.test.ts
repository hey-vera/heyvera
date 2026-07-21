import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveCreateAuthorship,
  type SocialPage,
} from './social';

function makePage(overrides: Partial<SocialPage> & Pick<SocialPage, 'id' | 'kind'>): SocialPage {
  return {
    handle: 'test',
    displayName: 'Test',
    isDefault: overrides.kind === 'person',
    avatarUrl: null,
    ...overrides,
  };
}

describe('resolveCreateAuthorship', () => {
  it('maps person page to person authorMode', () => {
    const page = makePage({ id: 'profile_1', kind: 'person', isDefault: true });
    expect(resolveCreateAuthorship(page)).toEqual({
      authorMode: 'person',
      pageId: 'profile_1',
    });
  });

  it('maps agent page to agent authorMode + linkedAgentId', () => {
    const page = makePage({
      id: 'agent_9',
      kind: 'agent',
      handle: 'bot',
      displayName: 'Bot',
      parentProfileId: 'profile_1',
    });
    expect(resolveCreateAuthorship(page)).toEqual({
      authorMode: 'agent',
      linkedAgentId: 'agent_9',
      pageId: 'agent_9',
    });
  });

  it('maps brand page to person authorship (v1 steward posts)', () => {
    const page = makePage({
      id: 'brand_3',
      kind: 'brand',
      handle: 'acme',
      displayName: 'Acme',
      parentProfileId: 'profile_1',
    });
    expect(resolveCreateAuthorship(page)).toEqual({
      authorMode: 'person',
      pageId: 'brand_3',
    });
  });
});

describe('listMyPages fetch path', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('calls GET /pages/mine with auth', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        pages: [
          {
            id: 'p1',
            kind: 'person',
            handle: 'alice',
            displayName: 'Alice',
            isDefault: true,
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { listMyPages } = await import('./social');
    const res = await listMyPages('tok-abc');

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/social/pages/mine',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok-abc',
        }),
      }),
    );
    expect(res.pages).toHaveLength(1);
    expect(res.pages[0].kind).toBe('person');
  });
});
