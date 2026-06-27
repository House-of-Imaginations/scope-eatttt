const PREFIX = "scope-eatttt:member:";

export function storeSessionMember(sessionId: string, memberId: string): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(`${PREFIX}${sessionId}`, memberId);
}

export function readSessionMember(sessionId: string): string | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  return sessionStorage.getItem(`${PREFIX}${sessionId}`) ?? undefined;
}

export function memberInput(sessionId: string, memberId: string | undefined): { sessionId: string; memberId?: string } {
  return memberId === undefined ? { sessionId } : { sessionId, memberId };
}
