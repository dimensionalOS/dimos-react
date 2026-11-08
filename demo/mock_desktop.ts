// A stand-in Desktop for the demo and the tests: the comments, UI settings and views endpoints of the contract, in
// memory, as a `fetch`, with an event stream (`events`) that hears what it changes.
import type { Comment } from "../src/comments.ts"

type Listener = (event: { type: string; [field: string]: unknown }) => void

export interface MockDesktop {
    fetch: typeof fetch
    events: (onEvent: Listener) => () => void
    emit: (event: { type: string; [field: string]: unknown }) => void
    comments: Comment[]
    settings: Record<string, unknown>
    views: Map<string, unknown>
    /** every call, as "METHOD path" */
    calls: string[]
}

/** `endpoints: false`: an older Desktop (every new endpoint answers 404). `agent`: a reply this long after a comment. */
export function mockDesktop(
    { endpoints = true, agentReplyMs = 0 }: { endpoints?: boolean; agentReplyMs?: number } = {},
): MockDesktop {
    const listeners = new Set<Listener>()
    let seq = 0
    const id = () => `c${++seq}`
    const desktop: MockDesktop = {
        comments: [],
        settings: { theme: "portal" },
        views: new Map(),
        calls: [],
        events: (onEvent) => {
            listeners.add(onEvent)
            return () => listeners.delete(onEvent)
        },
        emit: (event) => listeners.forEach((listener) => listener(event)),
        fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
            const url = new URL(String(input), "http://desktop.local")
            const method = (init.method ?? "GET").toUpperCase()
            const path = url.pathname.replace(/^\/gateways\/desktop/, "")
            desktop.calls.push(`${method} ${path}${url.search}`)
            const body = init.body ? JSON.parse(await new Response(init.body).text()) : undefined
            const json = (value: unknown, status = 200) =>
                new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
            if (path === "/settings/ui") {
                if (method === "PUT") {
                    for (const key of Object.keys(body)) {
                        if (key === "graphLayout" && !endpoints) {
                            return json({ error: `unknown setting ${key}` }, 400)
                        }
                    }
                    Object.assign(desktop.settings, body)
                }
                return json(desktop.settings)
            }
            if (!endpoints) {
                return new Response("not found", { status: 404 })
            }
            const changed = (comment: Comment, action: string) => {
                desktop.emit({ type: "comment", action, comment })
                return json(comment)
            }
            if (path === "/comments" && method === "GET") {
                const query = url.searchParams
                return json({
                    comments: desktop.comments.filter((comment) =>
                        comment.app === query.get("app") &&
                        (!query.get("kind") || comment.target.kind === query.get("kind")) &&
                        (!query.get("id") || comment.target.id === query.get("id")) &&
                        (!query.get("status") || comment.status === query.get("status"))
                    ),
                })
            }
            if (path === "/comments" && method === "POST") {
                const comment: Comment = {
                    id: id(),
                    app: body.app,
                    target: body.target,
                    text: body.text,
                    author: body.author ?? "user",
                    at: new Date().toISOString(),
                    status: "open",
                    replies: [],
                    context: body.context,
                }
                desktop.comments.push(comment)
                if (agentReplyMs && comment.author === "user") {
                    setTimeout(() => {
                        comment.replies.push({
                            id: id(),
                            text: `On it: looking at ${comment.target.label ?? comment.target.id}.`,
                            author: "dimcode",
                            at: new Date().toISOString(),
                        })
                        changed(comment, "replied")
                    }, agentReplyMs)
                }
                return changed(comment, "created")
            }
            const reply = /^\/comments\/([^/]+)\/replies$/.exec(path)
            const one = /^\/comments\/([^/]+)$/.exec(path)
            const comment = desktop.comments.find((comment) =>
                comment.id === decodeURIComponent((reply ?? one)?.[1] ?? "")
            )
            if (reply && comment && method === "POST") {
                comment.replies.push({ id: id(), text: body.text, author: body.author, at: new Date().toISOString() })
                return changed(comment, "replied")
            }
            if (one && comment && method === "PATCH") {
                comment.status = body.status
                return changed(comment, body.status === "resolved" ? "resolved" : "reopened")
            }
            const view = /^\/views\/([^/]+)$/.exec(path)
            if (view && method === "PUT") {
                desktop.views.set(decodeURIComponent(view[1]), { ...body, at: new Date().toISOString() })
                return json({ ok: true })
            }
            return new Response("not found", { status: 404 })
        }) as typeof fetch,
    }
    return desktop
}
