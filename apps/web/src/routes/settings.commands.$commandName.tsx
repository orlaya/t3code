import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { CommandEditForm } from "../components/settings/CommandEditForm";
import { useSettings } from "../hooks/useSettings";

function EditCommandRoute() {
  const { commandName } = Route.useParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const exists = settings.customSlashCommands.some((cmd) => cmd.name === commandName);

  useEffect(() => {
    if (!exists) {
      void navigate({ to: "/settings/commands", replace: true });
    }
  }, [exists, navigate]);

  if (!exists) return null;

  return <CommandEditForm commandName={commandName} />;
}

export const Route = createFileRoute("/settings/commands/$commandName")({
  component: EditCommandRoute,
});
