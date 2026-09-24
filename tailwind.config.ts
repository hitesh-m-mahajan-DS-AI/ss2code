import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        glow: "0 16px 38px rgba(108, 99, 255, 0.26)",
      },
      colors: {
        ink: "#070b18",
        panel: "rgba(20, 27, 51, 0.62)",
      },
    },
  },
  plugins: [],
};

export default config;
