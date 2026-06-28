// ponytail: plain fetch, credentials:include, no better-auth/client lib.
import { getAppLogger } from "@scope/logging/browser";

const log = getAppLogger(["auth"]);

export type Result = { ok: true } | { ok: false; error: string; retryAfter?: number };

export async function getCurrentUser(): Promise<{
  id: string;
  isAnonymous: boolean;
  name: string;
  email: string;
  image: string | null;
} | null> {
  try {
    const resp = await fetch("/api/auth/get-session", { credentials: "include" });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    if (!data?.user || !data?.session) return null;
    const u = data.user;
    return {
      id: u.id,
      isAnonymous: u.isAnonymous ?? false,
      name: u.name,
      email: u.email,
      image: u.image ?? null,
    };
  } catch (err) {
    log.error("getCurrentUser failed", { error: err });
    return null;
  }
}

export async function signUpEmail({
  name,
  email,
  password,
}: {
  name: string;
  email: string;
  password: string;
}): Promise<Result> {
  return _postAuth("/api/auth/sign-up/email", { name, email, password });
}

export async function signInEmail({
  email,
  password,
}: {
  email: string;
  password: string;
}): Promise<Result> {
  return _postAuth("/api/auth/sign-in/email", { email, password });
}

export function signInGoogle(redirect: string): void {
  window.location.href =
    "/api/auth/sign-in/social?provider=google&callbackURL=" + encodeURIComponent(redirect);
}

export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/sign-out", { method: "POST", credentials: "include" });
  } catch (err) {
    log.error("signOut failed", { error: err });
  }
}

// ponytail: shared post helper — only two callers, no abstraction overhead.
async function _postAuth(url: string, body: Record<string, string>): Promise<Result> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (resp.ok) return { ok: true };
    if (resp.status === 429) {
      const raw = Number(resp.headers.get("X-Retry-After"));
      // ponytail: exactOptionalPropertyTypes — only spread key when value is present.
      return raw > 0
        ? { ok: false, error: "Too many attempts", retryAfter: raw }
        : { ok: false, error: "Too many attempts" };
    }
    const data = await resp.json().catch(() => null);
    const error: string = data?.message ?? data?.error ?? "Something went wrong";
    return { ok: false, error };
  } catch (err) {
    log.error("auth POST failed", { url, error: err });
    return { ok: false, error: "Something went wrong" };
  }
}
