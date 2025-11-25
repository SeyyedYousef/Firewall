/**
 * Helper function to safely get acronym for Avatar component
 * Returns undefined if src exists, otherwise returns the acronym or undefined
 */
export function getAvatarAcronym(src: string | undefined | null, acronym: string | undefined | null): string | undefined {
  if (src) {
    return undefined;
  }
  return acronym ?? undefined;
}

/**
 * Generate initials from a name
 */
export function generateInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return '?';
  }
  if (words.length === 1) {
    return words[0]?.charAt(0).toUpperCase() ?? '?';
  }
  return `${words[0]?.charAt(0) ?? ''}${words[1]?.charAt(0) ?? ''}`.toUpperCase();
}
