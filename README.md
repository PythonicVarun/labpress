# labpress

Point it at a folder of lab programs. It compiles them, runs them against the
inputs you specify, captures what the terminal actually showed, and builds a
print-ready HTML file with proper syntax highlighting.

No install, no screenshots, no pasting code into Word.

```bash
npx labpress ./labs
```

That opens the finished record in your browser. Hit Ctrl+P and submit.

---

## Why it looks different

Most lab records are code pasted into a document with a screenshot of the
terminal glued underneath. labpress produces the real thing:

- **Source code** highlighted with the same TextMate grammars VS Code uses, with
  line numbers, wrapped so nothing runs off the page.
- **Output** captured by actually executing the program, not copied by hand.
- **Input shown where you typed it.** Your programs prompt and wait. labpress
  waits for the prompt, types the next value, and records the whole exchange in
  order, so the transcript reads exactly like a real session:

    ```
    All of the outputs taken below will be expecting an input in binary ONLY.
    Flag pattern: 01111110
    Enter data: 0111111011111101      <- highlighted as typed input
    Stuffed data     : 011111010111110101
    Bit(s) stuffed   : 2
    Does it match the original data? Yes
    ```

Typed values get a highlight box so an examiner can tell input from output at a
glance, and it survives a black-and-white printer.

---

## Getting started

Run it once with no configuration at all:

```bash
npx labpress ./labs
```

Every `.c`, `.cpp`, `.py` and `.java` file gets compiled, run and rendered. If a
program needs input, drop a file named after it next to the source:

```
Week-01/bit_stuffing.cpp
Week-01/bit_stuffing.in          -> one run, fed from this file
Week-01/bit_stuffing.edge.in     -> a second run, labelled "edge"
Week-01/inputs/bit_stuffing-2.txt
```

When you want titles, an aim line, multiple labelled runs and a cover page,
generate a config:

```bash
npx labpress init ./labs
```

That writes `labpress.config.jsonc` listing every program it found, with every
available option documented in comments. Fill in the blanks and run it again.

---

## Configuration

`labpress.config.jsonc` - JSON with comments and trailing commas allowed.
labpress looks for it in the target folder, then walks upward.

```jsonc
{
    "title": "Computer Networks - Lab Record",

    // Blank fields are skipped, so fill in only what your college wants.
    "student": {
        "name": "Varun Agnihotri",
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
`unbuffer` when one program needs to be built differently from the rest.

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
npx labpress [directory]        build, then open it in your browser
npx labpress init [directory]   write a starter config file
npx labpress list [directory]   show what would be included
npx labpress themes             list available syntax themes
```

| Flag                  | Effect                                         |
| --------------------- | ---------------------------------------------- |
| `-o, --out <path>`    | Where to write the HTML (default: a temp file) |
| `--pdf`               | Also write a PDF using your installed Chrome   |
| `--no-open`           | Don't launch the browser                       |
| `--no-run`            | Render the source only, execute nothing        |
| `--no-footer`         | Drop the labpress credit line                  |
| `--theme <name>`      | Any theme Shiki ships                          |
| `--transcript <mode>` | `interleaved` or `split`                       |
| `--title <text>`      | Document title                                 |
| `--only <glob>`       | Limit to matching files, repeatable            |
| `--timeout <ms>`      | Per-run time limit                             |
| `-c, --config <path>` | Use a specific config file                     |
| `--keep`              | Keep the temporary build directory             |
| `--json`              | Machine-readable output on stdout              |
| `-q, --quiet`         | Only report problems                           |

Logs go to stderr and JSON to stdout, so `--json` stays parseable. Exit codes:
`0` fine, `2` bad usage, `3` bad config, `4` nothing found, `5` a program failed
to compile or run, `6` PDF generation failed.

### PDF

`--pdf` drives the Chrome, Chromium, Brave or Edge you already have installed.
Nothing extra gets downloaded. Set `CHROME_PATH` if it lives somewhere unusual.
Without a Chrome-family browser, open the HTML and print from there instead.

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

## Things worth knowing

**How the interleaving works.** labpress runs your program over pipes and waits
for output to go quiet before typing the next line. C++ (`cin` is tied to
`cout`), Python (`input()` flushes) and Java (`System.out` autoflushes) all push
their prompt out before blocking on a read, which is what makes the ordering
accurate.

**Plain C is the exception.** `printf` into a pipe stays buffered, so the prompt
doesn't arrive until the program exits. labpress runs C through `stdbuf -o0`
where it's available (Linux, and macOS with GNU coreutils installed) which fixes
it completely. Where it isn't available, the run still completes - labpress
notices the ordering can't be trusted, switches that run to separate Input and
Output blocks, and says so in the document.

**Runaway programs are contained.** A program that hits end-of-input inside a
validation loop will print the same complaint forever. Runs stop at the time
limit, output stops at 64 KB, and repeated lines collapse to a single line with
a count.

**If `javac` is newer than `java`** you'll get `UnsupportedClassVersionError`.
That's a local JDK mismatch, not labpress. Either upgrade the runtime or pin the
target:

```jsonc
"languages": {
    "java": { "compile": "javac --release 21 -d {buildDir} {file}" }
}
```

**Printing is always light.** The on-screen theme toggle is for reading; the
printed page uses a light palette regardless, because dark backgrounds waste ink
and read badly on paper.

---

## Requirements

Node 20 or newer, plus whatever compiler each language needs (`gcc`, `g++`,
`python3`, `javac`/`java`). Only the languages you actually use have to be
installed.

## License

MIT
