#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./index.js";
import { initConfig } from "./init.js";
import { resolveRoot, discoverPrograms, applyOrder } from "./discover.js";
import { loadConfig, resolveProgram, mergeConfig } from "./config.js";
import { openInBrowser } from "./open.js";
import { findChrome, printToPdf } from "./pdf.js";
import { isKnownTheme, availableThemes } from "./highlight.js";

export const EXIT = {
    ok: 0,
    unexpected: 1,
    usage: 2,
    config: 3,
    nothingFound: 4,
    programFailed: 5,
    pdfFailed: 6,
};

const OPTIONS = {
    out: { type: "string", short: "o" },
    config: { type: "string", short: "c" },
    theme: { type: "string" },
    transcript: { type: "string" },
    title: { type: "string" },
    only: { type: "string", multiple: true },
    timeout: { type: "string" },
    pdf: { type: "boolean" },
    split: { type: "boolean" },
    "no-open": { type: "boolean" },
    "no-footer": { type: "boolean" },
    "no-run": { type: "boolean" },
    keep: { type: "boolean" },
    json: { type: "boolean" },
    quiet: { type: "boolean", short: "q" },
    force: { type: "boolean", short: "f" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
};

const HELP = `labpress - turn a folder of lab programs into a print-ready record

Usage
  npx labpress [directory] [options]        build, then open it in your browser
  npx labpress init [directory]             write a starter config file
  npx labpress list [directory]             show what would be included
  npx labpress themes                       list available syntax themes

Options
  -o, --out <path>        where to write the HTML (a directory when --split)
      --split             one document per subfolder, e.g. one PDF per week
      --pdf               also write a PDF, using your installed Chrome
      --no-open           don't launch the browser
      --no-run            just render the source, don't execute anything
      --no-footer         drop the labpress credit line
      --theme <name>      syntax theme (default: github-light)
      --transcript <mode> "interleaved" or "split"
      --title <text>      document title
      --only <glob>       limit to matching files (repeatable)
      --timeout <ms>      per-run time limit
  -c, --config <path>     use a specific config file
      --keep              keep the temporary build directory
      --json              machine-readable output on stdout
  -q, --quiet             only report problems
  -f, --force             overwrite an existing config (with init)
  -h, --help              show this
  -v, --version           show the version

Examples
  npx labpress ./labs
  npx labpress ./labs --pdf --no-footer
  npx labpress ./labs --split --pdf -o ./records
  npx labpress ./labs --only "Week-03/**"
  npx labpress init ./labs
`;

/** Logs go to stderr so --json output on stdout stays clean. */
function makeLogger({ quiet, json }) {
    const silent = quiet || json;
    return {
        info(message) {
            if (!silent) process.stderr.write(`${message}\n`);
        },
        warn(message) {
            process.stderr.write(`${message}\n`);
        },
    };
}

function fail(code, message, { json }) {
    if (json) {
        process.stdout.write(
            `${JSON.stringify({
                error: { code: codeName(code), message, retryable: false },
            })}\n`,
        );
    } else {
        process.stderr.write(`labpress: ${message}\n`);
    }
    process.exitCode = code;
}

function codeName(code) {
    return (
        Object.entries(EXIT).find(([, value]) => value === code)?.[0] ??
        "unknown"
    );
}

async function readVersion() {
    const file = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "package.json",
    );
    try {
        return JSON.parse(await readFile(file, "utf8")).version;
    } catch {
        return "0.0.0";
    }
}

/** Translate CLI flags into the config overrides the builder understands. */
function overridesFrom(values) {
    const overrides = {};
    if (values.theme) overrides.theme = values.theme;
    if (values.transcript) overrides.transcript = values.transcript;
    if (values.title) overrides.title = values.title;
    if (values["no-footer"]) overrides.footer = false;
    if (values.split) overrides.split = true;
    if (values.timeout) {
        overrides.defaults = { timeout: Number(values.timeout) };
    }
    return overrides;
}

function validate(values) {
    if (
        values.transcript &&
        !["interleaved", "split"].includes(values.transcript)
    ) {
        return `--transcript must be "interleaved" or "split", got "${values.transcript}"`;
    }
    if (values.theme && !isKnownTheme(values.theme)) {
        return `Unknown theme "${values.theme}". Run \`labpress themes\` to see the list.`;
    }
    if (values.timeout && !Number.isFinite(Number(values.timeout))) {
        return `--timeout must be a number of milliseconds, got "${values.timeout}"`;
    }
    return null;
}

async function runList(target, values, log) {
    const root = await resolveRoot(target);
    const loaded = await loadConfig(root, values.config ?? null);
    const config = mergeConfig(loaded.config, overridesFrom(values));
    const discovered = await discoverPrograms(root, {
        include: config.include,
        exclude: config.exclude,
        only: values.only ?? [],
    });

    const resolved = [];
    for (const program of applyOrder(discovered, config.order)) {
        const entry = await resolveProgram(program, config, root);
        if (!entry.hide) resolved.push(entry);
    }

    if (values.json) {
        process.stdout.write(
            `${JSON.stringify(
                {
                    root,
                    config: loaded.configPath,
                    programs: resolved.map((program) => ({
                        path: program.path,
                        language: program.language,
                        title: program.title,
                        runs: program.runs.map((run) => ({
                            label: run.label,
                            inputs: run.inputs.length,
                        })),
                    })),
                },
                null,
                2,
            )}\n`,
        );
        return EXIT.ok;
    }

    if (resolved.length === 0) {
        log.warn("No programs found.");
        return EXIT.nothingFound;
    }

    for (const program of resolved) {
        const runs = program.runs
            .map((run, index) => run.label ?? `run ${index + 1}`)
            .join(", ");
        process.stderr.write(
            `${program.path}  (${program.language})  ${program.runs.length} run(s)` +
                `${runs ? `: ${runs}` : ""}\n`,
        );
    }
    return EXIT.ok;
}

async function runBuild(target, values, log) {
    const result = await build({
        root: target,
        configPath: values.config ?? null,
        only: values.only ?? [],
        overrides: overridesFrom(values),
        skipRun: values["no-run"] === true,
        keepBuildDir: values.keep === true,
        onProgress(event) {
            if (event.phase === "compile")
                log.info(`  compiling ${event.program}`);
            if (event.phase === "run") {
                const name = event.label ? ` (${event.label})` : "";
                log.info(`  running   ${event.program}${name}`);
            }
            if (event.phase === "render")
                log.info("  highlighting and rendering");
            if (event.phase === "keep")
                log.info(`  build files kept in ${event.path}`);
        },
    });

    if (result.documents.length === 0) {
        log.warn(
            `No programs found under ${result.root}. ` +
                `Check the include patterns, or that the files are .c/.cpp/.py/.java.`,
        );
        return { code: EXIT.nothingFound };
    }

    const outputs = await writeDocuments(result.documents, values);
    const problems = collectProblems(result.programs);
    let pdfError = null;

    if (values.pdf) {
        const chrome = findChrome();
        if (!chrome) {
            pdfError =
                "No Chrome/Chromium/Edge found for --pdf. Set CHROME_PATH, or open the HTML and print from there.";
        } else {
            for (const output of outputs) {
                const target = `${output.html.replace(/\.html?$/i, "")}.pdf`;
                const outcome = await printToPdf(chrome, output.html, target);
                if (outcome.ok) {
                    output.pdf = target;
                } else {
                    pdfError = `PDF generation failed: ${outcome.message}`;
                }
            }
        }
    }

    if (values.json) {
        process.stdout.write(
            `${JSON.stringify(
                {
                    documents: outputs.map((output) => ({
                        group: output.group,
                        html: output.html,
                        pdf: output.pdf,
                    })),
                    root: result.root,
                    config: result.configPath,
                    programs: result.programs.map((program) => ({
                        path: program.path,
                        title: program.title,
                        compileError: program.compileError,
                        runs: program.transcripts.map((transcript) => ({
                            label: transcript.label,
                            mode: transcript.mode,
                            status: transcript.status,
                        })),
                    })),
                    problems,
                },
                null,
                2,
            )}\n`,
        );
    } else {
        log.info("");
        log.info(
            `  ${result.programs.length} program(s) in ${outputs.length} document(s)`,
        );
        for (const output of outputs) {
            log.info(`  ${output.pdf ?? output.html}`);
        }
        for (const problem of problems) log.warn(`  ! ${problem}`);
    }

    if (pdfError) {
        log.warn(`  ! ${pdfError}`);
        return { code: EXIT.pdfFailed };
    }

    if (!values["no-open"] && !values.json) {
        for (const output of outputs) {
            const opened = await openInBrowser(output.pdf ?? output.html);
            if (!opened) {
                log.warn(
                    `  couldn't open a browser; the file is at ${output.html}`,
                );
                break;
            }
        }
    }

    return { code: problems.length ? EXIT.programFailed : EXIT.ok };
}

/**
 * Write each rendered document to disk. With one document --out is the file
 * itself; with several it's the directory they go into.
 */
async function writeDocuments(documents, values) {
    const single = documents.length === 1 && documents[0].group === null;

    const directory = values.out
        ? single
            ? path.dirname(path.resolve(values.out))
            : path.resolve(values.out)
        : await mkdtemp(path.join(tmpdir(), "labpress-"));

    await mkdir(directory, { recursive: true });

    const outputs = [];
    for (const document of documents) {
        const file =
            single && values.out
                ? htmlPathFor(values.out)
                : path.join(directory, `${document.name}.html`);
        await writeFile(file, document.html, "utf8");
        outputs.push({ group: document.group, html: file, pdf: null });
    }
    return outputs;
}

/**
 * `-o record.pdf` reads as "put the PDF there", not "name the HTML record.pdf",
 * so swap the extension - otherwise --pdf would write record.pdf.pdf beside it.
 */
function htmlPathFor(out) {
    return path.resolve(out).replace(/\.pdf$/i, ".html");
}

/** Surface anything a student would want to fix before submitting. */
function collectProblems(programs) {
    const problems = [];
    for (const program of programs) {
        if (program.compileError) {
            problems.push(`${program.path}: failed to compile`);
        }
        for (const transcript of program.transcripts ?? []) {
            if (transcript.failed) {
                problems.push(
                    `${program.path}${transcript.label ? ` (${transcript.label})` : ""}: ${transcript.status}`,
                );
            }
        }
    }
    return problems;
}

async function main(argv) {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            options: OPTIONS,
            allowPositionals: true,
        });
    } catch (error) {
        fail(EXIT.usage, `${error.message}\n\n${HELP}`, { json: false });
        return;
    }

    const { values, positionals } = parsed;
    const json = values.json === true;
    const log = makeLogger({ quiet: values.quiet, json });

    if (values.help) {
        process.stdout.write(HELP);
        return;
    }
    if (values.version) {
        process.stdout.write(`${await readVersion()}\n`);
        return;
    }

    const knownCommands = new Set(["init", "list", "themes", "build"]);
    const command = knownCommands.has(positionals[0])
        ? positionals[0]
        : "build";
    const target =
        (knownCommands.has(positionals[0]) ? positionals[1] : positionals[0]) ??
        ".";

    const invalid = validate(values);
    if (invalid) {
        fail(EXIT.usage, invalid, { json });
        return;
    }

    try {
        if (command === "themes") {
            process.stdout.write(`${availableThemes().join("\n")}\n`);
            return;
        }

        if (command === "init") {
            const root = await resolveRoot(target);
            const created = await initConfig(root, {
                force: values.force === true,
                title: values.title ?? null,
            });
            if (json) {
                process.stdout.write(`${JSON.stringify(created)}\n`);
            } else {
                log.info(`Wrote ${created.path}`);
                log.info(
                    `Listed ${created.programCount} program(s). Fill in the inputs, then run: npx labpress .`,
                );
            }
            return;
        }

        if (command === "list") {
            process.exitCode = await runList(target, values, log);
            return;
        }

        log.info(`labpress: reading ${path.resolve(target)}`);
        const outcome = await runBuild(target, values, log);
        process.exitCode = outcome.code;
    } catch (error) {
        const message = error?.message ?? String(error);
        const code = /config|parse/i.test(message)
            ? EXIT.config
            : EXIT.unexpected;
        fail(code, message, { json });
    }
}

await main(process.argv.slice(2));
