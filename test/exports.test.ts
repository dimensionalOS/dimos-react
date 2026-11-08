// The public API: each entry exports exactly the names in exports.json (v0.1's list, minus h and Fragment), so a
// rename or a dropped export fails here instead of in an app.
import { test } from "vitest"
import { assertEquals } from "./assert.ts"
import expected from "./exports.json"

test("index exports the v0.1 API", async () => {
    assertEquals(Object.keys(await import("../src/index.ts")).sort(), expected.index)
})

test("three exports the v0.1 API", async () => {
    assertEquals(Object.keys(await import("../src/three.ts")).sort(), expected.three)
})

test("graph exports the graph view", async () => {
    assertEquals(Object.keys(await import("../src/graph.ts")).sort(), expected.graph)
})

test("comments exports the comments client and UI", async () => {
    assertEquals(Object.keys(await import("../src/comments.ts")).sort(), expected.comments)
})
