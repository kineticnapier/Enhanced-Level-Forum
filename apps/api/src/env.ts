export type Env = {
  HYPERDRIVE: { connectionString: string }
  ENVIRONMENT?: string
  WEB_ORIGIN?: string
  ADMIN_ORIGIN?: string
  /** Development-only bootstrap credentials. Production login ignores them. */
  BOOTSTRAP_ADMIN_EMAIL?: string
  BOOTSTRAP_ADMIN_PASSWORD?: string
  /** Secret salt used to pseudonymize email/IP keys in login rate-limit storage. */
  AUTH_RATE_LIMIT_SALT?: string
}
