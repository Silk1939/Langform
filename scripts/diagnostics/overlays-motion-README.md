# Offline overlay motion QA

This fixture embeds the current `summary.js` and `page-captions.js` sources. It uses the existing generic macOS WKWebView runner, local markup and mocked summary responses. It makes no network request and does not install an app.

From the repository directory:

```sh
python3 scripts/diagnostics/overlays-motion-fixture.py --output /tmp/langform-overlay-motion/fixture.html
xcrun swiftc scripts/diagnostics/CommentsMotionWebKit.swift -o /tmp/langform-overlay-motion/webkit-runner
/tmp/langform-overlay-motion/webkit-runner /tmp/langform-overlay-motion/fixture.html > /tmp/langform-overlay-motion/webkit.jsonl
```

The runner exits successfully only when all five scenarios pass. JSONL contains animation-frame positions and a final result with SHA-256 fingerprints of the embedded production sources, generator and runner source.

The scenarios check autofocus without ancestor scrolling, uninterrupted reversal, exit without a return-frame flash, asynchronous summary delivery during close, and immediate chapter seek. Summary scrolling is checked against its actual maximum scroll offset; chapter scrolling stays inside its own list.

This verifies actual macOS WebKit behavior against an offline fixture. It does not verify iPhone frame rate, live YouTube markup or device interaction. Unit coverage remains in `tests/summary-motion.test.js` and `tests/chapters.test.js`.
