// The generic pieces Desktop's Launcher added: SafeHtml's sanitizer, Stepper's per-step state, TagList, Tile.
import { test } from "vitest"
import { testGlobals } from "./fake_globals.ts"
import { assert, assertEquals } from "./assert.ts"
import { Window } from "happy-dom"

const window = new Window({
    url: "http://localhost/",
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true },
})
testGlobals.DOMParser ??= window.DOMParser
testGlobals.NodeFilter ??= window.NodeFilter
const { createElement: h } = await import("react")
const { renderToStaticMarkup } = await import("react-dom/server")
const { JsonLine, JsonView, sanitizeHtml, Stepper, TagList, Tile } = await import("../src/index.ts")

test("sanitizeHtml drops what runs or restyles, keeps the prose", () => {
    const clean = sanitizeHtml(
        `<h2 style="color:red">Title</h2><script>alert(1)</script><p onclick="x()">Hi <a href="javascript:bad()">x</a> <a href="https://a.b">y</a></p><pre>a ──▶ b</pre><object data="x"></object>`,
    )
    assert(!clean.includes("script") && !clean.includes("object") && !clean.includes("onclick"), clean)
    assert(!clean.includes("style=") && !clean.includes("javascript:"), clean)
    assert(clean.includes(`<a href="https://a.b" target="_blank" rel="noopener noreferrer">y</a>`), clean)
    assert(clean.includes("<pre>a --&gt; b</pre>"), clean)
})

test("Stepper: a step's own state wins over current", () => {
    const html = renderToStaticMarkup(
        h(Stepper, {
            steps: [{ label: "a", state: "done" }, { label: "b", state: "failed" }, { label: "c" }],
            current: 0,
        }),
    )
    const states = [...html.matchAll(/data-state="(\w+)"/g)].map((match) => match[1])
    assertEquals(states, ["done", "failed", "todo"])
    assert(html.includes(">!<"), html)
})

test("TagList renders every tag (oneLine trims only once laid out) and its extra; Tile is a button", () => {
    const html = renderToStaticMarkup(
        h(TagList, { items: ["A", { label: "B", tone: "danger" }], extra: "x", oneLine: true }),
    )
    assertEquals([...html.matchAll(/dr-tag-item/g)].length, 2)
    assert(html.includes("dr-badge--danger") && html.endsWith("x</span>"), html)
    const tile = renderToStaticMarkup(h(Tile, { title: "Go2", subtitle: "Unitree", selected: true }))
    assert(tile.startsWith("<button") && tile.includes(`aria-pressed="true"`) && tile.includes("Unitree"), tile)
    assert(renderToStaticMarkup(h(Tile, { loading: true })).includes("dr-tile--loading"))
})

test("Menu items pass their data-* / aria-* keys (and id) to their buttons", async () => {
    const { MenuList } = await import("../src/index.ts")
    const html = renderToStaticMarkup(
        h(MenuList, {
            autoFocus: false,
            items: [
                { label: "Clear", "data-testid": "clear-it", "aria-describedby": "why", id: "c", onSelect: () => {} },
            ],
        }),
    )
    assert(
        html.includes(`data-testid="clear-it"`) && html.includes(`aria-describedby="why"`) && html.includes(`id="c"`),
        html,
    )
    assert(!html.includes("onSelect"), html)
})

test("JsonView: fields as a table, lists as chips, no braces or quotes", () => {
    const html = renderToStaticMarkup(
        h(JsonView, { value: { speed: 0.12345, on: false, tags: ["a"], none: null, text: "" } }),
    )
    assert(html.includes(`<span class="dr-json-key">speed</span>`), html)
    assert(html.includes(">0.1235<") && html.includes("✗ false") && html.includes("empty text"), html)
    assert(
        html.includes(
            `<ol class="dr-json-list dr-json-inline"><li class="dr-json-item"><span class="dr-json-str">a</span>`,
        ),
        html,
    )
    assert(!html.includes("{") && !html.includes(`"a"`), html)
})

test("JsonLine: one colored line, cut at its budget", () => {
    const full = renderToStaticMarkup(h(JsonLine, { value: { a: [1, "x"] } })).replace(/<[^>]+>/g, "")
    assertEquals(full, `{ a: [1, &quot;x&quot;] }`)
    const cut = renderToStaticMarkup(h(JsonLine, { value: { a: "long text", b: 2, c: 3 }, budget: 8 })).replace(
        /<[^>]+>/g,
        "",
    )
    assert(cut.endsWith("…"), cut)
})
