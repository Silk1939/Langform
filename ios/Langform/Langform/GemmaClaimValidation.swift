import Foundation

/// These are bounded provenance checks, not a universal entailment judgment.
/// A passing document still needs independent semantic acceptance.
enum GemmaClaimValidation {
    struct Issue: Codable, Equatable, Sendable {
        let field: String
        let code: String
        let message: String
    }

    static func issues(for document: GemmaSummaryDocument, selection: String,
                       source: String) throws -> [Issue] {
        var result = issues(for: document.tldr, field: "tldr", source: source)
        result += issues(for: document.takeaway, field: "takeaway", source: source)
        let positive = try GemmaEvidence.directIDs(for: "positive", selection: selection, source: source)
        let critical = try GemmaEvidence.directIDs(for: "critical", selection: selection, source: source)
        var covered = ["positive": Set<Int>(), "critical": Set<Int>()]

        func binding(_ ids: [Int], role: String, field: String) throws -> [Issue] {
            let direct = try GemmaEvidence.directIDs(for: role, selection: selection, source: source)
            let allowed = try GemmaEvidence.allowedIDs(for: role, selection: selection, source: source)
            let cited = Set(ids)
            var findings = [Issue]()
            if role != "main" && cited.isDisjoint(with: direct) {
                findings.append(.init(field: field, code: "missingDirectEvidence",
                    message: "Die Aussage braucht mindestens einen direkten Beleg der Rolle \(role): \(direct.sorted())."))
            }
            let outside = cited.subtracting(allowed).sorted()
            if !outside.isEmpty {
                findings.append(.init(field: field, code: "outsideRoleEvidence",
                    message: "Die Belege \(outside) gehören weder zur Rolle \(role) noch zu ihrer notwendigen Einordnung."))
            }
            return findings
        }

        result += try binding(document.tldr.evidenceIDs, role: "verdict", field: "tldr")
        for (index, point) in document.points.enumerated() {
            let field = "points[\(index)]"
            result += issues(for: point.claim, field: field, source: source)
            if ["positive", "critical", "main"].contains(point.role) {
                result += try binding(point.evidenceIDs, role: point.role, field: field)
                if point.role != "main" { covered[point.role, default: []].formUnion(point.evidenceIDs) }
            } else {
                result.append(.init(field: field, code: "invalidRole", message: "Unbekannte Punktrolle."))
            }
        }
        for (role, selected) in [("positive", positive), ("critical", critical)] {
            // Source blocks are candidates and can contain several different
            // statements. Requiring every candidate ID would force incidental
            // facts into the summary without proving semantic completeness.
            // Preserve each selected viewpoint with a directly bound point.
            if !selected.isEmpty && selected.isDisjoint(with: covered[role, default: []]) {
                result.append(.init(field: "points", code: "uncoveredRoleEvidence",
                    message: "Die ausgewählte Rolle \(role) braucht mindestens einen Punkt mit einem direkten Beleg aus \(selected.sorted())."))
            }
        }
        return result
    }

    /// Return source metadata rather than asking a free writer to invent a
    /// date-bearing sentence. The caller must label it as source time context.
    /// Historical years from neighboring or other-role passages cannot add a
    /// requirement, and multiple verdict years remain ambiguous.
    static func requiredSourceYear(selection: String, source: String) throws -> String? {
        let direct = try GemmaEvidence.directIDs(for: "verdict", selection: selection, source: source)
        let blocks = GemmaEvidence.blocks(in: source)
        let values = Set(direct.flatMap { years(in: blocks[$0 - 1]) })
        return values.count == 1 ? values.first : nil
    }

    private static func years(in text: String) -> Set<String> {
        let expression = try! NSRegularExpression(pattern: #"(?<![\p{L}\p{N}_])(?:19|20)\d{2}(?![\p{L}\p{N}_])"#)
        let value = text as NSString
        return Set(expression.matches(in: text, range: NSRange(location: 0, length: value.length))
            .map { value.substring(with: $0.range) })
    }

    /// This same check protects a complete TLDR before it becomes a preview.
    /// Evidence is limited to the IDs actually cited by this claim.
    static func issues(for claim: GemmaSummaryDocument.Claim, field: String,
                       source: String) -> [Issue] {
        var result = [Issue]()
        if claim.text.range(of: #"\[\s*\d+(?:\s*,\s*\d+)*\s*\]"#,
                            options: .regularExpression) != nil {
            result.append(.init(field: field, code: "inlineEvidenceIDs",
                message: "Quellnummern dürfen nur in evidenceIDs stehen, nicht im sichtbaren Satz."))
        }
        let blocks = GemmaEvidence.blocks(in: source)
        let ids = Set(claim.evidenceIDs).sorted()
        guard !ids.isEmpty, ids.allSatisfy({ $0 > 0 && $0 <= blocks.count }) else {
            result.append(.init(field: field, code: "invalidEvidence", message: "Die Aussage zitiert keine gültigen Originalstellen."))
            return result
        }
        // Only adjacent cited blocks may complete a number pair across a block
        // boundary. Joining distant passages could invent a ratio in the source.
        var passages = [String]()
        var previous: Int?
        for id in ids {
            if let previous, previous + 1 == id { passages[passages.count - 1] += blocks[id - 1] }
            else { passages.append(blocks[id - 1]) }
            previous = id
        }
        let claimNumbers = numbers(in: claim.text)
        let sourceValues = Set(passages.flatMap { numbers(in: $0).map(\.value) })
        for value in Set(claimNumbers.map(\.value)).subtracting(sourceValues).sorted() {
            result.append(.init(field: field, code: "unsupportedNumber",
                message: "Der Zahlenwert \(value) ist in den tatsächlich zitierten Originalstellen nicht belegt."))
        }
        let sourcePairs = Set(passages.flatMap { ratios(in: $0) })
        for pair in Set(ratios(in: claim.text)).subtracting(sourcePairs).sorted() {
            result.append(.init(field: field, code: "unsupportedRatio",
                message: "Das Zahlenpaar \(pair.replacingOccurrences(of: "|", with: " von ")) ist in den zitierten Originalstellen nicht als dieses Paar belegt."))
        }
        return result
    }

    private struct NumberMention {
        let value: String
        let range: NSRange
    }
    private struct Token {
        let text: String
        let range: NSRange
    }

    private static func numbers(in text: String) -> [NumberMention] {
        let expression = try! NSRegularExpression(pattern:
            #"(?<![\p{L}\p{N}_])(?:\d+(?:(?:[.,]\d+)|(?:[ '\x{00A0}\x{202F}’]\d{3}(?!\d)))*)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])[\p{L}]+(?![\p{L}\p{N}_])"#)
        let original = text as NSString
        let tokens = expression.matches(in: text, range: NSRange(location: 0, length: original.length)).map {
            Token(text: original.substring(with: $0.range).lowercased(), range: $0.range)
        }
        var result = [NumberMention]()
        var index = 0
        while index < tokens.count {
            let token = tokens[index]
            var value = numericValue(token.text) ?? wordValue(token.text)
            // An indefinite article is not a number. It denotes one only in an
            // explicit scaled quantity, such as "eine Million" or "a hundred".
            if value == nil, ["ein", "eine", "einen", "einer", "einem", "eines", "a", "an"].contains(token.text),
               index + 1 < tokens.count, scale(tokens[index + 1].text) != nil { value = "1" }
            guard var value else { index += 1; continue }
            var end = index
            if end + 1 < tokens.count, let power = scale(tokens[end + 1].text) {
                value = shift(value, power: power)
                end += 1
            } else if end + 2 < tokens.count, ["komma", "point"].contains(tokens[end + 1].text),
                      let fraction = wordValue(tokens[end + 2].text) ?? numericValue(tokens[end + 2].text),
                      !fraction.contains("."), !value.contains(".") {
                value = canonical(value + "." + fraction)
                end += 2
            } else if ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"].contains(token.text),
                      end + 1 < tokens.count, let unit = wordValue(tokens[end + 1].text),
                      let first = Int(value), let last = Int(unit), (1...9).contains(last) {
                let between = original.substring(with: NSRange(location: NSMaxRange(token.range),
                    length: tokens[end + 1].range.location - NSMaxRange(token.range)))
                if between.range(of: #"^[\s-]+$"#, options: .regularExpression) != nil {
                    value = String(first + last)
                    end += 1
                }
            }
            let range = NSRange(location: token.range.location,
                                length: NSMaxRange(tokens[end].range) - token.range.location)
            result.append(.init(value: value, range: range))
            index = end + 1
        }
        return result
    }

    private static func ratios(in text: String) -> [String] {
        let mentions = numbers(in: text)
        guard mentions.count > 1 else { return [] }
        let original = text as NSString
        return zip(mentions, mentions.dropFirst()).compactMap { left, right in
            let between = original.substring(with: NSRange(location: NSMaxRange(left.range),
                length: right.range.location - NSMaxRange(left.range)))
            guard between.range(of: #"^\s*(?:von|aus|/|:|zu|out\s+of)\s*$"#,
                                options: [.regularExpression, .caseInsensitive]) != nil else { return nil }
            return left.value + "|" + right.value
        }
    }

    /// Normalize the conventional German/English decimal and grouping forms.
    /// A lone separator followed by three digits is treated as grouping, except
    /// after zero. No substring matching or floating-point rounding is used.
    private static func numericValue(_ token: String) -> String? {
        guard token.first?.isNumber == true else { return nil }
        let compact = token.filter { ![" ", "\u{00a0}", "\u{202f}", "'", "’"].contains($0) }
        let separators = compact.filter { $0 == "," || $0 == "." }
        guard !separators.isEmpty else { return canonical(compact) }
        let pieces = compact.split(whereSeparator: { $0 == "," || $0 == "." }).map(String.init)
        let both = separators.contains(",") && separators.contains(".")
        if !both, pieces.count > 1, pieces.dropFirst().allSatisfy({ $0.count == 3 }), pieces[0] != "0" {
            return canonical(pieces.joined())
        }
        return canonical(pieces.dropLast().joined() + "." + pieces.last!)
    }

    private static func canonical(_ value: String) -> String {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        let integer = String(parts[0].drop(while: { $0 == "0" }))
        let whole = integer.isEmpty ? "0" : integer
        guard parts.count > 1 else { return whole }
        let fraction = String(parts[1].reversed().drop(while: { $0 == "0" }).reversed())
        return fraction.isEmpty ? whole : whole + "." + fraction
    }

    private static func shift(_ value: String, power: Int) -> String {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        let fraction = parts.count > 1 ? parts[1] : ""
        let digits = parts[0] + fraction + String(repeating: "0", count: max(0, power - fraction.count))
        let remaining = max(0, fraction.count - power)
        guard remaining > 0 else { return canonical(digits) }
        return canonical(String(digits.dropLast(remaining)) + "." + digits.suffix(remaining))
    }

    private static func scale(_ word: String) -> Int? {
        ["hundert": 2, "hundred": 2, "tausend": 3, "thousand": 3,
         "million": 6, "millionen": 6, "millions": 6,
         "milliarde": 9, "milliarden": 9][word]
    }

    private static func wordValue(_ word: String) -> String? {
        let small = ["null": 0, "zero": 0, "eins": 1, "one": 1,
                     "zwei": 2, "two": 2, "drei": 3, "three": 3, "vier": 4, "four": 4,
                     "fünf": 5, "fuenf": 5, "five": 5, "sechs": 6, "six": 6,
                     "sieben": 7, "seven": 7, "acht": 8, "eight": 8, "neun": 9, "nine": 9,
                     "zehn": 10, "ten": 10, "elf": 11, "eleven": 11, "zwölf": 12, "zwoelf": 12, "twelve": 12,
                     "dreizehn": 13, "thirteen": 13, "vierzehn": 14, "fourteen": 14,
                     "fünfzehn": 15, "fuenfzehn": 15, "fifteen": 15, "sechzehn": 16, "sixteen": 16,
                     "siebzehn": 17, "seventeen": 17, "achtzehn": 18, "eighteen": 18,
                     "neunzehn": 19, "nineteen": 19]
        if let value = small[word] { return String(value) }
        let tens = ["zwanzig": 20, "twenty": 20, "dreißig": 30, "dreissig": 30, "thirty": 30,
                    "vierzig": 40, "forty": 40, "fünfzig": 50, "fuenfzig": 50, "fifty": 50,
                    "sechzig": 60, "sixty": 60, "siebzig": 70, "seventy": 70,
                    "achtzig": 80, "eighty": 80, "neunzig": 90, "ninety": 90]
        if let value = tens[word] { return String(value) }
        for (suffix, value) in tens where word.hasSuffix("und" + suffix) {
            let prefix = String(word.dropLast(suffix.count + 3))
            if prefix == "ein" { return String(value + 1) }
            if let unit = small[prefix], (1...9).contains(unit) { return String(value + unit) }
        }
        for (marker, multiplier) in [("tausend", 1000), ("hundert", 100)] {
            if let range = word.range(of: marker) {
                let before = String(word[..<range.lowerBound])
                var after = String(word[range.upperBound...])
                if after.hasPrefix("und") { after = String(after.dropFirst(3)) }
                guard let head = (before.isEmpty || before == "ein") ? 1 : wordValue(before).flatMap(Int.init),
                      let tail = after.isEmpty ? 0 : wordValue(after).flatMap(Int.init),
                      head <= 1_000_000, tail < multiplier else { return nil }
                return String(head * multiplier + tail)
            }
        }
        return nil
    }
}
