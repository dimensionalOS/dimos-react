// deno-lint-ignore-file jsx-curly-braces -- {"muted, "} keeps the trailing space deno fmt would trim from bare text
// dimos-react's demo / storybook: every component, in any Desktop skin (?skin=research, ?skin=vibeslop, …). The skin,
// the open section and the corners live in the URL (useUrlState), so each view has a link.
import { createRoot } from "react-dom/client"
import {
    Alert,
    AngleDial,
    AppProvider,
    Badge,
    BottomBar,
    Button,
    ButtonGroup,
    Card,
    Checkbox,
    Chip,
    Column,
    ConnectionStatus,
    CopyButton,
    Embed,
    EmptyState,
    Fab,
    Field,
    FloatingPanel,
    Heading,
    Hud,
    Icon,
    IconButton,
    ICONS,
    Kbd,
    Label,
    Link,
    memorySource,
    Modal,
    NumberInput,
    Panel,
    Progress,
    ProgressRing,
    RadioGroup,
    RangeSlider,
    Row,
    SearchInput,
    Segmented,
    Select,
    Separator,
    Skeleton,
    SKINS,
    Slider,
    Spinner,
    SplitPane,
    StatusDot,
    TagList,
    Text,
    TextArea,
    TextInput,
    Tile,
    TileGrid,
    Toggle,
    Toolbar,
    TopBar,
    UrlStateProvider,
    useConfirm,
    usePrompt,
    useTheme,
    useToast,
    useUrlParams,
    useUrlState,
} from "../src/index.ts"
import type { Corners } from "../src/index.ts"
import { useState } from "react"
import type { ComponentType } from "react"
import { DataSection } from "./sections/data.tsx"
import { NavSection } from "./sections/nav.tsx"
import { InputDevicesSection } from "./sections/input_devices.tsx"
import { SceneSection } from "./sections/scene.tsx"
import { MediaSection } from "./sections/media.tsx"
import { ViewsSection } from "./sections/views.tsx"
import { GraphSection } from "./sections/graph.tsx"

const source = memorySource({
    topics: ["dimos/odom/nav_msgs.Odometry", "dimos/lidar/sensor_msgs.PointCloud2", "dimos/tf/tf2_msgs.TFMessage"],
})

function ControlsSection() {
    const [text, setText] = useState("go2-dog")
    const [search, setSearch] = useState("lidar")
    const [notes, setNotes] = useState("Waypoint 3 is behind the door.")
    const [speed, setSpeed] = useState(0.6)
    const [range, setRange] = useState<[number, number]>([0.2, 1.4])
    const [count, setCount] = useState(12)
    const [rangeMax, setRangeMax] = useState<number | null>(null)
    const [mode, setMode] = useState("accumulate")
    const [checks, setChecks] = useState({ grid: true, labels: false })
    const [follow, setFollow] = useState(true)
    const [style, setStyle] = useState("voxel")
    const [chips, setChips] = useState({ lidar: true, odom: false, tf: true })
    const [label, setLabel] = useState("charger")
    const [yaw, setYaw] = useState(0.4)
    const [floor, setFloor] = useState(1)
    const [editOpen, setEditOpen] = useState(true)
    return (
        <Column gap={16}>
            <Card title="Buttons">
                <Row wrap={true}>
                    <Button>Default</Button>
                    <Button variant="primary" icon="play">
                        Start replay
                    </Button>
                    <Button variant="ghost" icon="refresh">
                        Reload
                    </Button>
                    <Button variant="danger" icon="trash">
                        Delete
                    </Button>
                    <Button variant="ok" icon="check">
                        Stand up
                    </Button>
                    <Button variant="warn" icon="warn">
                        Take over
                    </Button>
                    <Button pressed={true} icon="target">
                        Following
                    </Button>
                    <Button loading={true}>Saving</Button>
                    <Button disabled={true}>Disabled</Button>
                    <Button size="sm" icon="download">
                        Small
                    </Button>
                    <Button size="lg" variant="primary">
                        Large
                    </Button>
                </Row>
                <Row wrap={true}>
                    <IconButton icon="settings" label="Settings" />
                    <IconButton icon="fullscreen" label="Fullscreen" variant="default" />
                    <IconButton icon="close" label="Close" round={true} />
                    <ButtonGroup>
                        <Button size="sm" pressed={true}>
                            3D
                        </Button>
                        <Button size="sm">Top</Button>
                        <Button size="sm">Map</Button>
                    </ButtonGroup>
                    <Kbd keys={["mod", "K"]} />
                    <Kbd>W</Kbd>
                    <Button size="sm" icon="download" href="data:text/plain,hello" download="hello.txt">
                        A link
                    </Button>
                    <CopyButton text="ABCD-1234" label="Copy the code" />
                </Row>
                <Row wrap={true} gap={14}>
                    <Fab icon="edit" label="Edit tools" active={editOpen} onClick={() => setEditOpen(!editOpen)} />
                    <Fab icon="refresh" label="Generate (next step)" tone="info" attention="pulse" />
                    <Fab icon="layers" label="Slicer (recommended)" tone="warn" attention="glow" />
                    <Fab icon="zap" label="Working" tone="ok" attention="spin" size={40} />
                    <Fab icon="edit" label="Disabled" disabled={true} />
                    <AngleDial value={yaw} onChange={setYaw} tone="warn" title="drag around to turn" />
                    <Text mono={true} small={true}>{`${((yaw * 180) / Math.PI).toFixed(1)}°`}</Text>
                    <Segmented
                        vertical={true}
                        size="sm"
                        value={floor}
                        onChange={setFloor}
                        items={[
                            [2, "F3"],
                            [1, "F2"],
                            [0, "F1"],
                        ]}
                        label="floor"
                    />
                </Row>
            </Card>
            <Card title="Form fields">
                <div className="demo-grid">
                    <Field label="Robot name" hint="shown in Desktop's dock">
                        <TextInput value={text} onChange={setText} />
                    </Field>
                    <Field label="Search topics">
                        <SearchInput value={search} onChange={setSearch} />
                    </Field>
                    <Field label="Label (commits on Enter / blur)" hint={`saved: ${label}`}>
                        <TextInput value={label} onCommit={setLabel} />
                    </Field>
                    <Field label="Max points" error={count > 100 ? "too many" : null}>
                        <NumberInput value={count} onChange={setCount} min={0} step={1} unit="k" />
                    </Field>
                    <Field label="Range max (nullable)" hint="empty = auto">
                        <NumberInput
                            value={rangeMax}
                            onChange={setRangeMax}
                            nullable={true}
                            placeholder="auto"
                            step={0.5}
                        />
                    </Field>
                    <Field label="Keep">
                        <Select
                            value={mode}
                            onChange={setMode}
                            options={[
                                ["latest", "latest scan"],
                                ["accumulate", "accumulate"],
                            ]}
                        />
                    </Field>
                    <Field label="Speed">
                        <Slider
                            value={speed}
                            onChange={setSpeed}
                            min={0}
                            max={1.5}
                            step={0.05}
                            format={(value) => `${value.toFixed(2)} m/s`}
                        />
                    </Field>
                    <Field label="Height band">
                        <RangeSlider
                            value={range}
                            onChange={setRange}
                            min={-1}
                            max={3}
                            step={0.1}
                            format={(value) => `${value.toFixed(1)} m`}
                        />
                    </Field>
                    <Field label="Notes">
                        <TextArea value={notes} onChange={setNotes} rows={2} />
                    </Field>
                    <Field label="Frame id">
                        <TextInput value="base_link" mono={true} icon="target" />
                    </Field>
                </div>
                <Separator />
                <Row gap={24} wrap={true} align="flex-start">
                    <Column>
                        <Checkbox
                            value={checks.grid}
                            onChange={(grid) => setChecks({ ...checks, grid })}
                            label="Grid"
                        />
                        <Checkbox
                            value={checks.labels}
                            onChange={(labels) => setChecks({ ...checks, labels })}
                            label="Frame labels"
                        />
                        <Checkbox value={false} indeterminate={true} label="Some layers" />
                        <Checkbox value={true} disabled={true} label="Locked" />
                    </Column>
                    <Column>
                        <Toggle value={follow} onChange={setFollow} label="Follow robot" />
                        <Toggle value={false} label="Record" size="sm" />
                    </Column>
                    <RadioGroup
                        value={style}
                        onChange={setStyle}
                        options={[
                            ["voxel", "Cubes"],
                            ["splat", "Glow"],
                            ["disc", "Spheres"],
                        ]}
                    />
                    <Field label="Inline field" inline={true}>
                        <Toggle value={true} />
                    </Field>
                </Row>
            </Card>
            <Card title="Badges, chips, status">
                <Row wrap={true}>
                    <Badge>sensor_msgs.PointCloud2</Badge>
                    <Badge tone="info">10 Hz</Badge>
                    <Badge tone="ok" dot={true}>
                        live
                    </Badge>
                    <Badge tone="warn">stale 3 s</Badge>
                    <Badge tone="danger">no TF</Badge>
                    <Badge solid={true}>NEW</Badge>
                    <Badge solid={true} tone="ok">
                        3
                    </Badge>
                </Row>
                <Row wrap={true}>
                    {Object.entries(chips).map(([name, on]) => (
                        <Chip
                            key={name}
                            selected={on}
                            onChange={(value) => setChips({ ...chips, [name]: value })}
                        >
                            {`/${name}`}
                        </Chip>
                    ))}
                    <Chip icon="robot" onRemove={() => {}}>
                        go2
                    </Chip>
                </Row>
                <Row wrap={true} gap={16}>
                    <StatusDot tone="ok" label="ok" />
                    <StatusDot tone="warn" label="warn" />
                    <StatusDot tone="danger" label="danger" />
                    <StatusDot tone="off" label="off" />
                    <ConnectionStatus state="connected" detail="14 ms" />
                    <ConnectionStatus state="connecting" />
                    <ConnectionStatus state="lost" label="robot offline" />
                </Row>
                <Label>TagList (oneLine: as many as fit, then +N)</Label>
                <TagList
                    oneLine={true}
                    items={[
                        "GO2Connection",
                        "VoxelGridMapper",
                        "CostMapper",
                        "ReplanningAStarPlanner",
                        "WavefrontFrontierExplorer",
                        "Rerun",
                        "WebsocketVis",
                    ]}
                    extra={<Badge tone="warn">hidden</Badge>}
                />
                <TagList items={[{ label: "Doesn't load (yet)", tone: "danger", title: "No module named 'mujoco'" }]} />
            </Card>
        </Column>
    )
}

function FeedbackSection() {
    const toast = useToast()
    const confirm = useConfirm()
    const prompt = usePrompt()
    const [open, setOpen] = useState(false)
    const [answer, setAnswer] = useState("")
    return (
        <Column gap={16}>
            <Card title="Alerts">
                <Alert tone="info" title="Replay loaded">
                    2026-10-11_run3 · 4 min 12 s · 18 topics
                </Alert>
                <Alert tone="ok">Map saved to ~/maps/office.pcd</Alert>
                <Alert tone="warn" title="TF problem" actions={<Button size="sm">Open TF tree</Button>}>
                    lidar_link has two parents: base_link, body
                </Alert>
                <Alert tone="danger" title="Robot unreachable" onClose={() => {}}>
                    No heartbeat from 192.168.12.1 for 8 s
                </Alert>
            </Card>
            <Card title="Toasts, modals, confirm, prompt">
                <Row wrap={true}>
                    <Button onClick={() => toast("Recording started")}>Toast</Button>
                    <Button onClick={() => toast.ok("Uploaded 3 files")}>OK toast</Button>
                    <Button onClick={() => toast.error("Upload failed: disk full", { title: "Upload" })}>
                        Error toast
                    </Button>
                    <Button
                        onClick={() => toast({ message: "Layer hidden", action: { label: "Undo", onClick: () => {} } })}
                    >
                        Toast with action
                    </Button>
                    <Button onClick={() => setOpen(true)}>Modal</Button>
                    <Button
                        variant="danger"
                        onClick={async () =>
                            setAnswer(
                                String(
                                    await confirm({
                                        title: "Delete recording?",
                                        message: "2026-10-11_run3 will be gone for good.",
                                        danger: true,
                                        confirmLabel: "Delete",
                                    }),
                                ),
                            )}
                    >
                        Confirm
                    </Button>
                    <Button
                        onClick={async () => setAnswer(String(await prompt({ title: "Rename", defaultValue: "run3" })))}
                    >
                        Prompt
                    </Button>
                    {answer ? <Text muted={true} mono={true}>{`→ ${answer}`}</Text> : null}
                </Row>
                <Modal
                    open={open}
                    onClose={() => setOpen(false)}
                    title="Export map"
                    footer={[
                        <Button key="c" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>,
                        <Button key="e" variant="primary" onClick={() => setOpen(false)}>
                            Export
                        </Button>,
                    ]}
                >
                    <Field label="File name">
                        <TextInput value="office.pcd" mono={true} />
                    </Field>
                    <Field label="Format">
                        <Select value="pcd" options={["pcd", "ply", "las"]} />
                    </Field>
                </Modal>
            </Card>
            <Card title="Progress">
                <Row gap={16}>
                    <Spinner />
                    <ProgressRing value={0.68} />
                    <ProgressRing value={1} tone="ok" size={36} />
                    <Column grow={true}>
                        <Progress value={0.42} />
                        <Progress value={0.9} tone="warn" />
                        <Progress />
                    </Column>
                </Row>
                <Column gap={6}>
                    <Skeleton width="60%" />
                    <Skeleton width="85%" />
                </Column>
            </Card>
            <Card title="Empty state" padded={false}>
                <EmptyState
                    icon="robot"
                    title="No robot connected"
                    message="Start a blueprint in Desktop, or open a recording."
                    actions={[
                        <Button key="a" variant="primary">
                            Open recording
                        </Button>,
                        <Button key="b">Docs</Button>,
                    ]}
                />
            </Card>
        </Column>
    )
}

function LayoutSection() {
    const [tile, setTile] = useState("Go2")
    const [floating, setFloating] = useState(false)
    return (
        <Column gap={16}>
            <Card title="Top bar, toolbar, bottom bar" padded={false}>
                <TopBar
                    title="Recordings"
                    icon="record"
                    right={[
                        <ConnectionStatus key="c" state="connected" detail="9 ms" />,
                        <IconButton key="s" icon="settings" label="Settings" />,
                    ]}
                >
                    <SearchInput value="" onChange={() => {}} placeholder="Search recordings…" />
                </TopBar>
                <div style={{ position: "relative", height: 150, background: "var(--scene-bg)" }}>
                    <Hud position="top-left">
                        <Toolbar floating={true}>
                            <IconButton icon="layers" label="Layers" size="sm" />
                            <IconButton icon="camera" label="Cameras" size="sm" />
                            <Separator vertical={true} />
                            <IconButton icon="target" label="Follow" size="sm" />
                        </Toolbar>
                    </Hud>
                    <Hud position="bottom-right">
                        <Badge tone="info">60 fps · 14 ms</Badge>
                    </Hud>
                    <Hud position="center">
                        <Text muted={true}>a HUD over a view</Text>
                    </Hud>
                </div>
                <BottomBar>
                    <StatusDot tone="ok" />
                    go2 · 3 topics · 2.1 MB/s
                    <span className="dr-spacer" />
                    <Text mono={true} small={true}>
                        00:42 / 04:12
                    </Text>
                </BottomBar>
            </Card>
            <Card title="Embed (another page in this one)" padded={false}>
                <div style={{ position: "relative", height: 90 }}>
                    <Embed
                        title="embedded page"
                        srcDoc="<p style='font:13px sans-serif;padding:8px'>an embedded page (iframe)</p>"
                    />
                </div>
            </Card>
            <Row gap={16} align="stretch" wrap={true}>
                <Panel
                    title="Layers"
                    icon="layers"
                    collapsible={true}
                    style={{ flex: 1, minWidth: 240 }}
                    actions={<IconButton icon="plus" label="Add" size="sm" />}
                >
                    <Toggle value={true} label="/lidar" />
                    <Toggle value={false} label="/global_map" />
                </Panel>
                <Panel title="Glass panel" glass={true} style={{ flex: 1, minWidth: 240 }}>
                    <Text muted={true}>for panels floating over a 3D or video view</Text>
                </Panel>
                <Card
                    title="Card"
                    description="with a description"
                    actions={<Button size="sm">Action</Button>}
                    style={{ flex: 1, minWidth: 240 }}
                >
                    <Text>Body text</Text>
                </Card>
            </Row>
            <Card title="Split pane" padded={false}>
                <div style={{ height: 140 }}>
                    <SplitPane defaultSize={220}>
                        <div style={{ padding: 12 }}>
                            <Label>Left</Label>
                            <Text as="p" muted={true}>
                                Drag the divider.
                            </Text>
                        </div>
                        <div style={{ padding: 12 }}>
                            <Label>Right</Label>
                        </div>
                    </SplitPane>
                </div>
            </Card>
            <Card title="Tile + TileGrid (a picker)" className="demo-wide">
                <TileGrid min={140}>
                    <Tile icon="plus" title="Custom / new robot" subtitle="Bring your own hardware" />
                    {["Go2", "G1", "xArm7"].map((name, index) => (
                        <Tile
                            key={name}
                            icon="robot"
                            title={name}
                            subtitle={["Unitree", "Unitree", "UFactory"][index]}
                            selected={tile === name}
                            onClick={() => setTile(name)}
                        />
                    ))}
                    <Tile loading={true} />
                </TileGrid>
            </Card>
            <Card title="Type, links, icons">
                <Heading level={1}>Heading 1</Heading>
                <Heading level={2}>Heading 2 · section</Heading>
                <Heading level={3}>Heading 3 · micro label</Heading>
                <Text>
                    {"Body text, "}
                    <Text muted={true}>{"muted, "}</Text>
                    <Text mono={true}>{"mono /odom, "}</Text>
                    <Text tone="ok">{"ok, "}</Text>
                    <Text tone="warn">{"warn, "}</Text>
                    <Text tone="danger">{"danger, "}</Text>
                    <Link href="#">a link</Link>
                </Text>
                <Row wrap={true} gap={10} className="demo-icons">
                    {Object.keys(ICONS).map((name) => (
                        <span key={name} title={name}>
                            <Icon name={name} />
                        </span>
                    ))}
                </Row>
                <Button onClick={() => setFloating(!floating)}>
                    {floating ? "Hide floating panel" : "Show floating panel"}
                </Button>
                {floating
                    ? (
                        <FloatingPanel
                            title="Floating"
                            icon="panels"
                            onClose={() => setFloating(false)}
                            defaultPosition={{ x: -24, y: 80 }}
                        >
                            <Text muted={true}>Drag me by the header.</Text>
                        </FloatingPanel>
                    )
                    : null}
            </Card>
        </Column>
    )
}

const SECTIONS: [id: string, label: string, Section: ComponentType][] = [
    ["controls", "Controls", ControlsSection],
    ["feedback", "Feedback", FeedbackSection],
    ["layout", "Layout", LayoutSection],
    ["data", "Data", DataSection],
    ["nav", "Navigation", NavSection],
    ["devices", "Input devices", InputDevicesSection],
    ["media", "Media", MediaSection],
    ["views", "View panels & driving", ViewsSection],
    ["scene", "3D view", SceneSection],
    ["graph", "Module graph & comments", GraphSection],
]

function Demo() {
    const [only] = useUrlState("section", "all")
    const [params, setParams] = useUrlParams()
    const theme = useTheme()
    const shown = only === "all" ? SECTIONS : SECTIONS.filter(([id]) => id === only)
    return (
        <div className="demo">
            <TopBar
                title="dimos-react"
                icon="robot"
                right={[
                    <Select
                        key="s"
                        size="sm"
                        value={theme.skin}
                        options={SKINS}
                        onChange={(skin) => setParams({ skin: skin === "portal" ? null : skin })}
                    />,
                    <Select
                        key="c"
                        size="sm"
                        value={theme.corners}
                        options={[
                            ["theme", "skin corners"],
                            ["sharp", "sharp"],
                            ["rounded", "rounded"],
                        ]}
                        onChange={(corners) => setParams({ corners: corners === "theme" ? null : corners })}
                    />,
                    <Select
                        key="o"
                        size="sm"
                        value={only}
                        options={[["all", "all sections"], ...SECTIONS.map(([id, label]) => [id, label])]}
                        onChange={(section) => setParams({ section: section === "all" ? null : section })}
                    />,
                ]}
            >
                <Text
                    muted={true}
                    small={true}
                >
                    {`skin ${theme.skin} · ${theme.dark ? "dark" : "light"} · ${params.section ?? "all"}`}
                </Text>
            </TopBar>
            <main className="demo-main">
                {shown.map(([id, label, Section]) => (
                    <section key={id} id={id} className="demo-section">
                        <Heading level={2}>{label}</Heading>
                        <Section />
                    </section>
                ))}
            </main>
        </div>
    )
}

function Root() {
    // the skin comes from the URL (a link per skin); with no ?skin= it follows Desktop's saved choice, live
    const [skin] = useUrlState("skin")
    const [corners] = useUrlState<Corners>("corners")
    return (
        <AppProvider source={source} url={false} theme={{ skin, corners }}>
            <Demo />
        </AppProvider>
    )
}

const style = document.createElement("style")
style.textContent = `
.demo-main { max-width: 1180px; margin: 0 auto; padding: 20px 16px 80px; display: flex; flex-direction: column; gap: 28px; }
.demo-section { display: flex; flex-direction: column; gap: 12px; }
.demo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; align-items: start; }
.demo-icons { color: var(--muted-fg); }
.demo-wide { grid-column: 1 / -1; }
.demo-target { display: flex; align-items: center; justify-content: center; height: 120px; border: 1px dashed var(--border-strong); border-radius: var(--radius); color: var(--muted-fg); background: var(--scene-bg); }
`
document.head.append(style)
createRoot(document.getElementById("root")!).render(
    <UrlStateProvider events={false}>
        <Root />
    </UrlStateProvider>,
)
