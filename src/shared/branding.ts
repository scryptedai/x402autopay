import type { SiteBranding, ColorScheme } from "./types";

const BRANDING_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_IMAGE_TYPES = ["image/png", "image/svg+xml", "image/jpeg", "image/webp"];

export function isValidBrandingUrl(url: string, origin: string): boolean {
  try {
    const urlObj = new URL(url, origin);
    if (!["http:", "https:"].includes(urlObj.protocol)) {
      return false;
    }
    if (urlObj.protocol === "http:") {
      const originObj = new URL(origin);
      return urlObj.origin === originObj.origin;
    }
    return true;
  } catch {
    return false;
  }
}

export function isValidColor(color: string): boolean {
  return /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color);
}

export function sanitizeColorScheme(scheme: unknown): ColorScheme | undefined {
  if (!scheme || typeof scheme !== "object") return undefined;
  const s = scheme as Record<string, unknown>;
  const result: ColorScheme = {};
  const colorKeys: (keyof ColorScheme)[] = ["primary", "background", "text", "accent", "border"];
  for (const key of colorKeys) {
    const value = s[key];
    if (typeof value === "string" && isValidColor(value)) {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function parseBrandingHeaders(
  headers: Record<string, string>,
  origin: string,
): SiteBranding | undefined {
  const branding: SiteBranding = {
    source: "explicit",
    detectedAt: Date.now(),
  };

  const brandingHeader = headers["x-payment-branding"] ?? headers["X-Payment-Branding"];
  if (brandingHeader) {
    try {
      const decoded = atob(brandingHeader.trim());
      const parsed = JSON.parse(decoded) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.logo === "string") {
          if (parsed.logo.startsWith("data:")) {
            branding.logoDataUri = parsed.logo;
          } else if (isValidBrandingUrl(parsed.logo, origin)) {
            branding.logo = parsed.logo;
          }
        }
        if (typeof parsed.logoDataUri === "string" && parsed.logoDataUri.startsWith("data:")) {
          branding.logoDataUri = parsed.logoDataUri;
        }
        if (parsed.colorScheme) {
          branding.colorScheme = sanitizeColorScheme(parsed.colorScheme);
        }
        if (typeof parsed.theme === "string" && ["light", "dark", "auto"].includes(parsed.theme)) {
          branding.theme = parsed.theme as "light" | "dark" | "auto";
        }
        return branding;
      }
    } catch (error) {
      console.warn("Failed to parse x-payment-branding header", error);
    }
  }
  const logo = headers["x-payment-logo"] ?? headers["X-Payment-Logo"];
  if (logo) {
    if (logo.startsWith("data:")) {
      branding.logoDataUri = logo;
    } else if (isValidBrandingUrl(logo, origin)) {
      branding.logo = logo;
    }
  }

  const themeColor = headers["x-payment-theme-color"] ?? headers["X-Payment-Theme-Color"];
  if (themeColor && isValidColor(themeColor)) {
    branding.colorScheme = { primary: themeColor };
  }

  const bgColor = headers["x-payment-background"] ?? headers["X-Payment-Background"];
  if (bgColor && isValidColor(bgColor)) {
    branding.colorScheme = {
      ...branding.colorScheme,
      background: bgColor,
    };
  }

  return Object.keys(branding).length > 2 ? branding : undefined;
}

export async function fetchImageAsDataUri(
  url: string,
  origin: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!isValidBrandingUrl(url, origin)) {
    return undefined;
  }

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      return undefined;
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !ALLOWED_IMAGE_TYPES.some((type) => contentType.includes(type))) {
      return undefined;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_IMAGE_SIZE_BYTES) {
      return undefined;
    }

    const blob = await response.blob();
    if (blob.size > MAX_IMAGE_SIZE_BYTES) {
      return undefined;
    }

    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
        } else {
          reject(new Error("Failed to read image"));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    return dataUri;
  } catch (error) {
    console.warn("Failed to fetch branding image", error);
    return undefined;
  }
}

export async function fetchManifestBranding(
  manifestUrl: string,
  origin: string,
  signal?: AbortSignal,
): Promise<SiteBranding | undefined> {
  if (!isValidBrandingUrl(manifestUrl, origin)) {
    return undefined;
  }

  try {
    const response = await fetch(manifestUrl, { signal });
    if (!response.ok) {
      return undefined;
    }

    const manifest = (await response.json()) as Record<string, unknown>;
    if (!manifest || typeof manifest !== "object") {
      return undefined;
    }

    const branding: SiteBranding = {
      source: "implicit",
      detectedAt: Date.now(),
    };

    if (typeof manifest.theme_color === "string" && isValidColor(manifest.theme_color)) {
      branding.colorScheme = { primary: manifest.theme_color };
    }

    if (typeof manifest.background_color === "string" && isValidColor(manifest.background_color)) {
      branding.colorScheme = {
        ...branding.colorScheme,
        background: manifest.background_color,
      };
    }

    if (Array.isArray(manifest.icons) && manifest.icons.length > 0) {
      const icons = manifest.icons
        .filter((icon): icon is { src: string; sizes?: string; type?: string } => {
          return (
            typeof icon === "object" &&
            icon !== null &&
            typeof (icon as { src?: unknown }).src === "string"
          );
        })
        .map((icon) => {
          const sizes = icon.sizes || "";
          const sizeMatch = sizes.match(/(\d+)x(\d+)/);
          const size = sizeMatch ? Number.parseInt(sizeMatch[1], 10) : 0;
          return { ...icon, parsedSize: size };
        });

      const icons128Plus = icons.filter((icon) => icon.parsedSize >= 128);
      const bestIcon = icons128Plus.length > 0
        ? icons128Plus.sort((a, b) => a.parsedSize - b.parsedSize)[0]
        : icons.sort((a, b) => b.parsedSize - a.parsedSize)[0];

      if (bestIcon) {
        try {
          const resolvedUrl = new URL(bestIcon.src, origin).toString();
          if (isValidBrandingUrl(resolvedUrl, origin)) {
            branding.logo = resolvedUrl;
          }
        } catch {
          // continue
        }
      }
    }

    return Object.keys(branding).length > 2 ? branding : undefined;
  } catch (error) {
    console.warn("Failed to fetch manifest branding", error);
    return undefined;
  }
}

export async function detectBrandingFromManifest(origin: string): Promise<SiteBranding | undefined> {
  try {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (!manifestLink) {
      return undefined;
    }

    const manifestHref = manifestLink.getAttribute("href");
    if (!manifestHref) {
      return undefined;
    }

    let manifestUrl: string;
    try {
      manifestUrl = new URL(manifestHref, origin).toString();
    } catch {
      return undefined;
    }

    return {
      source: "implicit",
      detectedAt: Date.now(),
      logo: manifestUrl,
    } as SiteBranding & { _manifestUrl?: string };
  } catch (error) {
    console.warn("Failed to detect manifest link", error);
    return undefined;
  }
}

export async function detectBrandingFromPage(origin: string): Promise<SiteBranding | undefined> {
  const branding: SiteBranding = {
    source: "implicit",
    detectedAt: Date.now(),
  };

  try {
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      const color = themeColorMeta.getAttribute("content");
      if (color && isValidColor(color)) {
        branding.colorScheme = { primary: color };
      }
    }

    const logoSelectors = [
      'link[rel="apple-touch-icon"]',
      'link[rel="icon"][sizes="192x192"]',
      'link[rel="icon"][sizes="512x512"]',
      'link[rel="icon"]',
      'link[rel="logo"]',
      'meta[property="og:image"]',
    ];

    for (const selector of logoSelectors) {
      const element = document.querySelector(selector);
      if (!element) continue;

      let logoUrl: string | null = null;
      if (element.tagName === "LINK") {
        logoUrl = element.getAttribute("href");
      } else if (element.tagName === "META") {
        logoUrl = element.getAttribute("content");
      }

      if (logoUrl) {
        try {
          const resolvedUrl = new URL(logoUrl, origin).toString();
          if (isValidBrandingUrl(resolvedUrl, origin)) {
            branding.logo = resolvedUrl;
            break;
          }
        } catch {
          // continue
        }
      }
    }

    if (!branding.logo) {
      const commonPaths = ["/logo.png", "/logo.svg", "/favicon.ico", "/apple-touch-icon.png"];
      for (const path of commonPaths) {
        try {
          const testUrl = new URL(path, origin).toString();
          if (isValidBrandingUrl(testUrl, origin)) {
            branding.logo = testUrl;
            break;
          }
        } catch {
          // Continue
        }
      }
    }

    return Object.keys(branding).length > 2 ? branding : undefined;
  } catch (error) {
    console.warn("Failed to detect branding from page", error);
    return undefined;
  }
}

export function isBrandingCacheValid(branding: SiteBranding | undefined): boolean {
  if (!branding || !branding.detectedAt) return false;
  const age = Date.now() - branding.detectedAt;
  return age < BRANDING_CACHE_TTL_MS;
}

export function mergeBranding(
  explicit?: SiteBranding,
  cached?: SiteBranding,
  manifest?: SiteBranding,
  implicit?: SiteBranding,
): SiteBranding | undefined {
  if (explicit) return explicit;
  if (cached && isBrandingCacheValid(cached)) return cached;
  if (manifest) return manifest;
  return implicit;
}

