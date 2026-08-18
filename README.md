<h1 align="center">labpress</h1>

<p align="center">
  Turn a folder of lab programs into a print-ready record - highlighted source,
  real inputs, real captured output.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/labpress"><img alt="npm" src="https://img.shields.io/npm/v/labpress.svg"></a>
  <a href="https://www.npmjs.com/package/labpress"><img alt="node" src="https://img.shields.io/node/v/labpress.svg"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/npm/l/labpress.svg"></a>
</p>

```bash
npx labpress ./labs
```

That's the whole thing. It finds every program in the folder, compiles them,
runs them against the inputs you give it, captures what the terminal actually
printed, and opens a finished document in your browser. Ctrl+P and submit.

No install, no screenshots, no pasting code into Word every week.

---

## Contents

- [What you get](#what-you-get)
- [Install](#install)
- [Usage](#usage)
- [Configuration](#configuration)
- [Command line](#command-line)
- [Language defaults](#language-defaults)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## What you get

Most lab records are code pasted into a document with a screenshot of the
terminal glued underneath. labpress produces the real thing:

- **Source code** highlighted with the same TextMate grammars VS Code uses, with
  line numbers, wrapped so nothing runs off the edge of the page.
- **Output** captured by actually executing the program, not copied by hand.
- **Input shown where you typed it.** Your programs prompt and wait. labpress
  waits for the prompt, types the next value, and records the exchange in order,
  so the transcript reads like a real session:

    ```
    All of the outputs taken below will be expecting an input in binary ONLY.
    Flag pattern: 01111110
    Enter data: 0111111011111101      <- marked as typed input
    Stuffed data     : 011111010111110101
    Bit(s) stuffed   : 2
    Does it match the original data? Yes
    ```

    Typed values get a highlight box, so an examiner can tell input from output
    at a glance and it survives a black-and-white printer.

- **A cover page** with your name, roll number, subject and the rest, a linked
  contents list, and page breaks that land between programs instead of through
  the middle of one.
- **A PDF**, if you want it, printed by the Chrome you already have.

Works with **C, C++, Python and Java**.

---

## Install

You don't have to install anything. Every package manager can fetch and run it
in one shot:

```bash
npx labpress ./labs         # npm
yarn dlx labpress ./labs    # yarn 2+
pnpm dlx labpress ./labs    # pnpm
bunx labpress ./labs        # bun
```

The first run downloads it, after that it's cached. If you only want your record
printed, stop here - this is all you need.

**Installing it properly**, if you run it every week and want the shorter
command:

```bash
npm install -g labpress
yarn global add labpress    # yarn 1 only
pnpm add -g labpress
bun add -g labpress
```

Then it's just `labpress ./labs`. Yarn 2+ dropped `global add`, so there use
`yarn dlx` or install it with npm.

**As a project dependency**, to pin one version for a whole class or a repo:

```bash
npm install -D labpress
yarn add -D labpress
pnpm add -D labpress
bun add -d labpress
```

Run it with `npx labpress`, `yarn labpress`, `pnpm labpress` or
`bun run labpress`. Yarn's Plug'n'Play mode is supported - no `node_modules`
required.

### Requirements

Node 20 or newer, plus whatever compiler each language needs - `gcc`, `g++`,
`python3`, `javac`/`java`. Only the languages you actually use have to be
installed; labpress never touches the others.

Developed and tested on Linux. macOS and Windows are supported, with one caveat
on each: macOS needs GNU coreutils for `stdbuf` if you write plain C (see
[How it works](#how-it-works)), and Windows has no `stdbuf` at all.

---

## Usage

**1. Run it on your folder.**

```bash
npx labpress ./labs
```

Every `.c`, `.cpp`, `.py` and `.java` file gets compiled, run and rendered, and
the document opens in your browser.

**2. Give the programs their input.** Drop a file named after the source next to
it and labpress feeds it in, one line at a time, as the program asks:

```
Week-01/bit_stuffing.cpp
Week-01/bit_stuffing.in          -> one run, fed from this file
Week-01/bit_stuffing.edge.in     -> a second run, labelled "edge"
Week-01/inputs/bit_stuffing-2.txt
```

**3. Add a config when you want the rest** - proper titles, an aim line, several
labelled runs per program, and a cover page with your details:

```bash
npx labpress init ./labs
```

That writes `labpress.config.jsonc` listing every program it found, with every
option documented in comments. Fill in the blanks and run it again.

**4. Get the PDF.** Print from the browser, or let labpress drive Chrome:

```bash
npx labpress ./labs --pdf -o record.pdf
```

**5. One file per week**, if that's how your college wants it submitted:

```bash
npx labpress ./labs --split --pdf -o ./records
```

```
records/Week-01.pdf    Bit Stuffing, Byte Stuffing
records/Week-03.pdf    Parity Check, CRC, Hamming Code
records/Week-04.pdf    Stop and Wait, Go-Back-N, Selective Repeat
```

Each one gets its own cover naming the week, its own contents list, and
numbering that restarts at 1. Empty folders are skipped. Set `"split": true` in
the config to make it the default.

---

## Configuration

`labpress.config.jsonc` - JSON with comments and trailing commas allowed.
labpress looks for it in the target folder, then walks upward. Everything in it
is optional; it only exists to override what labpress guessed.

```jsonc
{
    "title": "Computer Networks - Lab Record",

    // Blank fields are skipped, so fill in only what your college wants.
    "student": {
        "name": "Your Name",
        "roll": "21CS1234",
        "course": "B.Tech CSE",
        "branch": "",
        "section": "A",
        "semester": "5th",
        "subject": "Computer Networks",
        "teacher": "",
        "university": "",
    },

    "cover": true,
    "toc": true,
    "split": false, // true for one document per subfolder
    "theme": "github-light",
    "transcript": "interleaved", // or "split"
    "footer": true, // false to remove, or a string to replace

    "include": ["**/*.{c,cc,cxx,cpp,py,java}"],
    "exclude": ["**/scratch/**"],
    "order": ["Week-01/bit_stuffing.cpp"], // the rest follow in natural order

    "defaults": {
        "timeout": 20000,
        "idleMs": 150,
        "unbuffer": "auto",
        "compileTimeout": 60000,
    },

    "programs": {
        "Week-03/crc.cpp": {
            "title": "CRC",
            "aim": "To detect errors in transmitted data using CRC.",
            "runs": [
                {
                    "label": "Clean transmission",
                    "stdin": ["1101", "111", "0"],
                },
                {
                    "label": "Corrupted transmission",
                    "stdin": ["1101", "111", "1", "110011"],
                },
            ],
        },
    },
}
```

### Run options

Each entry in `runs` is one execution of the program.

| Key          | What it does                                               |
| ------------ | ---------------------------------------------------------- |
| `label`      | Shown on the run header                                    |
| `note`       | A line of explanation above the output                     |
| `stdin`      | Array of lines, each typed when the program asks for input |
| `stdinText`  | The same thing as one string with newlines                 |
| `stdinFile`  | Read the input from a file instead                         |
| `args`       | Command-line arguments                                     |
| `env`        | Extra environment variables                                |
| `cwd`        | Working directory, if the program reads data files         |
| `timeout`    | Time limit in milliseconds for this run                    |
| `idleMs`     | How long to wait for a prompt before typing the next line  |
| `transcript` | `"interleaved"` or `"split"` for just this run             |
| `hide`       | Skip this run                                              |

### Program options

`title`, `aim`, `note`, `hide`, `transcript`, plus `compile`, `run` and
`unbuffer` when one program has to be built differently from the rest.

### Custom build commands

Override a whole language, or a single program:

```jsonc
"languages": {
    "cpp": { "compile": "g++ -O2 -std=c++20 -o {bin} {file}", "run": "{bin}" },
    "py":  { "run": "python3 -u {file}" }
}
```

Placeholders: `{file}` `{dir}` `{stem}` `{bin}` `{buildDir}` `{class}`.

Commands are split into arguments before the placeholders are filled in, so
paths containing spaces work without any quoting on your part.

---

## Command line

```
labpress [directory]        build, then open it in your browser
labpress init [directory]   write a starter config file
labpress list [directory]   show what would be included
labpress themes             list available syntax themes
```

| Flag                  | Effect                                             |
| --------------------- | -------------------------------------------------- |
| `-o, --out <path>`    | Where to write it (a directory with `--split`)     |
| `--split`             | One document per subfolder - e.g. one PDF per week |
| `--pdf`               | Also write a PDF using your installed Chrome       |
| `--no-open`           | Don't launch the browser                           |
| `--no-run`            | Render the source only, execute nothing            |
| `--no-footer`         | Drop the labpress credit line                      |
| `--theme <name>`      | Any theme Shiki ships                              |
| `--transcript <mode>` | `interleaved` or `split`                           |
| `--title <text>`      | Document title                                     |
| `--only <glob>`       | Limit to matching files, repeatable                |
| `--timeout <ms>`      | Per-run time limit                                 |
| `-c, --config <path>` | Use a specific config file                         |
| `--keep`              | Keep the temporary build directory                 |
| `--json`              | Machine-readable output on stdout                  |
| `-q, --quiet`         | Only report problems                               |

Give `--out` a `.pdf` name and the PDF lands exactly there, with the HTML beside
it. With `--split`, `--out` is the directory the documents go into.

Logs go to stderr and JSON to stdout, so `--json` stays parseable. Exit codes:
`0` fine, `2` bad usage, `3` bad config, `4` nothing found, `5` a program failed
to compile or run, `6` PDF generation failed.

---

## Language defaults

| Language | Compile                              | Run                           |
| -------- | ------------------------------------ | ----------------------------- |
| C        | `gcc -O2 -o {bin} {file}`            | `{bin}`                       |
| C++      | `g++ -O2 -std=c++17 -o {bin} {file}` | `{bin}`                       |
| Python   | -                                    | `python3 -u {file}`           |
| Java     | `javac -d {buildDir} {file}`         | `java -cp {buildDir} {class}` |

For Java, the class name is read from the `public class` declaration, so the
file name doesn't have to match.

---

## How it works

**The interleaving.** labpress runs your program over pipes and waits for its
output to go quiet before typing the next input line. C++ (`cin` is tied to
`cout`), Python (`input()` flushes) and Java (`System.out` autoflushes) all push
their prompt out before blocking on a read, which is what makes the recorded
order accurate. No PTY, no native modules - that's why it runs straight from
`npx`.

**Plain C is the exception.** `printf` into a pipe stays buffered, so the prompt
doesn't arrive until the program exits and everything lumps together at the end.
labpress runs C through `stdbuf -o0` where that exists, which fixes it
completely. Where it doesn't, the run still finishes - labpress notices the
ordering can't be trusted, renders that one as separate Input and Output blocks,
and says so in the document rather than printing a plausible lie.

**Runaway programs are contained.** A program that hits end-of-input inside a
validation loop will print the same complaint forever. Runs stop at the time
limit, output stops at 64 KB, and repeated lines collapse to one line plus a
count. A program that times out still renders whatever it managed to print.

**Printing is always light.** The on-screen theme toggle is for reading; the
printed page uses a light palette regardless, because dark backgrounds waste ink
and read badly on paper.

---

## Troubleshooting

**`UnsupportedClassVersionError` on Java.** Your `javac` is newer than your
`java` runtime - a local JDK mismatch, not labpress. Upgrade the runtime, or pin
the target:

```jsonc
"languages": {
    "java": { "compile": "javac --release 21 -d {buildDir} {file}" }
}
```

**`--pdf` says it can't find Chrome.** It uses the Chrome, Chromium, Brave or
Edge you already have and downloads nothing. Set `CHROME_PATH` if yours lives
somewhere unusual, or just open the HTML and print from the browser.

**A run shows Input and Output as separate blocks.** That's the degraded mode
described above - usually plain C without `stdbuf`. Install GNU coreutils, or
accept the split rendering.

**Nothing was found.** Check `include`/`exclude` in the config, and run
`labpress list ./labs` to see exactly what labpress thinks is there.

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for
how to run it locally and what to check before opening one.

## License

[MIT](LICENSE)
