import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { detectLanguage } from "./languages.js";

const ALWAYS_SKIP = new Set([
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "build",
    "dist",
    "out",
    "target",
    "__pycache__",
    ".venv",
    "venv",
]);

/**
 * Convert a glob to a RegExp. Supports the handful of things people actually
 * write in a config: `**`, `*`, `?` and `{a,b}` alternation.
 */
export function globToRegExp(pattern) {
    let source = "";
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === "*") {
            if (pattern[i + 1] === "*") {
                // `**/` may match zero directories, so the slash is optional.
                if (pattern[i + 2] === "/") {
                    source += "(?:.*/)?";
                    i += 2;
                } else {
                    source += ".*";
                    i += 1;
                }
            } else {
                source += "[^/]*";
            }
            continue;
        }
        if (char === "?") {
            source += "[^/]";
            continue;
        }
        if (char === "{") {
            const end = pattern.indexOf("}", i);
            if (end !== -1) {
                const options = pattern.slice(i + 1, end).split(",");
                source += `(?:${options.map(escapeLiteral).join("|")})`;
                i = end;
                continue;
            }
        }
        source += escapeLiteral(char);
    }
    return new RegExp(`^${source}$`);
}

function escapeLiteral(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `relativePath` matches any of the given globs. */
export function matchesAny(relativePath, patterns) {
    return patterns.some((pattern) => globToRegExp(pattern).test(relativePath));
}

/** Recursively collect files under `root`, returning paths relative to it. */
export async function walk(root) {
    const found = [];

    async function visit(directory) {
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (ALWAYS_SKIP.has(entry.name)) continue;
                await visit(absolute);
            } else if (entry.isFile()) {
                found.push(path.relative(root, absolute));
            }
        }
    }

    await visit(root);
    return found.sort(naturalCompare);
}

/** Sort so Week-2 lands before Week-10 instead of after it. */
export function naturalCompare(a, b) {
    return a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
    });
}

// Lab filenames are full of these, and "Crc" reads badly on a cover page.
// Anything missing here can still be fixed with an explicit title in config.
const ACRONYMS = new Set([
    "crc",
    "tcp",
    "udp",
    "ip",
    "http",
    "https",
    "ftp",
    "dns",
    "arp",
    "rarp",
    "icmp",
    "smtp",
    "dhcp",
    "nat",
    "vpn",
    "lan",
    "wan",
    "man",
    "osi",
    "mac",
    "rip",
    "ospf",
    "bgp",
    "csma",
    "cd",
    "ca",
    "fifo",
    "lifo",
    "lru",
    "fcfs",
    "sjf",
    "cpu",
    "gcd",
    "lcm",
    "dda",
    "aes",
    "des",
    "rsa",
    "md5",
    "sha",
    "sql",
    "api",
    "url",
    "uri",
    "io",
    "os",
    "db",
    "gui",
    "bfs",
    "dfs",
    "avl",
]);

/** `bit_stuffing` -> `Bit Stuffing`, used when no title is configured. */
export function titleFromStem(stem) {
    return stem
        .replace(/[_-]+/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .trim()
        .split(/\s+/)
        .map((word) => {
            if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase();
            if (word === word.toUpperCase()) return word;
            return word[0].toUpperCase() + word.slice(1);
        })
        .join(" ");
}

/**
 * Find input files sitting next to a program, so labpress does something
 * useful before anyone has written a config.
 *
 * Recognised: `<stem>.in`, `<stem>.<label>.in`, and anything under a sibling
 * `inputs/` directory starting with the stem.
 */
export function findInputFiles(relativeProgramPath, allFiles) {
    const directory = path.dirname(relativeProgramPath);
    const stem = path.basename(
        relativeProgramPath,
        path.extname(relativeProgramPath),
    );
    const matches = [];

    for (const file of allFiles) {
        if (path.dirname(file) === directory) {
            const name = path.basename(file);
            if (name === `${stem}.in`) {
                matches.push({ file, label: null });
            } else if (name.startsWith(`${stem}.`) && name.endsWith(".in")) {
                matches.push({
                    file,
                    label: name.slice(stem.length + 1, -".in".length),
                });
            }
            continue;
        }
        if (path.dirname(file) === path.join(directory, "inputs")) {
            const name = path.basename(file);
            if (!name.startsWith(stem)) continue;
            if (!/\.(in|txt)$/.test(name)) continue;
            const label = name
                .slice(stem.length, name.lastIndexOf("."))
                .replace(/^[-_.]+/, "");
            matches.push({ file, label: label || null });
        }
    }

    return matches.sort((a, b) => naturalCompare(a.file, b.file));
}

/**
 * Build the list of programs under `root` that labpress can handle.
 * Config-level include/exclude and the --only filter are applied here.
 */
export async function discoverPrograms(root, { include, exclude, only } = {}) {
    const files = await walk(root);
    const programs = [];

    for (const file of files) {
        const language = detectLanguage(file);
        if (!language) continue;
        const posixPath = file.split(path.sep).join("/");
        if (include?.length && !matchesAny(posixPath, include)) continue;
        if (exclude?.length && matchesAny(posixPath, exclude)) continue;
        if (only?.length && !matchesAny(posixPath, only)) continue;

        const stem = path.basename(file, path.extname(file));
        programs.push({
            path: posixPath,
            absolutePath: path.join(root, file),
            language,
            stem,
            title: titleFromStem(stem),
            inputFiles: findInputFiles(file, files),
        });
    }

    return programs;
}

/** Reorder programs so anything named in `order` comes first, in that order. */
export function applyOrder(programs, order = []) {
    if (!order.length) return programs;
    const rank = new Map(order.map((entry, index) => [entry, index]));
    return [...programs].sort((a, b) => {
        const rankA = rank.has(a.path)
            ? rank.get(a.path)
            : Number.MAX_SAFE_INTEGER;
        const rankB = rank.has(b.path)
            ? rank.get(b.path)
            : Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        return naturalCompare(a.path, b.path);
    });
}

/** Resolve a path the user pointed us at, erroring clearly if it's not a directory. */
export async function resolveRoot(target) {
    const absolute = path.resolve(target);
    let info;
    try {
        info = await stat(absolute);
    } catch {
        throw new Error(`No such directory: ${absolute}`);
    }
    if (!info.isDirectory()) throw new Error(`Not a directory: ${absolute}`);
    return absolute;
}
