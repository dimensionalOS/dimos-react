// deno-lint-ignore-file require-await -- act(async () => ...) waits for effects even when the callback doesn't await
// The graph's Desktop ties and helpers: the remembered layout, search matching, the zoomed-out grid, what a highlight
// finds and the flash it starts, the view report, and right click → Comment.
import { test } from "vitest"
import { Window } from "happy-dom"
import { assert, assertEquals } from "./assert.ts"
import { testGlobals } from "./fake_globals.ts"
import { mockDesktop } from "../demo/mock_desktop.ts"
import { DEMO_MODULES } from "../demo/sections/graph.tsx"
import {
    blueprintViewState,
    buildBlueprintGraph,
    findBlueprintTarget,
    GRAPH_LAYOUT_STORAGE_KEY,
    gridAt,
    loadGraphLayout,
    saveGraphLayout,
    searchGraph,
} from "../src/graph.ts"
import type { BlueprintGraphHandle } from "../src/graph.ts"
import { commentsClient } from "../src/comments.ts"

const memoryStorage = (start: Record<string, string> = {}) => {
    const map = new Map(Object.entries(start))
    return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => map.set(key, value),
        map,
    }
}

test("the remembered layout: Desktop's setting first, else this browser's, else none; saving writes both", async () => {
    const desktop = mockDesktop()
    const storage = memoryStorage({ [GRAPH_LAYOUT_STORAGE_KEY]: "radial" })
    assertEquals(await loadGraphLayout({ fetch: desktop.fetch, storage }), "radial")
    assertEquals(await saveGraphLayout("force", { fetch: desktop.fetch, storage }), "desktop")
    assertEquals(desktop.settings.graphLayout, "force")
    assertEquals(storage.map.get(GRAPH_LAYOUT_STORAGE_KEY), "force")
    storage.setItem(GRAPH_LAYOUT_STORAGE_KEY, "vertical")
    assertEquals(await loadGraphLayout({ fetch: desktop.fetch, storage }), "force")
    // a Desktop that refuses the key, or none at all: this browser keeps it
    const old = mockDesktop({ endpoints: false })
    assertEquals(await saveGraphLayout("circular", { fetch: old.fetch, storage }), "local")
    assertEquals(await loadGraphLayout({ fetch: old.fetch, storage }), "circular")
    const none = (() => Promise.reject(new TypeError("offline"))) as typeof fetch
    assertEquals(await loadGraphLayout({ fetch: none, storage: memoryStorage() }), null)
    // junk in either place is ignored
    desktop.settings.graphLayout = "spiral"
    assertEquals(
        await loadGraphLayout({ fetch: desktop.fetch, storage: memoryStorage({ [GRAPH_LAYOUT_STORAGE_KEY]: "nope" }) }),
        null,
    )
})

test("search: exact, then prefix, then a word's start, then anywhere, then letters in order; other names count less", () => {
    const items = [
        { id: "1", kind: "module", label: "CostMapper", also: ["costmap"] },
        { id: "2", kind: "topic", label: "costmap", also: ["nav_msgs.OccupancyGrid"] },
        { id: "3", kind: "module", label: "VoxelGridMapper", also: ["mapper"] },
        { id: "4", kind: "topic", label: "global_map", also: ["sensor_msgs.PointCloud2"] },
        { id: "5", kind: "topic", label: "odom", also: ["nav_msgs.Odometry"] },
    ]
    assertEquals(searchGraph(items, "costmap").map((hit) => hit.item.id), ["2", "1"])
    // "mapper" (VoxelGridMapper's instance name) starts with it: 1.5, before the word starts (2)
    assertEquals(searchGraph(items, "map").map((hit) => hit.item.id), ["3", "1", "4", "2"])
    assertEquals(searchGraph(items, "/odom")[0].item.id, "5")
    assertEquals(searchGraph(items, "vgm").map((hit) => hit.item.id), ["3"])
    assertEquals(searchGraph(items, "occupancy").map((hit) => hit.item.id), ["2"])
    assertEquals(searchGraph(items, "  "), [])
    assertEquals(searchGraph(items, "zzz"), [])
})

test("zoomed out, the grid thins (dots stay apart) and fades instead of packing into a gray wash", () => {
    const near = gridAt(1, 22)
    const far = gridAt(0.1, 22)
    assertEquals(near, { cell: 22, strength: 35 })
    assert(far.cell >= 14 && far.strength <= 12, JSON.stringify(far))
    for (let k = 0.1; k < 4; k *= 1.3) {
        assert(gridAt(k, 22).cell >= 14)
    }
})

const graph = buildBlueprintGraph(DEMO_MODULES, [], (text) => text.length * 7)

test("highlight finds modules (name, class, id), topics (with or without slash) and edges; else null", () => {
    const find = (kind: string, id: string) => findBlueprintTarget(graph.nodes, graph.edges, kind, id)
    assertEquals(find("module", "planner"), { node: "m:planner" })
    assertEquals(find("module", "ReplanningAStarPlanner"), { node: "m:planner" })
    assertEquals(find("module", "m:planner"), { node: "m:planner" })
    assertEquals(find("topic", "/odom"), { node: "t:odom" })
    assertEquals(find("edge", "mapper>global_map"), {
        edge: "m:mapper>t:global_map",
        from: "m:mapper",
        to: "t:global_map",
    })
    assertEquals(find("edge", "t:odom>m:planner"), { edge: "t:odom>m:planner", from: "t:odom", to: "m:planner" })
    assertEquals(find("module", "nope"), null)
    assertEquals(find("edge", "planner>odom"), null)
})

test("the view report: modules on screen, connections touching them, the selection and layout", () => {
    const state = blueprintViewState(graph.nodes, graph.edges, new Set(["m:go2", "t:odom"]), {
        kind: "topic",
        id: "odom",
    }, "force")
    assertEquals(state.visible.modules, [{ id: "go2", label: "GO2Connection" }])
    assertEquals(
        state.visible.connections.map((c) => `${c.from}-${c.topic}->${c.to}`).sort(),
        [
            "go2-color_image->detector",
            "go2-lidar->mapper",
            "go2-odom->mapper",
            "go2-odom->planner",
            "planner-cmd_vel->go2",
        ],
    )
    assertEquals(state.selected, { kind: "topic", id: "odom" })
    assertEquals(state.layout, "force")
})

test("BlueprintGraph: highlight flashes (then stops), right click → Comment → composer, a badge for open comments", async () => {
    const dom = new Window({ url: "http://localhost/" })
    testGlobals.window = dom
    testGlobals.document = dom.document
    testGlobals.getComputedStyle = dom.getComputedStyle.bind(dom)
    testGlobals.addEventListener = dom.addEventListener.bind(dom)
    testGlobals.removeEventListener = dom.removeEventListener.bind(dom)
    testGlobals.ResizeObserver ??= class {
        observe() {}
        disconnect() {}
    }
    testGlobals.IS_REACT_ACT_ENVIRONMENT = true
    const { act, createElement: h, createRef } = await import("react")
    const { createRoot } = await import("react-dom/client")
    const { BlueprintGraph } = await import("../src/graph.ts")
    const desktop = mockDesktop()
    const client = commentsClient({ fetch: desktop.fetch, events: desktop.events })
    const ref = createRef<BlueprintGraphHandle>()
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    await act(async () =>
        root.render(
            h(BlueprintGraph, { ref, modules: DEMO_MODULES, app: "demo", commentsClient: client, layout: "hierarchy" }),
        )
    )
    await act(async () => {})
    const node = (id: string) => host.querySelector<SVGGElement>(`[data-graph-node="${id}"]`)!
    let found = false
    await act(async () => {
        found = ref.current!.highlight("module", "planner", 1)
    })
    assert(found && node("m:planner").classList.contains("flash"), node("m:planner").getAttribute("class")!)
    assertEquals(node("m:planner").style.getPropertyValue("--dr-graph-flash-times"), "1")
    assert(!ref.current!.highlight("module", "ghost"))
    await act(async () => await new Promise((resolve) => setTimeout(resolve, 1000)))
    assert(!node("m:planner").classList.contains("flash"), node("m:planner").getAttribute("class")!)

    // right click a module: the menu, then the composer; an open comment on it (an agent's, here) draws a badge
    await act(async () => {
        node("m:costmap").querySelector("rect")!.dispatchEvent(
            new dom.MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: 50,
                clientY: 60,
            }) as unknown as Event,
        )
    })
    const item = document.querySelector<HTMLButtonElement>('[data-action="comment"]')
    assert(item, "no Comment item")
    await act(async () => item!.click())
    const box = document.querySelector<HTMLTextAreaElement>(".dr-comment-composer textarea")
    assert(box, "no composer")
    await act(async () => {
        await client.create({ app: "demo", target: { kind: "module", id: "costmap", label: "CostMapper" }, text: "hm" })
    })
    assert(host.querySelector('[data-graph-badge="module:costmap"]'), "no badge")
    await act(async () => root.unmount())
})
