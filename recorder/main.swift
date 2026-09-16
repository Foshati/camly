import Foundation
import CoreGraphics

// camly-capture — native capture helper for the Camly Tauri app.
//
//   camly-capture list     '{"excludePid":123,"path":"/Users/me/Movies/Camly"}'
//   camly-capture record   '<RecordOptions JSON>'   (stdin: stop | pause | resume)
//   camly-capture screenshot '<ShotOptions JSON>'
//   camly-capture compress '<CompressOptions JSON>'
//
// Every result is a JSON object per line on stdout.

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    Out.fail("usage: camly-capture <list|record|compress> [json]")
}
let payload = Data((arguments.count >= 3 ? arguments[2] : "{}").utf8)

func decode<T: Decodable>(_ type: T.Type) -> T {
    do {
        return try JSONDecoder().decode(T.self, from: payload)
    } catch {
        Out.fail("Invalid options: \(error)")
    }
}

var activeRecorder: Recorder?

switch arguments[1] {
case "list":
    let options = decode(ListOptions.self)
    // Never leave the toolbar waiting: a pending permission prompt can stall ScreenCaptureKit.
    DispatchQueue.global().asyncAfter(deadline: .now() + 8) {
        Out.emit([
            "event": "sources", "screenPermission": CGPreflightScreenCaptureAccess(),
            "displays": [], "windows": [], "microphones": [],
            "error": "Timed out reading screens and windows — check Screen Recording permission.",
        ])
        exit(0)
    }
    Task {
        await listSources(options)
        exit(0)
    }
case "record":
    let recorder = Recorder(opts: decode(RecordOptions.self))
    activeRecorder = recorder
    Task { await recorder.run() }
case "screenshot":
    let options = decode(ShotOptions.self)
    Task {
        await takeScreenshot(options)
        exit(0)
    }
case "permissions":
    let options = decode(PermissionOptions.self)
    Task {
        await handlePermissions(options)
        exit(0)
    }
case "compress":
    let options = decode(CompressOptions.self)
    Task {
        await compress(options)
        exit(0)
    }
default:
    Out.fail("Unknown command \(arguments[1])")
}

dispatchMain()
