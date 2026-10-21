import Foundation

/// Explicit app transformations are reported separately from native output.
/// No claim text is rewritten. A native retry uses the ordinary document
/// grammar: long exact-string enums fail in the current native tokenizer.
enum GemmaSummaryRepair {
    struct Request {
        let prompt: String
        let schemaJSON: String
        let removedPointIndices: [Int]
        let fixedFields: [String]
        let preparedOutput: String
        let needsGeneration: Bool
        let remainingIssues: [GemmaClaimValidation.Issue]
    }

    static func request(for output: String, issues: [GemmaClaimValidation.Issue],
                        selection: String, source: String) throws -> Request {
        let allowed = Set(try GemmaEvidence.includedIDs(selection, in: source))
        let schema = try GemmaSummaryDocument.schema(allowedEvidenceIDs: allowed.sorted())
        guard let original = try? GemmaSummaryDocument.decode(output, allowedEvidenceIDs: allowed) else {
            let findings = issues.isEmpty ? [GemmaClaimValidation.Issue(field: "document", code: "structuralIssue",
                message: "Das Dokument ist strukturell ungültig.")] : issues
            return Request(prompt: try GemmaSummaryPolicy.correctionPrompt(for: output, issues: findings,
                selection: selection, source: source), schemaJSON: schema,
                removedPointIndices: [], fixedFields: [], preparedOutput: output,
                needsGeneration: true, remainingIssues: findings)
        }

        let initial = try GemmaClaimValidation.issues(for: original, selection: selection, source: source)
        let supplementary = issues.filter { !initial.contains($0) }
        var findings = initial + supplementary
        var preparedOutput = output
        var removed = [Int]()
        let positive = try GemmaEvidence.directIDs(for: "positive", selection: selection, source: source)
        let critical = try GemmaEvidence.directIDs(for: "critical", selection: selection, source: source)
        let minimumPoints = max(1, min(3, positive.count + critical.count))
        let flagged = Set(initial.compactMap { pointIndex($0.field) }.filter { original.points.indices.contains($0) })
        if !flagged.isEmpty, original.points.count - flagged.count >= minimumPoints,
           !supplementary.contains(where: { $0.field.hasPrefix("points") }) {
            var candidateValue = try JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as! [String: Any]
            let points = candidateValue["points"] as! [[String: Any]]
            candidateValue["points"] = points.enumerated().filter { !flagged.contains($0.offset) }.map(\.element)
            let candidateOutput = String(decoding: try JSONSerialization.data(withJSONObject: candidateValue,
                options: [.sortedKeys]), as: UTF8.self)
            let candidate = try GemmaSummaryDocument.decode(candidateOutput, allowedEvidenceIDs: allowed)
            let remaining = try GemmaClaimValidation.issues(for: candidate, selection: selection, source: source)
            // Removal is explicit and allowed only when the entire remaining
            // document passes, including a directly bound point for every
            // selected positive/critical role and every numerical check.
            // A sparse plan must not force a redundant additional core aspect.
            if remaining.isEmpty && supplementary.isEmpty {
                preparedOutput = candidateOutput
                removed = flagged.sorted()
                findings = remaining + supplementary
            }
        }
        let fixedFields = ["tldr", "points", "takeaway"].filter { field in
            !findings.contains { $0.field == field || $0.field.hasPrefix(field + "[") || $0.field == "document" }
        }
        // These field names describe the app transformation only. No native
        // exact-string constraint or claim of semantic verification is implied.
        return Request(prompt: try GemmaSummaryPolicy.correctionPrompt(for: preparedOutput, issues: findings,
            selection: selection, source: source), schemaJSON: schema,
            removedPointIndices: removed, fixedFields: fixedFields, preparedOutput: preparedOutput,
            needsGeneration: !findings.isEmpty, remainingIssues: findings)
    }

    private static func pointIndex(_ field: String) -> Int? {
        guard field.hasPrefix("points["), field.hasSuffix("]") else { return nil }
        return Int(field.dropFirst(7).dropLast())
    }
}
