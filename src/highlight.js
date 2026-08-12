import { createHighlighter, bundledThemes } from "shiki";
import { LANGUAGES } from "./languages.js";

const LIGHT_FALLBACK = "github-light";
const DARK_FALLBACK = "github-dark";

/** Pair a chosen light theme with a sensible dark counterpart. */
function pickThemes(theme) {
    const light = theme in bundledThemes ? theme : LIGHT_FALLBACK;
    // Most bundled themes come as a light/dark pair with a predictable name.
    const guessed = light.replace(/-light$/, "-dark");
    const dark =
        guessed !== light && guessed in bundledThemes ? guessed : DARK_FALLBACK;
    return { light, dark };
}

/** True when the requested theme isn't one Shiki ships. */
export function isKnownTheme(theme) {
    return theme in bundledThemes;
}

export function availableThemes() {
    return Object.keys(bundledThemes).sort();
}

/**
 * Create a highlighter loaded with just the languages actually in use, so
 * startup stays quick rather than pulling in every bundled grammar.
 */
export async function createCodeHighlighter(languageIds, theme) {
    const { light, dark } = pickThemes(theme);
    const langs = [
        ...new Set(
            languageIds.map((id) => LANGUAGES[id]?.shikiLang).filter(Boolean),
        ),
    ];

    const highlighter = await createHighlighter({
        themes: [light, dark],
        langs: langs.length ? langs : ["text"],
    });

    return {
        themes: { light, dark },
        /**
         * Render code as HTML carrying both palettes as CSS variables, so the
         * on-screen light/dark toggle recolours without re-highlighting.
         */
        highlight(code, languageId) {
            const lang = LANGUAGES[languageId]?.shikiLang ?? "text";
            return highlighter.codeToHtml(code, {
                lang,
                themes: { light, dark },
                defaultColor: false,
                cssVariablePrefix: "--sh-",
            });
        },
        dispose() {
            highlighter.dispose();
        },
    };
}
