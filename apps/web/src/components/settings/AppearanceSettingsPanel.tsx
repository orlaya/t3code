import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import type { ServerConfigIssue } from "@t3tools/contracts";

import { useTheme } from "../../hooks/useTheme";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useSyntaxThemes } from "../../rpc/serverState";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

function findIssueForPath(
  issues: readonly ServerConfigIssue[] | undefined,
  path: string,
): ServerConfigIssue | undefined {
  if (!issues || !path) return undefined;
  return issues.find(
    (issue) => issue.kind === "syntaxThemes.malformed-config" && issue.path === path,
  );
}

function ThemeIssueStatus({ message }: { message: string }) {
  return <span className="text-destructive">{message}</span>;
}

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

export function AppearanceSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const syntaxThemes = useSyntaxThemes();

  const darkIssue = findIssueForPath(syntaxThemes?.issues, settings.syntaxThemeDarkPath);
  const lightIssue = findIssueForPath(syntaxThemes?.issues, settings.syntaxThemeLightPath);
  const diffIssue = findIssueForPath(syntaxThemes?.issues, settings.diffThemePath);

  return (
    <SettingsPageContainer>
      <SettingsSection title="General">
        <SettingsRow
          title="Theme"
          description="Choose how T3 Code looks across the app."
          resetAction={
            theme !== "system" ? (
              <SettingResetButton label="theme" onClick={() => setTheme("system")} />
            ) : null
          }
          control={
            <Select
              value={theme}
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") {
                  setTheme(value);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Theme preference">
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Time format"
          description="System default follows your browser or OS clock preference."
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({ timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Timestamp format">
                <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {TIMESTAMP_FORMAT_LABELS.locale}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {TIMESTAMP_FORMAT_LABELS["12-hour"]}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {TIMESTAMP_FORMAT_LABELS["24-hour"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Diff line wrapping"
          description="Set the default wrap state when the diff panel opens."
          resetAction={
            settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap ? (
              <SettingResetButton
                label="diff line wrapping"
                onClick={() =>
                  updateSettings({ diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffWordWrap}
              onCheckedChange={(checked) => updateSettings({ diffWordWrap: Boolean(checked) })}
              aria-label="Wrap diff lines by default"
            />
          }
        />

        <SettingsRow
          title="Assistant output"
          description="Show token-by-token output while a response is in progress."
          resetAction={
            settings.enableAssistantStreaming !==
            DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming ? (
              <SettingResetButton
                label="assistant output"
                onClick={() =>
                  updateSettings({
                    enableAssistantStreaming: DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.enableAssistantStreaming}
              onCheckedChange={(checked) =>
                updateSettings({ enableAssistantStreaming: Boolean(checked) })
              }
              aria-label="Stream assistant messages"
            />
          }
        />

        <SettingsRow
          title="Work log history"
          description="How many past turns keep their work logs and thinking blocks visible."
          resetAction={
            settings.workLogHistory !== DEFAULT_UNIFIED_SETTINGS.workLogHistory ? (
              <SettingResetButton
                label="work log history"
                onClick={() =>
                  updateSettings({ workLogHistory: DEFAULT_UNIFIED_SETTINGS.workLogHistory })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.workLogHistory}
              onValueChange={(value) => {
                if (value !== null && ["latest", "2", "3", "4", "5", "all"].includes(value)) {
                  updateSettings({ workLogHistory: value as typeof settings.workLogHistory });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label="Work log history">
                <SelectValue>
                  {settings.workLogHistory === "latest"
                    ? "Latest only"
                    : settings.workLogHistory === "all"
                      ? "All turns"
                      : `Last ${settings.workLogHistory} turns`}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  Latest only
                </SelectItem>
                <SelectItem hideIndicator value="2">
                  Last 2 turns
                </SelectItem>
                <SelectItem hideIndicator value="3">
                  Last 3 turns
                </SelectItem>
                <SelectItem hideIndicator value="4">
                  Last 4 turns
                </SelectItem>
                <SelectItem hideIndicator value="5">
                  Last 5 turns
                </SelectItem>
                <SelectItem hideIndicator value="all">
                  All turns
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Task sidebar"
          description="Open the plan and task sidebar automatically when steps appear."
          resetAction={
            settings.autoOpenPlanSidebar !== DEFAULT_UNIFIED_SETTINGS.autoOpenPlanSidebar ? (
              <SettingResetButton
                label="task sidebar"
                onClick={() =>
                  updateSettings({
                    autoOpenPlanSidebar: DEFAULT_UNIFIED_SETTINGS.autoOpenPlanSidebar,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.autoOpenPlanSidebar}
              onCheckedChange={(checked) =>
                updateSettings({ autoOpenPlanSidebar: Boolean(checked) })
              }
              aria-label="Open the task sidebar automatically"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Syntax highlighting">
        <SettingsRow
          title="Syntax theme (dark)"
          description="Path to a Shiki / VS Code theme JSON file used when dark mode is active. Leave empty for Pierre defaults."
          wideControl
          status={darkIssue ? <ThemeIssueStatus message={darkIssue.message} /> : null}
          resetAction={
            settings.syntaxThemeDarkPath ? (
              <SettingResetButton
                label="dark syntax theme"
                onClick={() => updateSettings({ syntaxThemeDarkPath: "" })}
              />
            ) : null
          }
          control={
            <Input
              className="w-full lg:w-72"
              value={settings.syntaxThemeDarkPath}
              onChange={(e) => updateSettings({ syntaxThemeDarkPath: e.target.value })}
              placeholder="~/.vscode/themes/my-dark.json"
              spellCheck={false}
              aria-label="Dark syntax theme path"
            />
          }
        />

        <SettingsRow
          title="Syntax theme (light)"
          description="Path to a Shiki / VS Code theme JSON file used when light mode is active. Leave empty for Pierre defaults."
          wideControl
          status={lightIssue ? <ThemeIssueStatus message={lightIssue.message} /> : null}
          resetAction={
            settings.syntaxThemeLightPath ? (
              <SettingResetButton
                label="light syntax theme"
                onClick={() => updateSettings({ syntaxThemeLightPath: "" })}
              />
            ) : null
          }
          control={
            <Input
              className="w-full lg:w-72"
              value={settings.syntaxThemeLightPath}
              onChange={(e) => updateSettings({ syntaxThemeLightPath: e.target.value })}
              placeholder="~/.vscode/themes/my-light.json"
              spellCheck={false}
              aria-label="Light syntax theme path"
            />
          }
        />

        <SettingsRow
          title="Diff theme"
          description="Path to a JSONC file controlling diff block colours — addition/deletion tints, hover states, separators. Leave empty for defaults."
          wideControl
          status={diffIssue ? <ThemeIssueStatus message={diffIssue.message} /> : null}
          resetAction={
            settings.diffThemePath ? (
              <SettingResetButton
                label="diff theme"
                onClick={() => updateSettings({ diffThemePath: "" })}
              />
            ) : null
          }
          control={
            <Input
              className="w-full lg:w-72"
              value={settings.diffThemePath}
              onChange={(e) => updateSettings({ diffThemePath: e.target.value })}
              placeholder="~/.t3/diff-theme.jsonc"
              spellCheck={false}
              aria-label="Diff theme path"
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
