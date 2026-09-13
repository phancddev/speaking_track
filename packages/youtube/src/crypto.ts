import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/**
 * AES-256-GCM envelope encryption (plan/02 § youtubeConnections): random
 * nonce per encryption, key version recorded for rotation, tag verified on
 * decrypt. Tampered or wrongly-keyed input fails closed without logging
 * secret material.
 */

export type EncryptedEnvelope = {
  v: number
  nonce: string
  ciphertext: string
  tag: string
}

export const ENVELOPE_VERSION = 1

function deriveKey(encryptionKey: string): Buffer {
  // Keys are configured as base64 (32 bytes) — see .env.example.
  const decoded = Buffer.from(encryptionKey, "base64")
  if (decoded.length === 32) {
    return decoded
  }
  throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY must be base64 for a 256-bit key")
}

export function encryptSecret(value: string, encryptionKey: string): EncryptedEnvelope {
  const key = deriveKey(encryptionKey)
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return {
    v: ENVELOPE_VERSION,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  }
}

export function decryptSecret(envelope: EncryptedEnvelope, encryptionKey: string): string {
  const key = deriveKey(encryptionKey)
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"))
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"))
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    // Fail closed; never surface the key or ciphertext in errors.
    throw new Error("Decryption failed: the stored secret is invalid or the key changed")
  }
}

export function serializeEnvelope(envelope: EncryptedEnvelope): string {
  return JSON.stringify(envelope)
}

export function parseEnvelope(serialized: string): EncryptedEnvelope {
  const parsed = JSON.parse(serialized) as EncryptedEnvelope
  if (
    typeof parsed.v !== "number" ||
    typeof parsed.nonce !== "string" ||
    typeof parsed.ciphertext !== "string" ||
    typeof parsed.tag !== "string"
  ) {
    throw new Error("Malformed encrypted envelope")
  }
  return parsed
}
