import { createFileRoute } from "@tanstack/react-router";

import { CommandEditForm } from "../components/settings/CommandEditForm";

function NewCommandRoute() {
  return <CommandEditForm />;
}

export const Route = createFileRoute("/settings/commands/new")({
  component: NewCommandRoute,
});
