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

// Jupyter renders raw HTML in a markdown cell.
const PLAIN_TAGS =
    /^<(\/?)(br|b|strong|i|em|u|s|del|sub|sup|mark|small|kbd|center)\s*\/?>$/i;
const BOX_TAG = /^<(\/?)(div|span|p)(\s+align="(left|right|center)")?\s*>$/i;
const IMG_TAG = /^<img\s[^>]*>$/i;

function attributeOf(tag, name) {
    return new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1] ?? "";
}

/** Turn one raw tag into the tag we are willing to emit, or null. */
function allowTag(tag, attachments) {
    const plain = PLAIN_TAGS.exec(tag);
    if (plain) return `<${plain[1]}${plain[2].toLowerCase()}>`;

    const box = BOX_TAG.exec(tag);
    if (box) {
        const align = box[4] ? ` style="text-align:${box[4]}"` : "";
        return box[1]
            ? `</${box[2].toLowerCase()}>`
            : `<${box[2].toLowerCase()}${align}>`;
    }

    if (IMG_TAG.test(tag)) {
        // Both paths hand renderImage already-escaped values.
        return renderImage(
            escapeHtml(attributeOf(tag, "alt")),
            escapeHtml(attributeOf(tag, "src")),
            attachments,
        );
    }
    return null;
}

/** Bold, italic, code, links, images - applied to one line of text. */
function inline(text, attachments) {
    const codes = [];
    let html = String(text).replace(/`([^`]+)`/g, (match, code) => {
        codes.push(`<code>${escapeHtml(code)}</code>`);
        return `${SLOT}${codes.length - 1}${SLOT}`;
    });

    html = html.replace(/<[^<>]+>/g, (tag) => {
        const allowed = allowTag(tag, attachments);
        if (allowed === null) return tag;
        codes.push(allowed);
        return `${SLOT}${codes.length - 1}${SLOT}`;
    });

    html = escapeHtml(html);

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
        (match, index) => codes[Number(index)],
    );
}

const FENCE = /^\s*(```+|~~~+)/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(?:[-*_]\s*){3,}$/;
const BULLET = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
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

/**
 * One list and everything nested inside it. Indentation decides the depth,
 * the way it does in the editor people typed the cell in.
 */
function collectList(lines, start, attachments) {
    const first = BULLET.exec(lines[start]);
    const baseIndent = first[1].length;
    const tag = /\d/.test(first[2]) ? "ol" : "ul";
    const items = [];
    let index = start;

    while (index < lines.length) {
        const bullet = BULLET.exec(lines[index]);
        if (!bullet || bullet[1].length < baseIndent) break;

        if (bullet[1].length > baseIndent) {
            const nested = collectList(lines, index, attachments);
            if (items.length) items.at(-1).children += nested.html;
            index = nested.next;
            continue;
        }

        items.push({ text: bullet[3], children: "" });
        index++;

        // A wrapped line belongs to the item above it.
        while (
            index < lines.length &&
            lines[index].trim() &&
            !startsBlock(lines[index])
        ) {
            items.at(-1).text += ` ${lines[index++].trim()}`;
        }
    }

    const body = items
        .map(
            (item) =>
                `<li>${inline(item.text, attachments)}${item.children}</li>`,
        )
        .join("");
    return { html: `<${tag}>${body}</${tag}>`, next: index };
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

        if (BULLET.test(line)) {
            const list = collectList(lines, index, attachments);
            blocks.push(list.html);
            index = list.next;
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

        // A cell that opens with a raw block tag shouldn't be wrapped in a
        // paragraph.
        const html = inline(paragraph.join("\n"), attachments);
        blocks.push(
            /^<(div|center|p)[\s>]/i.test(html) ? html : `<p>${html}</p>`,
        );
    }

    return blocks.join("\n");
}
