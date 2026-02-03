import * as Sentry from "@sentry/react";

let sentryInitialized = false;

export function initSentry() {
  if (sentryInitialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  sentryInitialized = true;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.captureConsoleIntegration({ levels: ["error", "warn"] }),
    ],
    tracesSampleRate: 0.1,
  });
}
