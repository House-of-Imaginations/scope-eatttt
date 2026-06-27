import type { AbsorbGuestInput } from "@scope/contract";
import type { UserLinkRepo } from "../ports/repo";

export async function absorbGuest(
  repo: UserLinkRepo,
  input: AbsorbGuestInput,
  currentUserId: string,
): Promise<{ reassigned: boolean }> {
  if (
    input.anonUserId === currentUserId ||
    await repo.isAnonymousUser(currentUserId) ||
    !(await repo.isAnonymousUser(input.anonUserId))
  ) {
    return { reassigned: false };
  }

  await repo.reassignUserRows(input.anonUserId, currentUserId);
  return { reassigned: true };
}
