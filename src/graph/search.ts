// Finding a graph's nodes by name: exact, then prefix, then a word's start, then anywhere, then (its own
// name only) the letters in order.

/** Something a graph search can find: a node, with the names it goes by. */
export interface GraphSearchItem {
    id: string
    kind: string
    label: string
    /** other names it matches on (a module's instance name, a topic's message type) */
    also?: string[]
}

export interface GraphSearchHit<T extends GraphSearchItem = GraphSearchItem> {
    item: T
    /** lower is better: 0 exact, 1 prefix, 2 a word's start, 3 anywhere, 4 letters in order (own name only); +0.5 on another name */
    score: number
}

const words = /[\s/._:-]+|(?<=[a-z])(?=[A-Z])/

function scoreText(text: string, query: string, inOrder = true): number | null {
    const lower = text.toLowerCase()
    if (lower === query) {
        return 0
    }
    if (lower.startsWith(query)) {
        return 1
    }
    if (text.split(words).some((word) => word.toLowerCase().startsWith(query))) {
        return 2
    }
    if (lower.includes(query)) {
        return 3
    }
    if (!inOrder) {
        return null
    }
    let at = 0
    for (const char of lower) {
        if (char === query[at]) {
            at++
        }
    }
    return at === query.length ? 4 : null
}

/** The items matching `query` (case-insensitive, a leading "/" ignored), best first, at most `limit`. */
export function searchGraph<T extends GraphSearchItem>(
    items: readonly T[],
    query: string,
    limit = 8,
): GraphSearchHit<T>[] {
    const wanted = query.trim().replace(/^\/+/, "").toLowerCase()
    if (!wanted) {
        return []
    }
    const hits: GraphSearchHit<T>[] = []
    for (const item of items) {
        const own = scoreText(item.label, wanted)
        const other = (item.also ?? [])
            .map((name) => scoreText(name, wanted, false))
            .filter((score): score is number => score !== null)
        const best = Math.min(own ?? Infinity, ...other.map((score) => score + 0.5))
        if (best !== Infinity) {
            hits.push({ item, score: best })
        }
    }
    return hits
        .sort((a, b) =>
            a.score - b.score || a.item.label.length - b.item.label.length || a.item.label.localeCompare(b.item.label)
        )
        .slice(0, limit)
}
