import { FolderTree } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { CategoryDialog } from "@/components/catalogue/category-dialog";
import { CategoryTree } from "@/components/catalogue/category-tree";
import { ListToolbar } from "@/components/catalogue/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { listCategoryTree, type CategoryRow } from "@/lib/catalogue/queries";
import { getLocale, getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.categories };
}

// The session (and, in CategoryTree, the search params) are read behind
// <Suspense> so navigations show the skeleton instantly (Cache Components);
// requireAdmin() guards the content.
export default async function CategoriesPage() {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Categories />
    </Suspense>
  );
}

/** A row for the structure view: the editable fields plus its product count. */
function editableRow(category: CategoryRow) {
  const { id, name, slug, description, image_url, sort_order, is_active, updated_at, parent_id } =
    category;
  return {
    id,
    name,
    slug,
    description,
    image_url,
    sort_order,
    is_active,
    updated_at,
    parent_id,
    productCount: category.productCount,
  };
}

/**
 * Categories as one structure tree. Search, level and status (?q=&level=&status=)
 * are applied by CategoryTree itself, so every category is loaded once.
 */
async function Categories() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const tree = await listCategoryTree();
  // Possible parents: top-level categories.
  const parents = tree
    .filter((category) => !category.parent_id)
    .map(({ id, name }) => ({ id, name }));

  const t = messages.catalogue;
  const c = t.categories;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            {messages.nav.categories}
            {tree.length > 0 && <Badge className="tabular-nums">{tree.length}</Badge>}
          </h1>
          <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{c.subtitle}</p>
        </div>
        <CategoryDialog parents={parents} />
      </div>

      <ListToolbar
        searchLabel={c.searchLabel}
        searchPlaceholder={c.searchPlaceholder}
        filters={[
          {
            name: "level",
            label: c.levelFilter,
            options: [
              { value: "", label: c.levelAll },
              { value: "main", label: c.levelMain },
              { value: "sub", label: c.levelSub },
            ],
          },
          {
            name: "status",
            label: t.common.status,
            options: [
              { value: "", label: t.common.statusAll },
              { value: "active", label: t.common.active },
              { value: "inactive", label: t.common.inactive },
            ],
          },
        ]}
      />

      {tree.length === 0 ? (
        <Card>
          <EmptyState
            icon={FolderTree}
            title={c.emptyTitle}
            description={c.emptyBody}
            action={<CategoryDialog parents={parents} />}
          />
        </Card>
      ) : (
        <CategoryTree categories={tree.map(editableRow)} />
      )}
    </div>
  );
}
