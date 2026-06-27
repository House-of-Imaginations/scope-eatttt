import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  lunchSession,
  outboxEvent,
  pollCandidate,
  restaurantCache,
  sessionMember,
  sessionStatus,
  swipe,
  swipeDecision,
  user,
  vote,
} from "./index";

describe("db schema", () => {
  it("uses lunch_session for app sessions and leaves auth session separate", () => {
    expect(getTableName(user)).toBe("user");
    expect(getTableName(lunchSession)).toBe("lunch_session");
    expect(getTableName(sessionMember)).toBe("session_member");
    expect(getTableColumns(user).displayName.name).toBe("display_name");
  });

  it("exports the P1 app tables and outbox table", () => {
    expect(getTableName(swipe)).toBe("swipe");
    expect(getTableName(restaurantCache)).toBe("restaurant_cache");
    expect(getTableName(pollCandidate)).toBe("poll_candidate");
    expect(getTableName(vote)).toBe("vote");
    expect(getTableName(outboxEvent)).toBe("outbox_event");
  });

  it("stores session poll options with pinned defaults", () => {
    const columns = getTableColumns(lunchSession);

    expect(columns.title.name).toBe("title");
    expect(columns.pollDurationSec.name).toBe("poll_duration_sec");
    expect(columns.promoteThreshold.name).toBe("promote_threshold");
    expect(columns.pollDurationSec.default).toBe(300);
    expect(columns.promoteThreshold.default).toBe(2);
  });

  it("captures pinned status and decision enum values", () => {
    expect(sessionStatus.enumValues).toEqual(["lobby", "swiping", "polling", "decided", "closed"]);
    expect(swipeDecision.enumValues).toEqual(["accept", "reject"]);
  });
});
