// The pages are copied here by the generator in packages/docs/src (`pnpm docs:generate`, ADR-0017).
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";

export const collections = { docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }) };
