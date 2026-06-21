import type { AuthProvider, AuthUser } from "@scope/core";

export interface BetterAuthLike {
  api: {
    getSession(input: { headers: Headers }): Promise<{ user: BetterAuthSessionUser } | null>;
  };
}

export interface BetterAuthSessionUser {
  id: string;
  email?: string | null | undefined;
  name?: string | null | undefined;
  displayName?: string | null | undefined;
  isAnonymous?: boolean | null | undefined;
}

export class BetterAuthProvider implements AuthProvider {
  constructor(private readonly auth: BetterAuthLike) {}

  async getUser(headers: Headers): Promise<AuthUser | null> {
    const session = await this.auth.api.getSession({ headers });
    if (!session) {
      return null;
    }

    return {
      id: session.user.id,
      email: session.user.email ?? null,
      displayName: session.user.displayName ?? session.user.name ?? "Guest",
      isAnonymous: session.user.isAnonymous ?? false,
    };
  }

  async requireUser(headers: Headers): Promise<AuthUser> {
    const user = await this.getUser(headers);
    if (!user) {
      throw new Error("User not found");
    }
    return user;
  }
}
