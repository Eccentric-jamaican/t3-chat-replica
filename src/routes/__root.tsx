import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover, titlebar-area=hidden, interactive-widget=resizes-content",
      },
      {
        title: "Sendcat",
      },
      {
        name: "description",
        content: "AI chat application",
      },
      {
        name: "theme-color",
        content: "#f2e1f4",
      },
      // Android Chrome PWA
      {
        name: "mobile-web-app-capable",
        content: "yes",
      },
      // iOS Safari PWA
      {
        name: "apple-mobile-web-app-capable",
        content: "yes",
      },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "default",
      },
      {
        name: "apple-mobile-web-app-title",
        content: "Sendcat",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
      {
        rel: "icon",
        href: "/favicon.ico",
      },
      // Apple touch icons
      {
        rel: "apple-touch-icon",
        href: "/logo192.png",
      },
      {
        rel: "apple-touch-icon",
        sizes: "192x192",
        href: "/logo192.png",
      },
      {
        rel: "apple-touch-icon",
        sizes: "512x512",
        href: "/logo512.png",
      },
    ],
  }),

  shellComponent: RootDocument,
});

import { useEffect } from "react";
import { Toaster } from "sonner";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { convex } from "../lib/convex";
import { authClient } from "../lib/auth";
import { useVisualViewport } from "../hooks/useVisualViewport";

function RootDocument({ children }: { children: React.ReactNode }) {
  // Initialize virtual keyboard tracking
  useVisualViewport();

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch((err) => {
          console.error("Service Worker registration failed:", err);
        });
      });
    }
  }, []);

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="antialiased">
        <div className="grain-overlay" />
        <ConvexBetterAuthProvider
          client={convex}
          authClient={authClient}
        >
          {children}
          <Toaster position="bottom-right" theme="light" />
        </ConvexBetterAuthProvider>
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
