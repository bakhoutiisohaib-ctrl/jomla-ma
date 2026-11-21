import { API } from './config';

// Logical upload references are data, never directly renderable public URLs.
// Reject queries, traversal, encoded separators and externally hosted images.
export function mediaUrl(value) {
  const match = typeof value === 'string' && /^\/uploads\/([A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif))$/i.exec(value);
  return match ? API + '/media/' + match[1] : '';
}
