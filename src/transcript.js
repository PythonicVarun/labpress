/** Merge neighbouring events of the same kind so we emit fewer spans. */
export function coalesce(events) {
    const merged = [];
    for (const event of events) {
        const previous = merged.at(-1);
        if (previous && previous.type === event.type) {
            previous.text += event.text;
        } else {
            merged.push({ ...event });
        }
    }
    return merged;
}

const REPEAT_THRESHOLD = 4;

/**
 * Collapse a run of identical consecutive lines into one line plus a count.
 *
 * A program that hits end-of-input inside a validation loop will happily
 * print the same complaint thousands of times, and none of that belongs in
 * a submitted PDF.
 */
export function collapseRepeats(text, threshold = REPEAT_THRESHOLD) {
    const endsWithNewline = text.endsWith("\n");
    const lines = endsWithNewline
        ? text.slice(0, -1).split("\n")
        : text.split("\n");
    const parts = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];
        let count = 1;
        while (index + count < lines.length && lines[index + count] === line)
            count++;

        if (count > threshold) {
            parts.push({ type: "text", value: `${line}\n` });
            parts.push({
                type: "note",
                value: `... the line above repeated ${count - 1} more times ...\n`,
            });
        } else {
            parts.push({
                type: "text",
                value: `${Array(count).fill(line).join("\n")}\n`,
            });
        }
        index += count;
    }

    if (!endsWithNewline && parts.length) {
        const last = parts.at(-1);
        if (last.type === "text") last.value = last.value.replace(/\n$/, "");
    }
    return parts;
}

/** Expand one segment into segments, splitting out any collapsed-repeat notes. */
function collapseSegment(segment) {
    if (segment.type !== "out" && segment.type !== "err") return [segment];
    const parts = collapseRepeats(segment.text);
    if (parts.length === 1 && parts[0].type === "text") return [segment];
    return parts.map((part) => ({
        type: part.type === "note" ? "meta" : segment.type,
        text: part.value,
    }));
}

/** Short sentence describing how a run ended, or null if it was clean. */
export function describeStatus(result) {
    if (result.error) return result.error;
    if (result.timedOut) {
        return "Stopped by labpress after the time limit - the program was still running.";
    }
    if (result.truncated)
        return "Output was longer than the limit and got cut off.";
    if (result.signal) return `Killed by signal ${result.signal}.`;
    if (result.exitCode !== 0 && result.exitCode !== null) {
        return `Exited with code ${result.exitCode}.`;
    }
    return null;
}

/**
 * Build the model the renderer draws from.
 *
 * Interleaved is the default because it reads like a real terminal session.
 * It gets downgraded to split when the runner reports `degraded`, which means
 * the program buffered everything and the ordering can't be trusted.
 */
export function buildTranscript(result, run, { mode = "interleaved" } = {}) {
    const wanted = run.transcript ?? mode;
    const forcedSplit = result.degraded && wanted === "interleaved";
    const effective = forcedSplit ? "split" : wanted;

    const base = {
        label: run.label,
        note: run.note,
        mode: effective,
        downgraded: forcedSplit,
        status: describeStatus(result),
        failed: Boolean(result.error) || result.timedOut,
        exitCode: result.exitCode,
        hasInput: run.inputs.length > 0,
        args: run.args,
    };

    if (effective === "split") {
        return {
            ...base,
            inputText: run.inputs.join("\n"),
            outputText: collapseRepeats(joinStreams(result))
                .map((part) => part.value)
                .join("")
                .trimEnd(),
        };
    }

    return {
        ...base,
        segments: coalesce(result.events).flatMap(collapseSegment),
    };
}

/** stdout with stderr appended, which is what a terminal would have shown. */
function joinStreams(result) {
    const parts = [result.stdout];
    if (result.stderr) parts.push(result.stderr);
    return parts.filter(Boolean).join("").trimEnd();
}
