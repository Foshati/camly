import AVFoundation
import VideoToolbox

/// Shared encoder settings for live recording and for "compress a video".
enum Encoding {
    /// Scales (width, height) down to fit inside the max box, keeping aspect ratio.
    /// Encoders need even dimensions.
    static func fit(width: Double, height: Double, maxWidth: Int?, maxHeight: Int?) -> (Int, Int) {
        var w = width, h = height
        if let mw = maxWidth, let mh = maxHeight, mw > 0, mh > 0 {
            // Fit the long edge to the long edge so portrait regions are not crushed.
            let boxLong = Double(max(mw, mh)), boxShort = Double(min(mw, mh))
            let long = max(w, h), short = min(w, h)
            let factor = min(1.0, min(boxLong / long, boxShort / short))
            w *= factor
            h *= factor
        }
        return (even(w), even(h))
    }

    static func even(_ v: Double) -> Int {
        let i = max(2, Int(v.rounded()))
        return i - (i % 2)
    }

    /// Target average bitrate. Screen content is mostly static and ScreenCaptureKit only
    /// delivers changed frames, so real files land far below this ceiling.
    static func bitrate(width: Int, height: Int, fps: Int, bitsPerPixel: Double, overrideMbps: Double?) -> Int {
        if let mbps = overrideMbps, mbps > 0 { return Int(mbps * 1_000_000) }
        let raw = Double(width * height * max(fps, 1)) * bitsPerPixel
        return max(600_000, Int(raw))
    }

    static func videoSettings(codec: String, width: Int, height: Int, fps: Int, bitrate: Int, resize: Bool) -> [String: Any] {
        let hevc = codec != "h264"
        var compression: [String: Any] = [
            AVVideoAverageBitRateKey: bitrate,
            AVVideoExpectedSourceFrameRateKey: fps,
            AVVideoMaxKeyFrameIntervalKey: fps * 2,
            AVVideoMaxKeyFrameIntervalDurationKey: 2,
        ]
        if !hevc {
            // HEVC defaults to Main profile; only H.264 needs High for good compression.
            compression[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel
        }

        var settings: [String: Any] = [
            AVVideoCodecKey: hevc ? AVVideoCodecType.hevc : AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoColorPropertiesKey: [
                AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
            ],
            AVVideoCompressionPropertiesKey: compression,
        ]
        if resize {
            settings[AVVideoScalingModeKey] = AVVideoScalingModeResizeAspect
        }
        return settings
    }

    static func audioSettings(channels: Int, bitrate: Int) -> [String: Any] {
        [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: channels,
            AVEncoderBitRateKey: bitrate,
        ]
    }

    static func fileType(for url: URL) -> AVFileType {
        url.pathExtension.lowercased() == "mov" ? .mov : .mp4
    }
}

