# PageCraft

<img src="public/icons/icon-128.png" alt="PageCraft logo" width="80" height="80">

**Persistent webpage customization with AI, plus reusable browser tools.**

English | [简体中文](README.zh-CN.md)

PageCraft is a Chrome Manifest V3 extension. Describe a webpage change in natural language, generate a **craft**, and save it to run again on matching pages. You can also create reusable tools with AI or JavaScript and run them manually or automatically on authorized sites.

Built for people who want to adapt the web to their workflows, PageCraft combines persistent webpage changes with reusable browser tools. Bring your own AI provider, inspect the generated code, and keep your saved crafts and tools in your browser.

**Status:** early development (0.1.0). This repository contains the extension source, tests, and developer documentation. Install from source using the instructions below. PageCraft is open source under the [MIT License](LICENSE).

[Quick start](#installation) · [AI providers](#settings-and-ai-providers) · [Development](#development-and-tests) · [Contributing](#contributing) · [Security](#security-reports)

> **Development-mode warning:** scripts are checked for syntax and response structure, not safety. User-script CSP is permissive. Generated or manually written code can read page data, change the DOM, and access the network. Use trusted code on test pages. Cancellation, disabling, and rollback cannot undo every side effect. This is not a security sandbox.

## Features

| Area             | Current capabilities                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Crafts           | Natural-language generation, page summaries, element selection, include/exclude URL rules, automatic application, and SPA route handling |
| Craft management | Enable/disable, source editing, stable names during AI revisions, last 10 versions, rollback, and a 10-second undo window after deletion |
| Built-in tools   | Visible-area and full-page screenshots, preview, download, and cancellation; no AI key required                                          |
| Custom tools     | AI generation or async JavaScript, JSON parameters, temporary CSS, test runs, versions, and text/table/image/file results                |
| Automatic tools  | All-site or site-specific startup, optional rerun on SPA navigation, and lifecycle cleanup                                               |
| Runtime AI       | Custom tools call `ctx.ai.ask()` through the background worker without receiving the API key                                             |
| Surfaces         | 420px popup, side panel, and management page; remembered popup/side-panel preference                                                     |
| Languages        | English, Simplified Chinese, browser-language detection, and synchronized language preferences                                           |

## What Can You Build?

- A craft that hides distracting page sections or adjusts a site's reading layout.
- A reusable tool that collects links into a downloadable table.
- A page action that asks your configured AI provider to summarize selected content.
- A site-specific tool that adds controls on each visit and cleans them up when disabled.

These are example requests, not bundled presets. Generated results depend on the model and the target webpage; review the code and test it before enabling automatic execution.

PageCraft focuses on user-directed webpage customization and browser tools. It is not a general-purpose cross-page agent, vulnerability scanner, or scam detector. Its interface lives in the extension popup, side panel, and management page, not a floating webpage launcher.

## Installation

Use **Chrome 138+**. The documented development workflow uses **Node.js 22.12+** and npm.

Download the repository source, or clone it using your repository host's clone URL. From the repository root:

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this project's `dist/` directory.
3. Open PageCraft's extension details and enable **Allow user scripts**.
4. Open a normal HTTP/HTTPS webpage and click the PageCraft toolbar icon.
5. The first launch opens the popup. Use the upper-right switch to open the side panel. The chosen mode persists across browser restarts.

Use the side panel for element selection, interactive tools, and long-running tasks. Chrome closes native popups when they lose focus. Closing a popup does not necessarily stop a background task; results and downloads are not guaranteed to be restored when reopening it.

After changing code, rebuild, reload the extension, and refresh the target webpage. Edge compatibility has not been fully verified.

## Settings and AI Providers

Settings contains four independent sections: **General settings**, **AI configuration**, **Script execution**, and **Local data**.

In AI configuration, choose a provider, enter your own API key and a compatible model ID, accept the data-sharing notice, and save. Testing the saved connection makes a real API request and may incur charges.

| Provider           | API host                            |
| ------------------ | ----------------------------------- |
| OpenAI             | `api.openai.com`                    |
| DeepSeek           | `api.deepseek.com`                  |
| Google Gemini      | `generativelanguage.googleapis.com` |
| Claude / Anthropic | `api.anthropic.com`                 |

Keys, models, and consent are stored separately for each provider. Save after switching providers to update the active configuration. There is no bundled AI subscription or PageCraft proxy server. Model IDs are user-supplied; supporting a provider does not guarantee support for every model it offers.

**Interface language** is in General settings and does not depend on AI configuration. Browser default uses Simplified Chinese for Chinese locales and English otherwise. Switching languages preserves editor drafts. User content and AI responses are not automatically translated. Chrome-native extension metadata follows Chrome's language, independently of the in-app preference.

## Using Crafts

1. In **Current**, describe a new craft or select an existing craft to refine.
2. Optionally inspect a page summary or select an element. Generation collects page context when none was supplied.
3. Check the scope, select **Generate and apply**, and grant the requested website access.
4. Review the result. Use **Crafts** to edit source, disable/delete a craft, or restore a version.

The current-page view shows saved crafts and the latest operation, not a full chat transcript. Recent same-craft requests may still be used internally as generation context. AI revisions preserve the name; rename crafts manually in the editor.

Example include rules:

```text
https://example.com/*
https://*.example.com/articles/*
```

Rules match scheme, hostname, and path. Do not include ports, query strings, or fragments. Matching ignores queries/fragments; exclusions take precedence. Up to 30 include/exclude rules are allowed in total.

## Custom Tools

Open **Tools > Create tool**. AI generation only fills an editor draft: it does not automatically save or execute it. Requests start empty when opening an editor and clear after successful generation. **Test run** executes real code; save after reviewing the result.

The JavaScript editor accepts an **async function body**, without an enclosing function:

```js
const links = [...document.querySelectorAll('a[href]')];
return {
  kind: 'table',
  columns: ['Title', 'URL'],
  rows: links
    .slice(0, ctx.params.limit ?? 100)
    .map((link) => [(link.textContent ?? '').trim(), link.href]),
  filename: 'links.csv',
};
```

Parameters must be a JSON object, for example `{"limit": 100}`.

| API                                          | Purpose                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `ctx.params`                                 | Saved/default run parameters                                             |
| `ctx.signal`                                 | Cooperative cancellation                                                 |
| `ctx.onCleanup(fn)`                          | Lifecycle cleanup                                                        |
| `ctx.tools.screenshot({ fullPage: false })`  | Visible-area capture; use `true` for full-page capture                   |
| `ctx.tools.extractText()`                    | Page-text extraction                                                     |
| `ctx.tools.download(result)`                 | Request a download; lifecycle differs between manual and automatic modes |
| `ctx.ai.ask({ instruction, input, signal })` | Ask the configured provider and receive text                             |

Manual runs support string, text, table, image, and text-file results. Results are temporary, not a persisted run history. Tool code, parameters, automatic-start settings, and the last 10 versions are saved locally.

Automatic startup requires explicit enablement and scope permissions. Saving an enabled automatic tool may immediately execute it on matching open pages. Automatic instances stay alive until their lifecycle ends; their return values do not appear in the extension's result preview. Register cleanup for DOM elements and listeners. Design automatic AI tools to require deliberate user action, since requests can otherwise incur charges without another toolbar click.

See [Custom tools](docs/CUSTOM_TOOLS.md) and [Runtime AI](docs/RUNTIME_AI.md) for lifecycle and result details. The custom-tool `ctx` is not interchangeable with the [craft runtime](docs/RUNTIME.md).

## Data and Permissions

- Settings, keys, crafts, and tools use local extension storage. Craft conversation drafts/context use browser session storage. There is no built-in cloud sync, account system, or telemetry backend.
- Generation sends the request, relevant existing code, and applicable page context to the selected provider. Custom-tool generation includes page context only when selected. Runtime AI sends the tool's explicit `instruction` and `input`.
- The context collector omits form controls, editable/hidden content, and scripts/styles, and strips URL queries/fragments. Visible text, titles, IDs, and class names can still contain personal information. This is not an anonymization guarantee.
- Built-in screenshots are processed locally and do not themselves call AI. They may include visible form values and personal data. Custom scripts can independently collect data or contact external services.
- API keys are used by the background worker, not passed to generated scripts. Local storage is not an encrypted vault.

| Permission                   | Purpose                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `storage`                    | Preferences, saved content, and task/session state            |
| `sidePanel`                  | Side-panel UI                                                 |
| `tabs`                       | Target-tab information and lifecycle handling                 |
| `activeTab`, `scripting`     | Capture, page context, element selection, and page operations |
| `userScripts`                | Execute crafts and custom tools                               |
| `alarms`                     | Purge deleted crafts after the undo period                    |
| Provider host permissions    | Requests to supported AI APIs                                 |
| Optional website permissions | Authorized site access, automatic tools, and capture fallback |

## Limits and Troubleshooting

- **Scripts do not run:** check Allow user scripts, website permissions, matching rules, and page support. Browser-internal pages, store pages, and PDFs are not normal craft targets.
- **Full-page screenshots fail:** the stitcher limits each dimension to 32,760 pixels and total area to 32 million pixels. Infinite scrolling, changing dimensions, or unscrollable pages may require visible-area capture.
- **Capture stops:** changing active tabs or replacing/reloading the document stops normal-page capture. Same-document URL changes alone are allowed; protected store pages use more conservative checks.
- **Chrome Web Store capture:** full-page capture is unavailable; visible-area capture may work with temporary `activeTab` access. Broad host permission does not bypass protected-page restrictions.
- **Timeouts:** code generation has a four-minute limit. Manual custom-tool runs and individual runtime-AI requests have two-minute limits. Automatic instances are not subject to the manual-run lifetime limit.
- **Cancellation/rollback:** requests already sent, submitted forms, and arbitrary DOM mutations may not be reversible. Cooperative cancellation cannot forcibly terminate synchronous infinite loops.

## Development and Tests

### Local Workflow

1. Install dependencies with `npm ci`.
2. Use `npm run dev` for UI development, or `npm run build` for a loadable extension.
3. Load `dist/` in Chrome, then rebuild and reload the extension after changes.
4. Run the relevant tests and check formatting before proposing a change.

| Command                | Purpose                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `npm run dev`          | Vite UI preview; use the URL printed in the terminal                  |
| `npm run build`        | Type-check, build UI, and bundle the worker into `dist/`              |
| `npm test`             | Unit tests, including locale fallback and static translation coverage |
| `npm run test:e2e`     | Chromium extension regression tests with mocked AI                    |
| `npm run format:check` | Check source formatting                                               |
| `npm run format`       | Format source files                                                   |

Install Chromium before running browser tests:

```sh
npx playwright install chromium
npm test
npm run test:e2e
```

The web preview cannot access extension APIs. Full validation requires the loaded extension. Browser tests use temporary profiles and an extension copy with pregranted test permissions; the distribution manifest is unchanged. They do not validate live-provider generation quality or replace manual testing of native permission prompts.

### Architecture

The React interface collects requests and manages saved content. The background service worker calls AI providers, coordinates permissions and tasks, and registers scripts. Crafts and custom tools run through Chrome's user-script API against the target page; their runtime interfaces are separate. Saved content and provider settings live in extension storage. No PageCraft backend is required.

```text
Popup / side panel / management UI
                 |
         Background service worker ----> Selected AI provider
                 |
         Craft and tool runtimes ------> Target webpage
                 |
         Chrome extension storage
```

### Source Map

```text
src/main.tsx                  Navigation, craft management, settings
src/CurrentPage.tsx           Current-page craft workflow
src/worker.ts                Messages, generation, script registration
src/ai.ts, src/providers.ts   Provider requests and profiles
src/context.ts               Page summaries and element picker
src/runtime.ts, src/rules.ts  Craft lifecycle and URL matching
src/store.ts                 Serialized storage transactions
src/check.ts                 Syntax and response validation
src/tools/                   Screenshots, tools, auto startup, runtime AI
src/i18n.ts, src/locales/     Interface localization
public/manifest.json         Permissions and entry points
public/_locales/             Chrome-native localized metadata
tests/, scripts/e2e.mjs      Unit and browser tests
```

## Contributing

Bug reports, documentation improvements, translations, tests, and focused code contributions are welcome. Contributions are provided under the project's [MIT License](LICENSE).

For a substantial feature, open an issue first to discuss the use case and scope. For a small fix:

1. Create a branch in your checkout or fork.
2. Keep the change focused and follow existing TypeScript and UI patterns.
3. Add or update tests for changed behavior. Update both READMEs when user-facing documentation changes, and include English and Chinese strings for new UI text.
4. Run `npm test`, `npm run build`, and `npm run format:check`. For extension runtime or UI changes, also run `npm run test:e2e` and manually verify the affected Chrome workflow.
5. Open a pull request describing the problem, the change, and verification results. Include screenshots for UI changes and call out changes to permissions or data sent to providers.

Do not commit API keys, `.env` files, private page content, browser profiles, generated `dist/` output, or local test artifacts. Tests should use synthetic fixtures and mocked AI, not contributors' paid API accounts.

### Reporting Bugs

Use your repository host's issue tracker. Include the Chrome version, operating system, PageCraft version or commit, popup/side-panel mode, reproduction steps, expected behavior, and actual behavior. For AI failures, include the provider and model ID, but never the API key. Redact sensitive URLs, page content, and logs. Prefer a minimal public or synthetic test page.

### Security Reports

Do not publish working exploits, credentials, or private user data in public issues. Use the repository host's private vulnerability-reporting feature if enabled, or a verified private maintainer contact. No dedicated security contact is currently documented. If no private channel is available, request one in an issue without disclosing exploit details.

The permissive script runtime described above is a known development limitation, not a guarantee of isolation. Changes that execute generated code, expose runtime APIs, or expand permissions need explicit security review.

## License

Licensed under the [MIT License](LICENSE).

Copyright (c) 2026 PageCraft contributors.
