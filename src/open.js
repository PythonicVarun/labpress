import { spawn } from "node:child_process";
import { platform } from "node:os";
import { pathToFileURL } from "node:url";

/** Open a file with whatever the OS considers its default application. */
export function openInBrowser(filePath) {
    const url = pathToFileURL(filePath).href;
    const os = platform();

    const [command, args] =
        os === "darwin"
            ? ["open", [url]]
            : os === "win32"
              ? // The empty string is the window title `start` expects first.
                ["cmd", ["/c", "start", "", url]]
              : ["xdg-open", [url]];

    return new Promise((resolve) => {
        try {
            const child = spawn(command, args, {
                stdio: "ignore",
                detached: true,
            });
            child.on("error", () => resolve(false));
            child.unref();
            resolve(true);
        } catch {
            resolve(false);
        }
    });
}
