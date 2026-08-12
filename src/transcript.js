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
            outputText: joinStreams(result),
        };
    }

    return { ...base, segments: coalesce(result.events) };
}

/** stdout with stderr appended, which is what a terminal would have shown. */
function joinStreams(result) {
    const parts = [result.stdout];
    if (result.stderr) parts.push(result.stderr);
    return parts.filter(Boolean).join("").trimEnd();
}
