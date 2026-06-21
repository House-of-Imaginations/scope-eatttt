export interface AuthUser {
  id: string;
  email?: string | null;
  displayName: string;
  isAnonymous?: boolean;
}

export interface AuthProvider {
  getUser(headers: Headers): Promise<AuthUser | null>;
  requireUser(headers: Headers): Promise<AuthUser>;
}
