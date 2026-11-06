import AVFoundation
import CoreMedia
import ScreenCaptureKit

struct RegionRect: Codable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double
}

struct RecordOptions: Codable {
    var output: String
    /// "display" | "window" | "region"
    var target: String
    var displayId: UInt32?
    var windowId: UInt32?
    /// Region in global points (top-left origin), as the overlay window measures it.
    var rect: RegionRect?
    var fps: Int
    /// "hevc" | "h264"
    var codec: String
    /// nil = native Retina pixels
    var maxWidth: Int?
    var maxHeight: Int?
    var bitsPerPixel: Double
    var bitrateMbps: Double?
    var systemAudio: Bool
    var microphoneId: String?
    var showCursor: Bool
    var showClicks: Bool
    /// Light voice cleanup (rumble filter + noise gate) on the microphone. Default off.
    var noiseReduction: Bool?
    var excludePid: Int32?
    /// Own windows that should appear in the video (the camera bubble).
    var includeWindowTitles: [String]?
    /// Space left on the disk when the recording is finalized: just enough to close the
    /// file safely and keep macOS working. Everything above it is used for the recording.
    var minFreeMB: Int?
}

/// ScreenCaptureKit → VideoToolbox (HEVC/H.264) → AVAssetWriter, in real time.
///
/// A recording only ends when the user stops it or the disk is full. Everything else is
/// survived: ScreenCaptureKit interruptions (sleep, lock, display changes) reconnect and
/// leave no gap, and a failing writer rolls over to "… (part 2)" without losing what was
/// already written.
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    /// Below this the disk is treated as full, whatever the app asked for.
    private static let hardReserveMB = 150

    private let opts: RecordOptions
    private let baseURL: URL
    private let queue = DispatchQueue(label: "camly.capture", qos: .userInteractive)

    private var stream: SCStream?
    private var config = SCStreamConfiguration()

    // Current segment. Swapped only on `queue`.
    private var url: URL
    private var writer: AVAssetWriter!
    private var videoInput: AVAssetWriterInput!
    private var systemAudioInput: AVAssetWriterInput?
    private var micInput: AVAssetWriterInput?
    private var voiceCleaner: VoiceCleaner?

    // Mutated only on `queue`.
    private var sessionStarted = false
    private var firstPTS = CMTime.zero
    private var lastPTS: [ObjectIdentifier: CMTime] = [:]
    /// User pause and capture interruptions are both "holds": no samples are written and the
    /// time spent held is cut out of the timeline.
    private var userPaused = false
    private var interrupted = false
    private var holdStartedAt = CMTime.invalid
    private var pauseOffset = CMTime.zero
    private var stopping = false
    private var writerBroken = false
    private var frames = 0
    private var segmentFrames = 0
    /// Recorded seconds in finished segments.
    private var carriedSeconds = 0.0
    private var segments: [URL] = []
    private var failedEmptySegments = 0

    private var width = 0
    private var height = 0
    private var ticker: DispatchSourceTimer?
    private var signalSources: [DispatchSourceSignal] = []
    private var activity: NSObjectProtocol?
    private let stopLock = NSLock()
    private var didStop = false
    private var reconnecting = false

    init(opts: RecordOptions) {
        self.opts = opts
        self.baseURL = URL(fileURLWithPath: opts.output)
        self.url = baseURL
        super.init()
    }

    private var isStopped: Bool { stopLock.withLock { didStop } }
    private var held: Bool { userPaused || interrupted }

    private var reserveBytes: Int64 {
        Int64(max(Self.hardReserveMB, opts.minFreeMB ?? 0)) * 1_048_576
    }

    // MARK: - Lifecycle

    func run() async {
        do {
            try await start()
        } catch {
            Out.fail(Self.describe(error), code: CGPreflightScreenCaptureAccess() ? "error" : "permission")
        }
        // Idle sleep (system or display) would interrupt the capture: keep the Mac awake and
        // opt out of App Nap for as long as we record.
        activity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiated, .idleSystemSleepDisabled, .idleDisplaySleepDisabled, .latencyCritical],
            reason: "Camly is recording the screen"
        )
        listenForCommands()
        installSignalHandlers()
        startTicker()
    }

    private func start() async throws {
        guard CGPreflightScreenCaptureAccess() else {
            _ = CGRequestScreenCaptureAccess()
            throw RecorderError.permission
        }
        let wantsMic = opts.microphoneId != nil
        if wantsMic, AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .audio)
        }

        let resolved = try await resolve()
        let filter = resolved.filter
        let sourceRect = resolved.sourceRect

        // Points → Retina pixels → fitted into the quality preset's box.
        let scale = Double(filter.pointPixelScale)
        let pointSize = sourceRect?.size ?? filter.contentRect.size
        (width, height) = Encoding.fit(
            width: Double(pointSize.width) * scale,
            height: Double(pointSize.height) * scale,
            maxWidth: opts.maxWidth,
            maxHeight: opts.maxHeight
        )

        config.width = width
        config.height = height
        if let sourceRect { config.sourceRect = sourceRect }
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(max(1, opts.fps)))
        config.queueDepth = 6
        config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        config.colorMatrix = CGDisplayStream.yCbCrMatrix_ITU_R_709_2
        config.colorSpaceName = CGColorSpace.sRGB
        config.showsCursor = opts.showCursor
        config.showMouseClicks = opts.showClicks
        config.capturesAudio = opts.systemAudio
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48_000
        config.channelCount = 2
        if let mic = opts.microphoneId {
            config.captureMicrophone = true
            config.microphoneCaptureDeviceID = mic.isEmpty ? nil : mic
            if opts.noiseReduction ?? false { voiceCleaner = VoiceCleaner() }
        }

        try installWriter(at: url)
        segments = [url]
        try await startStream(filter: filter)

        Out.emit([
            "event": "started",
            "path": url.path,
            "width": width,
            "height": height,
            "fps": opts.fps,
            "codec": opts.codec,
            "noiseReduction": voiceCleaner != nil,
        ])
    }

    private func resolve() async throws -> (filter: SCContentFilter, sourceRect: CGRect?) {
        let resolved = try await resolveTarget(
            target: opts.target, displayId: opts.displayId, windowId: opts.windowId, rect: opts.rect,
            excludePid: opts.excludePid, includeWindowTitles: opts.includeWindowTitles
        )
        return (resolved.filter, resolved.sourceRect)
    }

    private func startStream(filter: SCContentFilter) async throws {
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        if config.capturesAudio {
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        }
        if config.captureMicrophone {
            try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue)
        }
        try await stream.startCapture()
        self.stream = stream
    }

    /// Builds a writer for `target` and makes it current. Call before capture starts or on `queue`.
    private func installWriter(at target: URL) throws {
        try? FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: target)

        let writer = try AVAssetWriter(outputURL: target, fileType: Encoding.fileType(for: target))
        // Fragments every few seconds: a crash, power loss or full disk still leaves a playable file.
        writer.movieFragmentInterval = CMTime(seconds: 5, preferredTimescale: 600)

        let bitrate = Encoding.bitrate(
            width: width, height: height, fps: opts.fps,
            bitsPerPixel: opts.bitsPerPixel, overrideMbps: opts.bitrateMbps
        )
        let video = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: Encoding.videoSettings(
                codec: opts.codec, width: width, height: height, fps: opts.fps, bitrate: bitrate, resize: false
            )
        )
        video.expectsMediaDataInRealTime = true
        guard writer.canAdd(video) else { throw RecorderError.message("The video encoder is not available.") }
        writer.add(video)

        var systemAudio: AVAssetWriterInput?
        if opts.systemAudio {
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: Encoding.audioSettings(channels: 2, bitrate: 160_000))
            input.expectsMediaDataInRealTime = true
            if writer.canAdd(input) { writer.add(input); systemAudio = input }
        }
        var mic: AVAssetWriterInput?
        if opts.microphoneId != nil {
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: Encoding.audioSettings(channels: 1, bitrate: 96_000))
            input.expectsMediaDataInRealTime = true
            if writer.canAdd(input) { writer.add(input); mic = input }
        }

        guard writer.startWriting() else {
            throw RecorderError.message(writer.error?.localizedDescription ?? "Could not create the output file.")
        }

        self.url = target
        self.writer = writer
        self.videoInput = video
        self.systemAudioInput = systemAudio
        self.micInput = mic
        sessionStarted = false
        lastPTS = [:]
        segmentFrames = 0
        writerBroken = false
    }

    // MARK: - Samples

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard !stopping, !writerBroken, sampleBuffer.isValid else { return }
        if writer.status == .failed {
            writerFailed()
            return
        }
        switch type {
        case .screen:
            appendVideo(sampleBuffer)
        case .audio:
            appendAudio(sampleBuffer, to: systemAudioInput)
        case .microphone:
            appendAudio(voiceCleaner?.process(sampleBuffer) ?? sampleBuffer, to: micInput)
        @unknown default:
            break
        }
    }

    private func appendVideo(_ sampleBuffer: CMSampleBuffer) {
        guard !held, Self.isCompleteFrame(sampleBuffer), let buffer = retimed(sampleBuffer) else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(buffer)
        guard pts.isValid else { return }
        if !sessionStarted {
            writer.startSession(atSourceTime: pts)
            firstPTS = pts
            sessionStarted = true
        }
        guard videoInput.isReadyForMoreMediaData, advances(videoInput, to: pts) else { return }
        if videoInput.append(buffer) {
            frames += 1
            segmentFrames += 1
        }
    }

    private func appendAudio(_ sampleBuffer: CMSampleBuffer, to input: AVAssetWriterInput?) {
        guard let input, sessionStarted, !held,
              let buffer = retimed(sampleBuffer),
              case let pts = CMSampleBufferGetPresentationTimeStamp(buffer),
              pts.isValid, pts >= firstPTS,
              input.isReadyForMoreMediaData,
              advances(input, to: pts) else { return }
        input.append(buffer)
    }

    /// AVAssetWriter fails the whole file on a timestamp that goes backwards (it happens
    /// around pauses and reconnects), so such samples are dropped instead.
    private func advances(_ input: AVAssetWriterInput, to pts: CMTime) -> Bool {
        let key = ObjectIdentifier(input)
        if let last = lastPTS[key], pts <= last { return false }
        lastPTS[key] = pts
        return true
    }

    private static func isCompleteFrame(_ sampleBuffer: CMSampleBuffer) -> Bool {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
                as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int,
              let status = SCFrameStatus(rawValue: raw) else { return false }
        return status == .complete
    }

    /// Shifts timestamps back by the total held time so pauses and interruptions leave no gap.
    private func retimed(_ sampleBuffer: CMSampleBuffer) -> CMSampleBuffer? {
        guard pauseOffset > .zero else { return sampleBuffer }
        var count: CMItemCount = 0
        CMSampleBufferGetSampleTimingInfoArray(sampleBuffer, entryCount: 0, arrayToFill: nil, entriesNeededOut: &count)
        guard count > 0 else { return sampleBuffer }
        var timing = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: count)
        CMSampleBufferGetSampleTimingInfoArray(sampleBuffer, entryCount: count, arrayToFill: &timing, entriesNeededOut: &count)
        for i in 0..<count {
            timing[i].presentationTimeStamp = CMTimeSubtract(timing[i].presentationTimeStamp, pauseOffset)
            if timing[i].decodeTimeStamp.isValid {
                timing[i].decodeTimeStamp = CMTimeSubtract(timing[i].decodeTimeStamp, pauseOffset)
            }
        }
        var out: CMSampleBuffer?
        CMSampleBufferCreateCopyWithNewTiming(
            allocator: kCFAllocatorDefault,
            sampleBuffer: sampleBuffer,
            sampleTimingEntryCount: count,
            sampleTimingArray: &timing,
            sampleBufferOut: &out
        )
        return out
    }

    // MARK: - Holds (pause / interruption)

    private func hostNow() -> CMTime {
        CMClockGetTime(CMClockGetHostTimeClock())
    }

    /// Applies a pause/interruption change and keeps the timeline gap-free. Call on `queue`.
    private func updateHold(_ change: () -> Void) {
        let wasHeld = held
        change()
        if !wasHeld && held {
            holdStartedAt = hostNow()
        } else if wasHeld && !held {
            if holdStartedAt.isValid {
                pauseOffset = CMTimeAdd(pauseOffset, CMTimeSubtract(hostNow(), holdStartedAt))
            }
            holdStartedAt = .invalid
        }
    }

    func setPaused(_ value: Bool) {
        queue.async {
            guard self.userPaused != value else { return }
            self.updateHold { self.userPaused = value }
            Out.emit(["event": value ? "paused" : "resumed"])
        }
    }

    /// Seconds of recorded media so far (holds excluded). Call on `queue`.
    private func elapsedOnQueue() -> Double {
        guard sessionStarted else { return carriedSeconds }
        let now = held && holdStartedAt.isValid ? holdStartedAt : hostNow()
        return carriedSeconds + max(0, CMTimeGetSeconds(CMTimeSubtract(CMTimeSubtract(now, pauseOffset), firstPTS)))
    }

    // MARK: - Recovery

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        let code = (error as NSError).code
        // The user ended the capture from macOS's own screen-recording menu: honour it.
        if code == SCStreamError.Code.userStopped.rawValue {
            Task { await self.stop(reason: "systemStopped") }
            return
        }
        queue.async { self.updateHold { self.interrupted = true } }
        Out.emit([
            "event": "warning", "code": "interrupted",
            "message": "Capture was interrupted (\(Self.describe(error))). Reconnecting…",
        ])
        Task { await self.reconnect() }
    }

    /// Restarts ScreenCaptureKit until it works again or the user stops. The file stays open.
    private func reconnect() async {
        let begin = stopLock.withLock { () -> Bool in
            if didStop || reconnecting { return false }
            reconnecting = true
            return true
        }
        guard begin else { return }
        defer { stopLock.withLock { reconnecting = false } }

        var attempt = 0
        while !isStopped {
            attempt += 1
            try? await Task.sleep(nanoseconds: UInt64(min(5.0, 0.5 * Double(attempt)) * 1_000_000_000))
            if isStopped { return }
            degradeAudio(after: attempt)
            do {
                let resolved = try await resolve()
                if let rect = resolved.sourceRect { config.sourceRect = rect }
                try await startStream(filter: resolved.filter)
                queue.async { self.updateHold { self.interrupted = false } }
                Out.emit(["event": "recovered", "attempts": attempt])
                return
            } catch {
                if attempt == 1 || attempt % 30 == 0 {
                    Out.emit([
                        "event": "warning", "code": "reconnecting",
                        "message": "Still waiting for the screen (\(Self.describe(error))).",
                    ])
                }
            }
        }
    }

    /// A vanished audio device (AirPods, USB mic) can keep ScreenCaptureKit from restarting.
    /// The picture matters most: fall back to the default mic, then drop audio sources.
    private func degradeAudio(after attempt: Int) {
        var message: String?
        if attempt == 3, config.captureMicrophone, config.microphoneCaptureDeviceID != nil {
            config.microphoneCaptureDeviceID = nil
            message = "The selected microphone is unavailable — using the default microphone."
        } else if attempt == 6, config.captureMicrophone {
            config.captureMicrophone = false
            message = "No microphone is available — recording continues without it."
        } else if attempt == 9, config.capturesAudio {
            config.capturesAudio = false
            message = "System audio is unavailable — recording continues without it."
        }
        if let message { Out.emit(["event": "warning", "code": "audioFallback", "message": message]) }
    }

    /// The writer died (encoder reset after wake, I/O error…): keep what it wrote and carry on
    /// in a new part. Call on `queue`.
    private func writerFailed() {
        guard !writerBroken, !stopping else { return }
        writerBroken = true
        let failedURL = url
        let failedWriter = writer!
        let keptFrames = segmentFrames
        if sessionStarted, let last = lastPTS[ObjectIdentifier(videoInput)] {
            carriedSeconds += max(0, CMTimeGetSeconds(CMTimeSubtract(last, firstPTS)))
        }
        Out.emit([
            "event": "warning", "code": "writer",
            "message": failedWriter.error?.localizedDescription ?? "Write failed",
        ])

        // Fragmented files stay playable up to the last fragment; drop one that holds nothing.
        failedWriter.cancelWriting()
        if keptFrames == 0 {
            try? FileManager.default.removeItem(at: failedURL)
            segments.removeAll { $0 == failedURL }
            failedEmptySegments += 1
        } else {
            failedEmptySegments = 0
        }

        let free = Disk.freeBytes(at: baseURL.deletingLastPathComponent())
        if free >= 0 && free < reserveBytes {
            Task { await self.stop(reason: "lowDisk") }
            return
        }
        if failedEmptySegments >= 3 {
            Task { await self.stop(reason: "writeFailed") }
            return
        }

        let next = Self.partURL(base: baseURL, part: segments.count + 1)
        do {
            try installWriter(at: next)
            segments.append(next)
            Out.emit(["event": "segment", "path": next.path, "part": segments.count])
        } catch {
            Task { await self.stop(reason: "writeFailed") }
        }
    }

    /// "Camly 2026-… .mp4" → "Camly 2026-… (part 2).mp4"
    private static func partURL(base: URL, part: Int) -> URL {
        let dir = base.deletingLastPathComponent()
        let stem = base.deletingPathExtension().lastPathComponent
        let ext = base.pathExtension
        var candidate = dir.appendingPathComponent("\(stem) (part \(part)).\(ext)")
        var n = part
        while FileManager.default.fileExists(atPath: candidate.path) {
            n += 1
            candidate = dir.appendingPathComponent("\(stem) (part \(n)).\(ext)")
        }
        return candidate
    }

    // MARK: - Stop

    func stop(reason: String = "user") async {
        let alreadyStopping = stopLock.withLock { () -> Bool in
            defer { didStop = true }
            return didStop
        }
        if alreadyStopping { return }

        ticker?.cancel()
        if let stream { try? await stream.stopCapture() }

        // Drain the capture queue, then freeze state.
        let (started, broken, end, seconds): (Bool, Bool, CMTime, Double) = queue.sync {
            stopping = true
            let now = held && holdStartedAt.isValid ? holdStartedAt : hostNow()
            var end = CMTimeSubtract(now, pauseOffset)
            if let last = lastPTS[ObjectIdentifier(videoInput)], end <= last {
                end = CMTimeAdd(last, CMTime(value: 1, timescale: 30))
            }
            if end <= firstPTS { end = CMTimeAdd(firstPTS, CMTime(value: 1, timescale: 30)) }
            return (sessionStarted, writerBroken, end, elapsedOnQueue())
        }

        if broken {
            // A writer that failed was already cancelled and its part kept or removed.
        } else if started && segmentFrames > 0 {
            videoInput.markAsFinished()
            systemAudioInput?.markAsFinished()
            micInput?.markAsFinished()
            writer.endSession(atSourceTime: end)
            await writer.finishWriting()
            if writer.status != .completed {
                // The fragments already on disk still play; report it but keep the file.
                Out.emit([
                    "event": "warning", "code": "finalize",
                    "message": "The last seconds may be missing: \(writer.error?.localizedDescription ?? "unknown error")",
                ])
            }
        } else {
            writer.cancelWriting()
            try? FileManager.default.removeItem(at: url)
            segments.removeAll { $0 == url }
        }

        let kept = segments.filter { Disk.fileSize($0) > 0 }
        if let activity { ProcessInfo.processInfo.endActivity(activity) }
        guard let first = kept.first else {
            Out.fail("No frames were captured. Check Screen Recording permission for Camly.", code: "empty")
        }

        Out.emit([
            "event": "stopped",
            "path": first.path,
            "parts": kept.map(\.path),
            "seconds": seconds,
            "bytes": kept.reduce(Int64(0)) { $0 + Disk.fileSize($1) },
            "width": width,
            "height": height,
            "frames": frames,
            "reason": reason,
        ])
        exit(0)
    }

    // MARK: - Plumbing

    /// stdin lines from the app: "stop", "pause", "resume". EOF (app quit) also stops.
    private func listenForCommands() {
        Thread.detachNewThread { [weak self] in
            while let line = readLine() {
                switch line.trimmingCharacters(in: .whitespacesAndNewlines) {
                case "stop":
                    Task { await self?.stop() }
                    return
                case "pause": self?.setPaused(true)
                case "resume": self?.setPaused(false)
                default: break
                }
            }
            Task { await self?.stop(reason: "appClosed") }
        }
    }

    private func installSignalHandlers() {
        for sig in [SIGINT, SIGTERM, SIGHUP] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .global())
            source.setEventHandler { [weak self] in Task { await self?.stop(reason: "signal") } }
            source.resume()
            signalSources.append(source)
        }
    }

    private func startTicker() {
        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.resume()
        ticker = timer
    }

    private func tick() {
        let (seconds, isPaused, isInterrupted, current, done): (Double, Bool, Bool, [URL], Bool) = queue.sync {
            (elapsedOnQueue(), userPaused, interrupted, segments, stopping)
        }
        if done { return }
        let free = Disk.freeBytes(at: baseURL.deletingLastPathComponent())
        Out.emit([
            "event": "progress",
            "seconds": seconds,
            "bytes": current.reduce(Int64(0)) { $0 + Disk.fileSize($1) },
            "paused": isPaused || isInterrupted,
            "interrupted": isInterrupted,
            "freeBytes": free,
        ])
        // The only automatic stop: the disk is really full. The file is closed while there
        // is still room to do it, so nothing recorded is lost.
        if free >= 0 && free < reserveBytes {
            Out.emit(["event": "warning", "code": "lowDisk", "message": "The disk is full — the recording was stopped and saved."])
            Task { await self.stop(reason: "lowDisk") }
        }
    }

    static func describe(_ error: Error) -> String {
        if let e = error as? RecorderError { return e.message }
        return error.localizedDescription
    }
}

enum RecorderError: Error {
    case permission
    case message(String)

    var message: String {
        switch self {
        case .permission:
            return "Camly needs Screen Recording permission. Open System Settings → Privacy & Security → Screen & System Audio Recording, enable Camly, then try again."
        case .message(let m):
            return m
        }
    }
}
