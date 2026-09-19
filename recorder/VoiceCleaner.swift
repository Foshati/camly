import AVFoundation
import CoreMedia

/// Real-time voice cleanup on microphone buffers: rumble high-pass + adaptive noise gate.
/// It only ever attenuates background noise between words (to ~-18 dB); speech passes
/// untouched, so it can never mute the recording.
final class VoiceCleaner {
    private struct Biquad {
        var b0: Float = 1, b1: Float = 0, b2: Float = 0, a1: Float = 0, a2: Float = 0
        var z1: Float = 0, z2: Float = 0

        static func highPass(frequency: Double, sampleRate: Double, q: Double = 0.707) -> Biquad {
            let w0 = 2 * Double.pi * frequency / sampleRate
            let alpha = sin(w0) / (2 * q)
            let cosw = cos(w0)
            let a0 = 1 + alpha
            var f = Biquad()
            f.b0 = Float((1 + cosw) / 2 / a0)
            f.b1 = Float(-(1 + cosw) / a0)
            f.b2 = Float((1 + cosw) / 2 / a0)
            f.a1 = Float(-2 * cosw / a0)
            f.a2 = Float((1 - alpha) / a0)
            return f
        }

        mutating func process(_ x: Float) -> Float {
            let y = b0 * x + z1
            z1 = b1 * x - a1 * y + z2
            z2 = b2 * x - a2 * y
            return y
        }
    }

    private var filters: [Biquad] = []
    private var sampleRate: Double = 0
    private var envelope: Float = 0
    private var noiseFloor: Float = 0.003
    private var gain: Float = 1
    private let floorGain: Float = 0.125   // ≈ -18 dB between words

    /// Returns a cleaned copy, or the original buffer if its format isn't 32-bit float PCM.
    func process(_ sample: CMSampleBuffer) -> CMSampleBuffer {
        guard let format = CMSampleBufferGetFormatDescription(sample),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(format) else { return sample }
        let asbd = asbdPtr.pointee
        let isFloat = asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0
        guard asbd.mFormatID == kAudioFormatLinearPCM, isFloat, asbd.mBitsPerChannel == 32 else { return sample }
        let frames = CMSampleBufferGetNumSamples(sample)
        guard frames > 0 else { return sample }

        let channels = Int(max(1, asbd.mChannelsPerFrame))
        let nonInterleaved = asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
        if sampleRate != asbd.mSampleRate || filters.count != channels {
            sampleRate = asbd.mSampleRate
            filters = Array(repeating: .highPass(frequency: 85, sampleRate: sampleRate), count: channels)
        }

        // Pull the PCM into a buffer list we own.
        var blockBuffer: CMBlockBuffer?
        let listSize = MemoryLayout<AudioBufferList>.size + max(0, channels - 1) * MemoryLayout<AudioBuffer>.size
        let rawList = UnsafeMutableRawPointer.allocate(byteCount: listSize, alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { rawList.deallocate() }
        let list = rawList.bindMemory(to: AudioBufferList.self, capacity: 1)
        guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sample, bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: listSize,
            blockBufferAllocator: kCFAllocatorDefault, blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &blockBuffer
        ) == noErr else { return sample }

        let buffers = UnsafeMutableAudioBufferListPointer(list)
        let attack = Float(1 - exp(-1 / (0.002 * sampleRate)))
        let release = Float(1 - exp(-1 / (0.060 * sampleRate)))
        let open = Float(1 - exp(-1 / (0.004 * sampleRate)))
        let close = Float(1 - exp(-1 / (0.180 * sampleRate)))
        let floorRise = Float(1 - exp(-1 / (3.0 * sampleRate)))
        let floorFall = Float(1 - exp(-1 / (0.15 * sampleRate)))

        func sampleAt(_ ch: Int, _ i: Int) -> UnsafeMutablePointer<Float>? {
            if nonInterleaved {
                guard ch < buffers.count, let data = buffers[ch].mData else { return nil }
                return data.assumingMemoryBound(to: Float.self) + i
            }
            guard let data = buffers[0].mData else { return nil }
            return data.assumingMemoryBound(to: Float.self) + i * channels + ch
        }

        for i in 0..<frames {
            var peak: Float = 0
            for ch in 0..<channels {
                guard let p = sampleAt(ch, i) else { continue }
                let y = filters[ch].process(p.pointee)
                p.pointee = y
                peak = max(peak, abs(y))
            }
            envelope += (peak - envelope) * (peak > envelope ? attack : release)
            noiseFloor += (envelope - noiseFloor) * (envelope < noiseFloor ? floorFall : floorRise)
            noiseFloor = min(max(noiseFloor, 0.0004), 0.05)

            let ratio = envelope / noiseFloor
            let target: Float = ratio >= 4 ? 1 : ratio <= 1.8 ? floorGain : floorGain + (1 - floorGain) * (ratio - 1.8) / 2.2
            gain += (target - gain) * (target > gain ? open : close)
            for ch in 0..<channels {
                sampleAt(ch, i)?.pointee *= gain
            }
        }

        // New sample buffer with the cleaned PCM and the original timing.
        var timing = CMSampleTimingInfo()
        CMSampleBufferGetSampleTimingInfo(sample, at: 0, timingInfoOut: &timing)
        timing.duration = CMTime(value: 1, timescale: CMTimeScale(sampleRate))
        var out: CMSampleBuffer?
        guard CMSampleBufferCreate(
            allocator: kCFAllocatorDefault, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil,
            refcon: nil, formatDescription: format, sampleCount: frames, sampleTimingEntryCount: 1,
            sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &out
        ) == noErr, let out,
        CMSampleBufferSetDataBufferFromAudioBufferList(
            out, blockBufferAllocator: kCFAllocatorDefault, blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0, bufferList: list
        ) == noErr else { return sample }
        return out
    }
}
