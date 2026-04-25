import { createFileRoute } from "@tanstack/react-router";

import { HookEditForm } from "../components/settings/HookEditForm";

function NewHookRoute() {
  return <HookEditForm />;
}

export const Route = createFileRoute("/settings/hooks/new")({
  component: NewHookRoute,
});
