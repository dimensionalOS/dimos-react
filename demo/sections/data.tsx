// Demo: tables, trees, key/value, stats, lists, logs, code, sparklines, timeline.
import { useEffect, useRef, useState } from "react"
import {
    AttitudeIndicator,
    Badge,
    Button,
    captureFrame,
    Card,
    CodeBlock,
    IconButton,
    KeyValue,
    List,
    ListRow,
    LiveValue,
    LogView,
    Markdown,
    MediaFrame,
    SafeHtml,
    Sparkline,
    Stat,
    Table,
    Timeline,
    Tree,
} from "../../src/index.ts"

interface DemoTopic {
    key: string
    name: string
    type: string
    hz: number
    kb: number
}

const TOPICS: DemoTopic[] = [
    { key: "dimos/lidar/sensor_msgs.PointCloud2", name: "/lidar", type: "sensor_msgs.PointCloud2", hz: 10.1, kb: 1840 },
    { key: "dimos/odom/nav_msgs.Odometry", name: "/odom", type: "nav_msgs.Odometry", hz: 50.0, kb: 0.7 },
    { key: "dimos/tf/tf2_msgs.TFMessage", name: "/tf", type: "tf2_msgs.TFMessage", hz: 100.2, kb: 1.3 },
    {
        key: "dimos/global_map/sensor_msgs.PointCloud2",
        name: "/global_map",
        type: "sensor_msgs.PointCloud2",
        hz: 0.5,
        kb: 9200,
    },
    { key: "dimos/path/nav_msgs.Path", name: "/path", type: "nav_msgs.Path", hz: 2, kb: 4.2 },
    { key: "dimos/color_image/sensor_msgs.Image", name: "/color_image", type: "sensor_msgs.Image", hz: 15, kb: 260 },
]

const MARKDOWN = `## Markdown
Docs from a manifest or an OpenAPI document: **bold**, *italic*, \`code\` and [links](https://github.com/dimensionalOS/dimos-react).

- one
- two, with \`code\`
  - a sub item

| key | meaning |
| --- | --- |
| \`hz\` | messages per second |
| \`bps\` | bytes per second |

\`\`\`
GET /api/endpoints?family=desktop
\`\`\``

const FRAMES = [
    {
        id: "world",
        icon: "map",
        children: [
            {
                id: "map",
                children: [
                    {
                        id: "odom",
                        children: [
                            {
                                id: "base_link",
                                icon: "robot",
                                badge: "50 Hz",
                                children: [
                                    { id: "lidar_link", badge: "static" },
                                    { id: "camera_link", children: [{ id: "camera_optical", badge: "static" }] },
                                    { id: "imu_link", badge: "static" },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    },
]

interface DemoLogLine {
    ts: number
    text: string
    level: "error" | "warn" | "info" | "debug"
}

const LOG: DemoLogLine[] = [
    { ts: Date.now() - 9000, text: "[dimos] starting blueprint unitree_go2", level: "info" },
    { ts: Date.now() - 8000, text: "[go2] connecting to 192.168.12.1 over WebRTC", level: "info" },
    { ts: Date.now() - 7000, text: "[go2] connected; video + lidar streams up", level: "info" },
    { ts: Date.now() - 6000, text: "[nav] costmap resolution 0.05 m", level: "debug" },
    { ts: Date.now() - 5000, text: "[tf] odom -> base_link 230 ms stale", level: "warn" },
    { ts: Date.now() - 4000, text: "[agent] skill navigate_to(kitchen) failed: no path", level: "error" },
]

const CODE = `{
    "name": "dim-controller",
    "version": "0.1.23",
    "zenoh": { "read": ["dimos/**"], "write": ["dimos/cmd_vel/**"] }
}`

const PY = `from dimos.core import Module, In, Out
class Follow(Module):
    # follows the person closest to the robot
    def tick(self, detections):
        return min(detections, key=lambda d: d.distance)`

/** A canvas animation as a MediaStream stands in for a camera track. */
function MediaDemo() {
    const [stream, setStream] = useState<MediaStream | null>(null)
    const [still, setStill] = useState<string | null>(null)
    const video = useRef<HTMLVideoElement>(null)
    useEffect(() => {
        const canvas = Object.assign(document.createElement("canvas"), { width: 320, height: 180 })
        const context = canvas.getContext("2d")!
        const color = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()
        let frame = 0
        const timer = setInterval(() => {
            context.clearRect(0, 0, 320, 180)
            context.fillStyle = color
            context.fillRect(20 + ((frame++ * 4) % 260), 70, 40, 40)
        }, 33)
        setStream(canvas.captureStream?.(30) ?? null)
        return () => clearInterval(timer)
    }, [])
    return (
        <Card title="MediaFrame + captureFrame">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <MediaFrame stream={stream} ref={video} height={180} />
                <MediaFrame src={still} alt="snapshot" height={180} placeholder="No snapshot" />
            </div>
            <Button style={{ marginTop: 8 }} onClick={() => setStill(captureFrame(video.current))}>
                Snapshot
            </Button>
        </Card>
    )
}

export function DataSection() {
    const [selectedTopic, setSelectedTopic] = useState(TOPICS[0].key)
    const [frame, setFrame] = useState("base_link")
    const [time, setTime] = useState(42)
    const [playing, setPlaying] = useState(false)
    const [log, setLog] = useState(LOG)
    const [rates, setRates] = useState(() => Array.from({ length: 40 }, (_, i) => 10 + Math.sin(i / 3) * 2))
    useEffect(() => {
        const timer = setInterval(() => {
            setRates((old) => [...old.slice(1), 10 + Math.sin(Date.now() / 900) * 2 + Math.random()])
            if (playing) {
                setTime((t) => (t >= 184 ? 0 : t + 0.5))
            }
        }, 500)
        return () => clearInterval(timer)
    }, [playing])
    return (
        <div className="demo-grid">
            <Card title="Table (sortable)" className="demo-wide">
                <Table
                    columns={[
                        {
                            key: "name",
                            label: "Topic",
                            sort: true,
                            render: (row) => <span className="dr-mono">{row.name}</span>,
                        },
                        { key: "type", label: "Type", sort: true, render: (row) => <Badge>{row.type}</Badge> },
                        {
                            key: "hz",
                            label: "Rate",
                            sort: true,
                            align: "right",
                            render: (row) => `${row.hz.toFixed(1)} Hz`,
                        },
                        { key: "kb", label: "Size", sort: true, align: "right", render: (row) => `${row.kb} kB` },
                    ]}
                    rows={TOPICS}
                    rowKey="key"
                    defaultSort={{ key: "name", dir: "asc" }}
                    selected={selectedTopic}
                    onRowClick={(row) => setSelectedTopic(row.key)}
                    maxHeight={260}
                />
            </Card>
            <Card title="Table (rows sorted by the backend: sortRows false)" className="demo-wide">
                <BackendSortedTable />
            </Card>
            <Card title="Tree (TF frames)">
                <Tree nodes={FRAMES} defaultExpanded="all" selected={frame} onSelect={setFrame} />
            </Card>
            <Card title="KeyValue + Stat">
                <div style={{ display: "flex", gap: 24, marginBottom: 12, flexWrap: "wrap" }}>
                    <Stat label="Battery" value={87} unit="%" tone="ok" delta={-2} />
                    <Stat label="Latency" value={38} unit="ms" hint="p95 61 ms" />
                    <Stat label="Drops" value={3} unit="/s" tone="warn" />
                </div>
                <KeyValue
                    items={[
                        ["Robot", "unitree_go2"],
                        ["Fixed frame", "world"],
                        ["Selected frame", frame],
                        ["Gateway", "zenoh-gateway 0.5.3"],
                    ]}
                />
            </Card>
            <MediaDemo />
            <Card title="AttitudeIndicator">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <AttitudeIndicator roll={0.21} pitch={-0.08} yaw={1.2} />
                    <AttitudeIndicator />
                </div>
            </Card>
            <Card title="List + ListRow">
                <List>
                    <ListRow
                        icon="record"
                        title="go2_kitchen_2026-10-09.mcap"
                        subtitle="Go2 · 3.1 GB · 6 topics"
                        meta="12:04"
                        onClick={() => {}}
                        selected={true}
                        actions={<IconButton icon="download" label="Download" size="sm" />}
                    />
                    <ListRow
                        icon="record"
                        title="g1_hallway_loop.mcap"
                        subtitle="G1 · 1.2 GB"
                        meta="4:51"
                        onClick={() => {}}
                        handle={true}
                    />
                    <ListRow
                        icon="file"
                        title="office_map.pcd"
                        subtitle="global map · 18 M points"
                        meta="—"
                        onClick={() => {}}
                        disabled={true}
                    />
                </List>
            </Card>
            <Card title="LogView" className="demo-wide">
                <LogView lines={log} height={180} />
                <div style={{ marginTop: 8 }}>
                    <Button
                        size="sm"
                        onClick={() =>
                            setLog((old) => [
                                ...old,
                                {
                                    ts: Date.now(),
                                    text: `[nav] replanned path (${old.length} poses)`,
                                    level: "info",
                                },
                            ])}
                    >
                        Append line
                    </Button>
                </div>
            </Card>
            <Card title="Markdown">
                <Markdown text={MARKDOWN} />
            </Card>
            <Card title="SafeHtml (a server's rendered doc, sanitized)">
                <SafeHtml
                    html={`<h2>Custom robots</h2><p>Write a <code>Module</code> and a blueprint; see <a href="https://dimensionalos.com">the docs</a>.</p><pre>robot ──▶ blueprint</pre><script>alert(1)</script><p onclick="alert(2)">No handlers survive.</p>`}
                />
            </Card>
            <Card title="LiveValue (flashes on change)">
                <LiveValue value={Math.round(rates.at(-1)! * 10) / 10} format={(value) => `${value.toFixed(1)} Hz`} />
            </Card>
            <Card title="CodeBlock (json)">
                <CodeBlock code={CODE} language="json" lineNumbers={true} />
            </Card>
            <Card title="CodeBlock (python)">
                <CodeBlock code={PY} language="py" />
            </Card>
            <Card title="Sparkline">
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                        <span className="dr-muted dr-small" style={{ display: "inline-block", width: 80 }}>
                            /lidar Hz
                        </span>
                        <Sparkline values={rates} width={180} />
                    </div>
                    <div>
                        <span className="dr-muted dr-small" style={{ display: "inline-block", width: 80 }}>
                            battery
                        </span>
                        <Sparkline values={[96, 95, 93, 92, 90, 89, 88, 87]} width={180} color="var(--ok)" />
                    </div>
                    <div>
                        <span className="dr-muted dr-small" style={{ display: "inline-block", width: 80 }}>
                            drops
                        </span>
                        <Sparkline
                            values={[0, 0, 1, 0, 3, 5, 2, 0, 0, 1]}
                            width={180}
                            color="var(--warn)"
                            fill={false}
                        />
                    </div>
                </div>
            </Card>
            <Card title="Timeline (recording scrubber)" className="demo-wide">
                <Timeline
                    start={0}
                    end={184}
                    value={time}
                    onChange={setTime}
                    playing={playing}
                    onPlayPause={setPlaying}
                    markers={[
                        { t: 20, label: "start nav", tone: "ok" },
                        { t: 77, label: "tf stale", tone: "warn" },
                        {
                            t: 130,
                            label: "collision stop",
                            tone: "danger",
                        },
                        { t: 160, label: "note" },
                    ]}
                />
            </Card>
        </div>
    )
}

/** A table whose rows a backend sorts: the header picks the sort key, the rows keep the order they arrive in. */
function BackendSortedTable() {
    const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "hz", dir: "desc" })
    const readers: Record<string, (row: DemoTopic) => string | number> = {
        name: (row) => row.name,
        hz: (row) => -row.hz,
        kb: (row) => -row.kb,
    }
    const read = readers[sort.key]
    // stands in for the backend: sorted by the chosen key, live first
    const rows = [...TOPICS].sort((a, b) => (read(a) < read(b) ? -1 : read(a) > read(b) ? 1 : 0))
    return (
        <Table
            columns={[
                {
                    key: "name",
                    label: "Topic",
                    sort: true,
                    render: (row) => <span className="dr-mono">{row.name}</span>,
                },
                { key: "hz", label: "Rate", sort: true, align: "right", render: (row) => `${row.hz.toFixed(1)} Hz` },
                { key: "kb", label: "Size", sort: true, align: "right", render: (row) => `${row.kb} kB` },
            ]}
            rows={rows}
            rowKey="key"
            sortRows={false}
            sort={sort}
            onSortChange={(next) => next && setSort({ key: next.key, dir: next.key === "name" ? "asc" : "desc" })}
            compact={true}
            maxHeight={200}
        />
    )
}
