import { PageSkeleton } from "@/components/ui/states";
import { getMessages } from "@/lib/i18n/server";

export default async function Loading() {
  const messages = await getMessages();
  return <PageSkeleton label={messages.common.loading} />;
}
