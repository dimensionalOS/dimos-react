/** @jsxRuntime automatic */
/** @jsxImportSource react */
// The comment UI any app can use: a composer, a thread (the comment, its replies, a reply box, resolve), a badge.
import { useEffect, useRef, useState } from "react"
import type { HTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react"
import { cx } from "../cx.ts"
import { Button, TextArea } from "../components/controls.tsx"
import { Icon } from "../components/icon.tsx"
import type { Comment, CommentTarget } from "./client.ts"

/** "just now", "5m ago", "3h ago", "2d ago", else the date. */
export function commentTime(iso: string, now = Date.now()): string {
    const at = Date.parse(iso)
    if (Number.isNaN(at)) {
        return ""
    }
    const seconds = Math.max(0, (now - at) / 1000)
    if (seconds < 45) {
        return "just now"
    }
    if (seconds < 3600) {
        return `${Math.round(seconds / 60)}m ago`
    }
    if (seconds < 86400) {
        return `${Math.round(seconds / 3600)}h ago`
    }
    if (seconds < 86400 * 7) {
        return `${Math.round(seconds / 86400)}d ago`
    }
    return new Date(at).toLocaleDateString()
}

/** A target as words: its label, else its id, with its kind. */
export const targetLabel = (target: CommentTarget): string => `${target.kind} ${target.label ?? target.id}`

const submitKey = (event: ReactKeyboardEvent) => event.key === "Enter" && (event.metaKey || event.ctrlKey)

/** A box to write text and send it (shared by the composer and a thread's reply box). */
function Writer({
    placeholder,
    submitLabel,
    onSubmit,
    onCancel,
    autoFocus,
    rows,
}: {
    placeholder: string
    submitLabel: string
    onSubmit: (text: string) => Promise<unknown>
    onCancel?: () => void
    autoFocus?: boolean
    rows: number
}) {
    const [text, setText] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const box = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (autoFocus) {
            box.current?.querySelector("textarea")?.focus()
        }
    }, [])
    const send = async () => {
        if (!text.trim() || busy) {
            return
        }
        setBusy(true)
        setError(null)
        try {
            await onSubmit(text.trim())
            setText("")
        } catch (failure) {
            const missing = (failure as { missing?: boolean }).missing
            setError(missing ? "Desktop doesn't take comments here." : (failure as Error).message ?? String(failure))
        } finally {
            setBusy(false)
        }
    }
    return (
        <div className="dr-comment-writer" ref={box}>
            <TextArea
                rows={rows}
                value={text}
                placeholder={placeholder}
                aria-label={placeholder}
                onChange={setText}
                onKeyDown={(event) => {
                    if (submitKey(event)) {
                        event.preventDefault()
                        send()
                    } else if (event.key === "Escape" && onCancel) {
                        event.stopPropagation()
                        onCancel()
                    }
                }}
            />
            {error ? <div className="dr-comment-error" role="alert">{error}</div> : null}
            <div className="dr-comment-actions">
                <span className="dr-comment-hint">⌘/Ctrl + Enter</span>
                {onCancel
                    ? (
                        <Button size="sm" variant="ghost" onClick={onCancel}>
                            Cancel
                        </Button>
                    )
                    : null}
                <Button size="sm" variant="primary" loading={busy} disabled={!text.trim()} onClick={send}>
                    {submitLabel}
                </Button>
            </div>
        </div>
    )
}

export interface CommentComposerProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSubmit"> {
    /** what it's on (shown as the heading) */
    target?: CommentTarget
    /** sends the text (e.g. useComments' create); a rejection shows under the box */
    onSubmit: (text: string) => Promise<unknown>
    onCancel?: () => void
    placeholder?: string
    submitLabel?: string
    autoFocus?: boolean
}

/** Write a new comment: a heading naming the target, a text box (⌘/Ctrl+Enter sends, Esc cancels). */
export function CommentComposer({
    target,
    onSubmit,
    onCancel,
    placeholder = "Comment for the agent…",
    submitLabel = "Comment",
    autoFocus = true,
    className,
    ...rest
}: CommentComposerProps) {
    return (
        <div className={cx("dr-comment-composer", className)} {...rest}>
            {target
                ? (
                    <div className="dr-comment-heading">
                        <Icon name="comment" size={14} />
                        <span>
                            Comment on <b>{targetLabel(target)}</b>
                        </span>
                    </div>
                )
                : null}
            <Writer
                rows={3}
                placeholder={placeholder}
                submitLabel={submitLabel}
                onSubmit={onSubmit}
                onCancel={onCancel}
                autoFocus={autoFocus}
            />
        </div>
    )
}

export interface CommentThreadProps extends HTMLAttributes<HTMLDivElement> {
    comment: Comment
    /** sends a reply (no reply box without it) */
    onReply?: (text: string) => Promise<unknown>
    /** resolves (true) or reopens (false) (no button without it) */
    onResolve?: (resolved: boolean) => Promise<unknown>
    /** what an author is called ("user" is "You") */
    authorName?: (author: string) => ReactNode
}

const defaultAuthor = (author: string) => (author === "user" ? "You" : author)

/** A comment with its replies, a reply box and Resolve / Reopen. */
export function CommentThread({
    comment,
    onReply,
    onResolve,
    authorName = defaultAuthor,
    className,
    ...rest
}: CommentThreadProps) {
    const [busy, setBusy] = useState(false)
    const resolved = comment.status === "resolved"
    const entry = (key: string, author: string, at: string, text: string) => (
        <li key={key} className={cx("dr-comment-entry", author !== "user" && "dr-comment-entry--agent")}>
            <div className="dr-comment-meta">
                <span className="dr-comment-author">{authorName(author)}</span>
                <time dateTime={at} title={at}>{commentTime(at)}</time>
            </div>
            <div className="dr-comment-text">{text}</div>
        </li>
    )
    return (
        <div
            className={cx("dr-comment-thread", resolved && "dr-comment-thread--resolved", className)}
            data-comment={comment.id}
            {...rest}
        >
            <div className="dr-comment-heading">
                <Icon name={resolved ? "check-circle" : "comment"} size={14} />
                <span className="dr-comment-target">{targetLabel(comment.target)}</span>
                {onResolve
                    ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            icon={resolved ? "refresh" : "check"}
                            loading={busy}
                            onClick={async () => {
                                setBusy(true)
                                try {
                                    await onResolve(!resolved)
                                } finally {
                                    setBusy(false)
                                }
                            }}
                        >
                            {resolved ? "Reopen" : "Resolve"}
                        </Button>
                    )
                    : null}
            </div>
            <ol className="dr-comment-entries">
                {entry(comment.id, comment.author, comment.at, comment.text)}
                {comment.replies.map((reply) => entry(reply.id, reply.author, reply.at, reply.text))}
            </ol>
            {onReply && !resolved
                ? <Writer rows={2} placeholder="Reply…" submitLabel="Reply" onSubmit={onReply} />
                : null}
        </div>
    )
}

export interface CommentBadgeProps extends HTMLAttributes<HTMLButtonElement> {
    /** open comments (none: nothing is drawn) */
    count: number
}

/** A small "comments here" marker with the open count; a button when given onClick. */
export function CommentBadge({ count, className, onClick, ...rest }: CommentBadgeProps) {
    if (count <= 0) {
        return null
    }
    const label = `${count} open comment${count === 1 ? "" : "s"}`
    return (
        <button
            type="button"
            className={cx("dr-comment-badge", className)}
            aria-label={label}
            title={label}
            onClick={onClick}
            {...rest}
        >
            <Icon name="comment" size={12} />
            <span>{count}</span>
        </button>
    )
}
