import { z } from "zod"

/**
 * YouTube installation connection contract. One admin-managed channel for
 * the whole installation, stored as a single logical row.
 */

export const YOUTUBE_CONNECTION_STATUSES = ["CONNECTED", "REAUTH_REQUIRED", "DISCONNECTED"] as const

export type YoutubeConnectionStatus = (typeof YOUTUBE_CONNECTION_STATUSES)[number]

export const YoutubeConnectionStatusSchema = z.enum(YOUTUBE_CONNECTION_STATUSES)

/**
 * Fixed singleton identifier for `youtube_connections.id`. The table holds
 * at most this one logical row for the installation.
 */
export const SINGLETON_YOUTUBE_CONNECTION_ID = "00000000-0000-4000-8000-000000000001" as const

/**
 * Effective YouTube visibility for uploaded videos. The product contract
 * constrains this to `unlisted`; a `private` result is not READY for
 * ordinary embedded playback.
 */
export const YOUTUBE_PRIVACY_STATUSES = ["unlisted", "private", "public"] as const

export type YoutubePrivacyStatus = (typeof YOUTUBE_PRIVACY_STATUSES)[number]

export const YoutubePrivacyStatusSchema = z.enum(YOUTUBE_PRIVACY_STATUSES)
