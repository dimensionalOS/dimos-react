// deno-lint-ignore-file require-await -- act(async () => ...) waits for effects even when the callback doesn't await
// Theme tokens: every skin in the bundled copy of Desktop's /theme.css defines the theme contract, the components use
// only tokens (no color literals), and every token the components use exists.
import { test } from "vitest"
import { testGlobals } from "./fake_globals.ts"
import { assert, assertEquals } from "./assert.ts"
import { SKINS, TOKENS_CSS } from "../src/theme/tokens.ts"
import { COMPONENT_CSS } from "../src/theme/css.ts"

// Desktop's theme contract (its /theme.css header): the required tokens every skin resolves
const REQUIRED = [
    "--bg",
    "--fg",
    "--muted-fg",
    "--primary",
    "--primary-fg",
    "--ok",
    "--warn",
    "--danger",
    "--info",
    "--surface",
    "--raised",
    "--input-bg",
    "--hover",
    "--sel",
    "--border",
    "--border-strong",
    "--hair",
    "--radius",
    "--radius-sm",
    "--radius-lg",
    "--radius-xl",
    "--radius-pill",
    "--shadow",
    "--shadow-lg",
    "--blur",
    "--sans",
    "--mono",
    "--display",
    "--label-case",
    "--track-label",
]

/** `selector → { token: value }` for each top-level rule block of a stylesheet. */
function blocks(css: string): Map<string, Record<string, string>> {
    const out = new Map<string, Record<string, string>>()
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "")
    for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1].trim()
        const tokens: Record<string, string> = {}
        for (const declaration of match[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
            tokens[declaration[1]] = declaration[2].trim()
        }
        out.set(selector, { ...(out.get(selector) ?? {}), ...tokens })
    }
    return out
}

test("the bundled tokens cover every skin Desktop ships", () => {
    assert(SKINS.length >= 2)
    assertEquals(SKINS[0], "portal")
    for (const skin of SKINS.slice(1)) {
        assert(TOKENS_CSS.includes(`html[data-skin="${skin}"]`), `no block for skin ${skin}`)
    }
})

test("every required token is defined by :root, and each skin's own block keeps them resolvable", () => {
    const parsed = blocks(TOKENS_CSS)
    const root = parsed.get(":root")
    assert(root, "no :root block")
    for (const token of REQUIRED) {
        assert(root[token] !== undefined, `:root lacks ${token}`)
    }
    // a skin that changes color-scheme must also give the core colors (else Portal's dark colors leak into light)
    for (const skin of SKINS.slice(1)) {
        const own = parsed.get(`html[data-skin="${skin}"]`) ?? {}
        if (/light/.test(own["color-scheme"] ?? "") || Object.keys(own).length) {
            for (const token of ["--bg", "--fg", "--primary"]) {
                assert(own[token] !== undefined, `${skin} doesn't set ${token}`)
            }
        }
    }
})

test("light and dark skins both exist (the components have rules for each)", () => {
    const schemes = [...TOKENS_CSS.matchAll(/color-scheme:\s*(\w+)/g)].map((match) => match[1])
    assert(schemes.includes("dark"))
    assert(schemes.includes("light"))
})

// a relative color from a token (oklch(from var(--bg) …)) is the token, shifted: not a literal
test("component CSS has no color literals: only Desktop's tokens", () => {
    const css = COMPONENT_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
    const literals = [
        ...css.matchAll(
            /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\((?!from var\(--)|(?<![\w-])(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b(?![\w-])/g,
        ),
    ].map((match) => {
        const line = css.slice(0, match.index).split("\n").length
        return `${match[0]} (line ${line}: ${css.split("\n")[line - 1].trim()})`
    })
    assertEquals(literals, [])
})

test("every token the components use is defined by Desktop's theme (or by the components themselves)", () => {
    const defined = new Set([...TOKENS_CSS.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]))
    for (const match of COMPONENT_CSS.matchAll(/(--[\w-]+)\s*:/g)) {
        defined.add(match[1])
    }
    const used = new Set(
        [...COMPONENT_CSS.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)].filter((match) => !match[2]).map((match) => match[1]),
    )
    // set at runtime by the theme module (Desktop's dock insets), always with a fallback where used
    const runtime = new Set(["--dim-inset-top", "--dim-inset-bottom", "--dim-inset-left", "--dim-inset-right"])
    const missing = [...used].filter((token) => !defined.has(token) && !runtime.has(token))
    assertEquals(missing, [])
})

test("DimThemeProvider takes Desktop's saved skin and follows a live change (storage event)", async () => {
    const { Window } = await import("happy-dom")
    const dom = new Window({ url: "http://localhost/apps/demo/" })
    testGlobals.window = dom
    testGlobals.document = dom.document
    Object.defineProperty(globalThis, "localStorage", { value: dom.localStorage, configurable: true, writable: true })
    testGlobals.getComputedStyle = dom.getComputedStyle.bind(dom)
    testGlobals.addEventListener = dom.addEventListener.bind(dom)
    testGlobals.removeEventListener = dom.removeEventListener.bind(dom)
    testGlobals.dispatchEvent = dom.dispatchEvent.bind(dom)
    testGlobals.CustomEvent = dom.CustomEvent
    testGlobals.IS_REACT_ACT_ENVIRONMENT = true
    dom.localStorage.setItem("portal.theme", "research")
    dom.localStorage.setItem("portal.corners", "rounded")
    const React = await import("react")
    const { createRoot } = await import("react-dom/client")
    const { DimThemeProvider, useTheme } = await import("../src/theme/provider.tsx")
    function Show() {
        const theme = useTheme()
        return React.createElement("span", null, `${theme.skin}/${theme.corners}`)
    }
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    await React.act(async () =>
        root.render(React.createElement(DimThemeProvider, { bundled: true }, React.createElement(Show)))
    )
    const html = document.documentElement
    assertEquals(html.dataset.skin, "research")
    assertEquals(html.dataset.corners, "rounded")
    assertEquals(host.textContent, "research/rounded")
    assert(document.querySelector('style[data-dimos-react="components"]'), "component CSS installed")
    assert(document.querySelector('style[data-dimos-react="tokens"]'), "bundled tokens installed")
    // Desktop saves a new skin (Settings → Appearance in another document): a storage event here
    dom.localStorage.setItem("portal.theme", "vibeslop")
    dom.localStorage.setItem("portal.corners", "theme")
    await React.act(async () => dom.dispatchEvent(new dom.StorageEvent("storage", { key: "portal.theme" })))
    assertEquals(html.dataset.skin, "vibeslop")
    assertEquals(html.dataset.corners, undefined)
    assertEquals(host.textContent, "vibeslop/theme")
    await React.act(async () => root.unmount())
    await dom.happyDOM.close()
})

test("component CSS braces balance (one unclosed rule swallows every rule after it)", async () => {
    const { COMPONENT_CSS } = await import("../src/theme/css.ts")
    let depth = 0
    for (const char of COMPONENT_CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"]*"/g, "")) {
        depth += char === "{" ? 1 : char === "}" ? -1 : 0
        if (depth < 0 || depth > 2) {
            throw new Error(`unbalanced braces (depth ${depth})`)
        }
    }
    if (depth !== 0) {
        throw new Error(`unbalanced braces at the end (depth ${depth})`)
    }
})
