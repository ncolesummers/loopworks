const HTTPS_HOSTS = new Set(["github.com", "www.github.com", "vercel.com", "www.vercel.com"]);
const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isAllowedHttpsHost(hostname: string) {
  return HTTPS_HOSTS.has(hostname) || hostname === "vercel.app" || hostname.endsWith(".vercel.app");
}

function isAllowedArtifactReference(url: URL) {
  return (
    url.protocol === "artifact:" &&
    url.hostname === "validation" &&
    url.pathname.startsWith("/") &&
    !url.username &&
    !url.password
  );
}

export function getSafeExternalHref(href: string | undefined | null) {
  const value = href?.trim();

  if (!value || value === "pending") {
    return null;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (url.protocol === "https:" && isAllowedHttpsHost(hostname)) {
      return url.toString();
    }

    if (url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(hostname)) {
      return url.toString();
    }

    if (isAllowedArtifactReference(url)) {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}
