// Estado de la navegación simulada de Next.js para las pruebas (se declara en setup.ts).
import { vi } from "vitest";

export const navigation = {
  pathname: "/",
  search: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
};

export function nextNavigationMock() {
  return {
    useRouter: () => ({ replace: navigation.replace, push: navigation.push, refresh: vi.fn() }),
    usePathname: () => navigation.pathname,
    useSearchParams: () => navigation.search,
  };
}
