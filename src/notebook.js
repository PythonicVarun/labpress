import { Buffer } from "node:buffer";

/**
 * Read the cells and the outputs in notebook.
 */

// Pictures beat text when a cell offers both - a plot is the point of the cell.
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/svg+xml"];
const TEXT_MIMES = ["text/plain", "text/markdown", "text/latex"];

// Tracebacks keep their terminal colour codes, and stream text sometimes does.
const ANSI = /\u001B(?:\[[0-9;?]*[ -\/]*[@-~]|[()][A-Za-z0-9])/g;

export function stripAnsi(text) {
    return text.replace(ANSI, "");
}

/** Notebook JSON stores text as either one string or a list of lines. */
export function joinSource(value) {
    if (Array.isArray(value)) return value.join("");
    return typeof value === "string" ? value : "";
}

function dataUri(mime, payload) {
    // SVG is stored as markup; the bitmap formats are already base64.
    const base64 =
        mime === "image/svg+xml"
            ? Buffer.from(joinSource(payload), "utf8").toString("base64")
            : joinSource(payload).replace(/\s+/g, "");
    return `data:${mime};base64,${base64}`;
}

/**
 * Last resort for an output that ships nothing but HTML. Jupyter's markup
 * comes with its own <style> blocks that would bleed into the whole
 * document, so the tags go and the text stays.
 */
export function htmlToText(html) {
    return html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
        .replace(/<\/t[dh]>/gi, "\t")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** Pick the one representation of an output that is worth printing. */
function fromBundle(data) {
    for (const mime of IMAGE_MIMES) {
        if (data[mime]) {
            return { kind: "image", mime, src: dataUri(mime, data[mime]) };
        }
    }
    for (const mime of TEXT_MIMES) {
        if (data[mime]) {
            const text = stripAnsi(joinSource(data[mime])).trimEnd();
            if (text) return { kind: "text", text };
        }
    }
    if (data["text/html"]) {
        const text = htmlToText(joinSource(data["text/html"]));
        if (text) return { kind: "text", text };
    }
    return null;
}

function normaliseOutput(output) {
    if (output?.output_type === "stream") {
        const text = stripAnsi(joinSource(output.text)).trimEnd();
        if (!text) return null;
        return {
            kind: "stream",
            stream: output.name === "stderr" ? "stderr" : "stdout",
            text,
        };
    }

    if (
        output?.output_type === "execute_result" ||
        output?.output_type === "display_data"
    ) {
        return fromBundle(output.data ?? {});
    }

    if (output?.output_type === "error") {
        return {
            kind: "error",
            ename: String(output.ename ?? "Error"),
            evalue: String(output.evalue ?? ""),
            traceback: (output.traceback ?? [])
                .map((line) => stripAnsi(String(line)))
                .join("\n")
                .trimEnd(),
        };
    }

    return null;
}

/** Images pasted into a markdown cell, keyed by the name the cell refers to. */
function attachmentsOf(cell) {
    const found = {};
    for (const [name, bundle] of Object.entries(cell.attachments ?? {})) {
        const mime = Object.keys(bundle ?? {})[0];
        if (mime) found[name] = dataUri(mime, bundle[mime]);
    }
    return found;
}

/** The same cell tags nbconvert honours, so notebooks stay portable. */
function tagsOf(cell) {
    const tags = cell.metadata?.tags;
    return new Set(Array.isArray(tags) ? tags.map(String) : []);
}

function normaliseCell(cell) {
    const tags = tagsOf(cell);
    if (tags.has("remove-cell") || tags.has("hide-cell")) return null;

    const source = joinSource(cell.source).replace(/\s+$/, "");

    if (cell.cell_type === "markdown") {
        if (!source.trim()) return null;
        return { type: "markdown", source, attachments: attachmentsOf(cell) };
    }
    if (cell.cell_type === "raw") {
        return source.trim() ? { type: "raw", source } : null;
    }
    if (cell.cell_type !== "code") return null;

    const hideOutput = tags.has("hide-output") || tags.has("remove-output");
    const outputs = hideOutput
        ? []
        : (cell.outputs ?? []).map(normaliseOutput).filter(Boolean);

    const hideInput = tags.has("hide-input") || tags.has("remove-input");
    const visibleSource = hideInput ? null : source;

    // A cell told to hide its source with nothing to show has nothing left.
    if (!visibleSource?.trim() && outputs.length === 0) return null;

    return {
        type: "code",
        source: visibleSource,
        executionCount: cell.execution_count ?? null,
        outputs,
    };
}

/** Which language the code cells are in, as a Shiki grammar name. */
function languageOf(notebook) {
    const name =
        notebook.metadata?.language_info?.name ??
        notebook.metadata?.kernelspec?.language ??
        "python";
    return String(name).toLowerCase();
}

/** Parse a .ipynb into the cells the renderer draws, outputs included. */
export function parseNotebook(text, file) {
    let json;
    try {
        json = JSON.parse(text);
    } catch (error) {
        throw new Error(`Could not parse ${file}: ${error.message}`);
    }

    if (!Array.isArray(json.cells)) {
        throw new Error(
            `${file} is not a notebook labpress can read. It needs nbformat 4 - ` +
                `open it in Jupyter and save it again.`,
        );
    }

    const cells = json.cells.map(normaliseCell).filter(Boolean);
    return {
        language: languageOf(json),
        cells,
        hasCode: cells.some((cell) => cell.type === "code"),
        hasOutputs: cells.some(
            (cell) => cell.type === "code" && cell.outputs.length > 0,
        ),
    };
}

/**
 * Promote a leading "# Heading" to the program title. It gets removed from
 * the cell so the same words don't appear twice, one line apart.
 */
export function takeTitle(notebook) {
    const first = notebook.cells[0];
    if (first?.type !== "markdown") return null;

    const match = /^#\s+(.+?)\s*#*[ \t]*(?:\n|$)/.exec(first.source);
    if (!match) return null;

    const rest = first.source.slice(match[0].length).trim();
    if (rest) first.source = rest;
    else notebook.cells.shift();

    return match[1].replace(/[*_`]/g, "").trim() || null;
}
