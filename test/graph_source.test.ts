// blueprintCommentSource: the module's class goes with a comment on it, a topic's writer's, an edge's module end's
import { test } from "vitest"
import { assertEquals } from "./assert.ts"

const { blueprintCommentSource, pythonBlockAt } = await import("../src/graph.ts")

const FILE = [
    "import x",
    "",
    "@dataclass",
    "class Camera(Module):",
    "    image: Out[Image]",
    "",
    "    def start(self):",
    "        pass",
    "",
    "class Other:",
    "    pass",
].join("\n")

const MODULES = [
    {
        name: "camera",
        class: "a.Camera",
        file: "dimos/cam.py",
        line: 4,
        streams: [{ name: "image", type: "Image", direction: "out" }],
    },
    {
        name: "viewer",
        class: "a.Viewer",
        file: null,
        line: null,
        streams: [{ name: "image", type: "Image", direction: "in" }],
    },
]

test("pythonBlockAt: decorators, body, and stops at the next top-level statement", () => {
    assertEquals(pythonBlockAt(FILE, 4).split("\n"), FILE.split("\n").slice(2, 8))
    assertEquals(pythonBlockAt(FILE, 10), "class Other:\n    pass")
})

test("blueprintCommentSource: module, topic (its writer), edge (its module end), file read once", async () => {
    let reads = 0
    const source = blueprintCommentSource(MODULES, () => (reads++, Promise.resolve(FILE)))
    const camera = await source({ kind: "module", id: "camera" })
    assertEquals(camera?.split("\n")[0], "# dimos/cam.py:4 (a.Camera)")
    assertEquals(camera?.includes("class Camera(Module):"), true)
    assertEquals(await source({ kind: "topic", id: "image" }), camera)
    assertEquals(await source({ kind: "edge", id: "m:camera>t:image" }), camera)
    assertEquals(await source({ kind: "module", id: "viewer" }), null)
    assertEquals(await source({ kind: "blueprint", id: "x" }), null)
    assertEquals(reads, 1)
})
