import { useEffect, useState } from 'react';
import { detectOs, formatSize, installersFor, type Asset, type Os } from '@aeos/site/installers';
import releaseData from '@aeos/site/release';

/**
 * Interactive install chooser for the docs (P5.M6.T2), mounted by a
 * `<!-- aeos:component InstallPicker -->` marker in docs/ Markdown. The
 * installer choice is the landing page's tested logic and release data.
 */
interface Release {
  tag: string;
  url: string;
  prerelease: boolean;
  assets: Asset[];
}
const release = releaseData as Release | null;
const RELEASES = 'https://github.com/mirrorfolio-idea-labs/AEOS/releases';
const INSTALL = 'curl -fsSL https://mirrorfolio-idea-labs.github.io/AEOS/install.sh | sh';
const SOURCE = [
  'git clone https://github.com/mirrorfolio-idea-labs/AEOS.git',
  'cd AEOS && corepack enable',
  'pnpm install && pnpm build',
].join('\n');

type Tab = 'desktop' | 'cli' | 'source';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'desktop', label: 'Desktop app' },
  { id: 'cli', label: 'Command line' },
  { id: 'source', label: 'From source' },
];

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="aeos-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function InstallPicker() {
  const [os, setOs] = useState<Os>('other');
  const [tab, setTab] = useState<Tab>('desktop');
  useEffect(() => setOs(detectOs(navigator.userAgent, navigator.platform)), []);
  const mine = installersFor(os, release?.assets ?? []);

  return (
    <div className="aeos-install not-content" data-os={os}>
      <div role="tablist" aria-label="How to install AEOS" className="aeos-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`aeos-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`aeos-panel-${t.id}`}
            className="aeos-tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`aeos-panel-${tab}`} aria-labelledby={`aeos-tab-${tab}`} className="aeos-panel">
        {tab === 'desktop' &&
          (mine.length > 0 ? (
            <ul>
              {mine.map((i, n) => (
                <li key={i.asset.name}>
                  <a className={n === 0 ? 'aeos-primary' : undefined} href={i.asset.url}>
                    {i.label}
                  </a>{' '}
                  <span className="aeos-dim">
                    {i.detail} · {formatSize(i.asset.size)}
                  </span>
                </li>
              ))}
              <li className="aeos-dim">
                {release?.tag} · <a href={release?.url ?? RELEASES}>all downloads, checksums and signatures</a>
              </li>
            </ul>
          ) : (
            <p>
              {os === 'windows' ? 'No Windows app yet: use WSL2 and the command-line install. ' : ''}
              Desktop installers are on the <a href={RELEASES}>Releases page</a>.
            </p>
          ))}
        {tab === 'cli' && (
          <>
            <pre>
              <code>{INSTALL}</code>
            </pre>
            <Copy text={INSTALL} />
          </>
        )}
        {tab === 'source' && (
          <>
            <pre>
              <code>{SOURCE}</code>
            </pre>
            <Copy text={SOURCE} />
          </>
        )}
      </div>
    </div>
  );
}
