import AppKit

// Render the existing favicon geometry as a native app icon.
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
let transform = NSAffineTransform()
transform.translateX(by: 0, yBy: 1024)
transform.scaleX(by: 32, yBy: -32)
transform.concat()
NSColor(srgbRed: 0x13 / 255.0, green: 0x85 / 255.0, blue: 0x62 / 255.0, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: 32, height: 32), xRadius: 8, yRadius: 8).fill()
NSColor.white.setStroke()
let bubble = NSBezierPath()
bubble.move(to: NSPoint(x: 8, y: 8))
for point in [(24, 8), (24, 20), (14, 20), (9, 24), (9, 20), (8, 20)] {
  bubble.line(to: NSPoint(x: point.0, y: point.1))
}
bubble.close()
bubble.lineWidth = 1.7
bubble.lineJoinStyle = .round
bubble.stroke()
let lines = NSBezierPath()
lines.move(to: NSPoint(x: 12, y: 12))
lines.line(to: NSPoint(x: 20, y: 12))
lines.move(to: NSPoint(x: 12, y: 16))
lines.line(to: NSPoint(x: 18, y: 16))
lines.lineWidth = 1.7
lines.lineCapStyle = .round
lines.stroke()
image.unlockFocus()
guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
      let data = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]) else {
    fatalError("Could not render the Echo icon")
}
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
