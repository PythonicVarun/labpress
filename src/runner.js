import { spawn, spawnSync } from "node:child_process";
import { platform } from "node:os";

const IS_WINDOWS = platform() === "win32";

// Built from an escape rather than a literal control byte so the source
// file stays free of unprintable characters.
// Matches CSI sequences (colours, cursor moves) and the shorter two-byte forms.
const ANSI_PATTERN = new RegExp(
    "\\u001b\\[[0-9;?]*[ -/]*[@-~]|\\u001b[@-Z\\\\-_]",
    "g",
);

/** Strip ANSI escape sequences - printed pages don't want raw colour codes. */
export function stripAnsi(text) {
    return text.replace(ANSI_PATTERN, "");
}

let stdbufAvailable = null;

/** `stdbuf` ships with GNU coreutils - present on Linux, usually absent on macOS/Windows. */
function hasStdbuf() {
    if (stdbufAvailable !== null) return stdbufAvailable;
    if (IS_WINDOWS) {
        stdbufAvailable = false;
        return stdbufAvailable;
    }
    try {
        const result = spawnSync("stdbuf", ["--version"], { stdio: "ignore" });
        stdbufAvailable = !result.error && result.status === 0;
    } catch {
        stdbufAvailable = false;
    }
    return stdbufAvailable;
}

/**
 * Prefix an argv with `stdbuf -o0 -e0` when the language needs it and the
 * tool exists. Returns the argv unchanged when it can't help.
 */
export function applyUnbuffer(argv, mode) {
    if (mode !== "stdbuf" || !hasStdbuf()) return { argv, unbuffered: false };
    return { argv: ["stdbuf", "-o0", "-e0", ...argv], unbuffered: true };
}

function describeSpawnError(error, command) {
    if (error.code === "ENOENT") {
        return `Command not found: ${command}\nInstall it, or set a custom command in labpress.config.jsonc.`;
    }
    return String(error.message);
}

/** Run a compile step. Resolves with the outcome rather than throwing. */
export function compile(argv, { cwd, env, timeout = 60_000 } = {}) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(argv[0], argv.slice(1), {
                cwd,
                env: { ...process.env, ...env },
                stdio: ["ignore", "pipe", "pipe"],
            });
        } catch (error) {
            resolve({
                ok: false,
                stdout: "",
                stderr: describeSpawnError(error, argv[0]),
                exitCode: null,
            });
            return;
        }

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));

        const killer = setTimeout(() => child.kill("SIGKILL"), timeout);
        let settled = false;

        child.on("error", (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(killer);
            resolve({
                ok: false,
                stdout: stripAnsi(stdout),
                stderr: stripAnsi(stderr) || describeSpawnError(error, argv[0]),
                exitCode: null,
            });
        });

        child.on("close", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(killer);
            resolve({
                ok: code === 0,
                stdout: stripAnsi(stdout),
                stderr: stripAnsi(stderr),
                exitCode: code,
            });
        });
    });
}

/**
 * Execute one run of a program, feeding stdin and capturing an ordered
 * transcript of what the terminal would have shown.
 *
 * The feeder writes the next input line after `idleMs` of silence, then
 * re-arms its own timer. Re-arming matters: a fully buffered program (plain
 * C without stdbuf) never emits the prompt that would otherwise trigger the
 * next write, and a purely output-driven feeder deadlocks on it.
 */
export function execute({
    argv,
    cwd,
    env = {},
    inputs = [],
    timeout = 20_000,
    idleMs = 150,
    maxOutputBytes = 512 * 1024,
} = {}) {
    return new Promise((resolve) => {
        const events = [];
        let stdout = "";
        let stderr = "";
        let outputBytes = 0;
        let truncated = false;
        let sawOutputBeforeFirstInput = false;
        let inputsWritten = 0;
        let settled = false;

        let child;
        try {
            child = spawn(argv[0], argv.slice(1), {
                cwd,
                env: { ...process.env, NO_COLOR: "1", TERM: "dumb", ...env },
                stdio: ["pipe", "pipe", "pipe"],
            });
        } catch (error) {
            const message = describeSpawnError(error, argv[0]);
            resolve({
                events,
                stdout: "",
                stderr: message,
                exitCode: null,
                signal: null,
                timedOut: false,
                truncated: false,
                degraded: false,
                error: message,
                inputsWritten: 0,
                inputsTotal: inputs.length,
            });
            return;
        }

        let index = 0;
        let idleTimer = null;

        const arm = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(writeNext, idleMs);
        };

        const writeNext = () => {
            if (settled) return;
            if (index >= inputs.length) {
                try {
                    if (child.stdin.writable) child.stdin.end();
                } catch {
                    // already closed
                }
                return;
            }
            const line = inputs[index++];
            inputsWritten++;
            events.push({ type: "in", text: `${line}\n` });
            try {
                if (child.stdin.writable) child.stdin.write(`${line}\n`);
            } catch {
                // Program already exited; nothing left to feed.
            }
            arm();
        };

        const record = (type) => (chunk) => {
            outputBytes += chunk.length;
            if (outputBytes > maxOutputBytes) {
                if (!truncated) {
                    truncated = true;
                    events.push({
                        type: "meta",
                        text: "... output truncated by labpress ...",
                    });
                    child.kill("SIGKILL");
                }
                return;
            }
            const text = stripAnsi(chunk.toString());
            if (inputsWritten === 0 && text.length > 0) {
                sawOutputBeforeFirstInput = true;
            }
            if (type === "out") stdout += text;
            else stderr += text;
            events.push({ type, text });
            arm();
        };

        child.stdout.on("data", record("out"));
        child.stderr.on("data", record("err"));
        // A program that exits early makes stdin unwritable; that's expected.
        child.stdin.on("error", () => {});

        arm();

        let timedOut = false;
        const killer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeout);

        child.on("error", (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(killer);
            clearTimeout(idleTimer);
            const message = describeSpawnError(error, argv[0]);
            resolve({
                events,
                stdout,
                stderr: stderr || message,
                exitCode: null,
                signal: null,
                timedOut,
                truncated,
                degraded: false,
                error: message,
                inputsWritten,
                inputsTotal: inputs.length,
            });
        });

        child.on("close", (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(killer);
            clearTimeout(idleTimer);
            resolve({
                events,
                stdout,
                stderr,
                exitCode: code,
                signal,
                timedOut,
                truncated,
                // Nothing came through before we started typing => the program
                // is fully buffered and the interleaving can't be trusted.
                degraded: inputs.length > 0 && !sawOutputBeforeFirstInput,
                error: null,
                inputsWritten,
                inputsTotal: inputs.length,
            });
        });
    });
}
