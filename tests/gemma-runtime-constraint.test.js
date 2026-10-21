const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const runtimePath = path.join(__dirname, '../ios/Langform/Langform/GemmaRuntime.swift');
let directory, binary;

// Compile the actual native conversation initializer, stream entry point,
// callback, and lifetime methods. Only the native C ABI and engine are fakes;
// provider setup, schema forwarding, locking, and cleanup remain product code.
// This proves the ABI configuration, not native allocation or enforcement.
test.before(() => {
  if (process.platform !== 'darwin') return;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-constraint-'));
  binary = path.join(directory, 'constraint');
  const source = fs.readFileSync(runtimePath, 'utf8');
  const between = (start, end) => {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `Missing actual Swift section: ${start}`);
    return source.slice(first, last);
  };
  const actual = [
    between('enum GemmaRuntimeError:', '/// One runtime'),
    between('private func gemmaNativeError(', 'private final class GemmaNativeEngine:'),
    between('private final class GemmaNativeConversation:', '\n    deinit {'),
    between('\n    deinit {\n        if !closed', '\n    func sendDraft('),
    between('\n    func sendDraft(', '\n    func prepareReview('),
    between('\n    func start(messageJSON:', '\n    func metrics('),
    source.slice(source.indexOf('    private static func json(_ object: Any)')),
  ].join('\n');
  assert.match(actual, /responseSchemaJSON/);
  // Compile the official content/channel conversion too, rather than using a
  // fake that could accidentally flatten hidden thought into visible text.
  const checkout = process.env.LANGFORM_LITERT_CHECKOUT || path.join(os.homedir(),
    'Library/Developer/Xcode/DerivedData/Langform-simulator/SourcePackages/checkouts/LiteRT-LM');
  const liteRT = path.join(checkout, 'swift');
  const officialMessage = fs.readFileSync(path.join(liteRT, 'Message.swift'), 'utf8');
  const officialConversation = fs.readFileSync(path.join(liteRT, 'Conversation.swift'), 'utf8');
  const conversionStart = officialConversation.indexOf('  public static func jsonToMessage(');
  const conversionEnd = officialConversation.indexOf('\n  /// Context object', conversionStart);
  assert.ok(conversionStart >= 0 && conversionEnd > conversionStart);
  const conversion = officialConversation.slice(conversionStart, conversionEnd);
  const harness = String.raw`
import Foundation
import Darwin

private let kLiteRtLmSamplerTypeTopP: Int32 = 2
private let kLiteRtLmConstraintProviderTypeLlGuidance: Int32 = 1
private let kLiteRtLmConstraintTypeJsonSchema: Int32 = 2
private let fakePreface = strdup("system preface")!
private let fakeMessage = strdup("user prompt")!
private let fakeFailure = strdup("native constraint failure")!
private let fakeThought = strdup(#"{"role":"assistant","channels":{"thought":"SECRET THOUGHT"},"reasoning_content":"SECRET THOUGHT"}"#)!
private let fakeFinalText = strdup(#"{"role":"assistant","content":[{"type":"text","text":"VISIBLE ANSWER"}]}"#)!

private final class Native: @unchecked Sendable {
    static let shared = Native()
    private let lock = NSLock()
    private var log: [String] = []
    private var next = 10
    private var live: [Int: String] = [:]
    private var providers = Set<Int>()
    private var intrinsicToolConstraint: [Int: Bool] = [:]
    private var schemas: [Int: String] = [:]
    var mode = "success"
    var inputTokens = 50
    var appliedSchema: String?
    var createdWithProvider = false
    var createdWithIntrinsicToolConstraint: Bool?
    var thinkingEnabled = false
    var thinkingBudget: Int32?
    weak var streamContext: GemmaStreamContext?

    func record(_ event: String) { lock.lock(); log.append(event); lock.unlock() }
    func events() -> [String] { lock.lock(); defer { lock.unlock() }; return log }
    func create(_ kind: String) -> OpaquePointer {
        lock.lock(); defer { lock.unlock() }
        next += 1; live[next] = kind; log.append(kind + ".create")
        return OpaquePointer(bitPattern: next)!
    }
    func delete(_ pointer: OpaquePointer, _ kind: String) {
        lock.lock(); defer { lock.unlock() }
        let key = Int(bitPattern: pointer)
        precondition(live.removeValue(forKey: key) == kind, "Double/wrong native destruction")
        schemas.removeValue(forKey: key)
        log.append(kind + ".delete")
    }
    func setProvider(_ config: OpaquePointer) {
        lock.lock(); providers.insert(Int(bitPattern: config)); log.append("provider.set"); lock.unlock()
    }
    func setIntrinsicToolConstraint(_ config: OpaquePointer, _ enabled: Bool) {
        lock.lock(); intrinsicToolConstraint[Int(bitPattern: config)] = enabled
        log.append("intrinsic-tool-constraint." + String(enabled)); lock.unlock()
    }
    func createConversation(_ config: OpaquePointer) -> OpaquePointer? {
        lock.lock()
        let key = Int(bitPattern: config)
        createdWithProvider = providers.contains(key)
        createdWithIntrinsicToolConstraint = intrinsicToolConstraint[key]
        lock.unlock()
        if mode == "createFailure" { record("conversation.failed"); return nil }
        return create("conversation")
    }
    func setSchema(_ args: OpaquePointer, _ schema: String) {
        lock.lock(); schemas[Int(bitPattern: args)] = schema; log.append("schema.set"); lock.unlock()
    }
    func start(_ args: OpaquePointer, callback: (UnsafeMutableRawPointer?, OpaquePointer?) -> Void,
               data: UnsafeMutableRawPointer?) -> Int32 {
        lock.lock()
        appliedSchema = schemas[Int(bitPattern: args)]
        log.append("stream.start")
        lock.unlock()
        streamContext = Unmanaged<GemmaStreamContext>.fromOpaque(data!).takeUnretainedValue()
        if mode == "streamFailure" { return 17 }
        if mode == "thinkingChannel" {
            callback(data, OpaquePointer(bitPattern: 998))
            callback(data, OpaquePointer(bitPattern: 998))
            callback(data, OpaquePointer(bitPattern: 997))
        }
        callback(data, OpaquePointer(bitPattern: 999))
        return 0
    }
    func draft(_ args: OpaquePointer) -> OpaquePointer {
        lock.lock(); appliedSchema = schemas[Int(bitPattern: args)]; log.append("draft.send"); lock.unlock()
        return OpaquePointer(bitPattern: 2000)!
    }
    func assertReleased() {
        lock.lock(); defer { lock.unlock() }
        precondition(live.isEmpty, "Native handles leaked: " + String(describing: live))
    }
}

private enum GemmaDiagnosticTrace {
    static func record(_ stage: String) {
        if stage == "callback.thought.filtered" { Native.shared.record(stage) }
    }
}
private final class GemmaNativeEngine: @unchecked Sendable {
    let handle = OpaquePointer(bitPattern: 1)!
    let contextTokens = 8192
    func countTokens(_ text: String) throws -> Int { Native.shared.record("tokenize"); return Native.shared.inputTokens }
}
private enum LiteRTLMError: Error {
    case message(MessageError)
    enum MessageError { case failedToConvertToJson, invalidContent }
}
${officialMessage}
private enum Conversation {
${conversion}
}

private func litert_lm_session_config_create() -> OpaquePointer? { Native.shared.create("session") }
private func litert_lm_conversation_config_create() -> OpaquePointer? { Native.shared.create("config") }
private func litert_lm_sampler_params_create(_ type: Int32) -> OpaquePointer? { Native.shared.create("sampler") }
private func litert_lm_thinking_config_create() -> OpaquePointer? { Native.shared.create("thinking") }
private func litert_lm_session_config_delete(_ p: OpaquePointer) { Native.shared.delete(p, "session") }
private func litert_lm_conversation_config_delete(_ p: OpaquePointer) { Native.shared.delete(p, "config") }
private func litert_lm_sampler_params_delete(_ p: OpaquePointer) { Native.shared.delete(p, "sampler") }
private func litert_lm_thinking_config_delete(_ p: OpaquePointer) { Native.shared.delete(p, "thinking") }
private func litert_lm_sampler_params_set_top_k(_ p: OpaquePointer, _ v: Int32) {}
private func litert_lm_sampler_params_set_top_p(_ p: OpaquePointer, _ v: Float) {}
private func litert_lm_sampler_params_set_temperature(_ p: OpaquePointer, _ v: Float) {}
private func litert_lm_session_config_set_sampler_params(_ a: OpaquePointer, _ b: OpaquePointer) {}
private func litert_lm_conversation_config_set_session_config(_ a: OpaquePointer, _ b: OpaquePointer) {}
private func litert_lm_conversation_config_set_system_message(_ a: OpaquePointer, _ b: String) {}
private func litert_lm_thinking_config_set_enable_thinking(_ a: OpaquePointer, _ b: Bool) {
    Native.shared.thinkingEnabled = b; Native.shared.record("thinking.enabled")
}
private func litert_lm_thinking_config_set_thinking_token_budget(_ a: OpaquePointer, _ budget: Int32) {
    Native.shared.thinkingBudget = budget; Native.shared.record("thinking.budget")
}
private func litert_lm_conversation_config_set_thinking_config(_ a: OpaquePointer, _ b: OpaquePointer) {
    Native.shared.record("thinking.apply")
}
private func litert_lm_conversation_config_set_constraint_provider(_ config: OpaquePointer, _ p: UnsafePointer<Int32>) {
    precondition(p.pointee == kLiteRtLmConstraintProviderTypeLlGuidance)
    Native.shared.setProvider(config)
}
private func litert_lm_conversation_config_set_enable_constrained_decoding(_ config: OpaquePointer, _ enabled: Bool) {
    precondition(!enabled, "Intrinsic tool-FST creation must stay disabled independently of request JSON schemas")
    Native.shared.setIntrinsicToolConstraint(config, enabled)
}
private func litert_lm_conversation_create(_ engine: OpaquePointer, _ config: OpaquePointer) -> OpaquePointer? {
    Native.shared.createConversation(config)
}
private func litert_lm_conversation_delete(_ p: OpaquePointer) { Native.shared.delete(p, "conversation") }
private func litert_lm_conversation_render_preface_to_string(_ p: OpaquePointer) -> UnsafePointer<CChar>? {
    Native.shared.record("render.preface")
    return Native.shared.mode == "renderFailure" ? nil : UnsafePointer(fakePreface)
}
private func litert_lm_conversation_render_message_to_string(_ p: OpaquePointer, _ json: String) -> UnsafePointer<CChar>? {
    Native.shared.record("render.message"); return UnsafePointer(fakeMessage)
}
private func litert_lm_conversation_cancel_process(_ p: OpaquePointer) { Native.shared.record("native.cancel") }
private func litert_lm_conversation_optional_args_create() -> OpaquePointer? { Native.shared.create("args") }
private func litert_lm_conversation_optional_args_delete(_ p: OpaquePointer) { Native.shared.delete(p, "args") }
private func litert_lm_conversation_optional_args_set_max_output_tokens(_ p: OpaquePointer, _ n: Int32) {}
private func litert_lm_conversation_optional_args_set_constraint(_ p: OpaquePointer, _ type: Int32, _ schema: String) {
    precondition(type == kLiteRtLmConstraintTypeJsonSchema)
    Native.shared.setSchema(p, schema)
}
private func litert_lm_conversation_send_message_stream(_ handle: OpaquePointer, _ json: String,
    _ extra: UnsafePointer<CChar>?, _ args: OpaquePointer,
    _ callback: (UnsafeMutableRawPointer?, OpaquePointer?) -> Void, _ data: UnsafeMutableRawPointer?) -> Int32 {
    Native.shared.start(args, callback: callback, data: data)
}
private func litert_lm_conversation_send_message(_ handle: OpaquePointer, _ json: String,
    _ extra: UnsafePointer<CChar>?, _ args: OpaquePointer) -> OpaquePointer? { Native.shared.draft(args) }
private func litert_lm_json_response_get_string(_ response: OpaquePointer) -> UnsafePointer<CChar>? { UnsafePointer(fakeFinalText) }
private func litert_lm_json_response_delete(_ response: OpaquePointer) { Native.shared.record("response.delete") }
private func litert_lm_get_last_error_message() -> UnsafePointer<CChar>? { UnsafePointer(fakeFailure) }
private func litert_lm_get_last_error_code() -> Int32 { 2 }
private func litert_lm_clear_last_error() { Native.shared.record("error.clear") }
private func litert_lm_stream_chunk_get_error(_ p: OpaquePointer?) -> UnsafePointer<CChar>? {
    Native.shared.mode == "callbackFailure" ? UnsafePointer(fakeFailure) : nil
}
private func litert_lm_stream_chunk_get_text(_ p: OpaquePointer?) -> UnsafePointer<CChar>? {
    if p == OpaquePointer(bitPattern: 998) { return UnsafePointer(fakeThought) }
    if p == OpaquePointer(bitPattern: 997) { return UnsafePointer(fakeFinalText) }
    return nil
}
private func litert_lm_stream_chunk_is_final(_ p: OpaquePointer?) -> Bool { p == OpaquePointer(bitPattern: 999) }

@main struct ConstraintTest {
    static let schema = #"{"type":"array","items":{"enum":[1,2]},"minItems":0,"maxItems":10}"#
    private static func consume(_ conversation: GemmaNativeConversation) async throws -> String {
        var text = ""
        for try await chunk in conversation.start() { text += chunk }
        return text
    }
    static func main() async throws {
        let mode = CommandLine.arguments[1]
        let native = Native.shared
        let constrained = !["unconstrained", "draftUnconstrained", "thinkingUnconstrained", "thinkingChannel", "thinkingReview"].contains(mode)
        let draft = ["draftConstrained", "draftUnconstrained"].contains(mode)
        let rejectedBeforeAllocation = ["negativeBudget", "equalBudget", "tooLargeBudget", "thinkingReview", "schemaReview"].contains(mode)
        var budget = ["thinking", "thinkingUnconstrained", "thinkingChannel", "thinkingReview"].contains(mode) ? 256 : 0
        let limit = budget > 0 ? 1100 : 128
        if mode == "negativeBudget" { budget = -1 }
        if mode == "equalBudget" { budget = limit }
        if mode == "tooLargeBudget" { budget = limit + 1 }
        if ["createFailure", "renderFailure", "streamFailure", "callbackFailure", "thinkingChannel"].contains(mode) { native.mode = mode }
        if mode == "tokenReject" { native.inputTokens = 9000 }
        var conversation: GemmaNativeConversation?
        do {
            conversation = try GemmaNativeConversation(engine: GemmaNativeEngine(), instructions: "system",
                prompt: "full source", maxTokens: limit,
                reviewEnabled: ["thinkingReview", "schemaReview"].contains(mode),
                responseSchemaJSON: constrained ? schema : nil, thinkingBudget: budget)
            precondition(native.createdWithProvider == constrained)
            precondition(native.thinkingEnabled == (budget > 0) && native.thinkingBudget == Int32(budget))
            if mode == "cancelled" { conversation!.cancel() }
            if mode == "closed" { await conversation!.close() }
            let visible: String
            if draft { visible = try conversation!.sendDraft() } else { visible = try await consume(conversation!) }
            precondition(["constrained", "unconstrained", "draftConstrained", "draftUnconstrained", "thinking", "thinkingUnconstrained", "thinkingChannel"].contains(mode), "Failure unexpectedly accepted")
            precondition(visible == (mode == "thinkingChannel" || draft ? "VISIBLE ANSWER" : ""),
                "Actual official Message.toString must exclude thought and reasoning_content")
            precondition(native.appliedSchema == (constrained ? schema : nil))
        } catch GemmaRuntimeError.contextTooLarge {
            precondition(mode == "tokenReject")
        } catch GemmaRuntimeError.generation(let error) {
            precondition(["createFailure", "renderFailure", "streamFailure", "callbackFailure"].contains(mode) || rejectedBeforeAllocation)
            if !rejectedBeforeAllocation { precondition(error == "native constraint failure", "Underlying native error was lost") }
        } catch is CancellationError {
            precondition(["cancelled", "closed"].contains(mode))
        }
        if let conversation { await conversation.close() }
        conversation = nil
        native.assertReleased()
        precondition(native.streamContext == nil, "Native callback context leaked after final/failure")
        let events = native.events()
        precondition(events.filter { $0 == "callback.thought.filtered" }.count == (mode == "thinkingChannel" ? 1 : 0),
            "Thought activity must be logged once per callback context, without thought text")
        if rejectedBeforeAllocation {
            precondition(events.isEmpty, "Invalid budgets or unsupported review must not allocate/start native work")
            print("GEMMA_NATIVE_CONSTRAINT_OK " + mode)
            return
        }
        let create = events.firstIndex(of: mode == "createFailure" ? "conversation.failed" : "conversation.create")!
        precondition(events.firstIndex(of: "intrinsic-tool-constraint.false")! < create
            && native.createdWithIntrinsicToolConstraint == false,
            "Every conversation must explicitly disable intrinsic tool-FST construction before native allocation")
        precondition(events.firstIndex(of: "thinking.enabled")! < events.firstIndex(of: "thinking.budget")!
            && events.firstIndex(of: "thinking.budget")! < events.firstIndex(of: "thinking.apply")!
            && events.firstIndex(of: "thinking.apply")! < create, "Thinking settings must be applied before conversation creation")
        if constrained {
            let provider = events.firstIndex(of: "provider.set")!
            let disabled = events.firstIndex(of: "intrinsic-tool-constraint.false")!
            let created = events.firstIndex(of: mode == "createFailure" ? "conversation.failed" : "conversation.create")!
            precondition(disabled < created && provider < created,
                "External LlGuidance must remain configured while intrinsic tool-FST creation is disabled before native allocation")
            precondition(native.createdWithIntrinsicToolConstraint == false)
        } else {
            precondition(!events.contains("provider.set") && !events.contains("schema.set"))
        }
        let shouldStart = ["constrained", "unconstrained", "streamFailure", "callbackFailure", "thinking", "thinkingUnconstrained", "thinkingChannel"].contains(mode)
        precondition(events.contains("stream.start") == shouldStart)
        if shouldStart || draft {
            let started = events.firstIndex(of: draft ? "draft.send" : "stream.start")!
            let deleted = events.firstIndex(of: "args.delete")!
            precondition(started < deleted, "Stream arguments were destroyed before the native call")
            if constrained { precondition(events.firstIndex(of: "schema.set")! < started) }
        } else {
            precondition(!events.contains("args.create") && !events.contains("schema.set"), "Rejected/cancelled requests started native work")
        }
        for kind in ["session", "config", "sampler", "thinking", "conversation", "args"] {
            precondition(events.filter { $0 == kind + ".create" }.count == events.filter { $0 == kind + ".delete" }.count,
                "Unbalanced lifetime for " + kind)
        }
        print("GEMMA_NATIVE_CONSTRAINT_OK " + mode)
    }
}
`;
  const file = path.join(directory, 'ConstraintTest.swift');
  fs.writeFileSync(file, harness + '\n' + actual);
  const build = spawnSync('xcrun', ['swiftc', '-parse-as-library', file, '-o', binary], {
    encoding: 'utf8', timeout: 85000,
  });
  assert.equal(build.status, 0, build.stderr);
});

test.after(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

for (const mode of ['constrained', 'unconstrained', 'draftConstrained', 'draftUnconstrained', 'createFailure', 'renderFailure', 'tokenReject',
  'streamFailure', 'callbackFailure', 'cancelled', 'closed', 'thinking', 'thinkingUnconstrained',
  'thinkingChannel', 'negativeBudget', 'equalBudget', 'tooLargeBudget', 'thinkingReview', 'schemaReview']) {
  test(`actual native conversation schema contract: ${mode}`, { skip: process.platform !== 'darwin' }, () => {
    const run = spawnSync(binary, [mode], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, new RegExp(`GEMMA_NATIVE_CONSTRAINT_OK ${mode}`));
  });
}
