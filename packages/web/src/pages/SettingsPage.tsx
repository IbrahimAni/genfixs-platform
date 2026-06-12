import { useEffect, useState } from 'react';
import { Card, Mono, PageHeader, SectionTitle } from '../components/ui';
import { api, type Settings } from '../lib/api';

const THRESHOLD_LABELS: Record<keyof Settings['policies']['confidenceThresholds'], string> = {
  heal: 'Heal (benign drift)',
  proposeRewrite: 'Propose rewrite (behavior change)',
  reportRegression: 'Report regression',
  featureMissing: 'Feature missing',
  flaky: 'Flaky',
};

export function SettingsPage({ projectId }: { projectId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.settings(projectId).then(setSettings, console.error);
  }, [projectId]);

  if (!settings) return null;

  const save = async (next: Settings) => {
    setSettings(next);
    setSaved(false);
    await api.saveSettings(projectId, {
      policies: next.policies,
      ...(next.verificationBaseUrl !== null
        ? { verificationBaseUrl: next.verificationBaseUrl }
        : {}),
    });
    setSaved(true);
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Repository connections and merge policy." />

      <div className="flex flex-col gap-6">
        <Card className="px-5 py-4">
          <SectionTitle>Connections</SectionTitle>
          <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
            <dt className="text-ink-500">Test repository</dt>
            <dd>
              <Mono>
                {settings.testRepo.owner}/{settings.testRepo.name}
              </Mono>
            </dd>
            <dt className="text-ink-500">App repository</dt>
            <dd>
              {settings.appRepo ? (
                <Mono>
                  {settings.appRepo.owner}/{settings.appRepo.name}
                </Mono>
              ) : (
                <span className="text-ink-400">
                  not connected — diff-based diagnosis unavailable
                </span>
              )}
            </dd>
            <dt className="text-ink-500">CI provider</dt>
            <dd>{settings.ciProvider}</dd>
            <dt className="text-ink-500">Framework</dt>
            <dd>{settings.framework}</dd>
            <dt className="text-ink-500">Verification URL</dt>
            <dd>
              {settings.verificationBaseUrl ? (
                <Mono>{settings.verificationBaseUrl}</Mono>
              ) : (
                <span className="text-ink-400">none — heals cannot verify, so none will surface</span>
              )}
            </dd>
          </dl>
        </Card>

        <Card className="px-5 py-4">
          <SectionTitle>Merge policy</SectionTitle>
          <label className="flex items-start gap-3 py-1">
            <input
              type="checkbox"
              className="mt-1 accent-(--color-accent)"
              checked={settings.policies.autoMergeBenignDrift}
              onChange={(ev) =>
                save({
                  ...settings,
                  policies: { ...settings.policies, autoMergeBenignDrift: ev.target.checked },
                })
              }
            />
            <span>
              <span className="block text-sm font-medium text-ink-900">
                Auto-merge verified benign-drift heals
              </span>
              <span className="block text-sm leading-6 text-ink-500">
                Off by default. Only locator-level fixes that verified green are ever eligible;
                behavioral rewrites always require your approval regardless of this setting.
              </span>
            </span>
          </label>

          <div className="mt-4 border-t border-ink-100 pt-4">
            <span className="block text-sm font-medium text-ink-900">Deletion sign-off</span>
            <span className="block text-sm leading-6 text-ink-500">
              Always required. GenFixs never deletes a test and never auto-merges a removal; this is
              not configurable.
            </span>
          </div>
        </Card>

        <Card className="px-5 py-4">
          <SectionTitle>Confidence thresholds</SectionTitle>
          <p className="mb-3 text-sm leading-6 text-ink-500">
            Below the threshold for its classification, a diagnosis degrades to unclassified and the
            test is quarantined instead of acted on. Healing demands the highest confidence.
          </p>
          <div className="flex flex-col gap-2">
            {(
              Object.keys(THRESHOLD_LABELS) as (keyof Settings['policies']['confidenceThresholds'])[]
            ).map((key) => (
              <label key={key} className="grid grid-cols-[16rem_1fr_3rem] items-center gap-3 text-sm">
                <span className="text-ink-700">{THRESHOLD_LABELS[key]}</span>
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.01}
                  className="accent-(--color-accent)"
                  value={settings.policies.confidenceThresholds[key]}
                  onChange={(ev) =>
                    save({
                      ...settings,
                      policies: {
                        ...settings.policies,
                        confidenceThresholds: {
                          ...settings.policies.confidenceThresholds,
                          [key]: Number(ev.target.value),
                        },
                      },
                    })
                  }
                />
                <span className="text-right tabular-nums text-ink-700">
                  {settings.policies.confidenceThresholds[key].toFixed(2)}
                </span>
              </label>
            ))}
          </div>
        </Card>

        {saved && <p className="text-xs text-ink-400">Saved.</p>}
      </div>
    </div>
  );
}
