export function normalizeNamespace(value: string | undefined, fallback = "service"): string {
  const raw = (value ?? "").trim();
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}
