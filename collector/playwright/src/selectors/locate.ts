import type { Locator, Page } from 'playwright';
import type { LocatorSpec } from './schema';

type Role = Parameters<Page['getByRole']>[0];

/** Turns a JSON locator spec into a Playwright locator. All selector knowledge stays in the registry files. */
export function locate(scope: Page | Locator, spec: LocatorSpec): Locator {
  const text = spec.text ? new RegExp(spec.text, 'i') : undefined;
  if (spec.role) return scope.getByRole(spec.role as Role, spec.name ? { name: new RegExp(spec.name, 'i') } : {});
  if (spec.css) return text ? scope.locator(spec.css).filter({ hasText: text }) : scope.locator(spec.css);
  return scope.getByText(text!);
}
