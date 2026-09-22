import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // React Compiler preview diagnostics (eslint-plugin-react-hooks v6). They flag runtime-correct
    // patterns here — Date.now() inside a click handler, a ref read from a callback, and measuring
    // window size on mount — so they run as warnings until the codebase adopts the React Compiler.
    rules: {
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The source Claude Design compile plus its vendored runtime — input to the build, not
    // application code.
    "design/**",
    // The Anchor program is its own workspace with its own toolchain/deps.
    "program/**",
  ]),
]);

export default eslintConfig;
