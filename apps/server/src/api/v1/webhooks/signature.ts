/**
 * HMAC-SHA256 webhook signature utilities.
 *
 * The signature is computed over the exact request body bytes with the
 * subscription's signing secret and transmitted in the `X-Votion-Signature`
 * header. `verifyWebhookSignature` accepts both the bare hex digest and the
 * `sha256=<hex>` prefixed form used by GitHub-style integrations.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header carrying the HMAC signature. */
export const SIGNATURE_HEADER = 'x-votion-signature';

/** Computes the hex HMAC-SHA256 digest of `payload` with `secret`. */
export function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/** Normalises a presented signature (strips an optional `sha256=` prefix). */
export function normalizeSignature(signature: string): string {
  const trimmed = signature.trim();
  return trimmed.startsWith('sha256=') ? trimmed.slice('sha256='.length) : trimmed;
}

/** Constant-time comparison of two hex digests. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Verifies a presented signature against the expected HMAC. */
export function verifyWebhookSignature(
  payload: string,
  secret: string,
  signature: string,
): boolean {
  if (!signature) {
    return false;
  }
  const expected = signPayload(payload, secret);
  return safeEqual(expected, normalizeSignature(signature));
}
