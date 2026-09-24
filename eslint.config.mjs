import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: ["**/.next/**", "**/node_modules/**", "**/.data/**", "next-env.d.ts"],
    rules: {
      // The studio must render user-owned, private object URLs without Next's
      // remote image optimizer; native img is the deliberate safe surface.
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
