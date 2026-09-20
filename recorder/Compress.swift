import AVFoundation

struct CompressOptions: Codable {
    var input: String
    var output: String
    var codec: String
    var maxWidth: Int?
    var maxHeight: Int?
    var bitsPerPixel: Double
    var bitrateMbps: Double?
}

/// Re-encodes any video (e.g. a Cmd+Shift+5 .mov) with the same compact settings the
/// recorder uses. All audio tracks are mixed into one AAC track.
func compress(_ o: CompressOptions) async {
    let inputURL = URL(fileURLWithPath: o.input)
    let outputURL = URL(fileURLWithPath: o.output)
    let asset = AVURLAsset(url: inputURL)

    do {
        guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else {
            Out.fail("This file has no video track.")
        }
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        let duration = CMTimeGetSeconds(try await asset.load(.duration))
        let (natural, transform, nominalFPS) = try await videoTrack.load(.naturalSize, .preferredTransform, .nominalFrameRate)

        let fps = nominalFPS >= 1 ? min(60, Int(nominalFPS.rounded())) : 30
        let (width, height) = Encoding.fit(
            width: Double(abs(natural.width)), height: Double(abs(natural.height)),
            maxWidth: o.maxWidth, maxHeight: o.maxHeight
        )
        let bitrate = Encoding.bitrate(width: width, height: height, fps: min(fps, 30),
                                       bitsPerPixel: o.bitsPerPixel, overrideMbps: o.bitrateMbps)

        let reader = try AVAssetReader(asset: asset)
        let videoOut = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
        ])
        videoOut.alwaysCopiesSampleData = false
        reader.add(videoOut)

        var audioOut: AVAssetReaderAudioMixOutput?
        if !audioTracks.isEmpty {
            let mix = AVAssetReaderAudioMixOutput(audioTracks: audioTracks, audioSettings: [AVFormatIDKey: kAudioFormatLinearPCM])
            if reader.canAdd(mix) { reader.add(mix); audioOut = mix }
        }

        try? FileManager.default.removeItem(at: outputURL)
        let writer = try AVAssetWriter(outputURL: outputURL, fileType: Encoding.fileType(for: outputURL))
        writer.shouldOptimizeForNetworkUse = true

        let videoIn = AVAssetWriterInput(mediaType: .video, outputSettings: Encoding.videoSettings(
            codec: o.codec, width: width, height: height, fps: fps, bitrate: bitrate, resize: true
        ))
        videoIn.transform = transform
        writer.add(videoIn)

        var audioIn: AVAssetWriterInput?
        if audioOut != nil {
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: Encoding.audioSettings(channels: 2, bitrate: 128_000))
            if writer.canAdd(input) { writer.add(input); audioIn = input }
        }

        guard reader.startReading() else { Out.fail(reader.error?.localizedDescription ?? "Could not read the file.") }
        guard writer.startWriting() else { Out.fail(writer.error?.localizedDescription ?? "Could not write the file.") }
        writer.startSession(atSourceTime: .zero)

        Out.emit(["event": "started", "width": width, "height": height, "duration": duration])

        let group = DispatchGroup()
        let progressLock = NSLock()
        var lastReported = -1.0

        func pump(_ output: AVAssetReaderOutput, into input: AVAssetWriterInput, label: String, reportsProgress: Bool) {
            group.enter()
            var finished = false
            input.requestMediaDataWhenReady(on: DispatchQueue(label: "camly.compress.\(label)")) {
                while input.isReadyForMoreMediaData && !finished {
                    guard let sample = output.copyNextSampleBuffer() else {
                        finished = true
                        input.markAsFinished()
                        group.leave()
                        return
                    }
                    input.append(sample)
                    if reportsProgress, duration > 0 {
                        let t = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
                        let p = min(1, max(0, t / duration))
                        progressLock.lock()
                        if p - lastReported >= 0.01 {
                            lastReported = p
                            Out.emit(["event": "progress", "progress": p])
                        }
                        progressLock.unlock()
                    }
                }
            }
        }

        pump(videoOut, into: videoIn, label: "video", reportsProgress: true)
        if let audioOut, let audioIn {
            pump(audioOut, into: audioIn, label: "audio", reportsProgress: false)
        }

        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            group.notify(queue: .global()) { c.resume() }
        }

        if reader.status == .failed {
            writer.cancelWriting()
            Out.fail(reader.error?.localizedDescription ?? "Reading the video failed.")
        }
        await writer.finishWriting()
        guard writer.status == .completed else {
            Out.fail(writer.error?.localizedDescription ?? "Writing the video failed.")
        }

        Out.emit([
            "event": "done",
            "output": outputURL.path,
            "inputBytes": Disk.fileSize(inputURL),
            "outputBytes": Disk.fileSize(outputURL),
            "seconds": duration,
            "width": width,
            "height": height,
        ])
    } catch {
        Out.fail(error.localizedDescription)
    }
}
