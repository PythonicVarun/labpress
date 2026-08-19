import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { LANGUAGES } from "./languages.js";

const CONFIG_NAMES = [
    "labpress.config.jsonc",
    "labpress.config.json",
    ".labpressrc.json",
];

export const DEFAULT_CONFIG = {
    title: null,
    student: {},
    cover: true,
    toc: true,
    theme: "github-light",
    transcript: "interleaved",
    footer: true,
    // null means "today"; a string sets it, false leaves it off.
    date: null,
    // Per-group dates for --split, keyed by folder name.
    dates: {},
    // true emits one document per immediate subdirectory (one per week).
    split: false,
    include: ["**/*.{c,cc,cxx,cpp,py,java}"],
    exclude: [],
    order: [],
    defaults: {
        timeout: 20_000,
        idleMs: 150,
        unbuffer: "auto",
        compileTimeout: 60_000,
    },
    languages: {},
    programs: {},
};

/**
 * Strip line and block comments plus trailing commas so a commented config
 * file can go through JSON.parse. Quoted strings are left alone.
 */
export function stripJsonComments(text) {
    let output = "";
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
                output += char;
            }
            continue;
        }
        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                i++;
            } else if (char === "\n") {
                // Keep newlines so parse errors still report sensible lines.
                output += char;
            }
            continue;
        }
        if (inString) {
            output += char;
            if (char === "\\") {
                output += next ?? "";
                i++;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            output += char;
            continue;
        }
        if (char === "/" && next === "/") {
            inLineComment = true;
            i++;
            continue;
        }
        if (char === "/" && next === "*") {
            inBlockComment = true;
            i++;
            continue;
        }
        output += char;
    }

    return output.replace(/,(\s*[}\]])/g, "$1");
}

/** Parse JSONC, reporting the offending file and line on failure. */
export function parseJsonc(text, file) {
    const cleaned = stripJsonComments(text);
    try {
        return JSON.parse(cleaned);
    } catch (error) {
        const position = /position (\d+)/.exec(error.message)?.[1];
        const line = position
            ? cleaned.slice(0, Number(position)).split("\n").length
            : null;

        const detail = error.message.replace(/\s+/g, " ").trim();
        throw new Error(
            `Could not parse ${file}${line ? ` (line ${line})` : ""}: ${detail}`,
        );
    }
}

/** Look for a config file in `root`, then walk up towards the filesystem root. */
export function findConfigFile(root) {
    let directory = root;
    while (true) {
        for (const name of CONFIG_NAMES) {
            const candidate = path.join(directory, name);
            if (existsSync(candidate)) return candidate;
        }
        const parent = path.dirname(directory);
        if (parent === directory) return null;
        directory = parent;
    }
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Deep-merge `override` onto `base`; arrays replace rather than concatenate. */
export function mergeConfig(base, override) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override ?? {})) {
        if (value === undefined) continue;
        result[key] =
            isPlainObject(value) && isPlainObject(base[key])
                ? mergeConfig(base[key], value)
                : value;
    }
    return result;
}

/** Load and merge the config for a target directory. */
export async function loadConfig(root, explicitPath = null) {
    const file = explicitPath
        ? path.resolve(explicitPath)
        : findConfigFile(root);

    if (!file) return { config: { ...DEFAULT_CONFIG }, configPath: null };
    if (!existsSync(file)) throw new Error(`No such config file: ${file}`);

    const raw = await readFile(file, "utf8");
    const parsed = parseJsonc(raw, file);
    return { config: mergeConfig(DEFAULT_CONFIG, parsed), configPath: file };
}

/** Split raw stdin text into the individual lines the feeder will type. */
export function splitInputLines(text) {
    const lines = text.split(/\r?\n/);
    // A trailing newline shouldn't become an extra empty input.
    if (lines.length && lines.at(-1) === "") lines.pop();
    return lines;
}

/** Turn one configured run into the normalised shape the runner expects. */
async function normaliseRun(run, index, { root, program, defaults }) {
    let inputs = [];

    if (Array.isArray(run.stdin)) {
        inputs = run.stdin.map((value) => String(value));
    } else if (typeof run.stdin === "string") {
        inputs = splitInputLines(run.stdin);
    } else if (typeof run.stdinText === "string") {
        inputs = splitInputLines(run.stdinText);
    } else if (typeof run.stdinFile === "string") {
        const file = path.resolve(root, run.stdinFile);
        try {
            inputs = splitInputLines(await readFile(file, "utf8"));
        } catch {
            throw new Error(
                `Input file not found for ${program.path}: ${run.stdinFile}`,
            );
        }
    }

    return {
        label: run.label ?? null,
        note: run.note ?? null,
        hide: run.hide === true,
        inputs,
        args: (run.args ?? []).map((value) => String(value)),
        env: run.env ?? {},
        cwd: run.cwd ? path.resolve(root, run.cwd) : null,
        timeout: run.timeout ?? defaults.timeout,
        idleMs: run.idleMs ?? defaults.idleMs,
        transcript: run.transcript ?? null,
        index,
    };
}

/**
 * Work out everything needed to build one program: its title, commands and
 * the list of runs. Runs come from config when present, otherwise from any
 * input files found next to the source, otherwise a single input-less run.
 */
export async function resolveProgram(program, config, root) {
    const entry = config.programs?.[program.path] ?? {};
    const language = LANGUAGES[program.language];
    const languageOverride = config.languages?.[program.language] ?? {};
    const defaults = config.defaults ?? DEFAULT_CONFIG.defaults;

    let runSpecs = entry.runs;
    if (!Array.isArray(runSpecs) || runSpecs.length === 0) {
        runSpecs = program.inputFiles.length
            ? program.inputFiles.map((input) => ({
                  label: input.label,
                  stdinFile: input.file,
              }))
            : [{}];
    }

    const runs = [];
    for (const [index, run] of runSpecs.entries()) {
        runs.push(await normaliseRun(run, index, { root, program, defaults }));
    }

    return {
        ...program,
        title: entry.title ?? program.title,
        aim: entry.aim ?? null,
        note: entry.note ?? null,
        hide: entry.hide === true,
        compile: entry.compile ?? languageOverride.compile ?? language.compile,
        run: entry.run ?? languageOverride.run ?? language.run,
        unbuffer:
            entry.unbuffer ?? languageOverride.unbuffer ?? defaults.unbuffer,
        languageUnbuffer: language.unbuffer,
        compileTimeout: defaults.compileTimeout,
        transcript: entry.transcript ?? config.transcript,
        runs: runs.filter((run) => !run.hide),
    };
}

/**
 * Which date the cover shows. A "dates" entry for the current week beats the
 * top-level "date", and false at either level prints no date at all.
 */
export function resolveDate(config, group, fallback) {
    const value = (group ? config.dates?.[group] : undefined) ?? config.date;
    if (value === false) return null;
    return value === null || value === undefined || value === ""
        ? fallback
        : String(value);
}
