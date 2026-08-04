#!/usr/bin/env swift

import CoreGraphics
import Darwin
import Foundation
import ImageIO
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(("[ERROR] " + message + "\n").utf8))
    exit(1)
}

func normalizedBox(_ box: CGRect) -> [String: Double] {
    [
        "x": Double(box.minX),
        "y": Double(1.0 - box.maxY),
        "width": Double(box.width),
        "height": Double(box.height),
    ]
}

guard CommandLine.arguments.count == 2 else {
    fail("Usage: macos-vision-ocr.swift <image-path>")
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let imageSource = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
    fail("Unable to decode the image")
}

let textRequest = VNRecognizeTextRequest()
textRequest.recognitionLevel = .accurate
textRequest.usesLanguageCorrection = true

if #available(macOS 13.0, *) {
    textRequest.automaticallyDetectsLanguage = true
}

do {
    if let supportedLanguages = try? textRequest.supportedRecognitionLanguages() {
        let preferredLanguages = ["zh-Hans", "zh-Hant", "en-US"]
        let selectedLanguages = preferredLanguages.filter { supportedLanguages.contains($0) }
        if !selectedLanguages.isEmpty {
            textRequest.recognitionLanguages = selectedLanguages
        }
    }

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([textRequest])

    let items: [[String: Any]] = (textRequest.results ?? [])
        .sorted {
            let verticalDifference = abs($0.boundingBox.midY - $1.boundingBox.midY)
            if verticalDifference > 0.02 {
                return $0.boundingBox.midY > $1.boundingBox.midY
            }
            return $0.boundingBox.minX < $1.boundingBox.minX
        }
        .compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else {
                return nil
            }
            return [
                "text": candidate.string,
                "confidence": Double(candidate.confidence),
                "box": normalizedBox(observation.boundingBox),
            ]
        }

    let result: [String: Any] = [
        "backend": "macos-vision",
        "width": image.width,
        "height": image.height,
        "items": items,
    ]
    let data = try JSONSerialization.data(withJSONObject: result, options: [])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    fail("Vision OCR failed")
}
