const mod = require('../../node_modules/soma-heart/dist/core/crypto-provider.js');
export const DEFAULT_PROVIDER = mod.DEFAULT_PROVIDER;
export const getCryptoProvider: typeof mod.getCryptoProvider = mod.getCryptoProvider;
export const setCryptoProvider: typeof mod.setCryptoProvider = mod.setCryptoProvider;
export const resetCryptoProvider: typeof mod.resetCryptoProvider = mod.resetCryptoProvider;
