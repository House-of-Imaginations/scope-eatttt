import { getCurrentUser } from "./authClient";

// ponytail: module-level $state = app-wide reactive auth state, no store lib.
// Header reads `user`; login/signup/logout call refreshUser() after the mutation.
let user = $state<Awaited<ReturnType<typeof getCurrentUser>>>(null);

export const auth = {
  get user() {
    return user;
  },
};

export async function refreshUser(): Promise<void> {
  user = await getCurrentUser();
}
