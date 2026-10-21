import Foundation

enum GemmaEvidenceError: Error {
    case insufficient
    case malformed
    case ungrounded
}

/// The model selects IDs. Only the app can supply their original source text.
enum GemmaEvidence {
    static let maximumSelectedIDs = 10
    static let contextRadius = 2
    private static let roles = ["verdict", "positive", "critical", "context"]
    private static let roleLimits = ["verdict": 2, "positive": 2, "critical": 2, "context": 2]

    static func blocks(in source: String) -> [String] {
        let characters = Array(source)
        var blocks = [String]()
        var start = 0
        while start < characters.count {
            let limit = min(start + 450, characters.count)
            var end = limit
            if limit < characters.count {
                let candidates = (start + 220..<limit).reversed()
                if let boundary = candidates.first(where: { index in
                    characters[index].isWhitespace && ".!?\n".contains(characters[index - 1])
                }) ?? candidates.first(where: { characters[$0].isWhitespace }) {
                    end = boundary + 1
                }
            }
            blocks.append(String(characters[start..<end]))
            start = end
        }
        return blocks
    }

    static func numberedSource(_ source: String) -> String {
        blocks(in: source).enumerated().map { "[\($0.offset + 1)] " + $0.element }.joined(separator: "\n")
    }

    /// The model assigns roles only to actual source IDs. An entirely empty
    /// plan represents insufficient evidence; local validation requires a
    /// verdict for every nonempty plan.
    static func selectionSchema(for source: String) throws -> String {
        let ids = blocks(in: source).indices.map { $0 + 1 }
        // The grammar follows schema property order. Choose the overall
        // judgment before its supporting reasons and their necessary context.
        // Sorting a dictionary would instead make verdict the final decision.
        let fields = try roles.map { role -> String in
            let field: [String: Any] = ["type": "array", "items": ["type": "integer", "enum": ids],
                                       "minItems": 0, "maxItems": roleLimits[role]!]
            let data = try JSONSerialization.data(withJSONObject: field, options: [.sortedKeys])
            return "\"" + role + "\":" + String(decoding: data, as: UTF8.self)
        }.joined(separator: ",")
        return "{\"type\":\"object\",\"properties\":{" + fields
            + "},\"required\":[\"verdict\",\"positive\",\"critical\",\"context\"],\"additionalProperties\":false}"
    }

    /// No generated prose enters the writer: this plan contains source IDs
    /// only. JSONDecoder rejects booleans, strings, fractions and nested values.
    private static func selectedPlan(_ output: String, count: Int) throws -> [String: [Int]] {
        var text = output.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("```json\n"), text.hasSuffix("\n```") {
            text = String(text.dropFirst(8).dropLast(4))
        } else if text.hasPrefix("```\n"), text.hasSuffix("\n```") {
            text = String(text.dropFirst(4).dropLast(4))
        }
        guard let data = text.data(using: .utf8),
              let plan = try? JSONDecoder().decode([String: [Int]].self, from: data),
              Set(plan.keys) == Set(roles),
              roles.allSatisfy({ plan[$0]!.count <= roleLimits[$0]! }) else {
            throw GemmaEvidenceError.malformed
        }
        let ids = roles.flatMap { plan[$0]! }
        guard !ids.isEmpty else { throw GemmaEvidenceError.insufficient }
        guard !plan["verdict"]!.isEmpty else { throw GemmaEvidenceError.malformed }
        let unique = Set(ids)
        guard unique.count <= maximumSelectedIDs else { throw GemmaEvidenceError.malformed }
        guard ids.allSatisfy({ (1...max(1, count)).contains($0) }), count > 0 else {
            throw GemmaEvidenceError.ungrounded
        }
        return plan
    }

    /// Repeated source IDs across roles keep their role assignments while
    /// contributing only once to the original-source context union.
    static func selectedIDs(_ output: String, count: Int) throws -> [Int] {
        let plan = try selectedPlan(output, count: count)
        return Set(roles.flatMap { plan[$0]! }).sorted()
    }

    static func directIDs(for role: String, selection: String, source: String) throws -> Set<Int> {
        let key = role == "main" ? "verdict" : role
        guard roles.contains(key) else { throw GemmaEvidenceError.malformed }
        return Set(try selectedPlan(selection, count: blocks(in: source).count)[key]!)
    }

    /// Direct-role binding is checked separately. Extra citations may use any
    /// original block actually supplied to the writer, including an overlapping
    /// role's context when it supports the same claim.
    static func allowedIDs(for role: String, selection: String, source: String) throws -> Set<Int> {
        let key = role == "main" ? "verdict" : role
        guard roles.contains(key) else { throw GemmaEvidenceError.malformed }
        return Set(try includedIDs(selection, in: source))
    }

    private static func expandedIDs(_ ids: [Int], count: Int) -> [Int] {
        var selected = Set<Int>()
        for id in ids {
            for neighbour in max(1, id - contextRadius)...min(count, id + contextRadius) {
                selected.insert(neighbour)
            }
        }
        return selected.sorted()
    }

    /// Keep two original blocks on each side: explanations and qualifications
    /// can continue beyond the first neighbouring block. At most ten IDs
    /// produce at most fifty blocks. The runtime checks the complete writer
    /// input against its actual token budget; no passage is silently shortened.
    static func includedIDs(_ output: String, in source: String) throws -> [Int] {
        let blocks = blocks(in: source)
        let ids = try selectedIDs(output, count: blocks.count)
        return expandedIDs(ids, count: blocks.count)
    }

    /// The writer and its schema share these original source IDs, including
    /// context. Neither gaps nor repeated selections receive new numbering.
    static func numberedEvidence(_ output: String, in source: String) throws -> String {
        let blocks = blocks(in: source)
        return try includedIDs(output, in: source).map { id in
            "[\(id)] " + blocks[id - 1]
        }.joined(separator: "\n")
    }

    /// Explain each role using IDs only, then supply the exact numbered union
    /// once. Every role retains its complete context without duplicating it.
    static func planEvidence(_ output: String, in source: String) throws -> String {
        let blocks = blocks(in: source)
        let plan = try selectedPlan(output, count: blocks.count)
        let labels = ["verdict": "Gesamturteil", "positive": "Positive Erfahrungen",
                      "critical": "Konkrete Kritik", "context": "Notwendige Einordnung"]
        func list(_ ids: [Int]) -> String { "[" + ids.map(String.init).joined(separator: ",") + "]" }
        let roleText = roles.map { role in
            let direct = Array(Set(plan[role]!)).sorted()
            let context = expandedIDs(direct, count: blocks.count)
            return labels[role]! + " (" + role + "): " + list(direct)
                + "\nZugehöriger Kontext: " + list(context)
        }.joined(separator: "\n\n")
        return "<rollenplan>\n" + roleText + "\n</rollenplan>\n\n<originalbloecke>\n"
            + (try numberedEvidence(output, in: source)) + "\n</originalbloecke>"
    }

    /// Merge the same exact context in source order, without connecting prose.
    static func validate(_ output: String, in source: String) throws -> [String] {
        let blocks = blocks(in: source)
        let ids = try includedIDs(output, in: source)
        var passages = [String]()
        var previous: Int?
        for id in ids {
            let index = id - 1
            if let previous, previous + 1 == index {
                passages[passages.count - 1] += blocks[index]
            } else { passages.append(blocks[index]) }
            previous = index
        }
        return passages
    }
}
