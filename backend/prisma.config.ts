/// <reference types="node" />
import { defineConfig } from "prisma/config"
import "dotenv/config"

export default defineConfig({
  schema: "./prisma/schema.prisma",
  // Use the direct (non-pooled) URL for CLI commands (migrate, generate, etc.)
  // The runtime adapter is configured separately in src/lib/prisma.ts.
  datasource: {
    url: process.env.DIRECT_URL,
  },
})
