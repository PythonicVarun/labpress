function applyTheme(isDark) {
    document.documentElement.classList.toggle("dark-theme", isDark);
    localStorage.setItem("labpress-theme", isDark ? "dark" : "light");
}

function toggleTheme(event) {
    const goingDark =
        !document.documentElement.classList.contains("dark-theme");
    const canAnimate =
        typeof document.startViewTransition === "function" &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!canAnimate) {
        applyTheme(goingDark);
        return;
    }

    const x = event?.clientX ?? window.innerWidth / 2;
    const y = event?.clientY ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(() =>
        applyTheme(goingDark),
    );
    transition.ready.then(() => {
        document.documentElement.animate(
            {
                clipPath: [
                    `circle(0px at ${x}px ${y}px)`,
                    `circle(${endRadius}px at ${x}px ${y}px)`,
                ],
            },
            {
                duration: 650,
                easing: "cubic-bezier(0.4, 0, 0.2, 1)",
                pseudoElement: "::view-transition-new(root)",
            },
        );
    });
}

document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
document
    .getElementById("print-button")
    .addEventListener("click", () => window.print());
