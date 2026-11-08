// Comments on anything an app shows (a module, a topic, an edge, a file…), kept by Desktop
// (`/gateways/desktop/comments`): the user writes them, agents read and reply. A client for the endpoints, the event
// subscription, and the pure pieces useComments builds on.
import { type DesktopApiOptions, type DesktopEvent, desktopEvents, desktopJson } from "./desktop.ts"

/** What a comment is about: a kind ("module", "topic", "edge", "blueprint", or the app's own) and its id. */
export interface CommentTarget {
    kind: string
    id: string
    label?: string
    blueprint?: string
}

export interface CommentReply {
    id: string
    text: string
    author: string
    at: string
}

export type CommentStatus = "open" | "resolved"

export interface Comment {
    id: string
    app: string
    target: CommentTarget
    text: string
    /** "user", or an agent's name */
    author: string
    /** ISO time */
    at: string
    status: CommentStatus
    replies: CommentReply[]
    context?: CommentContext
}

/** Extra the page attaches for the agent: the target's source code, and anything else. */
export interface CommentContext {
    source?: string
    sourcePath?: string
    [field: string]: unknown
}

export interface NewComment {
    app: string
    target: CommentTarget
    text: string
    author?: string
    context?: CommentContext
}

export interface CommentFilter {
    kind?: string
    id?: string
    status?: CommentStatus
    /** ISO time: only comments since */
    since?: string
}

/** Desktop's `comment` event. */
export interface CommentEvent {
    type: "comment"
    action: "created" | "replied" | "resolved" | string
    comment: Comment
}

export interface CommentsClient {
    /** An app's comments, oldest first; `[]` when Desktop has no comments endpoint (see `available`). */
    list(app: string, filter?: CommentFilter): Promise<Comment[]>
    create(comment: NewComment): Promise<Comment>
    reply(id: string, text: string, author?: string): Promise<Comment>
    /** Resolve (or, with false, reopen) a comment. */
    resolve(id: string, resolved?: boolean): Promise<Comment>
    /** Hear comments created, replied to and resolved (by anyone: the user, agents). Returns unsubscribe. */
    subscribe(onEvent: (event: CommentEvent) => void): () => void
    /** false once Desktop answered that it has no comments endpoint (or there's no Desktop); null until known. */
    readonly available: boolean | null
}

/** The query string for a list call. */
export function commentsQuery(app: string, filter: CommentFilter = {}): string {
    const params = new URLSearchParams({ app })
    for (const key of ["kind", "id", "status", "since"] as const) {
        if (filter[key]) {
            params.set(key, filter[key]!)
        }
    }
    return params.toString()
}

/** A target's key, for grouping comments by what they're on. */
export const targetKey = (target: Pick<CommentTarget, "kind" | "id">): string => `${target.kind}:${target.id}`

/** `comments` with `comment` in (replacing the one with its id), oldest first. */
export function upsertComment(comments: readonly Comment[], comment: Comment): Comment[] {
    const rest = comments.filter((other) => other.id !== comment.id)
    return [...rest, comment].sort((a, b) => a.at.localeCompare(b.at))
}

/** Whether a comment passes a filter (the same test Desktop's list applies). */
export function commentMatches(comment: Comment, app: string, filter: CommentFilter = {}): boolean {
    return comment.app === app &&
        (!filter.kind || comment.target.kind === filter.kind) &&
        (!filter.id || comment.target.id === filter.id) &&
        (!filter.status || comment.status === filter.status) &&
        (!filter.since || comment.at >= filter.since)
}

/** Open comments per target key. */
export function openCounts(comments: readonly Comment[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const comment of comments) {
        if (comment.status === "open") {
            const key = targetKey(comment.target)
            counts.set(key, (counts.get(key) ?? 0) + 1)
        }
    }
    return counts
}

export interface CommentsClientOptions extends DesktopApiOptions {
    /** a stand-in for Desktop's event stream (default: desktopEvents) */
    events?: (onEvent: (event: DesktopEvent) => void) => () => void
}

/** A client for Desktop's comments (same origin unless `base`; `fetch` and `events` for a stand-in). */
export function commentsClient(options: CommentsClientOptions = {}): CommentsClient {
    const events = options.events ?? ((onEvent: (event: DesktopEvent) => void) => desktopEvents(onEvent, options))
    let available: boolean | null = null
    const call = async <T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
        try {
            const result = await desktopJson<T>(path, init, options)
            available = true
            return result
        } catch (error) {
            if ((error as { missing?: boolean }).missing) {
                available = false
            }
            throw error
        }
    }
    return {
        get available() {
            return available
        },
        async list(app, filter) {
            try {
                const result = await call<{ comments?: Comment[] }>(`/comments?${commentsQuery(app, filter)}`)
                return result?.comments ?? []
            } catch (error) {
                if (available === false) {
                    return []
                }
                throw error
            }
        },
        create: (comment) => call<Comment>("/comments", { method: "POST", body: { author: "user", ...comment } }),
        reply: (id, text, author = "user") =>
            call<Comment>(`/comments/${encodeURIComponent(id)}/replies`, { method: "POST", body: { text, author } }),
        resolve: (id, resolved = true) =>
            call<Comment>(`/comments/${encodeURIComponent(id)}`, {
                method: "PATCH",
                body: { status: resolved ? "resolved" : "open" },
            }),
        subscribe: (onEvent) =>
            events((event) => {
                if (event.type === "comment" && event.comment?.id) {
                    onEvent(event as CommentEvent)
                }
            }),
    }
}

let shared: CommentsClient | null = null
/** The page's same-origin client. */
export function defaultCommentsClient(): CommentsClient {
    return (shared ??= commentsClient())
}
