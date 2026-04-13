import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: "#0d1b2e",
          amber: "#f59e0b",
        },
      },
    },
  },
  plugins: [],
};

export default config;
