/**
 * A phone number in international form: "+" then digits (22 Oct 2026).
 *
 * Avantio sends some guest numbers without the "+" ("420777123456") and some
 * with "00" ("00420…"); the desk types them every way. Agents tap the number
 * to call or WhatsApp, which needs the "+". So every guest phone is stored and
 * shown as "+<digits>": spaces, dashes and brackets go, a leading "00" becomes
 * "+", and a number without either gets the "+" in front. The number itself is
 * not guessed at — a local number without a country code stays wrong, just
 * with a "+" (the desk can correct it).
 */
export function intlPhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const hadPlus = s.startsWith('+');
  let digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (!hadPlus && digits.startsWith('00')) digits = digits.slice(2);
  return digits ? `+${digits}` : null;
}
