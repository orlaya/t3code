import { createFileRoute } from "@tanstack/react-router";

import { HooksSettings } from "../components/settings/HooksSettings";

export const Route = createFileRoute("/settings/hooks/")({
  component: HooksSettings,
});
