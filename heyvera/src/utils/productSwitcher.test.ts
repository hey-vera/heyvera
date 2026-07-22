import { describe, expect, it } from 'vitest';
import {
  PRODUCT_SWITCHER_ITEMS,
  getProductSwitcherItem,
  isAgentsSwitcherActive,
  isProductSwitcherNavigable,
  productSwitcherState,
  productSwitcherStateLabel,
} from './productSwitcher';

describe('productSwitcher (12b)', () => {
  it('Social is Active and navigable', () => {
    expect(productSwitcherState('social')).toBe('active');
    expect(productSwitcherStateLabel('social')).toBe('Active');
    expect(isProductSwitcherNavigable('social')).toBe(true);
    expect(getProductSwitcherItem('social')?.route).toBe('/home');
  });

  it('Agents is WIP / gray — never Active', () => {
    expect(productSwitcherState('agents')).toBe('wip');
    expect(productSwitcherStateLabel('agents')).toBe('WIP');
    expect(isProductSwitcherNavigable('agents')).toBe(false);
    expect(isAgentsSwitcherActive()).toBe(false);
    expect(productSwitcherStateLabel('agents').toLowerCase()).not.toContain('active');
  });

  it('canonical list has Social then Agents only as live product claims', () => {
    expect(PRODUCT_SWITCHER_ITEMS.map((p) => p.id)).toEqual(['social', 'agents']);
    const agents = PRODUCT_SWITCHER_ITEMS.find((p) => p.id === 'agents');
    expect(agents?.stateLabel).toBe('WIP');
    expect(agents?.navigable).toBe(false);
    // No fake "Agents Active" string anywhere in catalog.
    for (const item of PRODUCT_SWITCHER_ITEMS) {
      const claim = `${item.label} ${item.stateLabel}`.toLowerCase();
      if (item.id === 'agents') {
        expect(claim).not.toContain('agents active');
      }
    }
  });
});
