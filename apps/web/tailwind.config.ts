import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Outfit", "Orbitron", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        /* Neon Colors */
        neon: {
          lime: "hsl(var(--neon-lime))",
          yellow: "hsl(var(--neon-yellow))",
          cyan: "hsl(var(--neon-cyan))",
        },
        glow: {
          lime: "hsl(var(--glow-lime))",
          yellow: "hsl(var(--glow-yellow))",
          cyan: "hsl(var(--glow-cyan))",
        },
        genniBlue: "#10b981", // Emerald-500 - primary green
        genniIndigo: "#059669", // Emerald-600 - mid green
        genniRose: "#047857", // Emerald-700 - dark green
      },
      boxShadow: {
        genniCard: "0 10px 30px -12px rgba(2, 6, 23, 0.15)",
        genniGlow: "0 0 0 6px rgba(34, 197, 94, 0.14)",
      },
      backgroundImage: {
        "genni-gradient": "linear-gradient(135deg, #10b981, #059669 45%, #047857)", // Green gradient
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "neon-pulse": {
          "0%, 100%": {
            boxShadow:
              "0 0 20px hsl(var(--glow-lime)), 0 0 40px hsl(var(--glow-lime))",
          },
          "50%": {
            boxShadow:
              "0 0 30px hsl(var(--glow-lime)), 0 0 60px hsl(var(--glow-lime)), 0 0 80px hsl(var(--glow-lime))",
          },
        },
        "neon-pulse-slow": {
          "0%, 100%": {
            boxShadow:
              "0 0 20px hsl(var(--glow-lime)), 0 0 40px hsl(var(--glow-lime)), 0 0 60px hsl(var(--glow-lime))",
          },
          "50%": {
            boxShadow:
              "0 0 35px hsl(var(--glow-lime)), 0 0 70px hsl(var(--glow-lime)), 0 0 100px hsl(var(--glow-lime))",
          },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "glow-rotate": {
          "0%": { filter: "hue-rotate(0deg)" },
          "100%": { filter: "hue-rotate(360deg)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "neon-pulse": "neon-pulse 2s ease-in-out infinite",
        "neon-pulse-slow": "neon-pulse-slow 4s ease-in-out infinite",
        float: "float 3s ease-in-out infinite",
        "glow-rotate": "glow-rotate 3s linear infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate, typography],
} satisfies Config;
