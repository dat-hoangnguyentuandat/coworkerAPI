import { readFileSync } from 'node:fs';
import { BRIDGE_ACTIVATION_URL } from './branding.js';

// Source tests and the compiled package both resolve their own bundled assets.
const directory = new URL(import.meta.url.endsWith('.ts') ? '../assets/guide/' : '../../assets/guide/', import.meta.url);
export const TOUR_IMAGES = ['create-tunnel.jpg', 'create-api-key.jpg', 'developer-mode.jpg', 'create-plugin.jpg', 'plugin-tools.png'] as const;
export function tourImage(name: typeof TOUR_IMAGES[number]): Buffer {
  return readFileSync(new URL(name, directory));
}

export const TOUR_RESOURCES = {
  'tunnel-setup': {
    links: [
      { href: 'https://platform.openai.com/settings/organization/tunnels', label: 'tour.link.tunnels' },
      { href: 'https://platform.openai.com/settings/organization/api-keys', label: 'tour.link.runtime-keys' },
      { href: 'https://developers.openai.com/api/docs/guides/secure-mcp-tunnels', label: 'tour.link.tunnel-docs' },
    ],
    images: [
      { file: 'create-tunnel.jpg', caption: 'tour.image.tunnel', instruction: 0 },
      { file: 'create-api-key.jpg', caption: 'tour.image.runtime-key', instruction: 1 },
    ],
  },
  plugin: {
    links: [
      { href: 'https://chatgpt.com/', label: 'tour.link.chatgpt-settings' },
      { href: 'https://chatgpt.com/plugins', label: 'tour.link.plugins' },
    ],
    images: [
      { file: 'developer-mode.jpg', caption: 'tour.image.developer-mode', instruction: 1 },
      { file: 'create-plugin.jpg', caption: 'tour.image.plugin', instruction: 2 },
      { file: 'plugin-tools.png', caption: 'tour.image.plugin-tools', instruction: 3 },
    ],
  },
  activate: { links: [{ href: BRIDGE_ACTIVATION_URL, label: 'tour.link.activate' }], images: [] },
};
