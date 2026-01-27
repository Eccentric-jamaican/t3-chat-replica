import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Register Better Auth routes on the Convex HTTP router with CORS enabled
authComponent.registerRoutes(http, createAuth, {
  cors: {
    allowedOrigins: ["http://localhost:3000"],
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
