const PRIVATE_BLOCK = /<private>[\s\S]*?<\/private>/gi

/** Whether the text wraps anything in `<private>`. */
export function containsPrivateTag(content: string): boolean {
  PRIVATE_BLOCK.lastIndex = 0
  return PRIVATE_BLOCK.test(content)
}

/** Replace every `<private>` block. The original is never sent to Supermemory. */
export function stripPrivateContent(content: string): string {
  return content.replace(PRIVATE_BLOCK, '[REDACTED]')
}

/** True when redaction leaves nothing worth storing. */
export function isFullyPrivate(content: string): boolean {
  const stripped = stripPrivateContent(content).trim()
  return stripped === '[REDACTED]' || stripped === ''
}
