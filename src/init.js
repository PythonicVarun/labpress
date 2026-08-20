import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverPrograms } from "./discover.js";
import { DEFAULT_CONFIG } from "./config.js";
import { isNotebook } from "./languages.js";

const TEMPLATE = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "templates",
    "labpress.config.jsonc",
);

const CONFIG_NAME = "labpress.config.jsonc";

/** The first program gets the full menu of run options as comments. */
function annotatedEntry(program) {
    return `"${program.path}": {
            "title": ${JSON.stringify(program.title)},
            "aim": "",

            // One entry per run. Each string in "stdin" is typed as its own
            // line, in order, whenever the program asks for input.
            "runs": [
                { "label": "Sample run", "stdin": [] }

                // Other ways to feed a run:
                // { "label": "From a file", "stdinFile": "inputs/case-1.txt" },
                // { "label": "Raw text",    "stdinText": "5\\n7\\n" },
                // { "label": "With args",   "args": ["--verbose"] },
                // { "label": "Slow one",    "stdin": ["3"], "timeout": 60000 },
                // { "label": "Split view",  "stdin": ["1"], "transcript": "split" },
                // { "label": "Annotated",   "stdin": ["1"], "note": "output is random" },
                // { "label": "Skipped",     "stdin": ["1"], "hide": true }
            ]

            // Also available per program:
            // "note": "shown under the aim",
            // "run": "{bin} --flag",
            // "compile": "g++ -O2 -std=c++20 -o {bin} {file}",
            // "transcript": "split",
            // "hide": true
        }`;
}

function plainEntry(program) {
    // A notebook has nothing to feed, and its own first heading titles it,
    // so writing a title here would only override something better.
    if (isNotebook(program.language)) {
        return `"${program.path}": {
            "aim": ""
        }`;
    }

    return `"${program.path}": {
            "title": ${JSON.stringify(program.title)},
            "aim": "",
            "runs": [{ "stdin": [] }]
        }`;
}

/**
 * Write a starter config listing every program found, so a student only has
 * to fill in the inputs rather than remember the schema.
 */
export async function initConfig(root, { force = false, title = null } = {}) {
    const destination = path.join(root, CONFIG_NAME);
    if (existsSync(destination) && !force) {
        throw new Error(
            `${CONFIG_NAME} already exists in ${root}. Pass --force to overwrite it.`,
        );
    }

    const programs = await discoverPrograms(root, {
        include: DEFAULT_CONFIG.include,
    });

    // The run options are worth spelling out once, on a program that has runs.
    const annotated = programs.findIndex(
        (program) => !isNotebook(program.language),
    );
    const entries = programs.map((program, index) =>
        index === annotated ? annotatedEntry(program) : plainEntry(program),
    );

    const body = entries.length
        ? entries.join(",\n        ")
        : `// No programs found yet. Add some .c / .cpp / .py / .java / .ipynb files
        // and run: npx labpress init . --force`;

    const template = await readFile(TEMPLATE, "utf8");
    const contents = template
        .replace("__TITLE__", title ?? `${path.basename(root)} - Lab Record`)
        .replace("        __PROGRAMS__", `        ${body}`);

    await writeFile(destination, contents, "utf8");
    return { path: destination, programCount: programs.length };
}
