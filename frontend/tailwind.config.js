/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#FFFFFF",
        ivory: "#F7F6F3",
        ink: "#14171C",
        slate: "#5B6470",
        hairline: "#E3E1DC",
        gold: "#B08D3C",
        status: {
          available: "#2E7D5B",
          onTrip: "#2F5D8A",
          maintenance: "#C9962B",
          issue: "#A3262A",
        },
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Cormorant Garamond", "Playfair Display", "serif"],
        sans: ["var(--font-sans)", "Inter", "Manrope", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "4px",
      },
    },
  },
  plugins: [],
};
