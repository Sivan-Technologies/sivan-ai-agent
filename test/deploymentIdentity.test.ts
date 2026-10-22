import { describe, expect, it } from "vitest";
import { deploymentIdentity, externalOpsAlertsEnabled } from "../src/services/deploymentIdentity";

describe("deployment identity", () => {
  it("keeps hosting separate from the environment", () => {
    expect(deploymentIdentity({HOSTING_PROVIDER:"aws", DEPLOYMENT_ENVIRONMENT:"staging", DEPLOYMENT_INSTANCE_ID:"worker-2", DEPLOYMENT_RELEASE:"abc123"})).toMatchObject({hosting:"aws",environment:"staging",instance:"worker-2",release:"abc123"});
  });
  it("uses Render metadata without assuming staging", () => {
    expect(deploymentIdentity({RENDER:"true",NODE_ENV:"production",RENDER_INSTANCE_ID:"srv-123",RENDER_GIT_COMMIT:"abc123"})).toMatchObject({hosting:"render",environment:"production",instance:"srv-123",release:"abc123"});
  });
  it("does not guess AWS from production or inspect database credentials", () => {
    expect(deploymentIdentity({NODE_ENV:"production",DATABASE_URL:"postgres://private:password@host/db"})).toEqual({hosting:"unknown",environment:"production",instance:"unknown",release:"unknown",dependency:"unknown"});
  });
  it("rejects URLs and multiline labels", () => {
    expect(deploymentIdentity({DEPLOYMENT_INSTANCE_ID:"https://user:pass@host",OPS_DATABASE_LABEL:"neon\nspoof",DEPLOYMENT_RELEASE:"Bearer secret"})).toMatchObject({instance:"unknown",dependency:"unknown",release:"unknown"});
  });
  it("disables local external alerts by default, with deliberate opt-in", () => {
    expect(externalOpsAlertsEnabled({HOSTING_PROVIDER:"local",NODE_ENV:"production"})).toBe(false);
    expect(externalOpsAlertsEnabled({NODE_ENV:"development"})).toBe(false);
    expect(externalOpsAlertsEnabled({})).toBe(false);
    expect(externalOpsAlertsEnabled({HOSTING_PROVIDER:"local",ENABLE_LOCAL_OPS_ALERTS:"true"})).toBe(true);
  });
  it("preserves staging alerts and absolute test/disable overrides", () => {
    expect(externalOpsAlertsEnabled({HOSTING_PROVIDER:"render",NODE_ENV:"staging"})).toBe(true);
    expect(externalOpsAlertsEnabled({NODE_ENV:"test",ENABLE_LOCAL_OPS_ALERTS:"true"})).toBe(false);
    expect(externalOpsAlertsEnabled({NODE_ENV:"production",DISABLE_OPS_ALERTS:"true"})).toBe(false);
  });
});
