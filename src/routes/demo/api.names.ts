import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { withSentry } from "@/lib/sentry.server";

export const Route = createFileRoute("/demo/api/names")({
  server: {
    handlers: {
      GET: withSentry(async () => json(["Alice", "Bob", "Charlie"])),
    },
  },
});
