// Labels only. Never expose connection strings, credentials or process environments.
function label(value?: string): string {
  const text = value?.trim();
  return text && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(text) ? text : "unknown";
}

export function deploymentIdentity(env: NodeJS.ProcessEnv = process.env) {
  const environment = label(env.DEPLOYMENT_ENVIRONMENT || env.APP_ENV || env.NODE_ENV);
  const configured = env.HOSTING_PROVIDER?.trim().toLowerCase();
  const hosting = configured
    ? (["render", "aws", "local"].includes(configured) ? configured : "unknown")
    : env.RENDER === "true" ? "render" : "unknown";
  return {
    environment,
    hosting,
    instance: label(env.DEPLOYMENT_INSTANCE_ID || (hosting === "render" ? env.RENDER_INSTANCE_ID || env.RENDER_SERVICE_ID : undefined)),
    release: label(env.DEPLOYMENT_RELEASE || env.RENDER_GIT_COMMIT || env.SENTRY_RELEASE),
    dependency: label(env.OPS_DATABASE_LABEL),
  };
}

export function externalOpsAlertsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DISABLE_OPS_ALERTS === "true" || env.NODE_ENV === "test" || env.VITEST) return false;
  const identity = deploymentIdentity(env);
  if (identity.hosting === "local" || ["development", "local"].includes(identity.environment) ||
      (!env.NODE_ENV && identity.environment === "unknown" && identity.hosting === "unknown")) {
    return env.ENABLE_LOCAL_OPS_ALERTS === "true";
  }
  return true;
}
