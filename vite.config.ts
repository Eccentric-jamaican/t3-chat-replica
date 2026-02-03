import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import { fileURLToPath, URL } from "url";
import { nitro } from "nitro/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

import tailwindcss from "@tailwindcss/vite";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const sentryRelease =
  process.env.SENTRY_RELEASE ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA;
const enableSentry = !!(sentryAuthToken && sentryOrg && sentryProject);

const config = defineConfig({
  build: {
    sourcemap: enableSentry,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    devtools(),
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
          release: sentryRelease,
        })
      : null,
  ].filter(Boolean),
});

export default config;
