import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        elegant: ["var(--font-elegant)"],
      },
      colors: {
        "light-gray": "hsl(var(--neutral-25))",
        "text-gray": "hsl(var(--neutral-700))",
        brand: {
          "25": "#F8FCFF",
          "50": "#EFF9FF",
          "100": "#DBF1FF",
          "200": "#BFE7FF",
          "300": "#93D5FF",
          "400": "#60BFFF",
          "500": "#1DA1F2",
          "600": "#0C8CE5",
          "700": "#0A74C7",
          "800": "#0F5FA3",
          "900": "#134E7F",
          "950": "#0A2E4D",
        },
        twitter: {
          "25": "#F8FCFF",
          "50": "#EFF9FF", 
          "100": "#DBF1FF",
          "200": "#BFE7FF",
          "300": "#93D5FF",
          "400": "#60BFFF",
          "500": "#1DA1F2",
          "600": "#0C8CE5",
          "700": "#0A74C7",
          "800": "#0F5FA3",
          "900": "#134E7F",
          "950": "#0A2E4D",
        },
        neutral: {
          "25": "hsl(var(--neutral-25))",
          "50": "hsl(var(--neutral-50))",
          "100": "hsl(var(--neutral-100))",
          "200": "hsl(var(--neutral-200))",
          "300": "hsl(var(--neutral-300))",
          "400": "hsl(var(--neutral-400))",
          "500": "hsl(var(--neutral-500))",
          "600": "hsl(var(--neutral-600))",
          "700": "hsl(var(--neutral-700))",
          "800": "hsl(var(--neutral-800))",
          "900": "hsl(var(--neutral-900))",
          "950": "hsl(var(--neutral-950))",
        },
        success: {
          "50": "hsl(var(--success-50))",
          "100": "hsl(var(--success-100))",
          "500": "hsl(var(--success-500))",
          "600": "hsl(var(--success-600))",
          "700": "hsl(var(--success-700))",
        },
        warning: {
          "50": "hsl(var(--warning-50))",
          "100": "hsl(var(--warning-100))",
          "500": "hsl(var(--warning-500))",
          "600": "hsl(var(--warning-600))",
        },
        error: {
          "50": "hsl(var(--error-50))",
          "100": "hsl(var(--error-100))",
          "500": "hsl(var(--error-500))",
          "600": "hsl(var(--error-600))",
          "700": "hsl(var(--error-700))",
        },
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
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
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      animation: {
        marquee: "marquee var(--duration) infinite linear",
        "marquee-vertical": "marquee-vertical var(--duration) linear infinite",
      },
      keyframes: {
        marquee: {
          from: {
            transform: "translateX(0)",
          },
          to: {
            transform: "translateX(calc(-100% - var(--gap)))",
          },
        },
        "marquee-vertical": {
          from: {
            transform: "translateY(0)",
          },
          to: {
            transform: "translateY(calc(-100% - var(--gap)))",
          },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate"),],
}
export default config
