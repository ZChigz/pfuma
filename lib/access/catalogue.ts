// The permission catalogue laid out for the Roles screens: module → page → actions. Pure, so pages and tests can use it.
import { MODULES, PERMISSIONS } from '@/lib/access-core';

export interface CatalogueAction { action: string; key: string; label: string }
export interface CataloguePage { page: string; title: string; actions: CatalogueAction[] }
export interface CatalogueModule { module: string; title: string; pages: CataloguePage[] }

const words = (s: string) => s.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function permissionCatalogue(): CatalogueModule[] {
  const out: CatalogueModule[] = [];
  for (const m of MODULES) {
    const pages = new Map<string, CatalogueAction[]>();
    for (const [key, label] of Object.entries(PERMISSIONS)) {
      const [mod, page, ...rest] = key.split('.');
      if (mod !== m.key || !page || !rest.length) continue;
      const list = pages.get(page) ?? [];
      list.push({ action: rest.join('.'), key, label });
      pages.set(page, list);
    }
    if (pages.size) out.push({ module: m.key, title: m.label, pages: Array.from(pages, ([page, actions]) => ({ page, title: words(page), actions })) });
  }
  return out;
}
