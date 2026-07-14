// Shared secret redaction for persisted subagent evidence. Every stage must
// use this one implementation so a new token pattern lands everywhere at once.
export function redactSecrets(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/\b(?:gh[pousr]_|sk-)[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /((?:password|secret|token|api[_-]?key|cookie|set-cookie)\s*[=:]\s*)\S+/gi,
      "$1[REDACTED]",
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/]+:)[^@\s]+@/gi, "$1[REDACTED]@");
}
