import type { Provider, ProviderProfile, Settings } from './types';

export const providers: Record<Provider, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  google: 'Google Gemini',
  claude: 'Claude (Anthropic)',
};
export const blankProfile = (): ProviderProfile => ({ apiKey: '', model: '', consent: false });
export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && Object.hasOwn(providers, value);
}
export function normalizeSettings(value: Partial<Settings>): Settings {
  const provider = isProvider(value.provider) ? value.provider : 'openai';
  const profiles = { ...value.profiles };
  const profile = {
    apiKey: value.apiKey ?? profiles[provider]?.apiKey ?? '',
    model: value.model ?? profiles[provider]?.model ?? '',
    consent: value.consent ?? profiles[provider]?.consent ?? false,
  };
  profiles[provider] = profile;
  return { provider, profiles, ...profile };
}
export function updateSettings(settings: Settings, change: Record<string, unknown>): Settings {
  const provider = change.provider ?? settings.provider;
  if (!isProvider(provider)) throw new Error('不支持的 AI 服务商');
  const old = settings.profiles[provider] || blankProfile();
  const profile = {
    apiKey: change.clearKey ? '' : String(change.apiKey || '').trim() || old.apiKey,
    model: String(change.model ?? old.model)
      .trim()
      .slice(0, 120),
    consent: change.consent === undefined ? old.consent : !!change.consent,
  };
  return { provider, ...profile, profiles: { ...settings.profiles, [provider]: profile } };
}
export function publicSettings(settings: Settings) {
  const redact = (p: ProviderProfile) => ({
    model: p.model,
    consent: p.consent,
    apiKey: '',
    hasKey: !!p.apiKey,
  });
  const profiles = Object.fromEntries(
    Object.keys(providers).map((id) => [
      id,
      redact(settings.profiles[id as Provider] || blankProfile()),
    ]),
  ) as Record<Provider, ReturnType<typeof redact>>;
  return { provider: settings.provider, ...redact(settings), profiles };
}
