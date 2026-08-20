import { escapeHtml } from "./html.js";

/**
 * Minimal Markdown for the prose cells of a notebook: headings, lists,
 * tables, quotes, fences and the usual inline marks.
 *
 * Anything unrecognised falls through as own text rather than disappearing.
 */

// Inline code is pulled out before the other marks run, so `a*b*c` survives.
const SLOT = String.fromCharCode(0);

/** Links and images only render for schemes that work in a printed file. */
function safeUrl(url) {
    return /^(?:https?:\/\/|mailto:|#|data:image\/)/i.test(url) ? url : null;
}

function renderImage(alt, src, attachments) {
    const resolved = src.startsWith("attachment:")
        ? attachments[src.slice("attachment:".length)]
        : safeUrl(src);
    return resolved
        ? `<img src="${resolved}" alt="${alt}">`
        : alt || escapeHtml(src);
}

function renderLink(label, href) {
    const resolved = safeUrl(href);
    return resolved ? `<a href="${resolved}">${label}</a>` : label;
}

/** Bold, italic, code, links, images - applied to one already-escaped line. */
function inline(text, attachments) {
    const codes = [];
    let html = escapeHtml(text).replace(/`([^`]+)`/g, (match, code) => {
        codes.push(code);
        return `${SLOT}${codes.length - 1}${SLOT}`;
    });

    html = html
        .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (match, alt, src) =>
            renderImage(alt, src, attachments),
        )
        .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (match, label, href) =>
            renderLink(label, href),
        )
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/__([^_]+)__/g, "<strong>$1</strong>")
        // Single underscores are left alone: snake_case is far more common
        // in a lab notebook than emphasis.
        .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
        .replace(/~~([^~]+)~~/g, "<del>$1</del>");

    return html.replace(
        new RegExp(`${SLOT}(\\d+)${SLOT}`, "g"),
        (match, index) => `<code>${codes[Number(index)]}</code>`,
    );
}

const FENCE = /^\s*(```+|~~~+)/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(?:[-*_]\s*){3,}$/;
const BULLET = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

/** True when a line opens a new block, so a paragraph has to stop here. */
function startsBlock(line) {
    return (
        FENCE.test(line) ||
        HEADING.test(line) ||
        RULE.test(line) ||
        BULLET.test(line) ||
        QUOTE.test(line)
    );
}

function isTableDivider(line) {
    return /\|/.test(line) && /^[\s|:-]+$/.test(line) && /-/.test(line);
}

function splitRow(line) {
    return line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim());
}

function alignmentsFrom(divider) {
    return splitRow(divider).map((cell) => {
        if (/^:-+:$/.test(cell)) return "center";
        if (/-+:$/.test(cell)) return "right";
        return null;
    });
}

function renderCells(cells, alignments, tag, attachments) {
    return cells
        .map((cell, index) => {
            const align = alignments[index]
                ? ` style="text-align:${alignments[index]}"`
                : "";
            return `<${tag}${align}>${inline(cell, attachments)}</${tag}>`;
        })
        .join("");
}

/** Render one Markdown string to HTML. */
export function renderMarkdown(text, { attachments = {} } = {}) {
    const lines = String(text).split("\n");
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];

        if (!line.trim()) {
            index++;
            continue;
        }

        const fence = FENCE.exec(line);
        if (fence) {
            const closing = new RegExp(`^\\s*\\${fence[1][0]}{3,}\\s*$`);
            const body = [];
            index++;
            while (index < lines.length && !closing.test(lines[index])) {
                body.push(lines[index++]);
            }
            index++;
            blocks.push(
                `<pre class="md-code">${escapeHtml(body.join("\n"))}</pre>`,
            );
            continue;
        }

        const heading = HEADING.exec(line);
        if (heading) {
            // The program title is an h2, so cell headings start below it.
            const level = Math.min(heading[1].length + 2, 6);
            const content = heading[2].replace(/\s*#+\s*$/, "");
            blocks.push(
                `<h${level}>${inline(content, attachments)}</h${level}>`,
            );
            index++;
            continue;
        }

        if (RULE.test(line)) {
            blocks.push("<hr>");
            index++;
            continue;
        }

        if (QUOTE.test(line)) {
            const quoted = [];
            while (index < lines.length && QUOTE.test(lines[index])) {
                quoted.push(QUOTE.exec(lines[index++])[1]);
            }
            blocks.push(
                `<blockquote>${renderMarkdown(quoted.join("\n"), {
                    attachments,
                })}</blockquote>`,
            );
            continue;
        }

        if (line.includes("|") && isTableDivider(lines[index + 1] ?? "")) {
            const header = splitRow(line);
            const alignments = alignmentsFrom(lines[index + 1]);
            index += 2;
            const rows = [];
            while (index < lines.length && lines[index].includes("|")) {
                rows.push(splitRow(lines[index++]));
            }
            const head = renderCells(header, alignments, "th", attachments);
            const body = rows
                .map(
                    (row) =>
                        `<tr>${renderCells(row, alignments, "td", attachments)}</tr>`,
                )
                .join("");
            blocks.push(
                `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
            );
            continue;
        }

        const bullet = BULLET.exec(line);
        if (bullet) {
            const ordered = /\d/.test(bullet[1]);
            const items = [];
            while (index < lines.length && BULLET.test(lines[index])) {
                items.push(BULLET.exec(lines[index++])[2]);
                while (
                    index < lines.length &&
                    lines[index].trim() &&
                    !startsBlock(lines[index])
                ) {
                    items[items.length - 1] += ` ${lines[index++].trim()}`;
                }
            }
            const tag = ordered ? "ol" : "ul";
            const rendered = items
                .map((item) => `<li>${inline(item, attachments)}</li>`)
                .join("");
            blocks.push(`<${tag}>${rendered}</${tag}>`);
            continue;
        }

        const paragraph = [];
        while (
            index < lines.length &&
            lines[index].trim() &&
            !startsBlock(lines[index])
        ) {
            paragraph.push(lines[index++]);
        }
        blocks.push(`<p>${inline(paragraph.join("\n"), attachments)}</p>`);
    }

    return blocks.join("\n");
}
