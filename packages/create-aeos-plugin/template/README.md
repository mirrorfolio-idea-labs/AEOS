# __NAME__

An [AEOS](https://github.com/mirrorfolio-idea-labs/AEOS) provider plugin,
scaffolded by `create-aeos-plugin`. It contributes the provider
`plugin:__ID__`.

## Try it

```bash
npm pack                                   # → __TARBALL__
aeos plugin install ./__TARBALL__          # runs no install scripts
aeos plugin list                           # check it is loaded
# point an agent at it
aeos agent create my-agent --workspace ws --name "Echo" --provider plugin:__ID__
```

## Make it yours

Edit `src/index.js`. The header comment there spells out the contract, and
the AEOS plugin guide (`docs/plugins.md`) covers it in depth. Bump `contract`
in `package.json` only when you move to a new AEOS plugin ABI.
