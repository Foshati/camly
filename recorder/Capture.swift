import CoreGraphics
import ScreenCaptureKit

struct CaptureTarget {
    let filter: SCContentFilter
    /// Display-local rectangle in points (region mode only).
    let sourceRect: CGRect?
    let isWindow: Bool
}

/// Shared by recording and screenshots: turns "display | window | region" into a content filter.
/// Our own windows are excluded, except those whose title is listed (e.g. the camera bubble).
func resolveTarget(
    target: String,
    displayId: UInt32?,
    windowId: UInt32?,
    rect: RegionRect?,
    excludePid: Int32?,
    includeWindowTitles: [String]?
) async throws -> CaptureTarget {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)

    let ownApps = content.applications.filter { app in
        guard let pid = excludePid else { return false }
        return app.processID == pid
    }
    let keepTitles = Set(includeWindowTitles ?? [])
    let keepWindows = content.windows.filter { w in
        guard let pid = excludePid, let app = w.owningApplication, app.processID == pid,
              let title = w.title else { return false }
        return keepTitles.contains(title)
    }

    func mainDisplay() -> SCDisplay? {
        content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first
    }

    switch target {
    case "window":
        guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
            throw RecorderError.message("That window is no longer available.")
        }
        return CaptureTarget(filter: SCContentFilter(desktopIndependentWindow: window), sourceRect: nil, isWindow: true)

    case "region":
        guard let r = rect, r.width >= 8, r.height >= 8 else {
            throw RecorderError.message("Select a larger area.")
        }
        let global = CGRect(x: r.x, y: r.y, width: r.width, height: r.height)
        let center = CGPoint(x: global.midX, y: global.midY)
        guard let display = content.displays.first(where: { CGDisplayBounds($0.displayID).contains(center) }) ?? mainDisplay() else {
            throw RecorderError.message("No display found.")
        }
        let bounds = CGDisplayBounds(display.displayID)
        let local = global.offsetBy(dx: -bounds.origin.x, dy: -bounds.origin.y)
            .intersection(CGRect(origin: .zero, size: bounds.size))
        guard !local.isNull, local.width >= 8, local.height >= 8 else {
            throw RecorderError.message("The selected area is outside the screen.")
        }
        let filter = SCContentFilter(display: display, excludingApplications: ownApps, exceptingWindows: keepWindows)
        return CaptureTarget(filter: filter, sourceRect: local, isWindow: false)

    default:
        guard let display = content.displays.first(where: { $0.displayID == displayId }) ?? mainDisplay() else {
            throw RecorderError.message("No display found.")
        }
        let filter = SCContentFilter(display: display, excludingApplications: ownApps, exceptingWindows: keepWindows)
        return CaptureTarget(filter: filter, sourceRect: nil, isWindow: false)
    }
}

