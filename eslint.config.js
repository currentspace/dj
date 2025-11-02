// @ts-check
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import perfectionist from "eslint-plugin-perfectionist";
import security from "eslint-plugin-security";
import globals from "globals";

export default [
  // ============================================================================
  // GLOBAL IGNORES - Must come first
  // ============================================================================
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "**/pnpm-lock.yaml",
      "**/build/**",
      "**/.turbo/**",
      "**/*.d.ts",
    ],
  },

  // ============================================================================
  // BASE JAVASCRIPT CONFIG
  // ============================================================================
  js.configs.recommended,

  // ============================================================================
  // SECURITY & CODE QUALITY - Apply to all files
  // ============================================================================
  security.configs.recommended,
  perfectionist.configs["recommended-natural"],

  // ============================================================================
  // TYPESCRIPT - Type-checked configs for TS files
  // ============================================================================
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        projectService: true,
        tsconfigRootDir: dirname(fileURLToPath(import.meta.url)),
      },
    },
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      // Disable some overly strict rules
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",

      // Customize TypeScript rules
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/require-await": "off",
    },
  },

  // ============================================================================
  // JAVASCRIPT FILES - Disable type-checking
  // ============================================================================
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },

  // ============================================================================
  // BROWSER ENVIRONMENT - React Web App + API Client
  // ============================================================================
  {
    files: ["apps/web/**/*.{ts,tsx}", "packages/api-client/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        JSX: "readonly",
        // React globals
        React: "readonly",
      },
    },
    plugins: {
      "jsx-a11y": jsxA11y,
      react: reactPlugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react/jsx-uses-react": "off",
      "react/prop-types": "off",
      // React Core Rules
      "react/react-in-jsx-scope": "off",

      // React Hooks Rules (with React Compiler support)
      ...reactHooks.configs["recommended-latest"].rules,

      // React Refresh
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // Accessibility Rules
      ...jsxA11y.flatConfigs.recommended.rules,

      // Allow Promise-returning functions in props when component handles them correctly
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: false,
        },
      ],

      // Console usage - more lenient in browser for debugging
      "no-console": "off",

      "security/detect-non-literal-fs-filename": "off", // Not applicable to browser
      // Security adjustments for browser code
      "security/detect-object-injection": "off", // Too many false positives in React
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },

  // ============================================================================
  // CLOUDFLARE WORKERS ENVIRONMENT - API & Webhook Workers
  // ============================================================================
  {
    files: ["workers/api/**/*.{ts,tsx}", "workers/webhooks/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        // Workers use browser globals as base (Web Standards)
        ...globals.browser,

        Buffer: "readonly",
        DurableObjectId: "readonly",
        DurableObjectNamespace: "readonly",
        DurableObjectState: "readonly",
        DurableObjectStorage: "readonly",
        // Cloudflare Workers types (when using @cloudflare/workers-types)
        Env: "readonly",
        ExecutionContext: "readonly",
        Fetcher: "readonly",
        // Cloudflare Workers-specific Runtime
        KVNamespace: "readonly",

        // Node.js-compat globals (when nodejs_compat flag enabled)
        process: "readonly",

        ScheduledController: "readonly",
        WebSocketPair: "readonly",
      },
    },
    rules: {
      // Console usage - only warn/error in production workers
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // Perfectionist - keep imports organized in workers
      "perfectionist/sort-imports": [
        "error",
        {
          groups: [
            "type",
            ["builtin", "external"],
            "internal-type",
            "internal",
            ["parent-type", "sibling-type", "index-type"],
            ["parent", "sibling", "index"],
            "object",
            "unknown",
          ],
          order: "asc",
          type: "natural",
        },
      ],
      "security/detect-non-literal-regexp": "warn",

      // Security is critical for workers
      "security/detect-object-injection": "error",
    },
  },

  // ============================================================================
  // SHARED TYPES PACKAGE - Type-only, strict rules
  // ============================================================================
  {
    files: ["packages/shared-types/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "error",

      // Extra strict for shared types
      "@typescript-eslint/no-explicit-any": "error",
      // No runtime code allowed in shared types
      "no-restricted-syntax": [
        "error",
        {
          message:
            "Shared types package should only export types, interfaces, and enums - not runtime code",
          selector:
            'ExportNamedDeclaration[declaration.type!="TSInterfaceDeclaration"][declaration.type!="TSTypeAliasDeclaration"][declaration.type!="TSEnumDeclaration"]',
        },
      ],
    },
  },

  // ============================================================================
  // NODE.JS BUILD SCRIPTS & CONFIG FILES
  // ============================================================================
  {
    files: [
      "scripts/**/*.{js,mjs,cjs,ts}",
      "*.config.{js,mjs,cjs,ts}",
      "**/vite.config.{js,ts}",
      "**/vitest.config.{js,ts}",
      "**/wrangler.config.{js,ts}",
      "**/tsup.config.{js,ts}",
      "**/eslint.config.{js,mjs,cjs}",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.nodeBuiltin,
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
      // More lenient for build scripts
      "no-console": "off",
      "perfectionist/sort-imports": "off", // Don't enforce import sorting in config files
      "security/detect-child-process": "off", // Build scripts use exec/spawn
      "security/detect-non-literal-fs-filename": "off", // Build scripts need dynamic paths
    },
  },

  // ============================================================================
  // TEST FILES - More lenient rules
  // ============================================================================
  {
    files: [
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/__tests__/**/*.{ts,tsx,js,jsx}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "no-console": "off",
      "security/detect-object-injection": "off",
    },
  },
];
