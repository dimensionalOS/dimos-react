/** zenoh priorities (lower = more important). */
export declare const Priority: Readonly<{
    readonly REAL_TIME: 1;
    readonly INTERACTIVE_HIGH: 2;
    readonly INTERACTIVE_LOW: 3;
    readonly DATA_HIGH: 4;
    readonly DATA: 5;
    readonly DATA_LOW: 6;
    readonly BACKGROUND: 7;
}>;
export type Delivery = "latest" | "reliable";
export type ConnectionState = "connecting" | "connected" | "degraded" | "lost";
export type PublisherState = "connecting" | "open" | "tripped" | "rejected" | "closed";
export type SubscriptionState = "connecting" | "open" | "rejected" | "closed";
/** What a message encoding produces on its default channel: pictures (`video`), sound (`audio`), or bytes on the data channel (`fields`: decoded by this client). */
export type EncodingOutput = "video" | "audio" | "data" | "fields";
/** What a subscription's messages travel on: a video track of one format, the Opus audio track, or the data channel. */
export type Channel = "video-h264" | "video-vp8" | "video-vp9" | "video-av1" | "audio-opus" | "data";
/** A message encoding the gateway has registered. */
export interface EncodingInfo {
    name: string;
    output: EncodingOutput;
}
/** Turns a data-channel encoding's bytes into what `msg.decoded` carries. */
export type EncodingDecoder = (bytes: Uint8Array, message: Message) => unknown;
/**
 * Registers the browser decoder for a data-channel encoding the gateway runs (a Rust encoding the host application
 * added with `ServerBuilder::encoding`). Messages of subscriptions using that encoding on the data channel get
 * `msg.decoded = decoder(msg.bytes, msg)` (fields messages decode by themselves). Video and audio need no decoder.
 * Registering a different decoder under a name that already has one throws.
 */
export declare function registerEncoding(name: string, decoder: EncodingDecoder): void;
/** Per-frame details of a video subscription; the pixels are on `mediaStream`. */
export interface VideoFrameInfo {
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
    quality: number;
    keyframe: boolean;
    encodedBytes: number;
    /** the frame's media time on its track (its RTP timestamp less the track's first, ms; a video element's
     * requestVideoFrameCallback `rtpTimestamp` says which frame is showing); absent from gateways before 0.5.20 */
    mediaTimeMs?: number;
    /** when the gateway wrote it to the track (unix ms, gateway clock); absent from gateways before 0.5.20 */
    writtenMs?: number;
    /** the frame's RTP timestamp: a video element's requestVideoFrameCallback `rtpTimestamp` names this frame exactly
     * (absent from gateways before 0.5.20, and until the gateway saw the track's first packet) */
    rtpTimestamp?: number;
    /** when the gateway got the frame's sample and finished encoding it (unix ms, gateway clock; the sample's own time is
     * the message's `timestamp`); absent from gateways before 0.5.20 */
    receivedMs?: number;
    encodedMs?: number;
    /** the picture's message header (its `stamp`, seconds, and `frameId`, the TF frame it was taken in), when the
     * encoding gave one (e.g. zenoh-dimos-codecs' image codecs); absent from gateways before 0.5.31 */
    stamp?: number;
    frameId?: string;
    /** the same header whole (exact `sec`/`nanosec`, `seq`), as `msg.header` carries it */
    header?: MessageHeader;
    /** the picture's zenoh sample encoding and attachment, when they say something (0.5.32+; also `msg.encoding` / `msg.attachment`) */
    encoding?: string;
    attachment?: Uint8Array;
}
/** A message's own header (ROS `std_msgs/Header`, dimos LCM's), which the gateway sends with what an encoding made of it. */
export interface MessageHeader {
    /** seconds since the epoch (to about a microsecond; `sec` + `nanosec` are exact) */
    stamp: number;
    sec: number;
    nanosec: number;
    /** the TF frame it was taken in */
    frameId: string;
    /** its sequence number, where the type has one (dimos LCM does, ROS 2 doesn't) */
    seq?: number;
}
/** Percentiles of one latency, ms. */
export interface LatencySpread {
    p50: number;
    p95: number;
}
/** End-to-end video latency over the frames a video element showed lately (`Subscription.watchVideoLatency`), ms. */
export interface VideoLatency {
    /** frames measured, and shown frames no metadata named (lost, or from a gateway before 0.5.20) */
    frames: number;
    unmatched: number;
    /** the sample's timestamp to the frame on screen */
    total: LatencySpread;
    /** where it went: to the gateway (zenoh), decoding + encoding there, waiting to be written to the track, then RTP
     * pacer + network + jitter buffer + decode to the screen; `toReceived`/`receivedToShown` split that last stage
     * where the browser reports a frame's receive time (Chrome) */
    stages: {
        toGateway: LatencySpread;
        encoding: LatencySpread;
        toTrack: LatencySpread;
        trackToShown: LatencySpread;
        toReceived?: LatencySpread;
        receivedToShown?: LatencySpread;
    };
    /** source-to-shown from the stamp the frame's own RTP packets carry (abs-capture-time, which Chrome reports in
     * `getSynchronizationSources()`), on frames shown while they were the newest received: a check that the stamp
     * that came with the video agrees with the one the metadata named */
    captureToShown?: LatencySpread;
}
export interface Message {
    key: string;
    /** "delete" for a delete sample (its bytes are empty) */
    kind: "put" | "delete";
    /** the payload (decompressed): raw sample bytes, or the encoding's output */
    bytes: Uint8Array;
    /** the sample's zenoh encoding, when not the default (raw messages; encoded ones with `header`, 0.5.32+) */
    encoding?: string;
    /** the sample's zenoh attachment (raw messages; encoded ones with `header`, 0.5.32+) */
    attachment?: Uint8Array;
    timestamp: number;
    seq: number;
    /** fields messages: the decoded fields (see `decodeFields`); other data-channel encodings: what the encoding's registered decoder returned (see `registerEncoding`) */
    decoded?: unknown;
    video?: VideoFrameInfo;
    mediaStream?: MediaStream;
    /** the sample's own header (stamp, frameId, seq) on encoded messages of any channel, unless the subscription says
     * `metadata: false` (raw messages are the whole sample, header and all); absent from gateways before 0.5.32 but on video */
    header?: MessageHeader;
}
export interface SubscribeOptions {
    delivery?: Delivery;
    priority?: number;
    /** when bandwidth is short, higher keeps more bandwidth and quality (default 1; 0 gives up everything first) */
    bandwidthPriority?: number;
    maxAge?: number;
    maxHz?: number;
    minQuality?: number;
    qualityToHzTradeoff?: number;
    /** a message encoding the gateway registered (`ZenohGateway.encodings`); none = raw bytes */
    encoding?: string;
    /** what the messages travel on (default: where the encoding's output goes: pictures on video-h264, sound on audio-opus, else data) */
    channel?: Channel;
    /** passed to the encoding; `quality` (0..1, default 1) is the most the bandwidth allocator may pick */
    encodeOptions?: {
        quality?: number;
        [option: string]: unknown;
    };
    /** data-channel compression (default: the encoding's, none without one); not for video or audio */
    compress?: "zstd" | "none";
    /** video channels: most bits/s the stream asks for (default: the server's) */
    maxBitrate?: number;
    /** video channels: smallest share of the source's width and height the picture may shrink to (default 0) */
    minResolutionScale?: number;
    /** video channels: [width, height] the picture never shrinks below, aspect kept (default [160, 64]) */
    minResolution?: [number, number];
    /** video channels: [width, height] box the picture is fitted into */
    maxResolution?: [number, number];
    /** video channels: the encoder may skip frames to hold its bitrate (default true; libwebrtc does the same for cameras) */
    frameDropping?: boolean;
    /** video channels: a keyframe at least this often, ms, on top of the ones the browser asks for after a loss (default 60000) */
    keyframeIntervalMs?: number;
    /** video channels: a keyframe when the encoder sees a new scene (default false: at low bitrates they cost more than they fix) */
    sceneChangeKeyframes?: boolean;
    /** video channels: the quantizer (H.264's 0-51) the picture's size aims for: lower = smaller, sharper (default 30) */
    targetQp?: number;
    /** video channels: [min, max] ms the browser may hold a frame to smooth out jitter (default [0, 0]: show at once) */
    playoutDelay?: [number, number];
    /** each encoded message comes with its sample's own header (`msg.header`: stamp, frameId, seq), default true; false
     * saves its few bytes a message when nothing reads where or when it was taken. Gateways before 0.5.32 ignore it. */
    metadata?: boolean;
}
/** What `Subscription.update` may change on a running subscription; `null` puts an option back to its default. */
export type SubscriptionUpdate = {
    [option in "maxHz" | "minQuality" | "qualityToHzTradeoff" | "bandwidthPriority" | "maxBitrate" | "minResolutionScale" | "minResolution" | "maxResolution" | "frameDropping" | "keyframeIntervalMs" | "sceneChangeKeyframes" | "targetQp" | "playoutDelay"]?: SubscribeOptions[option] | null;
} & {
    encodeOptions?: {
        quality?: number;
    };
};
export interface PublisherOptions {
    delivery?: Delivery;
    priority?: number;
    repeatMs?: number;
    latencyLimit?: number;
}
export interface ConnectOptions {
    /** default: the gateway's (`GET /zenoh-gateway/ice`, TURN credentials minted for this client) */
    iceServers?: RTCIceServer[];
    /** "relay" forces every byte through TURN; default: the `/zenoh-gateway/ice` reply's `iceTransportPolicy`, else "all" */
    iceTransportPolicy?: RTCIceTransportPolicy;
    /** sent as `Authorization: Bearer <token>`; the gateway's authorize hook turns it into a grant */
    token?: string;
    /** the link's known bandwidth (bytes/s), used by the gateway in place of its estimate (no probing; video sized for it
     *  from the first frame), e.g. for a page on the gateway's own machine; the host's cap still applies. Default: estimated */
    linkBandwidthBytesPerSec?: number;
    reconnect?: boolean;
    /** ms the page may be hidden or frozen, or the connection "disconnected", before the client starts a fresh
     *  connection at once instead of catching up or waiting for the browser to declare the old one failed (default 2000;
     *  a phone drops a backgrounded tab's connection, which then took ~5 s to come back) */
    freshAfterMs?: number;
    statsIntervalMs?: number;
    heartbeatHz?: number;
    heartbeatMisses?: number;
    clock?: () => number;
}
export interface KeyStats {
    received: number;
    dropped: number;
    backlogBytes: number;
    rttMs: number | null;
    gateway: GatewayChannelStats | null;
}
/** One channel as the gateway reports it in `stats`. */
export interface GatewayChannelStats {
    id: number | null;
    type: string;
    key: string;
    opts: Record<string, unknown>;
    stats: Record<string, number | boolean | string | null>;
    /** subscriptions: this stream's share of the frontend's bandwidth (SPEC "Bandwidth allocation") */
    allocation: Record<string, number | boolean | null> | null;
}
/**
 * How the gateway copes with this page's link, from each stats poll (SPEC "Congestion"): an app shows "link degraded,
 * dropping N/s" from it instead of the user finding out from stale data.
 */
export interface Congestion {
    /** the subscriptions want more than the link or the page takes, so the gateway sends fewer or smaller messages */
    degraded: boolean;
    /** what holds them back while degraded: the network path, or this page not getting through what already arrived */
    limitedBy: "network" | "page" | null;
    /** messages per second of the held-back subscriptions that never reached the page (a newer one replaced them, they outlived maxAge, or arrived incomplete) */
    droppedPerSec: number;
    /** bytes per second the gateway sends this page, and what its subscriptions would take at their full rate */
    sentBytesPerSec: number;
    wantedBytesPerSec: number;
}
/** The gateway's `clock`, `heartbeat` and `bandwidth` stats (SPEC "Stats"). */
export type GatewayStats = Record<string, Record<string, unknown> | null>;
export interface GetReply {
    key: string | null;
    bytes: Uint8Array;
    error?: boolean;
    /** a delete reply */
    kind?: "put" | "delete";
    /** the sample's (or the error's) encoding */
    encoding?: string;
    attachment?: Uint8Array;
    /** the sample's timestamp, unix ms */
    timestamp?: number;
}
export type TopicSource = "token" | "advancedPublisher" | "sample";
export interface Topic {
    key: string;
    sources: TopicSource[];
}
type Bytesish = Uint8Array | ArrayBuffer | ArrayBufferView | string;
interface ControlResponse {
    id?: number;
    ok?: boolean;
    error?: string;
    event?: "tripped" | "rejected" | "accepted" | "leaseLost" | "closed" | "query" | "liveliness" | "matching";
    reason?: string;
    [field: string]: unknown;
}
export interface Frame {
    key: string;
    timestamp: number;
    seq: number;
    frameId: number;
    chunkIndex: number;
    chunkCount: number;
    /** bit0: the whole message is zstd-compressed */
    flags: number;
    chunk: Uint8Array;
}
/**
 * Gateway frame (little endian):
 * u16 keyLen | key | f64 timestampMs | u32 seq | u32 frameId | u32 chunkIndex | u32 chunkCount | u8 flags | chunk
 */
export declare function decodeFrame(buffer: ArrayBuffer): Frame;
/** A decoded fields value: one number, text, or the elements' values (scaled fields: Float32Array). */
export type FieldValue = number | string | Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;
/**
 * A fields message (SPEC "Fields") as an object of named values: scalar fields are numbers, text
 * fields strings, others typed arrays viewing the message (copied once if misaligned).
 */
export declare function decodeFields(message: Uint8Array): Record<string, FieldValue>;
/** Video metadata frame (64 bytes, then the picture's header if flags bit2) sent on a video subscription's channel per frame. */
export declare function decodeVideoFrameInfo(bytes: Uint8Array): VideoFrameInfo;
/** A message's header with its zenoh sample's encoding and attachment, when they came. */
export interface DecodedHeader {
    header: MessageHeader;
    encoding?: string;
    attachment?: Uint8Array;
}
/** A message header as the gateway sends it: `f64 stamp | u16 frameIdLen | frameId | i32 sec | u32 nanosec | u8 flags |
 * u32 seq`, flags bit0: seq is set, bit1: `u16 encodingLen | encoding | u32 attachmentLen | attachment` (the zenoh
 * sample's) follow; 0.5.31 sent only up to frameId. Undefined if it is cut short. */
export declare function decodeHeader(bytes: Uint8Array): DecodedHeader | undefined;
/** Browser -> gateway put: f64 sentAtMs (browser clock) | payload (little endian). */
export declare function encodePut(payload: Uint8Array, sentAtMs: number): Uint8Array<ArrayBuffer>;
/**
 * Settles once the channel is usable: the gateway accepted it AND it is open in this browser.
 * Both are needed because the gateway's `accepted` (control channel) can arrive before this
 * channel's own open (its DCEP ack travels on a different SCTP stream). Rejects if the gateway
 * rejects it or it fails to open.
 */
declare class Acceptance {
    #private;
    promise: Promise<void>;
    settled: boolean;
    constructor();
    gatewayAccepted(): void;
    channelOpened(): void;
    reject(error: Error): void;
}
/** Common to subscriptions and publishers: a channel the gateway accepts or rejects. */
declare abstract class Endpoint {
    readonly owner: ZenohGateway;
    readonly id: number;
    readonly key: string;
    channel: RTCDataChannel | null;
    closed: boolean;
    rejectionReason: string | null;
    gatewayStats: GatewayChannelStats | null;
    protected acceptance: Acceptance;
    constructor(owner: ZenohGateway, id: number, key: string);
    abstract attach(peer: RTCPeerConnection): void;
    /** Resolves once the gateway accepted this channel; rejects with the gateway's reason otherwise. */
    ready(): Promise<void>;
    /** Starts a new attempt to get accepted (each attach, including reconnects). */
    protected beginAttempt(): Acceptance;
    protected watchChannel(channel: RTCDataChannel, acceptance: Acceptance): void;
    _accepted(): void;
    _rejected(reason: string): void;
    close(): void;
}
export declare class Subscription extends Endpoint {
    #private;
    options: SubscribeOptions;
    readonly callback: (message: Message) => void;
    received: number;
    /** chunked messages dropped incomplete (lost chunk or abandoned for a newer message) */
    partialDropped: number;
    /** encoded payloads that failed to decode in this page */
    decodeErrors: number;
    /** video and audio channels: the track (also on each message as `mediaStream`) */
    mediaStream: MediaStream | null;
    /** what the messages travel on */
    readonly channelName: Channel;
    constructor(owner: ZenohGateway, id: number, key: string, options: SubscribeOptions, callback: (message: Message) => void);
    /**
     * Changes the running subscription's options in place: same channel and track, no resubscribe; the gateway's
     * next frame uses them. Reconnects keep them too.
     */
    /**
     * Measures end-to-end latency on each frame `element` shows of this video subscription (requestVideoFrameCallback:
     * Chrome, Firefox, Safari): the frame's RTP timestamp names its metadata, whose gateway times the connection's
     * clock sync brings to this clock. Read it with `videoLatency()`; returns a function that stops measuring.
     */
    watchVideoLatency(element: HTMLVideoElement): () => void;
    /** The metadata of the frame a video element shows (a requestVideoFrameCallback's `rtpTimestamp`), e.g. its `stamp`
     * and `frameId` to place the picture on screen in its own TF frame; undefined if it is not among the latest 512. */
    videoFrameInfo(rtpTimestamp: number): VideoFrameInfo | undefined;
    /** End-to-end latency of the frames a watched video element showed lately (see `watchVideoLatency`): its latest 300,
     * or those of the last `windowMs`; null before any. */
    videoLatency(windowMs?: number): VideoLatency | null;
    update(changes: SubscriptionUpdate): Promise<void>;
    get state(): SubscriptionState;
    /** messages the gateway accepted for us but we never got whole (queue, age, maxHz, network) */
    get dropped(): number;
    attach(peer: RTCPeerConnection): void;
    /** Also after it opened: another client's lease took its key, so its channel and track go. */
    _rejected(reason: string): void;
    close(): void;
}
export declare class Publisher extends Endpoint {
    #private;
    readonly options: PublisherOptions;
    sent: number;
    dropped: number;
    tripped: boolean;
    /** why the deadman fired: "heartbeat" | "disconnected" | "shutdown" */
    tripReason: string | null;
    deadmanArmed: boolean;
    /** why the gateway is dropping this publisher's puts right now (another client's lease), else null */
    blocked: string | null;
    constructor(owner: ZenohGateway, id: number, key: string, options: PublisherOptions);
    get state(): PublisherState;
    onTripped(listener: (reason: string) => void): () => void;
    attach(peer: RTCPeerConnection): void;
    /** `timestamp`: when the value was produced, in this client's clock (`z.now()`); defaults to now. */
    /** A zenoh delete on this publisher's key (over the control channel; needs the `publish` grant). */
    delete(options?: PutOptions): Promise<void>;
    put(value: Bytesish, { timestamp }?: {
        timestamp?: number;
    }): void;
    /**
     * Stores `value` on the gateway; it is published once (REAL_TIME, reliable) if this frontend's
     * heartbeat stops, it disconnects, or the gateway shuts down. Then this publisher is tripped.
     */
    setDeadman(value: Bytesish): Promise<void>;
    clearDeadman(): Promise<void>;
    _trip(reason: string): void;
    _rejected(reason: string): void;
    close(): void;
}
/** An exclusive right to publish on a group of keys among this gateway's clients (SPEC "Leases"). */
export interface LeaseOptions {
    /** a group the server defines (its keys and grants), or a name for this one; unset = unnamed */
    group?: string;
    /** keys only the holder may publish on: the gateway drops other clients' puts there */
    publish?: string[];
    /** keys only the holder may subscribe to: the gateway ends and refuses other clients' subscriptions there */
    subscribe?: string[];
    /** a newer lease on overlapping keys takes this one over ("takenOver"); false: it is refused while this is held */
    allowTakeover?: boolean;
    maxSeconds?: number;
    /** heartbeat silence (ms) that ends it, instead of the connection's heartbeat deadline, so deadmen can stay tight
     * while the lease rides out a stall; at most the server's slowest lease heartbeat (default 60 s) */
    timeoutMs?: number;
    onLost?: (reason: string) => void;
}
export declare class Lease {
    #private;
    readonly owner: ZenohGateway;
    readonly group: string;
    readonly keys: string[];
    readonly subscribe: string[];
    readonly expiresInMs: number | null;
    /** why it ended: "takenOver" | "heartbeat" | "maxSeconds" | "disconnected" | "force-expired by peer N" | "released" | "renewed" */
    lost: string | null;
    /** the heartbeat silence that ends it, as the gateway applies it; null: the connection's heartbeat deadline (or a
     * gateway older than 0.5.17, which ignores `timeoutMs`) */
    timeoutMs: number | null;
    /** `keys`: the ones only we publish on; `subscribe`: the ones only we subscribe to */
    constructor(owner: ZenohGateway, group: string, keys: string[], subscribe: string[], expiresInMs: number | null);
    onLost(listener: (reason: string) => void): () => void;
    release(): Promise<void>;
    _lose(reason: string): void;
}
type ResolvedConnectOptions = Required<Omit<ConnectOptions, "clock" | "iceServers" | "iceTransportPolicy" | "token" | "linkBandwidthBytesPerSec">> & Pick<ConnectOptions, "clock" | "iceServers" | "iceTransportPolicy" | "token" | "linkBandwidthBytesPerSec">;
export declare class ZenohGateway {
    #private;
    state: ConnectionState;
    /** per subscribed/published key expression */
    stats: Record<string, KeyStats>;
    /** latest round trip to the gateway (heartbeat, else control ping) */
    rttMs: number | null;
    /** gateway clock minus this client's clock, from the lowest-RTT recent sample */
    clockOffsetMs: number | null;
    /** gateway-side heartbeat, clock and bandwidth stats */
    gatewayStats: GatewayStats | null;
    /** whether the link keeps up with the subscriptions, and what is dropped when it doesn't; null before the first stats poll */
    congestion: Congestion | null;
    /** the message encodings the gateway runs, fetched on connect */
    encodings: readonly EncodingInfo[];
    /** what the gateway supports beyond 0.5.31 (e.g. "metadata": the subscribe option), fetched with the encodings */
    features: readonly string[];
    /** the ICE servers in use (the gateway's unless given) */
    iceServers: RTCIceServer[];
    /** leases held, by group */
    readonly _leases: Map<string, Lease>;
    readonly url: string;
    readonly options: ResolvedConnectOptions;
    /** this client's clock in ms; put timestamps and clock sync use it */
    readonly now: () => number;
    constructor(url: string, options?: ConnectOptions);
    onState(listener: (state: ConnectionState) => void): () => void;
    /** Opens (or re-opens) the peer connection and every channel on it. */
    get _peer(): RTCPeerConnection | null;
    /**
     * A new recvonly transceiver bound to a gateway track of `channel`'s format, added through a renegotiation over
     * `control` (the gateway answers with a track for the new m-line). Never a reused one: Chrome stopped assembling
     * a reused receiver's frames after a few quick close-and-reopen switches.
     */
    _acquireTransceiver(peer: RTCPeerConnection, kind: "video" | "audio", channel: Channel): Promise<RTCRtpTransceiver>;
    /** A closed subscription's transceiver stops; the next renegotiation frees its m-line (Chrome reuses the slot). */
    _releaseTransceiver(peer: RTCPeerConnection, transceiver: RTCRtpTransceiver): void;
    _open(): Promise<void>;
    /** Stops sending heartbeats (the gateway then fires this frontend's deadmen); for testing deadman wiring. */
    pauseHeartbeat(): void;
    resumeHeartbeat(): void;
    _request(body: {
        op: string;
        [field: string]: unknown;
    }, timeoutMs: number): Promise<ControlResponse>;
    /** Options are checked by the gateway: a bad one rejects the subscription (`state`, `ready()`). */
    subscribe(key: string, options: SubscribeOptions, callback: (message: Message) => void): Subscription;
    publisher(key: string, options?: PublisherOptions): Publisher;
    /** Stops re-attaching an endpoint on reconnect (closed, tripped or rejected). */
    _forget(endpoint: Endpoint): void;
    /** zenoh query: `key` may carry parameters after `?` (or pass `parameters`). */
    get(key: string, options?: GetOptions): Promise<GetReply[]>;
    /** Queries with fixed options, like zenoh's querier. */
    querier(key: string, options?: GetOptions): Querier;
    /** One zenoh put (needs the `publish` grant). */
    put(key: string, value: Bytesish, options?: PutOptions): Promise<void>;
    /** One zenoh delete (needs the `publish` grant). */
    delete(key: string, options?: PutOptions): Promise<void>;
    /**
     * Answers zenoh queries on `key` from this page (needs the `queryable` grant). The callback gets
     * each query; reply with `query.reply(...)` (any number of times), then `query.finalize()`.
     */
    declareQueryable(key: string, options: {
        complete?: boolean;
    }, callback: (query: Query) => void): Promise<Queryable>;
    /** A liveliness token on `key`, alive until undeclared or this page goes (needs `liveliness`). */
    declareToken(key: string): Promise<LivelinessToken>;
    /** Tokens appearing (`alive: true`) and going under `key`; `history` also reports the ones already alive. */
    livelinessSubscribe(key: string, options: {
        history?: boolean;
    }, callback: (change: {
        key: string;
        alive: boolean;
    }) => void): Promise<LivelinessSubscriber>;
    /** The keys of the liveliness tokens alive under `key`. */
    livelinessGet(key: string, { timeoutMs }?: {
        timeoutMs?: number;
    }): Promise<string[]>;
    /** Whether a publisher ("subscribers") or a querier ("queryables") on `key` would reach anyone now. */
    matchingStatus(key: string, target?: MatchingTarget): Promise<boolean>;
    /** Called each time `matchingStatus(key, target)` changes. */
    matchingListener(key: string, target: MatchingTarget, callback: (matching: boolean) => void): Promise<MatchingListener>;
    /** Tells the gateway the link's known bandwidth (bytes/s), used in place of its estimate (`undefined`: back to the
     *  estimate); kept across reconnects. */
    setLinkBandwidth(bytesPerSec: number | undefined): Promise<void>;
    /** The gateway's zenoh session: its id, and the routers and peers it is connected to. */
    info(): Promise<SessionInfo>;
    _route(event: string, id: number, handler: (event: ControlResponse) => void): void;
    _unroute(event: string, id: number): void;
    _forgetHandle(handle: ApiHandle): void;
    /**
     * Keys currently live on the zenoh network under `filter`, including ones never subscribed to.
     * See SPEC.md "Topic enumeration" for which kinds of keys can and can't be seen.
     * `probeMs: 0` lists liveliness tokens only, without subscribing to `filter`.
     */
    listTopics(filter?: string, { probeMs }?: {
        probeMs?: number;
    }): Promise<Topic[]>;
    /**
     * Takes (or renews) the exclusive right, among this gateway's clients, to publish on `publish` and subscribe to
     * `subscribe` (or a server group's keys). Needs a heartbeat; it ends when the heartbeat stops, at `maxSeconds`, on
     * disconnect, by `release()`, by force-expiry or, with `allowTakeover`, when a newer lease overlaps it (`onLost`
     * says which). The older form `lease(group, { keys })` is `lease({ group, publish: keys })`.
     */
    lease(options: LeaseOptions): Promise<Lease>;
    lease(group: string, options?: {
        keys?: string[];
        maxSeconds?: number;
    }): Promise<Lease>;
    /** Ends another client's lease on `group` (needs the grant's forceExpire right). */
    expireLease(group: string): Promise<void>;
    /** Polls gateway stats (and, without a heartbeat, clock sync) once; also runs on a timer while connected. */
    pollStats(): Promise<void>;
    _startStats(): void;
    close(): void;
}
/** Connects to a zenoh-gateway server, e.g. `await connect("http://robot.local:7448")`. */
export declare function connect(url: string, options?: ConnectOptions): Promise<ZenohGateway>;
/** Options of `put` / `delete` (and `publisher.delete`). */
export interface PutOptions {
    /** e.g. "text/plain" (put only) */
    encoding?: string;
    attachment?: Bytesish;
    /** zenoh priority, 1 (real time) to 7 (background) */
    priority?: number;
    congestionControl?: "drop" | "block";
    express?: boolean;
    /** the sample's timestamp: unix ms on this client's clock (converted to the gateway's) */
    timestamp?: number;
}
/** Options of `get` (and a `Querier`). */
export interface GetOptions {
    /** the selector's parameters ("a=1;b=2"); also allowed inline in the key after `?` */
    parameters?: string;
    payload?: Bytesish;
    encoding?: string;
    attachment?: Bytesish;
    target?: "bestMatching" | "all" | "allComplete";
    consolidation?: "auto" | "none" | "monotonic" | "latest";
    /** default 5000 */
    timeoutMs?: number;
    priority?: number;
    congestionControl?: "drop" | "block";
    express?: boolean;
}
export type MatchingTarget = "subscribers" | "queryables";
export interface SessionInfo {
    /** the gateway's zenoh id */
    zid: string;
    routers: string[];
    peers: string[];
}
/** Something declared on the gateway for this page; re-declared after a reconnect. */
interface ApiHandle {
    _declare(): Promise<void>;
}
/** Fixed-option queries on one key (`gateway.querier(key, options)`). */
export declare class Querier {
    readonly owner: ZenohGateway;
    readonly key: string;
    readonly options: GetOptions;
    constructor(owner: ZenohGateway, key: string, options: GetOptions);
    /** A query with the querier's options, plus these per-call ones. */
    get(options?: Pick<GetOptions, "parameters" | "payload" | "attachment" | "encoding">): Promise<GetReply[]>;
    /** Whether a queryable would answer now. */
    matchingStatus(): Promise<boolean>;
    matchingListener(callback: (matching: boolean) => void): Promise<MatchingListener>;
}
/** A query this page's `Queryable` received. */
export declare class Query {
    #private;
    readonly owner: ZenohGateway;
    readonly id: number;
    readonly key: string;
    readonly parameters: string;
    readonly payload: Uint8Array | undefined;
    readonly encoding: string | undefined;
    readonly attachment: Uint8Array | undefined;
    constructor(owner: ZenohGateway, id: number, key: string, parameters: string, payload: Uint8Array | undefined, encoding: string | undefined, attachment: Uint8Array | undefined);
    /** Replies with a sample on `key` (default: the query's key). Any number of replies, then `finalize()`. */
    reply(value: Bytesish, options?: {
        key?: string;
        encoding?: string;
        attachment?: Bytesish;
        timestamp?: number;
    }): Promise<void>;
    replyErr(value: Bytesish, options?: {
        encoding?: string;
    }): Promise<void>;
    /** Replies that `key` (default: the query's key) was deleted. */
    replyDel(options?: {
        key?: string;
        attachment?: Bytesish;
    }): Promise<void>;
    /** No more replies: the asker's get completes. (The gateway finalizes forgotten queries after two minutes.) */
    finalize(): Promise<void>;
}
/** Queries for this page to answer (`gateway.declareQueryable`). */
export declare class Queryable implements ApiHandle {
    #private;
    readonly owner: ZenohGateway;
    readonly key: string;
    readonly complete: boolean;
    readonly callback: (query: Query) => void;
    constructor(owner: ZenohGateway, key: string, complete: boolean, callback: (query: Query) => void);
    _declare(): Promise<void>;
    undeclare(): Promise<void>;
}
/** A liveliness token (`gateway.declareToken`). */
export declare class LivelinessToken implements ApiHandle {
    #private;
    readonly owner: ZenohGateway;
    readonly key: string;
    constructor(owner: ZenohGateway, key: string);
    _declare(): Promise<void>;
    undeclare(): Promise<void>;
}
/** Liveliness changes under a key (`gateway.livelinessSubscribe`). */
export declare class LivelinessSubscriber implements ApiHandle {
    #private;
    readonly owner: ZenohGateway;
    readonly key: string;
    readonly history: boolean;
    readonly callback: (change: {
        key: string;
        alive: boolean;
    }) => void;
    constructor(owner: ZenohGateway, key: string, history: boolean, callback: (change: {
        key: string;
        alive: boolean;
    }) => void);
    _declare(): Promise<void>;
    undeclare(): Promise<void>;
}
/** Matching changes (`gateway.matchingListener`). */
export declare class MatchingListener implements ApiHandle {
    #private;
    readonly owner: ZenohGateway;
    readonly key: string;
    readonly target: MatchingTarget;
    readonly callback: (matching: boolean) => void;
    constructor(owner: ZenohGateway, key: string, target: MatchingTarget, callback: (matching: boolean) => void);
    _declare(): Promise<void>;
    undeclare(): Promise<void>;
}
export {};
