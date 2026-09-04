import { PmsTenantConfig } from './interfaces/pms-adapter.interface';
import { decryptSecret } from './crypto';

/**
 * One place where a tenant row becomes PMS credentials.
 *
 * Every caller used to build this literal itself, which meant the decrypt step
 * would have had to be added in seven places and remembered in the eighth. The
 * eighth is the one that sends an encrypted string to Avantio as if it were a
 * key.
 *
 * Returns null when the tenant has no credentials configured, so callers keep
 * the same "not configured" branch they already had. Throws only when a key is
 * present and cannot be decrypted — a real fault, not a missing config.
 */
export function pmsConfigFor(tenant: {
  pmsApiBaseUrl: string | null;
  pmsApiKey: string | null;
}): PmsTenantConfig | null {
  if (!tenant.pmsApiBaseUrl || !tenant.pmsApiKey) return null;
  return {
    apiBaseUrl: tenant.pmsApiBaseUrl,
    apiKey: decryptSecret(tenant.pmsApiKey),
  };
}
