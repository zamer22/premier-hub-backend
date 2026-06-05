const DEFAULT_PUBLIC_SUPABASE_URL = "https://supabase.zamer-o.com";

function stripTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function isPrivateHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function getPublicSupabaseBase() {
  const configuredPublicUrl =
    process.env.SUPABASE_PUBLIC_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim();

  if (configuredPublicUrl) return stripTrailingSlash(configuredPublicUrl);

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  if (!supabaseUrl) return DEFAULT_PUBLIC_SUPABASE_URL;

  try {
    const parsed = new URL(supabaseUrl);
    if (process.env.NODE_ENV === "production" && isPrivateHost(parsed.hostname)) {
      return DEFAULT_PUBLIC_SUPABASE_URL;
    }
  } catch {
    return DEFAULT_PUBLIC_SUPABASE_URL;
  }

  return stripTrailingSlash(supabaseUrl);
}

export function normalizeSupabaseSignedUrl(signedUrl: string | null | undefined) {
  if (!signedUrl) return null;

  const withoutPublicPort = signedUrl.replace(
    /^https?:\/\/supabase\.zamer-o\.com(?::\d+)?/i,
    DEFAULT_PUBLIC_SUPABASE_URL,
  );

  try {
    const publicBase = new URL(getPublicSupabaseBase());
    const normalizedUrl = new URL(withoutPublicPort);
    normalizedUrl.protocol = publicBase.protocol;
    normalizedUrl.hostname = publicBase.hostname;
    normalizedUrl.port = publicBase.port;
    return normalizedUrl.toString();
  } catch {
    return withoutPublicPort;
  }
}

export function buildSupabasePublicObjectUrl(bucket: string, path: string) {
  const publicBase = getPublicSupabaseBase();
  const cleanBucket = encodeURIComponent(bucket);
  const cleanPath = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  return `${publicBase}/storage/v1/object/public/${cleanBucket}/${cleanPath}`;
}
