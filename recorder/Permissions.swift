import AVFoundation
import CoreGraphics

struct PermissionOptions: Codable {
    /// "screen" | "microphone" | "camera" — nil just reports status.
    var request: String?
}

private func status(_ type: AVMediaType) -> String {
    switch AVCaptureDevice.authorizationStatus(for: type) {
    case .authorized: return "granted"
    case .denied, .restricted: return "denied"
    case .notDetermined: return "unknown"
    @unknown default: return "unknown"
    }
}

/// Reports (and optionally requests) Screen Recording, Microphone and Camera access.
/// Runs inside the app bundle, so macOS attributes every prompt to Camly.
func handlePermissions(_ o: PermissionOptions) async {
    switch o.request {
    case "screen":
        if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
    case "microphone":
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .audio)
        }
    case "camera":
        if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .video)
        }
    default:
        break
    }
    Out.emit([
        "event": "permissions",
        "screen": CGPreflightScreenCaptureAccess() ? "granted" : "denied",
        "microphone": status(.audio),
        "camera": status(.video),
    ])
}

