// ponytail: simple djb2 hash, upgrade to crypto if collision rates matter
const PALETTE = [
  "--color-banana-yellow",
  "--color-bubblegum-pink",
  "--color-mint-green",
  "--color-electric-blue",
] as const;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0]!.toUpperCase();
  if (parts.length === 1) return first;
  return first + parts[parts.length - 1]![0]!.toUpperCase();
}

export function colorFor(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (h * 33) ^ seed.charCodeAt(i);
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}
