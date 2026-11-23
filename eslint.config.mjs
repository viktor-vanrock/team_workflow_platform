import js from "@eslint/js";
import nx from "@nx/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import importPlugin from "eslint-plugin-import";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";
import { nxDependencyConstraints } from "./tools/architecture/dependency-rules.mts";

const prettierCompatibility = {
  ...eslintConfigPrettier,
  rules: Object.fromEntries(
    Object.entries(eslintConfigPrettier.rules).filter(
      ([ruleName]) => !ruleName.startsWith("@typescript-eslint/"),
    ),
  ),
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      ".node_modules-broken-*/**",
      "**/*.min.js",
      "packages/platform-contracts/src/generated/**",
    ],
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: {
      "@nx": nx,
      import: importPlugin,
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "array-callback-return": ["error", { checkForEach: true }],
      curly: ["error", "all"],
      eqeqeq: ["error", "always"],
      "no-constructor-return": "error",
      "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "no-promise-executor-return": "error",
      "no-template-curly-in-string": "error",
      "no-unmodified-loop-condition": "error",
      "no-unreachable-loop": "error",
      "no-useless-assignment": "error",
      "prefer-object-has-own": "error",
      "import/enforce-node-protocol-usage": ["error", "always"],
      "import/first": "error",
      "import/newline-after-import": [
        "error",
        { count: 1, exactCount: true, considerComments: true },
      ],
      "simple-import-sort/exports": "error",
      "simple-import-sort/imports": [
        "error",
        {
          groups: [
            ["^\\u0000"],
            ["^node:"],
            ["^@?(?!awp(?:/|$))\\w"],
            ["^@awp(?:/|$)"],
            ["^"],
            ["^\\."],
          ],
        },
      ],
      "@nx/enforce-module-boundaries": [
        "error",
        { enforceBuildableLibDependency: true, allow: [], depConstraints: nxDependencyConstraints },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex:
                "^@awp/(?!(?:competency-(?:qa|tech-writing)/(?:node|ui)|platform-contracts/canonical-hash)$)[^/]+/.+",
              message: "Undeclared workspace deep imports are forbidden; use a package export.",
            },
          ],
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-arguments": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },
  {
    files: ["**/*.tsx"],
    plugins: {
      "jsx-a11y": jsxA11y,
      "react-hooks": reactHooks,
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
    },
  },
  {
    files: ["**/*.spec.ts", "tools/**/*.mts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    files: ["packages/competency-qa/**/*.ts", "packages/competency-qa/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@awp/platform-core",
              message: "QA Pack consumes platform contracts through the Competency SDK.",
            },
            {
              name: "@awp/platform-runtime-nest",
              message: "QA Pack cannot depend on the Nest runtime adapter.",
            },
            {
              name: "@awp/connector-sdk",
              message: "QA Pack declares capabilities and cannot depend on Connector SDK.",
            },
            {
              name: "@awp/connector-mock",
              message: "QA Pack cannot depend on a concrete Connector.",
            },
          ],
          patterns: [
            {
              regex:
                "^@awp/(?!(?:competency-(?:qa|tech-writing)/(?:node|ui)|platform-contracts/canonical-hash)$)[^/]+/.+",
              message: "Undeclared workspace deep imports are forbidden; use a package export.",
            },
            {
              group: ["@nestjs/*"],
              message: "QA Pack cannot depend on Nest or vendor runtime packages.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@awp/competency-qa/node",
              message: "Browser code must use @awp/competency-qa or @awp/competency-qa/ui.",
            },
          ],
          patterns: [
            {
              regex:
                "^@awp/(?!(?:competency-(?:qa|tech-writing)/(?:node|ui)|platform-contracts/canonical-hash)$)[^/]+/.+",
              message: "Undeclared workspace deep imports are forbidden; use a package export.",
            },
          ],
        },
      ],
    },
  },
  prettierCompatibility,
);
