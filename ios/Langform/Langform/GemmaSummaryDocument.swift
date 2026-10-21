import Foundation

enum GemmaSummaryDocumentError: Error {
    case unexpectedFields
    case invalidText
    case invalidEvidence
    case invalidPointCount
    case invalidRole
}

/// A complete answer with source IDs attached to every claim. Structural and
/// ID validation does not establish that the source entails the claim's text.
struct GemmaSummaryDocument: Codable {
    struct Claim: Codable {
        let text: String
        let evidenceIDs: [Int]

        private enum CodingKeys: String, CodingKey { case text, evidenceIDs }

        init(text: String, evidenceIDs: [Int]) {
            self.text = text
            self.evidenceIDs = evidenceIDs
        }

        init(from decoder: Decoder) throws {
            try GemmaSummaryDocument.requireFields(["text", "evidenceIDs"], in: decoder)
            let container = try decoder.container(keyedBy: CodingKeys.self)
            text = try container.decode(String.self, forKey: .text)
            evidenceIDs = try container.decode([Int].self, forKey: .evidenceIDs)
        }

        fileprivate func validate(allowedEvidenceIDs: Set<Int>) throws {
            guard !text.isEmpty,
                  text == text.trimmingCharacters(in: .whitespacesAndNewlines),
                  text.rangeOfCharacter(from: .newlines) == nil else {
                throw GemmaSummaryDocumentError.invalidText
            }
            let lower = text.lowercased()
            guard !text.hasPrefix("#"), !text.contains("```"), !text.hasPrefix("~~~"),
                  !lower.contains("<think"), !lower.contains("</think"),
                  !lower.contains("<|") else {
                throw GemmaSummaryDocumentError.invalidText
            }
            guard (1...3).contains(evidenceIDs.count),
                  Set(evidenceIDs).count == evidenceIDs.count,
                  evidenceIDs.allSatisfy({ $0 > 0 && allowedEvidenceIDs.contains($0) }) else {
                throw GemmaSummaryDocumentError.invalidEvidence
            }
        }
    }

    struct Point: Codable {
        let role: String
        let text: String
        let evidenceIDs: [Int]

        private enum CodingKeys: String, CodingKey { case role, text, evidenceIDs }

        init(from decoder: Decoder) throws {
            try GemmaSummaryDocument.requireFields(["role", "text", "evidenceIDs"], in: decoder)
            let container = try decoder.container(keyedBy: CodingKeys.self)
            role = try container.decode(String.self, forKey: .role)
            text = try container.decode(String.self, forKey: .text)
            evidenceIDs = try container.decode([Int].self, forKey: .evidenceIDs)
        }

        var claim: Claim { Claim(text: text, evidenceIDs: evidenceIDs) }

        fileprivate func validate(allowedEvidenceIDs: Set<Int>) throws {
            guard ["positive", "critical", "main"].contains(role) else {
                throw GemmaSummaryDocumentError.invalidRole
            }
            try claim.validate(allowedEvidenceIDs: allowedEvidenceIDs)
        }
    }

    let tldr: Claim
    let points: [Point]
    let takeaway: Claim

    private enum CodingKeys: String, CodingKey { case tldr, points, takeaway }

    init(from decoder: Decoder) throws {
        try Self.requireFields(["tldr", "points", "takeaway"], in: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        tldr = try container.decode(Claim.self, forKey: .tldr)
        points = try container.decode([Point].self, forKey: .points)
        takeaway = try container.decode(Claim.self, forKey: .takeaway)
    }

    static func decode(_ output: String, allowedEvidenceIDs: Set<Int>) throws -> Self {
        let document = try JSONDecoder().decode(Self.self, from: Data(output.utf8))
        guard (1...5).contains(document.points.count) else {
            throw GemmaSummaryDocumentError.invalidPointCount
        }
        // Validate every field before returning any part of the document.
        try document.tldr.validate(allowedEvidenceIDs: allowedEvidenceIDs)
        for point in document.points { try point.validate(allowedEvidenceIDs: allowedEvidenceIDs) }
        try document.takeaway.validate(allowedEvidenceIDs: allowedEvidenceIDs)
        return document
    }

    static func schema(allowedEvidenceIDs: [Int]) throws -> String {
        guard !allowedEvidenceIDs.isEmpty, allowedEvidenceIDs.allSatisfy({ $0 > 0 }) else {
            throw GemmaSummaryDocumentError.invalidEvidence
        }
        let ids = Array(Set(allowedEvidenceIDs)).sorted()
        let idData = try JSONSerialization.data(withJSONObject: ids)
        let idJSON = String(decoding: idData, as: UTF8.self)
        // Explicit property order makes the first complete streamed field the
        // TLDR. A dictionary serialized with sortedKeys would put points first.
        let claim = #"{"type":"object","properties":{"text":{"type":"string","minLength":1},"evidenceIDs":{"type":"array","items":{"type":"integer","enum":\#(idJSON)},"minItems":1,"maxItems":3}},"required":["text","evidenceIDs"],"additionalProperties":false}"#
        let point = #"{"type":"object","properties":{"role":{"type":"string","enum":["positive","critical","main"]},"text":{"type":"string","minLength":1},"evidenceIDs":{"type":"array","items":{"type":"integer","enum":\#(idJSON)},"minItems":1,"maxItems":3}},"required":["role","text","evidenceIDs"],"additionalProperties":false}"#
        return #"{"type":"object","properties":{"tldr":\#(claim),"points":{"type":"array","items":\#(point),"minItems":1,"maxItems":5},"takeaway":\#(claim)},"required":["tldr","points","takeaway"],"additionalProperties":false}"#
    }

    var markdown: String {
        "## TLDR\n" + tldr.text
            + "\n\n## Die wichtigsten Punkte\n" + points.map { "* " + $0.text }.joined(separator: "\n")
            + "\n\n## Das bleibt hängen\n" + takeaway.text
    }

    /// Only a fully closed, decoded and validated first TLDR claim can become
    /// a preview. Later fields remain unavailable until the document validates.
    static func preview(_ partialOutput: String, allowedEvidenceIDs: Set<Int>) -> String? {
        previewClaim(partialOutput, allowedEvidenceIDs: allowedEvidenceIDs)?.text
    }

    static func previewClaim(_ partialOutput: String, allowedEvidenceIDs: Set<Int>) -> Claim? {
        let bytes = Array(partialOutput.utf8)
        var cursor = 0
        skipWhitespace(bytes, cursor: &cursor)
        guard cursor < bytes.count, bytes[cursor] == 0x7B else { return nil } // {
        cursor += 1
        skipWhitespace(bytes, cursor: &cursor)
        let keyStart = cursor
        guard let keyEnd = quotedStringEnd(bytes, from: keyStart),
              let key = try? JSONDecoder().decode(String.self, from: Data(bytes[keyStart..<keyEnd])),
              key == "tldr" else { return nil }
        cursor = keyEnd
        skipWhitespace(bytes, cursor: &cursor)
        guard cursor < bytes.count, bytes[cursor] == 0x3A else { return nil } // :
        cursor += 1
        skipWhitespace(bytes, cursor: &cursor)
        let claimStart = cursor
        guard let claimEnd = objectEnd(bytes, from: claimStart),
              let claim = try? JSONDecoder().decode(Claim.self, from: Data(bytes[claimStart..<claimEnd])),
              (try? claim.validate(allowedEvidenceIDs: allowedEvidenceIDs)) != nil else { return nil }
        cursor = claimEnd
        skipWhitespace(bytes, cursor: &cursor)
        // If the next byte already proves the prefix invalid, show nothing.
        guard cursor == bytes.count || bytes[cursor] == 0x2C || bytes[cursor] == 0x7D else { return nil }
        return claim
    }

    private struct FieldKey: CodingKey {
        let stringValue: String
        let intValue: Int? = nil
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    private static func requireFields(_ expected: Set<String>, in decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: FieldKey.self)
        guard Set(container.allKeys.map(\.stringValue)) == expected else {
            throw GemmaSummaryDocumentError.unexpectedFields
        }
    }

    private static func skipWhitespace(_ bytes: [UInt8], cursor: inout Int) {
        while cursor < bytes.count, [0x20, 0x09, 0x0A, 0x0D].contains(bytes[cursor]) { cursor += 1 }
    }

    /// Returns the byte after a complete JSON string, accounting for escaped
    /// quotes and even/odd runs of backslashes. JSONDecoder validates escapes.
    private static func quotedStringEnd(_ bytes: [UInt8], from start: Int) -> Int? {
        guard start < bytes.count, bytes[start] == 0x22 else { return nil }
        var cursor = start + 1
        var escaped = false
        while cursor < bytes.count {
            let byte = bytes[cursor]
            if escaped { escaped = false }
            else if byte == 0x5C { escaped = true }
            else if byte == 0x22 { return cursor + 1 }
            cursor += 1
        }
        return nil
    }

    private static func objectEnd(_ bytes: [UInt8], from start: Int) -> Int? {
        guard start < bytes.count, bytes[start] == 0x7B else { return nil }
        var expectedClosers = [UInt8]()
        var cursor = start
        while cursor < bytes.count {
            let byte = bytes[cursor]
            if byte == 0x22 {
                guard let end = quotedStringEnd(bytes, from: cursor) else { return nil }
                cursor = end
                continue
            }
            if byte == 0x7B { expectedClosers.append(0x7D) }
            else if byte == 0x5B { expectedClosers.append(0x5D) }
            else if byte == 0x7D || byte == 0x5D {
                guard expectedClosers.popLast() == byte else { return nil }
                if expectedClosers.isEmpty { return cursor + 1 }
            }
            cursor += 1
        }
        return nil
    }
}
