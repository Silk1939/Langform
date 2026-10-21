import Foundation
import CryptoKit

/// QA-only adapter. Prompt/schema/provenance checks are compiled from current
/// product sources; this adapter never calls the product Gemma runtime.
@main struct SmolSummaryContract {
    static func main() {
        do {
            let request = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String: Any]
            let operation = request["operation"] as! String
            let raw = try String(contentsOfFile: request["sourcePath"] as! String, encoding: .utf8)
            let source = OnDeviceSummary.prepare(raw)
            let blocks = GemmaEvidence.blocks(in: source)
            var result: [String: Any] = ["policy": GemmaSummaryPolicy.version,
                "instructions": GemmaSummaryPolicy.instructions + "\n/no_think",
                "baseInstructions": GemmaSummaryPolicy.instructions,
                "sourceSHA256": digest(raw), "preparedSHA256": digest(source),
                "sourceBytes": raw.utf8.count, "preparedBytes": source.utf8.count,
                "sourceBlocks": blocks.count, "sourceReconstructedExactly": blocks.joined() == source,
                "preparedSource": source, "selectionTokenLimit": GemmaSummaryPolicy.selectionTokenLimit,
                "writerTokenLimit": GemmaSummaryPolicy.writerTokenLimit,
                "correctionTokenLimit": GemmaSummaryPolicy.correctionTokenLimit]
            if operation == "prepare" {
                result["prompt"] = GemmaSummaryPolicy.prompt(for: source)
                let schemaJSON = try GemmaEvidence.selectionSchema(for: source)
                result["schemaJSON"] = schemaJSON
                result["schema"] = try JSONSerialization.jsonObject(with: Data(schemaJSON.utf8))
            } else {
                let selection = request["selection"] as! String
                _ = try GemmaEvidence.validate(selection, in: source)
                let allowed = Set(try GemmaEvidence.includedIDs(selection, in: source))
                result["sourceSelectionVerified"] = true
                result["includedEvidenceIDs"] = allowed.sorted()
                result["sourceYear"] = try GemmaClaimValidation.requiredSourceYear(selection: selection, source: source)
                if operation == "writer" {
                    result["prompt"] = try GemmaSummaryPolicy.writerPrompt(for: selection, source: source)
                    let schemaJSON = try GemmaSummaryDocument.schema(allowedEvidenceIDs: allowed.sorted())
                    result["schemaJSON"] = schemaJSON
                    result["schema"] = try JSONSerialization.jsonObject(with: Data(schemaJSON.utf8))
                } else {
                    let output = request["output"] as! String
                    let findings = try issues(output, selection: selection, source: source, allowed: allowed)
                    result["issues"] = try json(findings)
                    result["validatorPassed"] = findings.isEmpty
                    if let document = try? GemmaSummaryDocument.decode(output, allowedEvidenceIDs: allowed) {
                        result["document"] = try json(document)
                    }
                    if operation == "repair" {
                        let repair = try GemmaSummaryRepair.request(for: output, issues: findings, selection: selection, source: source)
                        result["preparedOutput"] = repair.preparedOutput
                        result["needsGeneration"] = repair.needsGeneration
                        result["removedPointIndices"] = repair.removedPointIndices
                        result["fixedFields"] = repair.fixedFields
                        result["remainingIssues"] = try json(repair.remainingIssues)
                        result["prompt"] = repair.prompt
                        result["schemaJSON"] = repair.schemaJSON
                        result["schema"] = try JSONSerialization.jsonObject(with: Data(repair.schemaJSON.utf8))
                    }
                }
            }
            let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
            FileHandle.standardOutput.write(data)
        } catch {
            let value = ["error": String(reflecting: error)]
            FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: value))
            exit(2)
        }
    }

    private static func issues(_ output: String, selection: String, source: String, allowed: Set<Int>) throws -> [GemmaClaimValidation.Issue] {
        guard let document = try? GemmaSummaryDocument.decode(output, allowedEvidenceIDs: allowed) else {
            return [.init(field: "document", code: "invalid_document",
                message: "Das vollständige JSON muss das geforderte Schema mit gültigen Originalnummern und Punktrollen einhalten.")]
        }
        return try GemmaClaimValidation.issues(for: document, selection: selection, source: source)
    }
    private static func json<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    }
    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
