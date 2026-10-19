import { defineConfig } from 'wxt';
import sourceManifest from './manifest.json';

// WXT generates the worker entrypoint; all other metadata uses the source manifest.
const { background, manifest_version, ...manifest } = sourceManifest;
export default defineConfig({ manifest });
