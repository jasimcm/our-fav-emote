// Cuts the person out of every frame in a folder using macOS Vision.
// Keeps only the largest foreground subject (drops watermarks / stray objects).
// Usage: segment [--raw] <inDir> <outDir>
//   --raw  Vision's cut-out only: no backdrop-colour clean-up (for photos with arbitrary backgrounds)
// Writes <outDir>/<frame>.png (RGBA, same size as input) and <outDir>/stats.jsonl
// (one {"f":name,"box":[minX,minY,maxX,maxY],"legsX":cx} per frame, top-left origin).
import AppKit
import CoreImage
import Foundation
import Vision

var args = CommandLine.arguments
let rawOnly = args.contains("--raw")
args.removeAll { $0 == "--raw" }
guard args.count == 3 else { print("usage: segment [--raw] <inDir> <outDir>"); exit(1) }
let inDir = URL(fileURLWithPath: args[1]), outDir = URL(fileURLWithPath: args[2])
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let files = try FileManager.default.contentsOfDirectory(atPath: inDir.path).filter { $0.hasSuffix(".png") }.sorted()
let ctx = CIContext()
var stats = ""

/// Index of the largest instance in Vision's instance-label buffer.
func largestInstance(_ obs: VNInstanceMaskObservation) -> Int? {
  let buf = obs.instanceMask
  CVPixelBufferLockBaseAddress(buf, .readOnly)
  defer { CVPixelBufferUnlockBaseAddress(buf, .readOnly) }
  let w = CVPixelBufferGetWidth(buf), h = CVPixelBufferGetHeight(buf), row = CVPixelBufferGetBytesPerRow(buf)
  let p = CVPixelBufferGetBaseAddress(buf)!.assumingMemoryBound(to: UInt8.self)
  var counts = [Int](repeating: 0, count: 256)
  for y in 0..<h { for x in 0..<w { counts[Int(p[y * row + x])] += 1 } }
  counts[0] = 0
  let best = counts.indices.max { counts[$0] < counts[$1] }!
  return counts[best] > 0 ? best : nil
}

/// Bounding box of alpha > 32 and the mean x of the bottom 35% (legs: stable while arms move).
func measure(_ cg: CGImage) -> (box: [Int], legsX: Double)? {
  let w = cg.width, h = cg.height
  var a = [UInt8](repeating: 0, count: w * h)
  let c = CGContext(data: &a, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                    space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.alphaOnly.rawValue)!
  c.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
  var minX = w, minY = h, maxX = -1, maxY = -1
  for y in 0..<h { for x in 0..<w where a[y * w + x] > 32 {
    minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
  } }
  if maxX < 0 { return nil }
  let legTop = maxY - Int(Double(maxY - minY) * 0.35)
  var sum = 0.0, n = 0.0
  for y in legTop...maxY { for x in minX...maxX where a[y * w + x] > 32 { sum += Double(x); n += 1 } }
  return ([minX, minY, maxX, maxY], n > 0 ? sum / n : Double(minX + maxX) / 2)
}

/// Colour difference that ignores brightness: distance in an opponent-colour plane
/// (blue vs yellow, green vs red). A saturated backdrop is far from skin, a pale tee or grey shoes,
/// but close to its own darker (vignetted) or lighter shades.
struct Chroma {
  let cb: Double, cg: Double
  init(_ r: Double, _ g: Double, _ b: Double) { cb = b - (r + g) / 2; cg = g - r }
  func dist(_ o: Chroma) -> Double { ((cb - o.cb) * (cb - o.cb) + (cg - o.cg) * (cg - o.cg)).squareRoot() }
  var magnitude: Double { (cb * cb + cg * cg).squareRoot() }
}

/// Edge clean-up: within `band` px of the cut-out's edge, pixels close to the backdrop colour fade out
/// (colour-difference key) and lose the backdrop tint. Colours deeper inside (blue shoe accents) are untouched.
func cleanEdges(_ cg: CGImage, backdrop bg: (Double, Double, Double), band: Int = 4) -> CGImage {
  let w = cg.width, h = cg.height
  guard let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else { return cg }
  c.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
  let p = c.data!.assumingMemoryBound(to: UInt8.self)
  var near = [Bool](repeating: false, count: w * h)
  for i in 0..<(w * h) where p[i * 4 + 3] < 250 { near[i] = true }
  for _ in 0..<band {
    var grown = near
    for y in 1..<(h - 1) { for x in 1..<(w - 1) where !near[y * w + x] {
      let i = y * w + x
      if near[i - 1] || near[i + 1] || near[i - w] || near[i + w] { grown[i] = true }
    } }
    near = grown
  }
  for i in 0..<(w * h) where near[i] && p[i * 4 + 3] > 0 {
    let a = Double(p[i * 4 + 3])
    var r = Double(p[i * 4]) * 255 / a, g = Double(p[i * 4 + 1]) * 255 / a, b = Double(p[i * 4 + 2]) * 255 / a
    let bgc = Chroma(bg.0, bg.1, bg.2)
    let d = Chroma(r, g, b).dist(bgc)
    let keep = min(1, max(0, (d - 0.3 * bgc.magnitude) / (0.5 * bgc.magnitude))) // 0 = backdrop, 1 = subject
    // remove tint. Skin, hair, clothes here all have blue <= max(red, green); a cyan/green
    // backdrop additionally pushes green above red, which olive cloth only does slightly
    if bg.2 > bg.0 { b = min(b, max(r, g)) }
    if bg.1 > bg.0 + 40 { g = min(g, r * 1.15 + 10) }
    let lum = 0.3 * r + 0.59 * g + 0.11 * b
    r = lum + (r - lum) * keep; g = lum + (g - lum) * keep; b = lum + (b - lum) * keep
    let na = a * keep
    p[i * 4] = UInt8(min(255, r * na / 255)); p[i * 4 + 1] = UInt8(min(255, g * na / 255))
    p[i * 4 + 2] = UInt8(min(255, b * na / 255)); p[i * 4 + 3] = UInt8(na)
  }
  return c.makeImage() ?? cg
}

/// Median colour of the frame border = the backdrop.
func backdropColor(_ cg: CGImage) -> (Double, Double, Double) {
  let w = cg.width, h = cg.height
  let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  c.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
  let p = c.data!.assumingMemoryBound(to: UInt8.self)
  var rs = [Double](), gs = [Double](), bs = [Double]()
  func add(_ x: Int, _ y: Int) { let i = (y * w + x) * 4; rs.append(Double(p[i])); gs.append(Double(p[i + 1])); bs.append(Double(p[i + 2])) }
  for x in stride(from: 0, to: w, by: 4) { add(x, 2) }
  for y in stride(from: 0, to: h * 3 / 4, by: 4) { add(2, y); add(w - 3, y) }
  let med = { (a: [Double]) in a.sorted()[a.count / 2] }
  return (med(rs), med(gs), med(bs))
}

/// Vision keeps backdrop that is enclosed by the body (the gap between arm and torso).
/// Clear connected areas of backdrop colour inside the cut-out (tiny specks of 40px or fewer stay).
func clearEnclosedBackdrop(_ cg: CGImage, backdrop bg: (Double, Double, Double), minArea: Int = 40) -> CGImage {
  let w = cg.width, h = cg.height
  guard let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else { return cg }
  c.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
  let p = c.data!.assumingMemoryBound(to: UInt8.self)
  let bgc = Chroma(bg.0, bg.1, bg.2)
  var cand = [Bool](repeating: false, count: w * h)
  for i in 0..<(w * h) {
    let a = Double(p[i * 4 + 3])
    if a < 8 { continue }
    let r = Double(p[i * 4]) * 255 / a, g = Double(p[i * 4 + 1]) * 255 / a, b = Double(p[i * 4 + 2]) * 255 / a
    cand[i] = Chroma(r, g, b).dist(bgc) < 0.5 * bgc.magnitude
  }
  var seen = [Bool](repeating: false, count: w * h)
  var stack = [Int](), region = [Int]()
  for start in 0..<(w * h) where cand[start] && !seen[start] {
    region.removeAll(keepingCapacity: true)
    stack.append(start); seen[start] = true
    while let i = stack.popLast() {
      region.append(i)
      let x = i % w, y = i / w
      for (nx, ny) in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)] where nx >= 0 && ny >= 0 && nx < w && ny < h {
        let j = ny * w + nx
        if cand[j] && !seen[j] { seen[j] = true; stack.append(j) }
      }
    }
    if region.count >= minArea { for i in region { p[i * 4] = 0; p[i * 4 + 1] = 0; p[i * 4 + 2] = 0; p[i * 4 + 3] = 0 } }
  }
  return c.makeImage() ?? cg
}

for (i, f) in files.enumerated() {
  autoreleasepool {
    guard let img = CIImage(contentsOf: inDir.appendingPathComponent(f)) else { return }
    let req = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(ciImage: img)
    var line = "{\"f\":\"\(f)\",\"box\":null}"
    if (try? handler.perform([req])) != nil, let obs = req.results?.first, let inst = largestInstance(obs),
       let buf = try? obs.generateMaskedImage(ofInstances: IndexSet(integer: inst), from: handler, croppedToInstancesExtent: false) {
      let ci = CIImage(cvPixelBuffer: buf)
      if let raw = ctx.createCGImage(ci, from: ci.extent) {
        let src = ctx.createCGImage(img, from: img.extent)!
        let bg = backdropColor(src)
        let cg = rawOnly ? raw : cleanEdges(clearEnclosedBackdrop(raw, backdrop: bg), backdrop: bg)
        try? NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])!
          .write(to: outDir.appendingPathComponent(f))
        if let m = measure(cg) {
          line = "{\"f\":\"\(f)\",\"box\":[\(m.box.map(String.init).joined(separator: ","))],\"legsX\":\(String(format: "%.1f", m.legsX))}"
        }
      }
    }
    stats += line + "\n"
    if i % 24 == 0 { print("  segmented \(i + 1)/\(files.count)") }
  }
}
try stats.write(to: outDir.appendingPathComponent("stats.jsonl"), atomically: true, encoding: .utf8)
print("  done: \(files.count) frames")
