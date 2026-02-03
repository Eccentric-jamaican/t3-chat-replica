import * as Sentry from "@sentry/node";

let sentryServerInitialized = false;

export function initSentryServer() {
  if (sentryServerInitialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  sentryServerInitialized = true;
  const tracesSampleRate = Number.parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1",
  );

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number.isFinite(tracesSampleRate)
      ? tracesSampleRate
      : 0.1,
  });
}

export function captureServerException(error: unknown) {
  initSentryServer();
  if (sentryServerInitialized) {
    Sentry.captureException(error);
  }
}

export function withSentry<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => Promise<TResult>,
) {
  return async (...args: TArgs) => {
    initSentryServer();
    try {
      return await handler(...args);
    } catch (error) {
      captureServerException(error);
      throw error;
    }
  };
}
