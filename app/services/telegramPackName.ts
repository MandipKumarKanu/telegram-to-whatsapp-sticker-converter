const PACK_NAME_REGEX = /^[A-Za-z0-9_]+$/;

const normalizeCandidate = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim().replace(/^@+/, "");
  if (!trimmed) return null;
  return PACK_NAME_REGEX.test(trimmed) ? trimmed : null;
};

const extractFromPath = (path: string): string | null => {
  const cleanPath = path.replace(/[#?].*$/, "").replace(/^\/+|\/+$/g, "");
  if (!cleanPath) return null;

  const segments = cleanPath.split("/").filter(Boolean);
  if (!segments.length) return null;

  const markerIndex = segments.findIndex((segment) => {
    const lower = segment.toLowerCase();
    return lower === "addstickers" || lower === "stickers";
  });

  const markerCandidate = markerIndex >= 0 ? segments[markerIndex + 1] : null;
  const tailCandidate = segments[segments.length - 1];
  return normalizeCandidate(markerCandidate) || normalizeCandidate(tailCandidate);
};

export const extractTelegramPackName = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const directCandidate = normalizeCandidate(trimmed);
  if (directCandidate) {
    return directCandidate;
  }

  try {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    const pathMatch = extractFromPath(parsed.pathname);
    if (pathMatch) {
      return pathMatch;
    }
  } catch {
    // Fall through to path parsing from non-URL input.
  }

  return extractFromPath(trimmed);
};