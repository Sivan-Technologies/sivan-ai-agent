import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({warn:vi.fn(),setTag:vi.fn(),setExtra:vi.fn(),captureException:vi.fn(),captureMessage:vi.fn()}));
vi.mock("../src/lib/logger", () => ({warn:mocks.warn}));
vi.mock("@sentry/node", () => ({withScope:(fn:any)=>fn(mocks),captureException:mocks.captureException,captureMessage:mocks.captureMessage}));
import {captureOperationalError, capturePaymentWarning, listOperationalEvents, formatTelegramAlert} from "../src/services/monitoring";
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks();});

it("correlates operational logs, Sentry and Telegram formatting without network calls", () => {
  vi.stubEnv("DISABLE_OPS_ALERTS","true");
  vi.stubEnv("DEPLOYMENT_ENVIRONMENT","staging");
  vi.stubEnv("HOSTING_PROVIDER","render");
  vi.stubEnv("DEPLOYMENT_INSTANCE_ID","srv-test");
  vi.stubEnv("SENTRY_DSN","test-only");
  const fetch = vi.fn();vi.stubGlobal("fetch",fetch);
  captureOperationalError("Read failed",new Error("quota exceeded"));
  const event=listOperationalEvents(1)[0];
  expect(event.deployment).toMatchObject({environment:"staging",hosting:"render",instance:"srv-test"});
  expect(mocks.warn).toHaveBeenCalledWith("Read failed",expect.objectContaining({eventId:event.id,deployment:event.deployment}),"quota exceeded");
  expect(mocks.setExtra).toHaveBeenCalledWith("operationalEventId",event.id);
  expect(mocks.setTag).toHaveBeenCalledWith("deployment.hosting","render");
  expect(formatTelegramAlert(event)).toContain(`Event ID: ${event.id}`);
  vi.stubEnv("HOSTING_PROVIDER","aws");
  expect(formatTelegramAlert(event)).toContain("Hosting: render");
  capturePaymentWarning("Delayed job");
  expect(listOperationalEvents(1)[0].deployment?.hosting).toBe("aws");
  expect(fetch).not.toHaveBeenCalled();
});
