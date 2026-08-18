# Contributing

Thanks for taking a look. Bug reports, ideas and pull requests are all welcome.

## Running it locally

```bash
git clone https://github.com/PythonicVarun/labpress.git
cd labpress
npm install
node src/cli.js ./some-folder-of-programs --no-open -o /tmp/record.html
```

There's no build step - the package ships the source in `src/` and runs on Node
20+. `--no-open` keeps it from launching a browser on every iteration, and
`--keep` leaves the temporary build directory around when you need to see what
was compiled.

## How the code is laid out

| File            | Does                                                                |
| --------------- | ------------------------------------------------------------------- |
| `cli.js`        | Argument parsing, subcommands, exit codes, writing output           |
| `index.js`      | Ties discovery, compiling, running and rendering together           |
| `discover.js`   | Walks the folder, matches globs, finds input files                  |
| `config.js`     | Finds and parses `labpress.config.jsonc`, resolves per-program runs |
| `languages.js`  | Per-language compile/run defaults and `{placeholder}` expansion     |
| `runner.js`     | Spawns programs, feeds stdin, records the transcript                |
| `transcript.js` | Turns recorded events into the interleaved or split model           |
| `highlight.js`  | Shiki wrapper, dual light/dark themes                               |
| `render.js`     | Builds the HTML document                                            |
| `pdf.js`        | Finds a local Chrome and prints to PDF                              |

`runner.js` is the interesting one. It writes the next input line after stdout
has been quiet for `idleMs`, and **re-arms that timer after every write** - not
only when output arrives. Dropping the re-arm deadlocks any program whose output
is fully buffered, because the prompt that would trigger the next write never
shows up. If you touch the feeder, test it against plain C compiled without
`stdbuf` and make sure it still terminates.

## Before opening a pull request

There's no test suite yet, so please check by hand:

- A program in each language you touched still compiles, runs and renders.
- An interactive program still shows its input in the right place.
- A program that reads past end-of-input still terminates instead of hanging.
- The document still prints sanely - page breaks between programs, nothing
  clipped at the right edge.

Code style is Prettier with 4-space indent. Comments should explain why
something is the way it is, not restate the line below.

## Releasing

Maintainers only. Publishing needs an npm automation token stored as the
`NPM_TOKEN` repository secret. Then:

```bash
npm version patch
git push --follow-tags
```

The tag triggers `.github/workflows/publish.yml`, which checks the tag matches
`package.json`, installs the packed tarball and runs the binary out of it as a
smoke test, publishes with provenance, and cuts a GitHub release. The workflow's
manual trigger takes a dist-tag, for pushing a `beta` or `next` without moving
`latest`.
