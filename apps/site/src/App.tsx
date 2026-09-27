import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Download,
  FileText,
  Github,
  Layers,
  Puzzle,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import releaseData from './generated/release.json';
import { allInstallers, detectOs, formatSize, installersFor, type Asset, type Os } from './installers.js';

interface Release {
  tag: string;
  url: string;
  prerelease: boolean;
  assets: Asset[];
}

const release = releaseData as Release | null;
const REPO = 'https://github.com/mirrorfolio-idea-labs/AEOS';
const RELEASES = `${REPO}/releases`;
const BASE = import.meta.env.BASE_URL;
const DOCS = `${BASE}docs/`;
const INSTALL = `curl -fsSL https://mirrorfolio-idea-labs.github.io${BASE}install.sh | sh`;

const features: Array<{ icon: ReactNode; title: string; body: string }> = [
  {
    icon: <RotateCcw aria-hidden className="h-5 w-5" />,
    title: 'Survives anything',
    body: 'Kill the daemon, reboot, upgrade. The agent resumes at its last checkpoint with nothing lost and nothing re-explained.',
  },
  {
    icon: <FileText aria-hidden className="h-5 w-5" />,
    title: 'Files are the truth',
    body: "An agent's memory, plans, transcripts and costs are plain files in git. Inspect them, diff them, back them up.",
  },
  {
    icon: <ShieldCheck aria-hidden className="h-5 w-5" />,
    title: 'Least privilege by default',
    body: 'Tiered policy with an approvals inbox, daemon-enforced budgets, secret redaction and an optional container sandbox.',
  },
  {
    icon: <Layers aria-hidden className="h-5 w-5" />,
    title: 'Autonomous, accountable',
    body: 'A planner, cost-aware model routing, verification gates and a retrospective that turns mistakes into lessons.',
  },
  {
    icon: <Puzzle aria-hidden className="h-5 w-5" />,
    title: 'Your harness, your models',
    body: 'Claude Code, OpenCode and Codex out of the box, each in a hermetic profile. Anything else as a plugin.',
  },
  {
    icon: <ServerCog aria-hidden className="h-5 w-5" />,
    title: 'Runs where you do',
    body: 'Desktop app, a login service, Docker Compose or Kubernetes. Local-first, with a token gate for remote access.',
  },
];

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 p-2 pl-4 font-mono text-sm text-zinc-100">
      <span aria-hidden className="select-none text-emerald-400">
        $
      </span>
      <code className="flex-1 overflow-x-auto whitespace-nowrap">{command}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="rounded-md p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        aria-label={copied ? 'Copied' : 'Copy install command'}
      >
        {copied ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
      </button>
    </div>
  );
}

function osName(os: Os): string {
  return os === 'macos' ? 'macOS' : os === 'linux' ? 'Linux' : os === 'windows' ? 'Windows' : 'your device';
}

function DesktopDownload({ os }: { os: Os }) {
  const assets = release?.assets ?? [];
  const mine = installersFor(os, assets);
  const others = allInstallers(assets).filter((i) => !mine.some((m) => m.asset.name === i.asset.name));
  const [primary, ...alternatives] = mine;
  return (
    <div className="flex flex-col gap-4">
      {primary !== undefined ? (
        <a
          href={primary.asset.url}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          <Download aria-hidden className="h-5 w-5" />
          {primary.label}
          <span className="font-normal text-zinc-800">({formatSize(primary.asset.size)})</span>
        </a>
      ) : (
        <p className="text-sm text-zinc-300">
          {os === 'windows'
            ? 'No Windows app yet: run AEOS in WSL2 with the one-line install below.'
            : `No desktop build for ${osName(os)} yet.`}{' '}
          <a className="text-emerald-400 underline hover:text-emerald-300" href={RELEASES}>
            All releases
          </a>
        </p>
      )}
      {alternatives.length + others.length > 0 && (
        <ul className="grid gap-1 text-sm text-zinc-300">
          {[...alternatives, ...others].map((i) => (
            <li key={i.asset.name}>
              <a className="text-emerald-400 underline hover:text-emerald-300" href={i.asset.url}>
                {i.label}
              </a>{' '}
              <span className="text-zinc-400">
                · {i.detail} · {formatSize(i.asset.size)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-zinc-400">
        {release !== null ? (
          <>
            <a className="underline hover:text-zinc-200" href={release.url}>
              {release.tag}
            </a>
            {release.prerelease ? ' (pre-release)' : ''} · checksums, SBOMs and signatures on the release page
          </>
        ) : (
          <a className="underline hover:text-zinc-200" href={RELEASES}>
            Downloads are on the Releases page
          </a>
        )}
      </p>
    </div>
  );
}

export function App() {
  const [os, setOs] = useState<Os>('other');
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    setOs(detectOs(navigator.userAgent, nav.userAgentData?.platform ?? navigator.platform));
  }, []);
  const year = useMemo(() => new Date().getFullYear(), []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-zinc-900">
        Skip to content
      </a>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <a href={BASE} className="text-lg font-bold tracking-tight">
          AEOS
        </a>
        <nav aria-label="Main" className="flex items-center gap-5 text-sm text-zinc-300">
          <a className="hover:text-white" href={DOCS}>
            Docs
          </a>
          <a className="hover:text-white" href="#install">
            Install
          </a>
          <a className="inline-flex items-center gap-1 hover:text-white" href={REPO}>
            <Github aria-hidden className="h-4 w-4" /> GitHub
          </a>
        </nav>
      </header>

      <main id="main">
        <section className="mx-auto max-w-6xl px-6 pb-16 pt-12 text-center sm:pt-20">
          <p className="mb-4 text-sm font-medium uppercase tracking-widest text-emerald-400">Open source · local-first</p>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            AI coding agents that never lose their place
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-300">
            In AEOS the agent, not the chat, is the durable object. Its memory, plan and progress are plain files, so a
            crash, a reboot or an upgrade resumes exactly where the work stopped.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#install"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            >
              <Download aria-hidden className="h-5 w-5" /> Get AEOS
            </a>
            <a
              href={`${DOCS}getting-started/quickstart/`}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-3 font-semibold hover:border-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            >
              <BookOpen aria-hidden className="h-5 w-5" /> Read the quickstart
            </a>
          </div>
          <img
            src={`${BASE}screens/ade-session.png`}
            width={1440}
            height={900}
            alt="The AEOS web UI streaming an agent's session output"
            className="mx-auto mt-16 w-full max-w-5xl rounded-xl border border-zinc-800 shadow-2xl shadow-emerald-500/10"
          />
        </section>

        <section aria-labelledby="features" className="border-t border-zinc-800 bg-zinc-900/40">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 id="features" className="text-center text-3xl font-bold tracking-tight">
              Built for work that takes more than one sitting
            </h2>
            <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <li key={f.title} className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
                  <div className="mb-3 inline-flex rounded-lg bg-emerald-500/10 p-2 text-emerald-400">{f.icon}</div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-300">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="install-title" id="install" className="mx-auto max-w-6xl scroll-mt-8 px-6 py-20">
          <h2 id="install-title" className="text-center text-3xl font-bold tracking-tight">
            Install
          </h2>
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 p-6">
              <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold">
                <Download aria-hidden className="h-5 w-5 text-emerald-400" /> Desktop app
              </h3>
              <p className="mb-5 text-sm text-zinc-300">
                Starts the daemon for you, with native notifications when an agent needs you.
              </p>
              <DesktopDownload os={os} />
            </div>
            <div className="rounded-xl border border-zinc-800 p-6">
              <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold">
                <Terminal aria-hidden className="h-5 w-5 text-emerald-400" /> Command line
              </h3>
              <p className="mb-5 text-sm text-zinc-300">
                Linux and macOS. Installs the daemon and the <code className="text-zinc-100">aeos</code> CLI, verified
                against the release checksums (and its signature when cosign is installed).
              </p>
              <CopyCommand command={INSTALL} />
              <p className="mt-4 text-sm text-zinc-300">
                Then run <code className="text-zinc-100">aeosd run</code> and open{' '}
                <code className="text-zinc-100">http://127.0.0.1:7777</code>. Update any time with{' '}
                <code className="text-zinc-100">aeos update</code>.
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="see" className="border-t border-zinc-800 bg-zinc-900/40">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-2">
            <div>
              <h2 id="see" className="text-3xl font-bold tracking-tight">
                You stay in charge
              </h2>
              <p className="mt-4 text-zinc-300">
                Risky actions park in an approvals inbox until you decide. Every change lands as a commit in its own
                worktree, with a review pane that sends your comments straight back to the agent.
              </p>
              <a
                href={`${DOCS}getting-started/first-agent/`}
                className="mt-6 inline-flex items-center gap-2 text-emerald-400 underline hover:text-emerald-300"
              >
                Walk through your first agent
              </a>
            </div>
            <div className="grid gap-4">
              <img
                src={`${BASE}screens/ade-approvals.png`}
                width={1440}
                height={900}
                loading="lazy"
                alt="The approvals inbox holding an agent's parked action"
                className="rounded-xl border border-zinc-800"
              />
              <img
                src={`${BASE}screens/ade-review.png`}
                width={1440}
                height={900}
                loading="lazy"
                alt="The review pane showing an agent's diff with comments"
                className="rounded-xl border border-zinc-800"
              />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-zinc-400 sm:flex-row sm:justify-between">
          <p>© {year} Mirrorfolio · MIT licensed</p>
          <nav aria-label="Footer" className="flex gap-5">
            <a className="hover:text-zinc-200" href={DOCS}>
              Docs
            </a>
            <a className="hover:text-zinc-200" href={RELEASES}>
              Releases
            </a>
            <a className="hover:text-zinc-200" href={`${REPO}/blob/main/SECURITY.md`}>
              Security
            </a>
            <a className="hover:text-zinc-200" href={REPO}>
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
