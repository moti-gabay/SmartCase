import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // `@ts-ignore` (not `@ts-expect-error`) is required on `@/generated/prisma`
      // imports: once `prisma generate` has run the lines are error-free, so
      // `@ts-expect-error` would itself fail tsc. See CLAUDE.md (Prisma 7 setup).
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": "allow-with-description" }],
    },
  },
]);

export default eslintConfig;
