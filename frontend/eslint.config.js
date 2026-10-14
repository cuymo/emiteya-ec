// ESLint del frontend. eslint-config-next no admite ESLint 10 (sus plugins react y jsx-a11y
// exigen ESLint ≤9); se usan directamente el plugin de Next y el de hooks de React.
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: [".next/**", "next-env.d.ts", "coverage/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@facturador/backend", "**/backend/**"],
              message: "El frontend no importa código del backend; usa la API.",
            },
          ],
        },
      ],
    },
  },
  // Prevención de duplicación escalonada (adopt-premium-design-foundation-and-shell, design D19; ADR
  // 0028): reglas estrictas solo para el código nuevo del shell. El código heredado no cambia de
  // reglas; la lista de rutas crece a medida que migran las pantallas (component-system.md).
  {
    files: [
      "src/components/shell/**/*.{ts,tsx}",
      "src/components/route-states/**/*.{ts,tsx}",
      "src/lib/navigation/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@facturador/backend", "**/backend/**"],
              message: "El frontend no importa código del backend; usa la API.",
            },
            {
              group: ["radix-ui", "@radix-ui/*"],
              message: "Usa los primitivos de components/ui, no Radix directamente.",
            },
            {
              group: [
                "@/components/ui/menu-and-tooltip",
                "@/components/states",
                "@/components/notice-strip",
              ],
              message: "Componente heredado: el código nuevo usa los primitivos derivados.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/(^|\\s)[^\\s:]*-\\[[^\\]]+\\](\\s|$)/]",
          message: "Sin valores arbitrarios de Tailwind: usa los tokens y las escalas.",
        },
        {
          selector: "TemplateElement[value.raw=/(^|\\s)[^\\s:]*-\\[[^\\]]+\\](\\s|$)/]",
          message: "Sin valores arbitrarios de Tailwind: usa los tokens y las escalas.",
        },
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
          message: "Sin colores literales: usa los tokens semánticos.",
        },
        {
          selector: "Literal[value=/^legacy-/]",
          message: "Los tamaños legacy-* son solo para pantallas sin migrar.",
        },
        {
          selector: "JSXAttribute[name.name='style']",
          message: "Sin atributo style: la CSP lo bloquea en el HTML del servidor.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Button']:not(:has(JSXAttribute[name.name='size']))",
          message: "Pasa un tamaño de la escala aprobada a Button.",
        },
      ],
    },
  },
  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='style']",
          message: "Sin atributo style: la CSP lo bloquea en el HTML del servidor.",
        },
      ],
    },
  },
);
