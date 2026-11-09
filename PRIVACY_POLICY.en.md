# PageCraft Privacy Policy

Effective date: November 9, 2026

Publisher: PageCraft contributors

Privacy and support contact: yxf4559@gmail.com

This policy describes the PageCraft 0.1.0 extension reviewed for this release.
It does not cover unrelated websites or services accessed through user-created scripts.

## Data We Handle

PageCraft stores provider settings, API keys, crafts, tool code, parameters, URL rules,
versions, preferences, and task/run state in local extension storage. Some operational
records include target URLs, tab identifiers, timestamps, status, and errors. Craft
drafts and recent conversation context are held in browser session storage.

When generating a craft, PageCraft processes your request, relevant existing code,
page title and URL, and a structural summary of page content. Recent successful
requests for the same craft may be included as context. The summary collector omits
form controls, editable and hidden content, and scripts/styles, and removes query
strings and fragments from the summary URL. Visible text and element identifiers
may nevertheless contain personal or sensitive information. Other operational URLs
are not guaranteed to receive the same filtering.

Screenshots can include all visible content, including form values and personal
information. Custom tools can extract text or process other data available on an
authorized webpage. Data entered in prompts, code, and tool parameters is controlled
by you and may itself be sensitive.

## AI Requests and Recipients

After you configure and authorize a provider, generation requests are sent over
HTTPS directly to the selected provider: OpenAI, DeepSeek, Google Gemini, or
Anthropic. The request can include your prompt, relevant code and conversation
context, and applicable page summary. Custom-tool generation includes the current
page summary only when you choose that option.

When a tool calls `ctx.ai.ask()`, its instruction and input are sent to the configured
provider; a page summary is not added automatically. A tool may itself collect data
and include it in the input. Provider API keys are transmitted to the corresponding
provider to authenticate API calls. Connection tests also contact that provider.

Requests can incur charges on your provider account. Provider processing, retention,
training settings, and international transfers depend on that service and account;
PageCraft does not promise zero retention or control those policies. Cancelling a
request does not retract content already sent or reverse charges already incurred.

## Local Processing and User Scripts

The reviewed extension has no PageCraft-operated account service, cloud sync,
analytics, or advertising backend. Built-in screenshot processing does not itself
send images to an AI provider. Downloaded files are saved under your control.

Saved crafts run on matching authorized sites. Tools can also run automatically
when you explicitly enable automatic startup. Such code can read or modify DOM
content and make network requests to services chosen by that code. PageCraft's
syntax validation does not establish that code is safe. Data sent by custom code
is not necessarily covered by the limited inputs of PageCraft's built-in AI flow.
Inspect code before running it, particularly on sensitive pages.

## Storage and Security

API keys are used by the background worker and are not intentionally passed to
webpage scripts or AI prompts. Extension storage access is restricted to trusted
extension contexts. **The current implementation does not add application-level
encryption for locally stored keys or content.** Local users or tools with sufficient
machine/debugging access may read that data. No absolute security claim is made.

The extension's own AI requests use HTTPS. User-created scripts may make their own
network requests; this development version does not impose an HTTPS-only policy on
all script networking. Use trusted code and avoid sensitive inputs.

## Retention and Your Controls

- Settings and saved crafts/tools remain locally until removed, cleared, or the extension is uninstalled. Up to 10 versions are retained per craft/tool.
- Craft deletion offers a 10-second undo window before cleanup. Tool deletion does not have that same undo flow.
- Conversation session data is cleared with the browser session or via the application's data-clearing flow. Task/run state may remain locally until overwritten or cleared.
- Tool results are transient in the extension UI; downloaded files remain until you delete them separately.
- You can change providers, clear the selected provider's key, disable or delete crafts/tools, revoke website permissions in Chrome, or clear application data in Settings.
- The current Clear all data action resets application content/settings and session data; separate interface language/surface preferences may remain. Removing the extension clears its extension storage. Previously downloaded files and provider-held data are not deleted by these actions.

Reload affected pages after disabling scripts or clearing data. Cleanup cannot
reverse every DOM change, submitted form, or network side effect. Requests to delete
provider-held data must follow the relevant provider's process.

## Purpose and Contact

The extension's built-in data processing supports user-requested webpage
customization and reusable tools. The reviewed code does not implement sale of
user data, advertising profiles, or credit/eligibility scoring. These observations
must remain accurate for the distributed version and any publisher-operated service.

For privacy questions, contact yxf4559@gmail.com. If you voluntarily send support
messages or screenshots, their handling and retention must be covered by the
publisher's confirmed support process before this policy is published.

Changes in data processing require a corresponding policy update and any applicable
notice or consent. Confirm the effective date and operator details before publication.
