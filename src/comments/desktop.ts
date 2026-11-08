// Desktop's own HTTP API (`/gateways/desktop/...`, same origin) and its event stream, as the comments client, the
// graph's layout setting and its view reports use them. Every call degrades quietly: outside Desktop, or on a Desktop
// without an endpoint, a read gives null and a subscription hears nothing.

/** Where Desktop's API lives: same origin by default. */
export const DESKTOP_GATEWAY = "/gateways/desktop"

/** How a caller reaches Desktop: another origin (`base`) or a stand-in `fetch` (tests, demos). */
export interface DesktopApiOptions {
    /** prefix before `/gateways/desktop` (default "": this page's origin) */
    base?: string
    fetch?: typeof fetch
}

/** A Desktop call that failed: `status` 0 for no answer (no Desktop, offline), else its HTTP status. */
export class DesktopApiError extends Error {
    constructor(message: string, readonly status: number) {
        super(message)
        this.name = "DesktopApiError"
    }
    /** The endpoint isn't there (an older Desktop, or no Desktop at all). */
    get missing(): boolean {
        return this.status === 0 || this.status === 404 || this.status === 405 || this.status === 501
    }
}

/** A JSON call to `/gateways/desktop/<path>`; throws DesktopApiError (an HTML page instead of JSON counts as missing). */
export async function desktopJson<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
    options: DesktopApiOptions = {},
): Promise<T> {
    const call = options.fetch ?? globalThis.fetch
    let response: Response
    try {
        response = await call(`${options.base ?? ""}${DESKTOP_GATEWAY}${path}`, {
            method: init.method ?? "GET",
            headers: init.body === undefined ? undefined : { "content-type": "application/json" },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
        })
    } catch (error) {
        throw new DesktopApiError(`Desktop unreachable: ${(error as Error)?.message ?? error}`, 0)
    }
    const text = await response.text().catch(() => "")
    if (!response.ok) {
        let message = text.slice(0, 300) || response.statusText
        try {
            message = JSON.parse(text).error ?? message
        } catch {
            // not JSON: the text itself
        }
        throw new DesktopApiError(String(message), response.status)
    }
    try {
        return (text ? JSON.parse(text) : null) as T
    } catch {
        // a dev server's index.html for any path: there's no Desktop behind it
        throw new DesktopApiError("not a Desktop answer (no JSON)", 404)
    }
}

/** An event on Desktop's stream (`narration`, `comment`, `view-highlight`, …). */
export interface DesktopEvent {
    type: string
    // deno-lint-ignore no-explicit-any -- each event type has its own fields
    [field: string]: any
}

type Listener = (event: DesktopEvent) => void
const streams = new Map<string, { source: EventSource; listeners: Set<Listener> }>()

/**
 * Hear Desktop's event stream (`GET /gateways/desktop/ui/events`, server-sent JSON), one shared connection per page.
 * Returns unsubscribe. Without EventSource, or without Desktop, nothing is heard (the browser stops on a 404).
 */
export function desktopEvents(onEvent: Listener, options: Pick<DesktopApiOptions, "base"> = {}): () => void {
    const url = `${options.base ?? ""}${DESKTOP_GATEWAY}/ui/events`
    if (typeof EventSource === "undefined") {
        return () => {}
    }
    let stream = streams.get(url)
    if (!stream) {
        let source: EventSource
        try {
            source = new EventSource(url)
        } catch {
            // no page origin to resolve it against (a test, a worker): nothing to hear
            return () => {}
        }
        const listeners = new Set<Listener>()
        source.onmessage = (message) => {
            let event: DesktopEvent
            try {
                event = JSON.parse(message.data)
            } catch {
                return
            }
            for (const listener of [...listeners]) {
                try {
                    listener(event)
                } catch (error) {
                    console.error("desktopEvents listener", error)
                }
            }
        }
        stream = { source, listeners }
        streams.set(url, stream)
    }
    const { source, listeners } = stream
    listeners.add(onEvent)
    return () => {
        listeners.delete(onEvent)
        if (!listeners.size) {
            source.close()
            streams.delete(url)
        }
    }
}
