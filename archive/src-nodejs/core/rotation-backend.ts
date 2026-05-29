import { ClawNetApiKeyBackend } from './api-key-rotation';

let _backend: ClawNetApiKeyBackend | null = null;

export function getRotationBackend(): ClawNetApiKeyBackend {
  if (!_backend) _backend = new ClawNetApiKeyBackend();
  return _backend;
}

export function _resetRotationBackendForTests(): void {
  _backend = null;
}
