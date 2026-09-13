/**
 * @speaking-track/storage — private S3-compatible object operations:
 * deterministic object keys, presigned PUT (signed for the public endpoint),
 * stat, stream, and delete, with provider config validation from env-shaped
 * records. No authorization decisions; no sockets at import.
 */

export * from "./config"
export * from "./errors"
export * from "./storage"
