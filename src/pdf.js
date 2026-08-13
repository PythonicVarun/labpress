import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { pathToFileURL } from "node:url";

const CANDIDATES = {
    linux: [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "brave-browser",
        "microsoft-edge",
    ],
    darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
    win32: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
};

function onPath(command) {
    const probe = platform() === "win32" ? "where" : "which";
    try {
        const result = spawnSync(probe, [command], { stdio: "ignore" });
        return !result.error && result.status === 0;
    } catch {
        return false;
    }
}

/** Locate a Chrome-family browser we can drive headlessly, or null. */
export function findChrome() {
    if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
        return process.env.CHROME_PATH;
    }
    for (const candidate of CANDIDATES[platform()] ?? CANDIDATES.linux) {
        if (candidate.includes("/") || candidate.includes("\\")) {
            if (existsSync(candidate)) return candidate;
        } else if (onPath(candidate)) {
            return candidate;
        }
    }
    return null;
}

/**
 * Print an HTML file to PDF using the browser already installed on the
 * machine, so labpress doesn't have to ship a hundred-megabyte Chromium.
 */
export function printToPdf(
    chromePath,
    htmlPath,
    pdfPath,
    { timeout = 120_000 } = {},
) {
    const args = [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-pdf-header-footer",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=10000",
        `--print-to-pdf=${pdfPath}`,
        pathToFileURL(htmlPath).href,
    ];

    return new Promise((resolve) => {
        const child = spawn(chromePath, args, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => (stderr += chunk));

        const killer = setTimeout(() => child.kill("SIGKILL"), timeout);
        child.on("error", (error) => {
            clearTimeout(killer);
            resolve({ ok: false, message: String(error.message) });
        });
        child.on("close", (code) => {
            clearTimeout(killer);
            if (code === 0 && existsSync(pdfPath)) {
                resolve({ ok: true, message: null });
                return;
            }
            resolve({
                ok: false,
                message: stderr.trim() || `Chrome exited with code ${code}.`,
            });
        });
    });
}
