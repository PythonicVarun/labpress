import { platform } from "node:os";

const IS_WINDOWS = platform() === "win32";

/** Language id -> how to build and run it. */
export const LANGUAGES = {
    c: {
        name: "C",
        shikiLang: "c",
        extensions: [".c"],
        compile: "gcc -O2 -o {bin} {file}",
        run: "{bin}",
        // glibc does not flush stdout before a scanf(), so prompts never
        // reach us until exit. stdbuf fixes the transcript completely.
        unbuffer: "stdbuf",
    },
    cpp: {
        name: "C++",
        shikiLang: "cpp",
        extensions: [".cpp", ".cc", ".cxx", ".c++"],
        compile: "g++ -O2 -std=c++17 -o {bin} {file}",
        run: "{bin}",
        unbuffer: "stdbuf",
    },
    python: {
        name: "Python",
        shikiLang: "python",
        extensions: [".py"],
        compile: null,
        // -u already makes it unbuffered, nothing more to do.
        run: `${IS_WINDOWS ? "python" : "python3"} -u {file}`,
        unbuffer: null,
    },
    notebook: {
        name: "Jupyter Notebook",
        // Kernels other than Python override this per file.
        shikiLang: "python",
        extensions: [".ipynb"],
        // Nothing to build or run - the outputs are already in the file.
        compile: null,
        run: null,
        unbuffer: null,
        notebook: true,
    },
    java: {
        name: "Java",
        shikiLang: "java",
        extensions: [".java"],
        compile: "javac -d {buildDir} {file}",
        run: "java -cp {buildDir} {class}",
        unbuffer: null,
    },
};

const EXTENSION_MAP = new Map(
    Object.entries(LANGUAGES).flatMap(([id, lang]) =>
        lang.extensions.map((ext) => [ext, id]),
    ),
);

/** True for languages whose "source" is a document with its outputs inside. */
export function isNotebook(languageId) {
    return LANGUAGES[languageId]?.notebook === true;
}

/** Detect a language id from a file path, or null if unsupported. */
export function detectLanguage(filePath) {
    const dot = filePath.lastIndexOf(".");
    if (dot === -1) return null;
    return EXTENSION_MAP.get(filePath.slice(dot).toLowerCase()) ?? null;
}

/** Every extension labpress knows how to handle, e.g. [".c", ".cpp", ...]. */
export function knownExtensions() {
    return [...EXTENSION_MAP.keys()];
}

/**
 * Split a command template into argv tokens, honouring quotes.
 *
 * Tokenising *before* placeholder substitution is deliberate: it means a
 * {file} that expands to `/pythonic/5th Sem/x.cpp` stays a single argument
 * without anyone having to quote it in their config.
 */
export function tokenize(template) {
    const tokens = [];
    let current = "";
    let quote = null;
    let started = false;

    for (const char of template) {
        if (quote) {
            if (char === quote) quote = null;
            else current += char;
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            started = true;
            continue;
        }

        if (/\s/.test(char)) {
            if (started) tokens.push(current);
            current = "";
            started = false;
            continue;
        }

        current += char;
        started = true;
    }
    if (quote)
        throw new Error(`Unclosed ${quote} quote in command: ${template}`);

    if (started) tokens.push(current);
    return tokens;
}

/** Replace every {key} in a single token with its value from `vars`. */
function substitute(token, vars) {
    return token.replace(/\{(\w+)\}/g, (match, key) =>
        key in vars ? String(vars[key]) : match,
    );
}

/**
 * Turn a command template into a ready-to-spawn argv.
 * Tokens that expand to an empty string are dropped so optional
 * placeholders like {flags} don't leave stray empty arguments behind.
 */
export function buildCommand(template, vars) {
    return tokenize(template)
        .map((token) => substitute(token, vars))
        .filter((token) => token.length > 0);
}
