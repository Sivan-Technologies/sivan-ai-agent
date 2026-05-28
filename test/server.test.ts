import request from "supertest";
import { describe, it, expect } from "vitest";

process.env.DATABASE_PROVIDER = "sqlite";
process.env.DATABASE_URL = process.env.DATABASE_URL || "./data/test-server.db";
process.env.NOTIFICATION_URL = "";

// Import app after test environment overrides are set.
const app = (await import("../src/server")).default;

describe("server basic endpoints", () => {
  it("returns health ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("returns readiness ok", async () => {
    const res = await request(app).get("/health/readiness");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.database).toMatchObject({
      status: "ok",
      configured: true,
    });
  });
});
