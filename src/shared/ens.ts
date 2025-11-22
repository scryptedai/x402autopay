import { ethers } from "ethers";
import type { EnsData } from "./types";

const ENS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAINNET_RPC = "https://eth.llamarpc.com";

export function isEnsCacheValid(data: EnsData | undefined): boolean {
  if (!data) return false;
  return Date.now() - data.resolvedAt < ENS_CACHE_TTL_MS;
}

export async function resolveEnsName(address: string): Promise<string | null> {
  try {
    const provider = new ethers.JsonRpcProvider(MAINNET_RPC);
    const name = await provider.lookupAddress(address);
    if (!name) return null;

    const verifiedAddress = await provider.resolveName(name);
    if (!verifiedAddress) return null;

    if (verifiedAddress.toLowerCase() !== address.toLowerCase()) {
      return null;
    }

    return name;
  } catch {
    return null;
  }
}

export async function resolveEnsAvatar(name: string): Promise<string | null> {
  try {
    const provider = new ethers.JsonRpcProvider(MAINNET_RPC);
    const avatar = await provider.getAvatar(name);
    return avatar || null;
  } catch {
    return null;
  }
}

export async function fetchAvatarAsDataUri(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
      return null;
    }
    const blob = await response.blob();
    if (blob.size > 2 * 1024 * 1024) {
      return null;
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        resolve(typeof result === "string" ? result : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function resolveEns(address: string): Promise<EnsData | null> {
  const name = await resolveEnsName(address);
  if (!name) return null;

  let avatar: string | undefined;
  let avatarDataUri: string | undefined;

  const avatarUrl = await resolveEnsAvatar(name);
  if (avatarUrl) {
    avatar = avatarUrl;
    const dataUri = await fetchAvatarAsDataUri(avatarUrl);
    if (dataUri) {
      avatarDataUri = dataUri;
    }
  }

  return {
    name,
    avatar,
    avatarDataUri,
    resolvedAt: Date.now(),
  };
}

