import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
    darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,jsx,tsx,mdx}",
    "./src/components/**/*.{js,jsx,tsx,mdx}",
    "./src/app/**/*.{js,jsx,tsx,mdx}",
    "!./src/app/api/**",
  ],
  theme: {
  	extend: {
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--success))',
  				foreground: 'hsl(var(--success-foreground))'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning))',
  				foreground: 'hsl(var(--warning-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))'
  			},
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			/* Brandable blue scale — resolved via CSS variables so
  			   TenantBrandingProvider can override them at runtime. */
  			blue: {
  				50:  'hsl(var(--blue-50) / <alpha-value>)',
  				100: 'hsl(var(--blue-100) / <alpha-value>)',
  				200: 'hsl(var(--blue-200) / <alpha-value>)',
  				300: 'hsl(var(--blue-300) / <alpha-value>)',
  				400: 'hsl(var(--blue-400) / <alpha-value>)',
  				500: 'hsl(var(--blue-500) / <alpha-value>)',
  				600: 'hsl(var(--blue-600) / <alpha-value>)',
  				700: 'hsl(var(--blue-700) / <alpha-value>)',
  				800: 'hsl(var(--blue-800) / <alpha-value>)',
  				900: 'hsl(var(--blue-900) / <alpha-value>)',
  				950: 'hsl(var(--blue-950) / <alpha-value>)',
  			},
  			/* Brandable teal scale — same pattern. */
  			teal: {
  				50:  'hsl(var(--teal-50) / <alpha-value>)',
  				100: 'hsl(var(--teal-100) / <alpha-value>)',
  				200: 'hsl(var(--teal-200) / <alpha-value>)',
  				300: 'hsl(var(--teal-300) / <alpha-value>)',
  				400: 'hsl(var(--teal-400) / <alpha-value>)',
  				500: 'hsl(var(--teal-500) / <alpha-value>)',
  				600: 'hsl(var(--teal-600) / <alpha-value>)',
  				700: 'hsl(var(--teal-700) / <alpha-value>)',
  				800: 'hsl(var(--teal-800) / <alpha-value>)',
  				900: 'hsl(var(--teal-900) / <alpha-value>)',
  				950: 'hsl(var(--teal-950) / <alpha-value>)',
  			},
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		fontFamily: {
  			sans: [
  				'var(--font-geist-sans)',
  				'system-ui',
  				'sans-serif'
  			],
  			mono: [
  				'var(--font-geist-mono)',
  				'monospace'
  			]
  		}
  	}
  },
  plugins: [tailwindcssAnimate],
};

export default config;
