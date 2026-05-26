import request from "supertest";
import { describe, it, expect } from "vitest";

// Import app after vitest sets up environment
import app from "../src/server";

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
