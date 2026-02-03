import { handler } from "@/lib/auth-server";
import { createFileRoute } from "@tanstack/react-router";
import { withSentry } from "@/lib/sentry.server";

const ALLOWED_ORIGIN = process.env.VITE_APP_ORIGIN || "http://localhost:3000";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
};

const withCors = withSentry(async (request: Request): Promise<Response> => {
  const response = await handler(request);
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
});

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: corsHeaders }),
      GET: ({ request }) => withCors(request),
      POST: ({ request }) => withCors(request),
    },
  },
});
