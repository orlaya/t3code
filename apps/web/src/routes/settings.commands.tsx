import { createFileRoute } from "@tanstack/react-router";

import { CommandsSettings } from "../components/settings/CommandsSettings";

export const Route = createFileRoute("/settings/commands")({
  component: CommandsSettings,
});
