import { AdminShell } from "@/components/layout/admin-shell";
import { UserMenu } from "@/components/layout/user-menu";
import { ToastProvider } from "@/components/ui/toast";
import { requireAdmin } from "@/lib/auth/dal";
import { getLocale } from "@/lib/i18n/server";

/**
 * Every /[lang]/admin/* route renders inside this shell.
 *
 * Authorization layers:
 *   1. proxy.ts — signed-out users are redirected to /login (optimistic).
 *   2. requireAdmin() — here (user menu) and in every page, against
 *      profiles.role / is_active. Layouts aren't re-rendered on client
 *      navigation, so each page must check too.
 *   3. RLS — the database rejects anything the role may not do.
 */
export default function AdminLayout({ children }: LayoutProps<"/[lang]/admin">) {
  return (
    <ToastProvider>
      <AdminShell userMenu={<HeaderUser />}>{children}</AdminShell>
    </ToastProvider>
  );
}

async function HeaderUser() {
  const user = await requireAdmin(await getLocale());
  // Pass only what the menu displays to the client component.
  return <UserMenu user={{ fullName: user.fullName, email: user.email, role: user.role }} />;
}
