export type SessionStatus = "lobby" | "swiping" | "polling" | "decided" | "closed";
export type Decision = "accept" | "reject";
export type VoteValue = 1 | -1;

export interface Restaurant {
  id: string;
  name: string;
  address: string;
  cuisineTags: string[];
  lat?: number;
  lng?: number;
  rating?: number;
  priceLevel?: number;
  distanceM?: number;
}

export interface Member {
  id: string;
  userId: string;
  displayName: string;
  image?: string | undefined;
  isHost: boolean;
  joinedAt: string;
}

export interface Candidate {
  id: string;
  restaurant: Restaurant;
  promotedAt: string;
  upvotes: number;
  downvotes: number;
  netScore: number;
}

export interface SessionState {
  id: string;
  joinCode: string;
  status: SessionStatus;
  hostUserId: string;
  viewerIsHost: boolean;
  lat: number;
  lng: number;
  radiusM: number;
  cuisines: string[];
  members: Member[];
  candidates: Candidate[];
  pollDeadlineAt?: string;
  winnerCandidateId?: string;
}
