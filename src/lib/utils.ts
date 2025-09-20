export function generateId(type: string): string {
  // Use cryptographically secure UUID v4
  const uuid = crypto.randomUUID();
  return `${type}_${uuid}`;
}

/**
 * Generate deterministic ID based on content hash
 * This ensures the same content always gets the same ID
 */
export function generateDeterministicId(type: string, content: string): string {
  const hash = hashString(content);
  return `${type}_${hash}`;
}

/**
 * Simple FNV-1a hash function for consistent ID generation
 */
function hashString(str: string): string {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash *= 16777619; // FNV prime
  }
  // Convert to positive 32-bit hex string
  return (hash >>> 0).toString(16);
}


