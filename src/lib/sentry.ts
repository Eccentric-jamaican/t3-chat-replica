import * as Sentry from "@sentry/react";

let sentryInitialized = false;

export function initSentry() {
  if (sentryInitialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  sentryInitialized = true;
  const tracesSampleRate = Number.parseFloat(
    import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || "0.1",
  );

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    sendDefaultPii: false,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.captureConsoleIntegration({ levels: ["error", "warn"] }),
    ],
    tracesSampleRate: Number.isFinite(tracesSampleRate)
      ? tracesSampleRate
      : 0.1,
  });
}
