import AppKit
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

struct ShotOptions: Codable {
    var output: String
    var target: String
    var displayId: UInt32?
    var windowId: UInt32?
    var rect: RegionRect?
    /// "png" | "jpg" | "heic"
    var format: String
    var showCursor: Bool
    var clipboard: Bool
    var excludePid: Int32?
}

/// Full-resolution (Retina) still of a display, window or region — the same engine as ⌘⇧4.
func takeScreenshot(_ o: ShotOptions) async {
    guard CGPreflightScreenCaptureAccess() else {
        _ = CGRequestScreenCaptureAccess()
        Out.fail(RecorderError.permission.message, code: "permission")
    }
    do {
        let target = try await resolveTarget(
            target: o.target, displayId: o.displayId, windowId: o.windowId, rect: o.rect,
            excludePid: o.excludePid, includeWindowTitles: nil
        )
        let scale = Double(target.filter.pointPixelScale)
        let points = target.sourceRect?.size ?? target.filter.contentRect.size

        let config = SCStreamConfiguration()
        config.width = max(2, Int((Double(points.width) * scale).rounded()))
        config.height = max(2, Int((Double(points.height) * scale).rounded()))
        if let r = target.sourceRect { config.sourceRect = r }
        config.showsCursor = o.showCursor
        config.captureResolution = .best
        config.ignoreShadowsSingleWindow = true
        config.shouldBeOpaque = !target.isWindow

        let image = try await SCScreenshotManager.captureImage(contentFilter: target.filter, configuration: config)

        let url = URL(fileURLWithPath: o.output)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard let data = encode(image, format: o.format, scale: scale) else {
            Out.fail("Could not encode the screenshot.")
        }
        try data.write(to: url, options: .atomic)

        if o.clipboard {
            let png = o.format == "png" ? data : (encode(image, format: "png", scale: scale) ?? data)
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setData(png, forType: .png)
        }

        Out.emit([
            "event": "shot",
            "path": url.path,
            "width": image.width,
            "height": image.height,
            "bytes": Disk.fileSize(url),
            "copied": o.clipboard,
        ])
    } catch {
        Out.fail(Recorder.describe(error))
    }
}

/// Encodes with Retina DPI metadata so Preview shows the image at its point size.
func encode(_ image: CGImage, format: String, scale: Double) -> Data? {
    let type: UTType = switch format {
    case "jpg": .jpeg
    case "heic": .heic
    default: .png
    }
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil) else { return nil }
    var props: [CFString: Any] = [
        kCGImagePropertyDPIWidth: 72 * scale,
        kCGImagePropertyDPIHeight: 72 * scale,
    ]
    if format != "png" { props[kCGImageDestinationLossyCompressionQuality] = 0.9 }
    CGImageDestinationAddImage(dest, image, props as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return data as Data
}

