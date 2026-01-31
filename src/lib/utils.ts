import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Resolves a redirect string into a path and search string.
 * This is useful for TanStack Router's navigate function.
 */
export function resolveRedirect(redirect: string | undefined): { pathname: string; search: string } | null {
  if (!redirect) return null;
  
  try {
    // If it's already a full URL
    const url = new URL(redirect);
    return { pathname: url.pathname, search: url.search };
  } catch (e) {
    // If it's a relative path, resolve it against a dummy origin to parse search params easily
    try {
      const url = new URL(redirect, "http://localhost");
      return { pathname: url.pathname, search: url.search };
    } catch (err) {
      return { pathname: redirect, search: "" };
    }
  }
}
