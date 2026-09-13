/**
 * @speaking-track/youtube — OAuth authorization URL/callback exchange
 * helpers, AES-256-GCM envelope encryption, an authenticated YouTube client
 * factory with an injectable transport, and provider error classification.
 * No HTTP routing, queue processors, or user authorization decisions.
 */

export * from "./crypto"
export * from "./errors"
export * from "./oauth"
export * from "./client"
