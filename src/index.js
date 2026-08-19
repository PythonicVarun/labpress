import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, platform } from "node:os";
import path from "node:path";
import { LANGUAGES, buildCommand } from "./languages.js";
import { discoverPrograms, applyOrder, resolveRoot } from "./discover.js";
import {
    loadConfig,
    resolveProgram,
    mergeConfig,
    resolveDate,
} from "./config.js";
import { compile, execute, applyUnbuffer } from "./runner.js";
import { buildTranscript } from "./transcript.js";
import { createCodeHighlighter } from "./highlight.js";
import { renderDocument } from "./render.js";

const IS_WINDOWS = platform() === "win32";

/** Java needs the declared class name, which isn't always the file name. */
function javaClassName(source, stem) {
    const match =
        /(?:^|\n)\s*public\s+(?:final\s+|abstract\s+)?class\s+(\w+)/.exec(
            source,
        ) ?? /(?:^|\n)\s*class\s+(\w+)/.exec(source);

    return match ? match[1] : stem;
}

function placeholdersFor(program, index, buildDir, source) {
    const binName = `${index}-${program.stem}${IS_WINDOWS ? ".exe" : ""}`;
    return {
        file: program.absolutePath,
        dir: path.dirname(program.absolutePath),
        stem: program.stem,
        bin: path.join(buildDir, binName),
        buildDir,
        class: javaClassName(source, program.stem),
    };
}

/** Compile if the language needs it, then run every configured input set. */
async function buildProgram(program, index, { buildDir, skipRun, onProgress }) {
    // Trailing newlines would render as an extra numbered blank line.
    const source = (await readFile(program.absolutePath, "utf8")).replace(
        /\s+$/,
        "",
    );
    const vars = placeholdersFor(program, index, buildDir, source);
    const result = { ...program, source, compileError: null, transcripts: [] };

    if (skipRun) return result;

    if (program.compile) {
        onProgress?.({ phase: "compile", program: program.path });
        const argv = buildCommand(program.compile, vars);
        const outcome = await compile(argv, {
            cwd: path.dirname(program.absolutePath),
            timeout: program.compileTimeout,
        });
        if (!outcome.ok) {
            result.compileError =
                [outcome.stderr, outcome.stdout]
                    .filter(Boolean)
                    .join("\n")
                    .trim() ||
                `Compilation failed (exit code ${outcome.exitCode}).`;
            return result;
        }
    }

    const wantsUnbuffer =
        program.unbuffer === false
            ? null
            : program.unbuffer === true
              ? "stdbuf"
              : program.languageUnbuffer;

    for (const run of program.runs) {
        onProgress?.({
            phase: "run",
            program: program.path,
            label: run.label,
            index: run.index,
        });

        const baseArgv = buildCommand(program.run, vars);
        const { argv } = applyUnbuffer(
            [...baseArgv, ...run.args],
            wantsUnbuffer,
        );

        const outcome = await execute({
            argv,
            cwd: run.cwd ?? path.dirname(program.absolutePath),
            env: run.env,
            inputs: run.inputs,
            timeout: run.timeout,
            idleMs: run.idleMs,
        });

        result.transcripts.push(
            buildTranscript(outcome, run, { mode: program.transcript }),
        );
    }

    return result;
}

/**
 * Discover, run and render everything under `root`.
 * Returns the HTML plus enough detail for the CLI to report on.
 */
export async function build({
    root: target,
    configPath = null,
    only = [],
    overrides = {},
    skipRun = false,
    keepBuildDir = false,
    onProgress = null,
} = {}) {
    const root = await resolveRoot(target);
    const loaded = await loadConfig(root, configPath);
    const config = mergeConfig(loaded.config, overrides);

    const discovered = await discoverPrograms(root, {
        include: config.include,
        exclude: config.exclude,
        only,
    });

    const ordered = applyOrder(discovered, config.order);
    const resolved = [];
    for (const program of ordered) {
        const entry = await resolveProgram(program, config, root);
        if (!entry.hide) resolved.push(entry);
    }

    if (resolved.length === 0) {
        return {
            documents: [],
            programs: [],
            config,
            root,
            configPath: loaded.configPath,
        };
    }

    const buildDir = await mkdtemp(path.join(tmpdir(), "labpress-build-"));
    const built = [];
    try {
        for (const [index, program] of resolved.entries()) {
            built.push(
                await buildProgram(program, index, {
                    buildDir,
                    skipRun,
                    onProgress,
                }),
            );
        }
    } finally {
        if (keepBuildDir) {
            onProgress?.({ phase: "keep", path: buildDir });
        } else {
            await rm(buildDir, { recursive: true, force: true }).catch(
                () => {},
            );
        }
    }

    onProgress?.({ phase: "render" });
    const highlighter = await createCodeHighlighter(
        built.map((program) => program.language),
        config.theme,
    );

    const today = new Date().toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
    });

    const documents = [];
    try {
        for (const group of partition(built, config.split, root)) {
            documents.push({
                group: group.key,
                name: group.name,
                programs: group.programs,
                html: await renderDocument({
                    programs: group.programs,
                    config,
                    highlighter,
                    generatedAt: resolveDate(config, group.key, today),
                    group: group.key,
                }),
            });
        }
    } finally {
        highlighter.dispose();
    }

    return {
        documents,
        programs: built,
        config,
        root,
        configPath: loaded.configPath,
    };
}

/**
 * Split programs into one document per immediate subdirectory, which for a
 * folder laid out as Week-01/, Week-02/ ... means one document per week.
 * Programs sitting directly in the root are grouped under the root's name.
 */
export function partition(programs, split, root) {
    if (!split) return [{ key: null, name: "index", programs }];

    const groups = new Map();
    for (const program of programs) {
        const segments = program.path.split("/");
        const key = segments.length > 1 ? segments[0] : path.basename(root);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(program);
    }

    // Map preserves insertion order, so groups follow the configured order.
    return [...groups.entries()].map(([key, grouped]) => ({
        key,
        name: key.replace(/[^\w.-]+/g, "-"),
        programs: grouped,
    }));
}

export { LANGUAGES };
