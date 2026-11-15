import { useEffect, useState } from 'react';
import { api } from './api.ts';
import type { AppConfig } from '../shared/types.ts';

let configPromise: Promise<AppConfig | null> | null = null;
export const loadConfig = () => (configPromise ??= api.config().catch(() => null));

/** Server settings (registration open, accounts required, public URL). */
export function useConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    loadConfig().then(setConfig);
  }, []);
  return config;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The URL other devices should use. If the host opened the app on localhost,
 * swap in the machine's LAN address so phones scanning the QR code can reach it.
 */
export function useBaseUrl(): string {
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    loadConfig().then(setConfig);
  }, []);
  if (config?.publicUrl) return config.publicUrl.replace(/\/$/, '');
  const { protocol, hostname, port } = window.location;
  const host = LOCAL_HOSTS.has(hostname) && config?.lanAddresses[0] ? config.lanAddresses[0] : hostname;
  return `${protocol}//${host}${port ? ':' + port : ''}`;
}

export function useJoinUrl(code: string) {
  return `${useBaseUrl()}/p/${code}`;
}
