/** Enforces spec §5: packages talk through published entry points only. */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-package-internals',
      severity: 'error',
      comment:
        'Import other workspace packages via their package name (@aeos/x), never via relative paths into their src/.',
      from: { path: '^(packages|apps)/([^/]+)/' },
      to: { path: '^packages/([^/]+)/src/', pathNot: '^packages/$2/src/' },
    },
    {
      name: 'contracts-depends-on-nothing',
      severity: 'error',
      comment: 'packages/contracts is the dependency root (spec §5).',
      from: { path: '^packages/contracts/' },
      to: { path: '^(packages|apps)/', pathNot: '^packages/contracts/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
  },
};
