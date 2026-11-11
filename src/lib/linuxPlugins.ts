import { invokeNative, isNative } from './native';

/** One CLAP descriptor returned by the Linux sidecar. */
export interface LinuxClapPlugin {
  id: string;
  name: string;
  vendor: string;
}

/**
 * Ask the Linux sidecar to scan the standard CLAP paths. The caller should
 * check `nativePlatform()` first so Windows/macOS never show a Linux-only
 * failure.
 */
export async function scanLinuxPlugins(): Promise<LinuxClapPlugin[]> {
  if (!isNative()) throw new Error('Linux CLAP scanning is only available in the desktop app');
  return invokeNative<LinuxClapPlugin[]>('scan_plugins_linux');
}

/**
 * Load one scanned plugin into the sidecar. `READY` means the instance was
 * created and activated; it does not yet mean the plugin is in the mixer.
 */
export async function loadLinuxPlugin(id: string): Promise<string> {
  if (!isNative()) throw new Error('Linux CLAP loading is only available in the desktop app');
  return invokeNative<string>('load_plugin_linux', { id });
}
