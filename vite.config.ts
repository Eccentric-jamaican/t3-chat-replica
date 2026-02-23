import { defineConfig, loadEnv } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import { fileURLToPath, URL } from "url";
import { nitro } from "nitro/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

import tailwindcss from "@tailwindcss/vite";

const config = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const sentryAuthToken = env.SENTRY_AUTH_TOKEN || process.env.SENTRY_AUTH_TOKEN;
  const sentryOrg = env.SENTRY_ORG || process.env.SENTRY_ORG;
  const sentryProject = env.SENTRY_PROJECT || process.env.SENTRY_PROJECT;
  const sentryRelease =
    env.SENTRY_RELEASE ||
    process.env.SENTRY_RELEASE ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA;
  const enableSentry = !!(sentryAuthToken && sentryOrg && sentryProject);

  return {
  build: {
    sourcemap: enableSentry,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
    plugins: [
    devtools({
      // Avoid hard-failing dev server startup if the default port is taken.
      // Override with `TANSTACK_DEVTOOLS_EVENT_BUS_PORT` if needed.
      eventBusConfig: {
        port: Number(env.TANSTACK_DEVTOOLS_EVENT_BUS_PORT || "42070"),
      },
    }),
    nitro(),
    tailwindcss(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),

    tanstackStart(),
    viteReact(),
      enableSentry
        ? sentryVitePlugin({
            org: sentryOrg,
            project: sentryProject,
            authToken: sentryAuthToken,
            release: sentryRelease ? { name: sentryRelease } : undefined,
          })
        : null,
    ].filter(Boolean),
  };
});

export default config;
