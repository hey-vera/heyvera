/**
 * Wave 12b — pure product-switcher state (TopBar).
 * Social is Active; Agents stays WIP/gray — never "Agents Active".
 */

export type ProductSwitcherState = 'active' | 'wip' | 'soon';

export type ProductSwitcherItem = {
  id: 'social' | 'agents';
  label: string;
  /** Display state badge: Active | WIP | Soon */
  state: ProductSwitcherState;
  stateLabel: string;
  navigable: boolean;
  route?: string;
};

/** Canonical product list for the TopBar product switcher. */
export const PRODUCT_SWITCHER_ITEMS: ReadonlyArray<ProductSwitcherItem> = [
  {
    id: 'social',
    label: 'Social',
    state: 'active',
    stateLabel: 'Active',
    navigable: true,
    route: '/home',
  },
  {
    id: 'agents',
    label: 'Agents',
    state: 'wip',
    stateLabel: 'WIP',
    navigable: false,
  },
];

/** Resolve product by id. */
export function getProductSwitcherItem(
  id: ProductSwitcherItem['id'],
): ProductSwitcherItem | undefined {
  return PRODUCT_SWITCHER_ITEMS.find((p) => p.id === id);
}

/**
 * Display state for a product id.
 * Agents is always WIP until a real product surface ships.
 */
export function productSwitcherState(
  id: ProductSwitcherItem['id'],
): ProductSwitcherState {
  return getProductSwitcherItem(id)?.state ?? 'wip';
}

/** Human-readable badge for a product (never invents "Active" for Agents). */
export function productSwitcherStateLabel(id: ProductSwitcherItem['id']): string {
  const item = getProductSwitcherItem(id);
  if (!item) return 'WIP';
  return item.stateLabel;
}

/** Whether the product can navigate in the switcher. */
export function isProductSwitcherNavigable(id: ProductSwitcherItem['id']): boolean {
  return getProductSwitcherItem(id)?.navigable === true;
}

/**
 * True only when the Agents product may show an Active claim.
 * Wave 12: always false.
 */
export function isAgentsSwitcherActive(): boolean {
  return productSwitcherState('agents') === 'active';
}
