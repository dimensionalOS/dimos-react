// useComments: an app's comments from Desktop, kept current by its `comment` events.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
    type Comment,
    type CommentContext,
    type CommentFilter,
    commentMatches,
    type CommentsClient,
    type CommentTarget,
    defaultCommentsClient,
    openCounts,
    upsertComment,
} from "./client.ts"

export interface UseComments {
    /** oldest first */
    comments: Comment[]
    /** open comments per target key (`kind:id`) */
    counts: Map<string, number>
    loading: boolean
    /** false when Desktop has no comments endpoint (or there's no Desktop): hide the comment UI */
    available: boolean | null
    error: string | null
    create(target: CommentTarget, text: string, context?: CommentContext): Promise<Comment>
    reply(id: string, text: string): Promise<Comment>
    resolve(id: string, resolved?: boolean): Promise<Comment>
    refresh(): Promise<void>
}

/** An app's comments (narrowed by `filter`), live. `app` null: none, and nothing is fetched. */
export function useComments(
    app: string | null | undefined,
    filter: CommentFilter = {},
    options: { client?: CommentsClient; author?: string } = {},
): UseComments {
    const client = options.client ?? defaultCommentsClient()
    const author = options.author ?? "user"
    const filterKey = JSON.stringify(filter)
    const [comments, setComments] = useState<Comment[]>([])
    const [loading, setLoading] = useState(!!app)
    const [available, setAvailable] = useState<boolean | null>(client.available)
    const [error, setError] = useState<string | null>(null)
    const latest = useRef({ app, filter })
    latest.current = { app, filter }

    const take = useCallback((comment: Comment) => {
        const { app, filter } = latest.current
        setComments((list) =>
            app && commentMatches(comment, app, filter)
                ? upsertComment(list, comment)
                : list.filter((other) => other.id !== comment.id)
        )
    }, [])

    const refresh = useCallback(async () => {
        const { app, filter } = latest.current
        if (!app) {
            setComments([])
            setLoading(false)
            return
        }
        try {
            const list = await client.list(app, filter)
            if (latest.current.app === app) {
                setComments([...list].sort((a, b) => a.at.localeCompare(b.at)))
                setError(null)
            }
        } catch (failure) {
            setError((failure as Error).message ?? String(failure))
        } finally {
            setAvailable(client.available)
            setLoading(false)
        }
    }, [client])

    useEffect(() => {
        setComments([])
        setLoading(!!app)
        refresh()
        if (!app) {
            return
        }
        return client.subscribe((event) => take(event.comment))
    }, [app, filterKey, client])

    const write = useCallback(async (call: Promise<Comment>) => {
        try {
            const comment = await call
            take(comment)
            return comment
        } finally {
            setAvailable(client.available)
        }
    }, [client])

    const create = useCallback(
        (target: CommentTarget, text: string, context?: CommentContext) => {
            if (!latest.current.app) {
                return Promise.reject(new Error("no app to comment in"))
            }
            return write(client.create({ app: latest.current.app, target, text, author, context }))
        },
        [client, author],
    )
    const reply = useCallback((id: string, text: string) => write(client.reply(id, text, author)), [client, author])
    const resolve = useCallback((id: string, resolved = true) => write(client.resolve(id, resolved)), [client])
    const counts = useMemo(() => openCounts(comments), [comments])
    return { comments, counts, loading, available, error, create, reply, resolve, refresh }
}
