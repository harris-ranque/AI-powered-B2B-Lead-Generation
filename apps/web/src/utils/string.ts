export function toStandardCase(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(/\s+/)
    .map((word) => {
      if (!word) {
        return "";
      }

      const hasMultipleUpper = /[A-Z].*[A-Z]/.test(word);
      if (hasMultipleUpper) {
        return word;
      }

      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

