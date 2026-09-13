import { getOpenRouterKeyStatus } from "@/server/openrouter-key";
import { OpenRouterSettings } from "@/ui/openrouter-settings";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <OpenRouterSettings initialStatus={getOpenRouterKeyStatus()} />;
}
