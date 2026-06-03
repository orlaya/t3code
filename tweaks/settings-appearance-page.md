# Settings Appearance Page

## Intent

Appearance and display controls belong on the Appearance settings page, not mixed back into General after upstream merges.

## Current behaviour

General keeps app-wide workflow settings such as default thread mode, project browser start path, archive/delete confirmation, Git text generation model, About, and Diagnostics.

Appearance owns theme, time format, diff line wrapping, assistant output streaming, work log history, task sidebar auto-open, syntax theme paths, and the diff theme path.

The global restore-defaults action lives at the bottom of the General settings page, not in the settings header, so it is harder to click accidentally.

## Key files

- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/components/settings/AppearanceSettingsPanel.tsx`

## Merge notes

Do not re-add Appearance-owned rows to `GeneralSettingsPanel`. There is an explicit JSX comment at the top of the General section so accidental upstream reintroductions land beside the warning and are easy to catch.

Do not move restore defaults back into the settings route header.
