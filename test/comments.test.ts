// deno-lint-ignore-file require-await -- act(async () => ...) waits for effects even when the callback doesn't await
// dimos-react/comments: the client speaks the contract's endpoints, degrades quietly on a Desktop without them, and
// useComments stays current through Desktop's comment events.
import { test } from "vitest"
import { Window } from "happy-dom"
import { assert, assertEquals } from "./assert.ts"
import { testGlobals } from "./fake_globals.ts"
import { mockDesktop } from "../demo/mock_desktop.ts"
import {
    commentMatches,
    commentsClient,
    commentsQuery,
    DesktopApiError,
    openCounts,
    upsertComment,
    useComments,
} from "../src/comments.ts"
import type { Comment, UseComments } from "../src/comments.ts"

const target = { kind: "module", id: "planner", label: "Planner" }

test("the client lists, creates, replies and resolves through the contract's endpoints", async () => {
    const desktop = mockDesktop()
    const client = commentsClient({ fetch: desktop.fetch, events: desktop.events })
    const heard: string[] = []
    const stop = client.subscribe((event) => heard.push(`${event.action} ${event.comment.id}`))
    const made = await client.create({ app: "launcher", target, text: "why?", context: { source: "class P: ..." } })
    assertEquals(made.author, "user")
    assertEquals(made.context?.source, "class P: ...")
    const replied = await client.reply(made.id, "because", "claude-code")
    assertEquals(replied.replies.map((reply) => [reply.author, reply.text]), [["claude-code", "because"]])
    const resolved = await client.resolve(made.id)
    assertEquals(resolved.status, "resolved")
    assertEquals((await client.list("launcher", { status: "resolved" })).map((c) => c.id), [made.id])
    assertEquals(await client.list("launcher", { status: "open" }), [])
    assertEquals(await client.list("other"), [])
    assertEquals(client.available, true)
    assertEquals(desktop.calls.slice(0, 4), [
        "POST /comments",
        `POST /comments/${made.id}/replies`,
        `PATCH /comments/${made.id}`,
        "GET /comments?app=launcher&status=resolved",
    ])
    assertEquals(heard, [`created ${made.id}`, `replied ${made.id}`, `resolved ${made.id}`])
    stop()
})

test("a Desktop without the endpoints (or none at all): list is empty, writes reject as missing, nothing throws", async () => {
    const old = commentsClient({ fetch: mockDesktop({ endpoints: false }).fetch })
    assertEquals(await old.list("launcher"), [])
    assertEquals(old.available, false)
    const error = await old.create({ app: "launcher", target, text: "hi" }).catch((e) => e)
    assert(error instanceof DesktopApiError && error.missing, String(error))
    const offline = commentsClient({ fetch: (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch })
    assertEquals(await offline.list("launcher"), [])
    assertEquals(offline.available, false)
    // a dev server's index.html for every path is no Desktop either
    const html = commentsClient({
        fetch: (async () => new Response("<!doctype html>", { status: 200 })) as typeof fetch,
    })
    assertEquals(await html.list("launcher"), [])
    assertEquals(html.available, false)
    // and without EventSource, a subscription hears nothing (and unsubscribes)
    commentsClient().subscribe(() => {})()
})

test("pure helpers: the query, upsert by id in time order, the filter, open counts per target", () => {
    assertEquals(commentsQuery("a b", { kind: "topic", id: "/odom" }), "app=a+b&kind=topic&id=%2Fodom")
    const at = (minute: number) => `2026-10-25T20:${String(minute).padStart(2, "0")}:00.000Z`
    const make = (id: string, minute: number, status: "open" | "resolved" = "open"): Comment => ({
        id,
        app: "x",
        target,
        text: id,
        author: "user",
        at: at(minute),
        status,
        replies: [],
    })
    let list = upsertComment([], make("b", 2))
    list = upsertComment(list, make("a", 1))
    list = upsertComment(list, make("b", 2, "resolved"))
    assertEquals(list.map((c) => `${c.id}:${c.status}`), ["a:open", "b:resolved"])
    assertEquals([...openCounts(list)], [["module:planner", 1]])
    assert(commentMatches(list[0], "x", { kind: "module", status: "open" }))
    assert(!commentMatches(list[1], "x", { status: "open" }) && !commentMatches(list[0], "y"))
})

test("useComments loads, takes its own writes and hears others' (an agent's reply) live", async () => {
    const dom = new Window({ url: "http://localhost/" })
    testGlobals.window = dom
    testGlobals.document = dom.document
    testGlobals.IS_REACT_ACT_ENVIRONMENT = true
    const { act, createElement: h } = await import("react")
    const { createRoot } = await import("react-dom/client")
    const desktop = mockDesktop()
    const client = commentsClient({ fetch: desktop.fetch, events: desktop.events })
    await client.create({ app: "launcher", target, text: "first" })
    let store: UseComments | null = null
    const Probe = () => {
        store = useComments("launcher", {}, { client })
        return null
    }
    const root = createRoot(document.createElement("div"))
    await act(async () => root.render(h(Probe)))
    await act(async () => {})
    assertEquals(store!.comments.map((c) => c.text), ["first"])
    assertEquals(store!.available, true)
    await act(async () => {
        await store!.create({ kind: "topic", id: "odom" }, "second")
    })
    assertEquals(store!.comments.map((c) => c.text), ["first", "second"])
    // an agent replies through Desktop: the event updates it
    const first = store!.comments[0]
    await act(async () => {
        await commentsClient({ fetch: desktop.fetch }).reply(first.id, "looking", "claude-code")
    })
    assertEquals(store!.comments[0].replies.map((r) => r.text), ["looking"])
    assertEquals(store!.counts.get("module:planner"), 1)
    await act(async () => root.unmount())
})
