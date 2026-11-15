import { invokeNative, isNative } from './native';
import type { NativeClapParameter } from './nativeAudio';

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
 * Isolated load probe used before inserting a plugin. It returns the controls
 * exposed by the activated and processed CLAP instance.
 */
export async function loadLinuxPlugin(id: string): Promise<NativeClapParameter[]> {
  if (!isNative()) throw new Error('Linux CLAP loading is only available in the desktop app');
  return invokeNative<NativeClapParameter[]>('load_plugin_linux', { id });
}
