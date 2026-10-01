import AVFoundation
import CoreGraphics
import ImageIO
import Foundation
// usage: encodeav <frames-dir> <fps> <audio.wav|-> <out.mp4> [bitrate]
// H.264 High video from numbered JPEG frames, AAC 192 kbps audio from a WAV.
let a = CommandLine.arguments
let dir = URL(fileURLWithPath: a[1]); let fps = Int32(a[2])!; let audioPath = a[3]; let out = URL(fileURLWithPath: a[4])
let bitrate = a.count > 5 ? Int(a[5])! : 16_000_000
let files = try! FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil).filter { $0.pathExtension == "jpg" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
func load(_ u: URL) -> CGImage { let s = CGImageSourceCreateWithURL(u as CFURL, nil)!; return CGImageSourceCreateImageAtIndex(s, 0, nil)! }
let first = load(files[0]); let W = first.width, H = first.height
try? FileManager.default.removeItem(at: out)
let writer = try! AVAssetWriter(outputURL: out, fileType: .mp4)
let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: bitrate, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalKey: Int(fps) * 2]])
vIn.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: vIn, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H])
writer.add(vIn)
var aIn: AVAssetWriterInput? = nil
var reader: AVAssetReader? = nil
var aOut: AVAssetReaderTrackOutput? = nil
if audioPath != "-" {
  let asset = AVURLAsset(url: URL(fileURLWithPath: audioPath))
  let track = asset.tracks(withMediaType: .audio)[0]
  reader = try! AVAssetReader(asset: asset)
  aOut = AVAssetReaderTrackOutput(track: track, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false])
  reader!.add(aOut!)
  let ain = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 192000])
  ain.expectsMediaDataInRealTime = false
  writer.add(ain); aIn = ain
  reader!.startReading()
}
writer.startWriting(); writer.startSession(atSourceTime: .zero)
let group = DispatchGroup()
let vq = DispatchQueue(label: "v"), aq = DispatchQueue(label: "a")
var idx = 0
group.enter()
vIn.requestMediaDataWhenReady(on: vq) {
  while vIn.isReadyForMoreMediaData {
    if idx >= files.count { vIn.markAsFinished(); group.leave(); return }
    var pb: CVPixelBuffer?; CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
    let buf = pb!; CVPixelBufferLockBaseAddress(buf, [])
    let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: W, height: H, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
    ctx.draw(load(files[idx]), in: CGRect(x: 0, y: 0, width: W, height: H))
    CVPixelBufferUnlockBaseAddress(buf, [])
    adaptor.append(buf, withPresentationTime: CMTime(value: CMTimeValue(idx), timescale: fps))
    idx += 1
  }
}
if let ain = aIn, let ao = aOut {
  group.enter()
  ain.requestMediaDataWhenReady(on: aq) {
    while ain.isReadyForMoreMediaData {
      if let sb = ao.copyNextSampleBuffer() { ain.append(sb) } else { ain.markAsFinished(); group.leave(); return }
    }
  }
}
group.wait()
let sem = DispatchSemaphore(value: 0); writer.finishWriting { sem.signal() }; sem.wait()
print("wrote \(files.count) frames \(W)x\(H) @\(fps)fps\(aIn != nil ? " + AAC audio" : "") -> \(out.path) status \(writer.status.rawValue) \(writer.error?.localizedDescription ?? "")")
