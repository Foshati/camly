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
    /// Auto-stop (and finalize the file) when free disk space drops below this.
    var minFreeMB: Int?
}

/// ScreenCaptureKit → VideoToolbox (HEVC/H.264) → AVAssetWriter, in real time.
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private let opts: RecordOptions
    private let url: URL
    private let queue = DispatchQueue(label: "camly.capture", qos: .userInteractive)

    private var stream: SCStream?
    private var writer: AVAssetWriter!
    private var videoInput: AVAssetWriterInput!
    private var systemAudioInput: AVAssetWriterInput?
    private var micInput: AVAssetWriterInput?
    private var voiceCleaner: VoiceCleaner?

    // Mutated only on `queue`.
    private var sessionStarted = false
    private var firstPTS = CMTime.zero
    private var paused = false
    private var pauseStartedAt = CMTime.invalid
    private var pauseOffset = CMTime.zero
    private var stopping = false
    private var frames = 0

    private var width = 0
    private var height = 0
    private var ticker: DispatchSourceTimer?
    private var signalSources: [DispatchSourceSignal] = []
    private let stopLock = NSLock()
    private var didStop = false

    init(opts: RecordOptions) {
        self.opts = opts
        self.url = URL(fileURLWithPath: opts.output)
        super.init()
    }

    // MARK: - Lifecycle

    func run() async {
        do {
            try await start()
        } catch {
            Out.fail(Self.describe(error), code: CGPreflightScreenCaptureAccess() ? "error" : "permission")
        }
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

        let resolved = try await resolveTarget(
            target: opts.target, displayId: opts.displayId, windowId: opts.windowId, rect: opts.rect,
            excludePid: opts.excludePid, includeWindowTitles: opts.includeWindowTitles
        )
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

        let config = SCStreamConfiguration()
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

        try setupWriter()

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        if opts.systemAudio {
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        }
        if wantsMic {
            try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue)
        }
        try await stream.startCapture()
        self.stream = stream

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

    private func setupWriter() throws {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: url)

        writer = try AVAssetWriter(outputURL: url, fileType: Encoding.fileType(for: url))
        // Fragments every few seconds: a crash, power loss or full disk still leaves a playable file.
        writer.movieFragmentInterval = CMTime(seconds: 5, preferredTimescale: 600)

        let bitrate = Encoding.bitrate(
            width: width, height: height, fps: opts.fps,
            bitsPerPixel: opts.bitsPerPixel, overrideMbps: opts.bitrateMbps
        )
        videoInput = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: Encoding.videoSettings(
                codec: opts.codec, width: width, height: height, fps: opts.fps, bitrate: bitrate, resize: false
            )
        )
        videoInput.expectsMediaDataInRealTime = true
        guard writer.canAdd(videoInput) else { throw RecorderError.message("The video encoder is not available.") }
        writer.add(videoInput)

        if opts.systemAudio {
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: Encoding.audioSettings(channels: 2, bitrate: 160_000))
            input.expectsMediaDataInRealTime = true
            if writer.canAdd(input) { writer.add(input); systemAudioInput = input }
        }
        if opts.microphoneId != nil {
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: Encoding.audioSettings(channels: 1, bitrate: 96_000))
            input.expectsMediaDataInRealTime = true
            if writer.canAdd(input) { writer.add(input); micInput = input }
        }

        guard writer.startWriting() else {
            throw RecorderError.message(writer.error?.localizedDescription ?? "Could not create the output file.")
        }
    }

    // MARK: - Samples

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard !stopping, sampleBuffer.isValid else { return }
        if writer.status == .failed {
            Out.emit(["event": "warning", "code": "writer", "message": writer.error?.localizedDescription ?? "Write failed"])
            Task { await self.stop(reason: "writeFailed") }
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
        guard !paused, Self.isCompleteFrame(sampleBuffer) else { return }
        if !sessionStarted {
            firstPTS = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            writer.startSession(atSourceTime: firstPTS)
            sessionStarted = true
        }
        guard let buffer = retimed(sampleBuffer), videoInput.isReadyForMoreMediaData else { return }
        if videoInput.append(buffer) { frames += 1 }
    }

    private func appendAudio(_ sampleBuffer: CMSampleBuffer, to input: AVAssetWriterInput?) {
        guard let input, sessionStarted, !paused,
              let buffer = retimed(sampleBuffer),
              CMSampleBufferGetPresentationTimeStamp(buffer) >= firstPTS,
              input.isReadyForMoreMediaData else { return }
        input.append(buffer)
    }

    private static func isCompleteFrame(_ sampleBuffer: CMSampleBuffer) -> Bool {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
                as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int,
              let status = SCFrameStatus(rawValue: raw) else { return false }
        return status == .complete
    }

    /// Shifts timestamps back by the total paused time so pauses leave no gap.
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

    // MARK: - Control

    private func hostNow() -> CMTime {
        CMClockGetTime(CMClockGetHostTimeClock())
    }

    func setPaused(_ value: Bool) {
        queue.async {
            guard self.paused != value else { return }
            if value {
                self.pauseStartedAt = self.hostNow()
                self.paused = true
            } else {
                if self.pauseStartedAt.isValid {
                    self.pauseOffset = CMTimeAdd(self.pauseOffset, CMTimeSubtract(self.hostNow(), self.pauseStartedAt))
                }
                self.pauseStartedAt = .invalid
                self.paused = false
            }
            Out.emit(["event": value ? "paused" : "resumed"])
        }
    }

    /// Seconds of recorded media so far (pauses excluded). Call on `queue`.
    private func elapsedOnQueue() -> Double {
        guard sessionStarted else { return 0 }
        let now = paused && pauseStartedAt.isValid ? pauseStartedAt : hostNow()
        return max(0, CMTimeGetSeconds(CMTimeSubtract(CMTimeSubtract(now, pauseOffset), firstPTS)))
    }

    func stop(reason: String = "user") async {
        let alreadyStopping = stopLock.withLock { () -> Bool in
            defer { didStop = true }
            return didStop
        }
        if alreadyStopping { return }

        ticker?.cancel()
        if let stream { try? await stream.stopCapture() }

        // Drain the capture queue, then freeze state.
        let (started, end, seconds): (Bool, CMTime, Double) = queue.sync {
            stopping = true
            let now = paused && pauseStartedAt.isValid ? pauseStartedAt : hostNow()
            var end = CMTimeSubtract(now, pauseOffset)
            if end <= firstPTS { end = CMTimeAdd(firstPTS, CMTime(value: 1, timescale: 30)) }
            return (sessionStarted, end, elapsedOnQueue())
        }

        guard started else {
            writer.cancelWriting()
            try? FileManager.default.removeItem(at: url)
            Out.fail("No frames were captured. Check Screen Recording permission for Camly.", code: "empty")
        }

        videoInput.markAsFinished()
        systemAudioInput?.markAsFinished()
        micInput?.markAsFinished()
        writer.endSession(atSourceTime: end)
        await writer.finishWriting()

        guard writer.status == .completed else {
            Out.fail("Could not finish the file: \(writer.error?.localizedDescription ?? "unknown error")")
        }

        Out.emit([
            "event": "stopped",
            "path": url.path,
            "seconds": seconds,
            "bytes": Disk.fileSize(url),
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
        for sig in [SIGINT, SIGTERM] {
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
        let (seconds, isPaused): (Double, Bool) = queue.sync { (elapsedOnQueue(), paused) }
        let free = Disk.freeBytes(at: url.deletingLastPathComponent())
        Out.emit([
            "event": "progress",
            "seconds": seconds,
            "bytes": Disk.fileSize(url),
            "paused": isPaused,
            "freeBytes": free,
        ])
        if let minMB = opts.minFreeMB, minMB > 0, free >= 0, free < Int64(minMB) * 1_048_576 {
            Out.emit(["event": "warning", "code": "lowDisk", "message": "Disk almost full — recording was stopped and saved."])
            Task { await self.stop(reason: "lowDisk") }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        Out.emit(["event": "warning", "code": "streamStopped", "message": Self.describe(error)])
        Task { await self.stop(reason: "streamStopped") }
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

