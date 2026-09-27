// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";

/**
 * @param {"dev" | "build" | "preview" | "sync"} astroCommand
 * @returns {import("vite").Plugin[]}
 */
function viteRuntimeConfig(astroCommand) {
  const ssrDependencies = [
    "@astrojs/react/server.js",
    "@supabase/ssr",
    "@supabase/supabase-js",
    "astro/app",
    "astro/app/entrypoint/dev",
    "astro/app/fetch/default-handler",
    "astro/app/manifest",
    "astro/compiler-runtime",
    "astro/virtual-modules/middleware.js",
    "exceljs",
    "react",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "react-dom",
    "react-dom/server",
    "devalue",
    "esbuild",
    "js-yaml",
    "p-queue",
    "picomatch",
    "shiki",
    "smol-toml",
    "tinyglobby",
    "vite",
    "xxhash-wasm",
    "zod/v4/core",
  ];

  return [
    {
      name: "vite-command-cache",
      config(_config, { command }) {
        const cacheCommand = astroCommand === "build" ? "build" : command;

        return {
          cacheDir:
            cacheCommand === "build"
              ? "node_modules/.vite/build"
              : "node_modules/.vite/dev",
          resolve:
            command === "serve"
              ? {
                  alias: ssrDependencies.map((dependency) => ({
                    find: dependency,
                    replacement: dependency,
                  })),
                }
              : undefined,
        };
      },
    },
    {
      name: "vite-ssr-dependencies",
      enforce: "post",
      configEnvironment(name) {
        if (name !== "ssr") return;

        return {
          optimizeDeps: {
            noDiscovery: true,
            include: ssrDependencies,
          },
        };
      },
    },
    {
      name: "vite-ssr-dependencies-ready",
      apply: "serve",
      enforce: "pre",
      async configureServer(server) {
        await server.environments.ssr?.depsOptimizer?.init();
      },
    },
  ];
}

/** @returns {import("astro").AstroIntegration} */
function viteRuntimeIntegration() {
  return {
    name: "vite-runtime-config",
    hooks: {
      "astro:config:setup": ({ command, updateConfig }) => {
        updateConfig({
          vite: {
            plugins: viteRuntimeConfig(command),
          },
        });
      },
    },
  };
}

export default defineConfig({
  output: "server",
  adapter: vercel(),
  integrations: [viteRuntimeIntegration(), react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
