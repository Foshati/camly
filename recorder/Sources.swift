import AppKit
import AVFoundation
import ScreenCaptureKit

struct ListOptions: Codable {
    var excludePid: Int32?
    var path: String?
}

/// Displays, windows and microphones the toolbar can offer, plus permission and disk state.
func listSources(_ opts: ListOptions) async {
    var result: [String: Any] = [:]

    let granted = CGPreflightScreenCaptureAccess()
    if !granted { _ = CGRequestScreenCaptureAccess() }
    result["screenPermission"] = granted

    result["microphones"] = microphones()
    result["microphonePermission"] = micPermission()

    if let path = opts.path {
        let url = URL(fileURLWithPath: path)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        result["freeBytes"] = Disk.freeBytes(at: url)
    }

    do {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        result["screenPermission"] = true
        result["displays"] = content.displays.map(describe)
        result["windows"] = content.windows
            .filter { w in
                guard let app = w.owningApplication else { return false }
                if let pid = opts.excludePid, app.processID == pid { return false }
                return w.windowLayer == 0 && w.frame.width >= 120 && w.frame.height >= 80
                    && !app.applicationName.isEmpty
            }
            .map { w -> [String: Any] in
                [
                    "id": w.windowID,
                    "title": w.title ?? "",
                    "app": w.owningApplication?.applicationName ?? "",
                    "bundleId": w.owningApplication?.bundleIdentifier ?? "",
                    "width": Int(w.frame.width),
                    "height": Int(w.frame.height),
                ]
            }
    } catch {
        result["displays"] = []
        result["windows"] = []
        result["error"] = error.localizedDescription
    }

    result["event"] = "sources"
    Out.emit(result)
}

private func describe(_ d: SCDisplay) -> [String: Any] {
    let mode = CGDisplayCopyDisplayMode(d.displayID)
    let screen = NSScreen.screens.first {
        ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == d.displayID
    }
    return [
        "id": d.displayID,
        "name": screen?.localizedName ?? "Display \(d.displayID)",
        "width": d.width,
        "height": d.height,
        "pixelWidth": mode?.pixelWidth ?? d.width,
        "pixelHeight": mode?.pixelHeight ?? d.height,
        "isMain": d.displayID == CGMainDisplayID(),
    ]
}

private func microphones() -> [[String: Any]] {
    let session = AVCaptureDevice.DiscoverySession(
        deviceTypes: [.microphone, .external],
        mediaType: .audio,
        position: .unspecified
    )
    let defaultId = AVCaptureDevice.default(for: .audio)?.uniqueID
    return session.devices.map {
        ["id": $0.uniqueID, "name": $0.localizedName, "isDefault": $0.uniqueID == defaultId]
    }
}

private func micPermission() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return "granted"
    case .denied, .restricted: return "denied"
    case .notDetermined: return "unknown"
    @unknown default: return "unknown"
    }
}
