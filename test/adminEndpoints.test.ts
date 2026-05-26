import fs from "fs";
import path from "path";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-admin-settings.db");
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.DATABASE_URL = TEST_DB_PATH;

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

const app = (await import("../src/server")).default;

describe("Admin Settings API Integration", () => {
  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (err) {
        // SQLite may still have the file open while the app is alive.
      }
    }
  });

  it("should reject unauthorized access to admin settings", async () => {
    const res = await request(app).get("/admin/settings");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/i);
  });

  it("should fetch fee settings with admin credentials", async () => {
    const res = await request(app)
      .get("/admin/settings")
      .set("x-admin-key", "test-admin-key");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      nairaFeePercent: 2.5,
      nairaFeeFixed: 50,
      usdcFeePercent: 1.5,
      usdcFeeFixed: 0.5,
      version: 1,
    });
  });

  it("should update fee settings and return the updated config", async () => {
    const updatePayload = {
      nairaFeePercent: 3.5,
      nairaFeeFixed: 75,
      usdcFeePercent: 2.0,
      usdcFeeFixed: 0.75,
      expectedVersion: 1,
    };

    const res = await request(app)
      .post("/admin/settings")
      .set("x-admin-key", "test-admin-key")
      .send(updatePayload);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      nairaFeePercent: 3.5,
      nairaFeeFixed: 75,
      usdcFeePercent: 2.0,
      usdcFeeFixed: 0.75,
      version: 2,
    });
  });

  it("should return conflict when updating with a stale expectedVersion", async () => {
    const stalePayload = {
      nairaFeePercent: 4.0,
      nairaFeeFixed: 100,
      usdcFeePercent: 2.5,
      usdcFeeFixed: 1.0,
      expectedVersion: 1,
    };

    const res = await request(app)
      .post("/admin/settings")
      .set("x-admin-key", "test-admin-key")
      .send(stalePayload);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Settings version mismatch");
  });

  it("should expose audit history after settings updates", async () => {
    const res = await request(app)
      .get("/admin/audit-history?limit=20")
      .set("x-admin-key", "test-admin-key");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty("settingName");
    expect(res.body[0]).toHaveProperty("newValue");
    expect(res.body[0]).toHaveProperty("changedBy");
  });

  it("should expose protected database status", async () => {
    const unauthorized = await request(app).get("/admin/db-status");
    expect(unauthorized.status).toBe(401);

    const res = await request(app)
      .get("/admin/db-status")
      .set("x-admin-key", "test-admin-key");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      provider: "sqlite",
      configured: true,
    });
    expect(res.body).toHaveProperty("settingsVersion");
    expect(res.body).toHaveProperty("latencyMs");
    expect(res.body).not.toHaveProperty("databaseUrl");
  });

  it("should expose protected escrow ledger", async () => {
    const unauthorized = await request(app).get("/admin/escrows");
    expect(unauthorized.status).toBe(401);

    const res = await request(app)
      .get("/admin/escrows")
      .set("x-admin-key", "test-admin-key");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
