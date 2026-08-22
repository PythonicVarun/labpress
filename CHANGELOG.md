# Changelog

## v2.0.0 - 2026-08-22

### Breaking: you get a PDF now

1.x wrote an HTML file and left the printing to you. The PDF is the thing that
actually gets submitted, so that is what `labpress ./labs` produces.

| You used to run          | You now run                 |
| ------------------------ | --------------------------- |
| `labpress ./labs`        | `labpress ./labs --to html` |
| `labpress ./labs --pdf`  | `labpress ./labs`           |
| both files, side by side | `labpress ./labs --to both` |

- `--to` picks the format: `pdf` (default), `html` or `both`.
- `--out` names the file; the extension decides nothing any more. `-o record.html`
  on the default writes `record.pdf`.
- When only a PDF is wanted, the intermediate HTML goes to a temp folder instead
  of sitting next to it. In `--json` output, `documents[].html` points there.
- `--pdf` still parses, so a 1.x command doesn't error out. It does nothing -
  it is the default now.
- A PDF needs a Chrome, Chromium, Brave or Edge you already have. Without one,
  labpress says so, tells you where the HTML is, and exits 6.

### Added

**Jupyter notebooks.** A `.ipynb` is picked up like any other file. Nothing is
executed - the notebook already records what each cell printed, so labpress
reuses that. Which means: run the cells and save before building, or the record
comes out as source with no output. It warns on stderr when that happens.

Code cells render as one block with their output attached underneath, prose
cells read as prose, and plots come through as images - not as nbconvert's
`In[ ]` / `Out[ ]` rows. A leading `# Heading` becomes the program title.
nbconvert's `remove-cell`, `hide-input` and `hide-output` tags are honoured, so
the import cell can stay out of a submission. Interactive outputs - Plotly,
Vega, ipywidgets - leave a note saying they only exist with a kernel running,
rather than a silent gap. Runaway output is collapsed the same way a program
run's is.

`runs` and `stdin` mean nothing for a notebook. `title`, `aim`, `note` and
`hide` still apply.

**A cover date you can set.** The date was whatever day you built the record.

```jsonc
"date": "12 August 2026",     // or false for no date at all
"dates": {                     // one per week, when using --split
    "Week-01": "5 August 2026"
}
```

`--date "12 August 2026"` sets it from the shell, `--date none` leaves it off,
and either beats what the config says.

### Also

- Page breaks waste less paper. A run or a notebook output refuses to split
  only when it is short enough to fit on a page anyway; a long one flows
  instead of being pushed onto a fresh page and breaking there regardless.
  Plots and tables still come through whole.
- The footer no longer prints on top of the last line of a page. It used to
  cover one line wherever the text ran the full height of the page.
- `include` now picks up `.ipynb` by default.
- `labpress list` describes a notebook instead of reporting "0 run(s)".
- Releases are staged on npm and approved by hand rather than published outright
  by the workflow.

## v1.0.0 - 2026-08-19

First release. C, C++, Python and Java: compiled, run against the inputs you
give them, with the real terminal session captured into a print-ready record.
