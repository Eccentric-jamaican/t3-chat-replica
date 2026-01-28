import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Build CORS allowed origins from environment variable
// Set ALLOWED_ORIGINS in Convex dashboard (comma-separated list)
// Falls back to localhost for development
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
  : ["http://localhost:3000"];

// Register Better Auth routes on the Convex HTTP router with CORS enabled
authComponent.registerRoutes(http, createAuth, {
  cors: {
    allowedOrigins,
  },
  onRequest: (request) => {
    const url = new URL(request.url);
    console.log("[AUTH HTTP] Incoming request:", {
      method: request.method,
      path: url.pathname,
      timestamp: new Date().toISOString(),
    });
  },
  onResponse: (request, response) => {
    const url = new URL(request.url);
    console.log("[AUTH HTTP] Response:", {
      method: request.method,
      path: url.pathname,
      status: response.status,
      timestamp: new Date().toISOString(),
    });
  },
});

export default http;
