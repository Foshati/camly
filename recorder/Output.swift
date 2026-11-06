import Foundation

/// Line-delimited JSON on stdout is the only channel back to the Tauri app.
enum Out {
    private static let lock = NSLock()

    static func emit(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let line = String(data: data, encoding: .utf8) else { return }
        lock.lock()
        defer { lock.unlock() }
        // Plain write(2): if the app is gone, FileHandle.write would raise and kill us before
        // the recording is finalized. Errors are ignored; stdin EOF stops us cleanly instead.
        var bytes = Array((line + "\n").utf8)
        var offset = 0
        while offset < bytes.count {
            let n = bytes.withUnsafeMutableBytes { write(STDOUT_FILENO, $0.baseAddress! + offset, $0.count - offset) }
            if n > 0 { offset += n } else if n < 0 && errno == EINTR { continue } else { return }
        }
    }

    static func fail(_ message: String, code: String = "error") -> Never {
        emit(["event": "error", "code": code, "message": message])
        exit(1)
    }
}

enum Disk {
    /// Space a recording can still use: what Finder shows as available (includes purgeable
    /// space macOS frees on demand), falling back to the raw free count.
    static func freeBytes(at url: URL) -> Int64 {
        let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeAvailableCapacityKey])
        if let important = values?.volumeAvailableCapacityForImportantUsage, important > 0 { return important }
        if let raw = values?.volumeAvailableCapacity { return Int64(raw) }
        return -1
    }

    static func fileSize(_ url: URL) -> Int64 {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs?[.size] as? NSNumber)?.int64Value ?? 0
    }
}
