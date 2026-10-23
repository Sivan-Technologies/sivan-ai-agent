import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { isPaymentInstructionBuyer } from "../src/services/paymentInstructionBuyer";

const mocks = vi.hoisted(() => ({ detail: vi.fn(), active: vi.fn(), create: vi.fn() }));
vi.mock("../src/context", () => ({}));
vi.mock("../src/config", () => ({ config: {} }));
vi.mock("../src/lib/logger", () => ({ warn: vi.fn(), info: vi.fn() }));
vi.mock("../src/services/monitoring", () => ({}));
vi.mock("../src/services/escrowService", () => ({ buildEscrowDetail: mocks.detail }));
vi.mock("../src/services/paymentService", () => ({ activePaymentInstructionForEscrow: mocks.active, createPaymentInstructionForEscrow: mocks.create }));
vi.mock("../src/services/paymentBalanceClient", () => ({}));
import router from "../src/routes/escrows";

const buyer = "whatsapp:+2348011112222";
const seller = "whatsapp:+2348033334444";
const app = express(); app.use(express.json()); app.use(router);
beforeEach(() => {
  vi.stubEnv("CORE_API_SECRET", "isolated-test-secret");
  vi.stubEnv("CORE_API_IP_ALLOWLIST", "");
  vi.stubEnv("CORE_API_ALLOWED_IPS", "");
  vi.clearAllMocks();
  mocks.active.mockResolvedValue({ reference: "test-reference", totalPayable: 15 });
});
afterEach(() => vi.unstubAllEnvs());

function post(actorWhatsapp: string, actorUserId?: string) {
  return request(app).post("/api/escrows/test-agreement/payment-instruction")
    .set("x-core-api-key", "isolated-test-secret").send({ actorWhatsapp, actorUserId });
}
function detail(currency: string, profile: string | null = buyer, stored = buyer) {
  return { buyer: profile ? { whatsappNumber: profile } : null,
    escrow: { escrowId: "test-agreement", buyerUserId: "buyer-id", buyerWhatsapp: stored, currency, status: "PENDING_PAYMENT" } };
}

describe.each(["NGN", "USDC"])("%s payment instruction buyer authorisation", currency => {
  it.each([buyer, "+2348011112222", "2348011112222"])("accepts equivalent phone %s", async actor => {
    mocks.detail.mockResolvedValue(detail(currency));
    expect((await post(actor)).status).toBe(200);
    expect(mocks.active).toHaveBeenCalledOnce();
  });
  it("accepts a differently formatted stored profile", async () => {
    mocks.detail.mockResolvedValue(detail(currency, "+2348011112222"));
    expect((await post(buyer)).status).toBe(200);
  });
  it("uses the agreement buyer phone when the profile is missing", async () => {
    mocks.detail.mockResolvedValue(detail(currency, null));
    expect((await post(buyer)).status).toBe(200);
  });
  it.each([seller, "+2348099998888", "tag:2348011112222", "web:2348011112222"])("rejects nonbuyer/invalid identity %s", async actor => {
    mocks.detail.mockResolvedValue(detail(currency));
    expect((await post(actor)).status).toBe(403);
    expect(mocks.active).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects conflicting profile and agreement phones", async () => {
    mocks.detail.mockResolvedValue(detail(currency, seller));
    expect((await post(buyer)).status).toBe(403);
    expect((await post(seller)).status).toBe(403);
  });
  it("rejects a conflicting supplied user ID", async () => {
    mocks.detail.mockResolvedValue(detail(currency));
    expect((await post(buyer, "seller-id")).status).toBe(403);
  });
  it("keeps the service authentication requirement", async () => {
    expect((await request(app).post("/api/escrows/test-agreement/payment-instruction").send({actorWhatsapp:buyer})).status).toBe(401);
    expect(mocks.detail).not.toHaveBeenCalled();
  });
  it("preserves status restrictions", async () => {
    const record=detail(currency);record.escrow.status="EXPIRED";mocks.detail.mockResolvedValue(record);
    expect((await post(buyer)).status).toBe(409);
    expect(mocks.active).not.toHaveBeenCalled();
  });
  it("can generate instructions after authorisation", async () => {
    mocks.detail.mockResolvedValue(detail(currency));mocks.active.mockResolvedValue(null);
    mocks.create.mockResolvedValue({reference:"test-new",totalPayable:15});
    expect((await post("+2348011112222")).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledOnce();
  });
});

it("fails closed for missing phones and malformed stored profiles", () => {
  expect(isPaymentInstructionBuyer({actorWhatsapp:buyer,buyerUserId:"buyer-id"})).toBe(false);
  expect(isPaymentInstructionBuyer({actorWhatsapp:buyer,buyerUserId:"buyer-id",profileWhatsapp:"tag:2348011112222",agreementWhatsapp:buyer})).toBe(false);
});
