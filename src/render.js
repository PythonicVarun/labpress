import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "./languages.js";

const ASSETS = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "assets",
);

export const FOOTER_TEXT =
    'Generated with <a href="https://www.npmjs.com/package/labpress">labpress</a>';

export function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** Blank strings and nullish values shouldn't render an empty row. */
function present(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
}

const COVER_FIELDS = [
    ["name", "Name"],
    ["roll", "Roll No."],
    ["course", "Course"],
    ["branch", "Branch"],
    ["section", "Section"],
    ["semester", "Semester"],
    ["subject", "Subject"],
    ["teacher", "Faculty"],
    ["university", "University"],
];

/** `Week-01` reads better as `Week 01` on a cover page. */
export function humaniseGroup(group) {
    return group.replace(/[_-]+/g, " ").trim();
}

function renderCover(config, generatedAt, group) {
    if (config.cover === false) return "";
    const student = config.student ?? {};
    const rows = COVER_FIELDS.filter(([key]) => present(student[key]))
        .map(
            ([key, label]) =>
                `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(student[key])}</dd>`,
        )
        .join("\n            ");

    const subject = present(student.subject) ? student.subject : null;
    const title = config.title ?? "Lab Record";

    return `<section class="cover">
        ${subject ? `<div class="cover-subject">${escapeHtml(subject)}</div>` : ""}
        <h1>${escapeHtml(title)}</h1>
        ${group ? `<div class="cover-group">${escapeHtml(humaniseGroup(group))}</div>` : ""}
        <div class="cover-rule"></div>
        ${rows ? `<dl class="cover-details">\n            ${rows}\n        </dl>` : ""}
        ${generatedAt ? `<div class="cover-subject" style="margin-top:22px">${escapeHtml(generatedAt)}</div>` : ""}
    </section>`;
}

function renderToc(programs, config) {
    if (config.toc === false || programs.length === 0) return "";
    const items = programs
        .map(
            (program, index) =>
                `<li><a href="#program-${index + 1}">${escapeHtml(program.title)}` +
                ` <span class="toc-path">${escapeHtml(program.path)}</span></a></li>`,
        )
        .join("\n            ");
    return `<section class="toc">
        <h2>Contents</h2>
        <ol>
            ${items}
        </ol>
    </section>`;
}

/** One interleaved terminal block: output as-is, typed input marked up. */
function renderSegments(segments) {
    if (!segments.length) {
        return '<span class="empty">(no output)</span>';
    }
    return segments
        .map((segment) => {
            const text = escapeHtml(segment.text);
            if (segment.type === "in") {
                // Trailing newline sits outside the span so the highlight box
                // doesn't stretch across the rest of the line.
                const body = text.replace(/\n$/, "");
                return `<span class="typed">${body}</span>\n`;
            }
            if (segment.type === "err")
                return `<span class="stderr">${text}</span>`;
            if (segment.type === "meta")
                return `<span class="meta">${text}</span>`;
            return text;
        })
        .join("");
}

function renderRun(transcript, index, total) {
    const heading = total > 1 ? `Run ${index + 1}` : "Run";
    const label = present(transcript.label)
        ? `<span class="run-label">${escapeHtml(transcript.label)}</span>`
        : "";

    const note = present(transcript.note)
        ? `<div class="run-note">${escapeHtml(transcript.note)}</div>`
        : "";

    let body;
    if (transcript.mode === "split") {
        const input = transcript.inputText
            ? `<div class="split-part"><div class="split-title">Input</div>` +
              `<pre class="terminal">${escapeHtml(transcript.inputText)}</pre></div>`
            : "";
        const output =
            `<div class="split-part"><div class="split-title">Output</div>` +
            `<pre class="terminal">${
                transcript.outputText
                    ? escapeHtml(transcript.outputText)
                    : '<span class="empty">(no output)</span>'
            }</pre></div>`;
        body = input + output;
    } else {
        body = `<pre class="terminal">${renderSegments(transcript.segments)}</pre>`;
    }

    const notices = [];
    if (transcript.downgraded) {
        notices.push(
            `<div class="status info">This program buffers its output, so input and output ` +
                `are shown separately rather than interleaved.</div>`,
        );
    }
    if (transcript.status) {
        notices.push(
            `<div class="status">${escapeHtml(transcript.status)}</div>`,
        );
    }

    return `<div class="run">
                <div class="run-head"><span>${heading}</span>${label}</div>
                ${note}${body}${notices.join("")}
            </div>`;
}

function renderProgram(program, index, highlighted) {
    const language = LANGUAGES[program.language]?.name ?? program.language;
    const aim = present(program.aim)
        ? `<p class="aim"><strong>Aim.</strong> ${escapeHtml(program.aim)}</p>`
        : "";
    const note = present(program.note)
        ? `<p class="aim">${escapeHtml(program.note)}</p>`
        : "";

    const runs = program.transcripts.length
        ? program.transcripts
              .map((transcript, i) =>
                  renderRun(transcript, i, program.transcripts.length),
              )
              .join("\n            ")
        : "";

    const compileError = program.compileError
        ? `<div class="run"><div class="run-head"><span>Compilation failed</span></div>` +
          `<pre class="terminal"><span class="stderr">${escapeHtml(
              program.compileError,
          )}</span></pre></div>`
        : "";

    const outputSection =
        runs || compileError
            ? `<div class="section-label">Output</div>
            ${compileError}${runs}`
            : "";

    return `<article class="program" id="program-${index + 1}">
        <header>
            <div class="program-index">Program ${index + 1}</div>
            <h2>${escapeHtml(program.title)}</h2>
            <div class="program-meta">${escapeHtml(program.path)} &middot; ${escapeHtml(language)}</div>
            ${aim}${note}
        </header>
        <div class="section-label">Source code</div>
        <div class="code">${highlighted}</div>
        ${outputSection}
    </article>`;
}

function renderFooter(footer) {
    if (footer === false) return "";
    const content =
        typeof footer === "string" ? escapeHtml(footer) : FOOTER_TEXT;
    return `<footer class="page-footer">${content}</footer>`;
}

/** Assemble the whole self-contained page. */
export async function renderDocument({
    programs,
    config,
    highlighter,
    generatedAt,
    group = null,
}) {
    const [css, viewerJs] = await Promise.all([
        readFile(path.join(ASSETS, "print.css"), "utf8"),
        readFile(path.join(ASSETS, "viewer.js"), "utf8"),
    ]);

    const body = programs
        .map((program, index) =>
            renderProgram(
                program,
                index,
                highlighter.highlight(program.source, program.language),
            ),
        )
        .join("\n    ");

    const baseTitle = config.title ?? "Lab Record";
    const title = group ? `${baseTitle} - ${humaniseGroup(group)}` : baseTitle;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<script>
    // Runs before paint so a dark-mode reader never sees a white flash.
    (function () {
        var saved = localStorage.getItem("labpress-theme");
        var dark = saved
            ? saved === "dark"
            : window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (dark) document.documentElement.classList.add("dark-theme");
    })();
</script>
<style>
${css}
</style>
</head>
<body>
<div class="toolbar">
    <button id="print-button" type="button">Print / Save as PDF</button>
    <button id="theme-toggle" class="theme-toggle-btn" type="button" aria-label="Toggle theme">
        <span class="sun-icon">&#9728;</span>
        <span class="moon-icon">&#9790;</span>
    </button>
</div>
<main class="doc">
    ${renderCover(config, generatedAt, group)}
    ${renderToc(programs, config)}
    ${body}
</main>
${renderFooter(config.footer)}
<script>
${viewerJs}
</script>
</body>
</html>
`;
}
