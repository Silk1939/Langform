import XCTest

/// Standalone runner: the Langform app is already installed. No application
/// target, source dependency or user data reset is part of this project.
final class DeviceAccessibilityTests: XCTestCase {
    private let bundleID = "de.ipekkaya.langform"

    override func setUpWithError() throws {
        continueAfterFailure = false
        executionTimeAllowance = 120
    }

    @MainActor private func launchInstalledApp(videoID: String? = nil, holdProbe: Bool = false) -> XCUIApplication {
        let app = XCUIApplication(bundleIdentifier: bundleID)
        app.launchEnvironment["LANGFORM_DIAGNOSTICS"] = "1"
        if holdProbe { app.launchEnvironment["LANGFORM_HOLD_PROBE"] = "1" }
        if let videoID {
            // Existing opt-in route probe: exercises ordinary openWatch.
            // The interactions below use actual accessible UI controls.
            app.launchEnvironment["LANGFORM_VIDEO_PROBE"] = "[\"\(videoID)\"]"
        }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30), "Die installierte App zeigt keine WebView.")
        // A fresh Simulator has its own cookie store. Dismiss only YouTube's
        // optional-cookie notice, without changing the physical iPhone session.
        let rejectCookies = app.buttons.matching(NSPredicate(
            format: "label IN %@", [
                "Verwendung von Cookies und anderen Daten zu den beschriebenen Zwecken ablehnen",
                "Alle ablehnen", "Reject all"
            ]
        )).firstMatch
        if rejectCookies.waitForExistence(timeout: 5) {
            for _ in 0..<5 where !rejectCookies.isHittable {
                app.webViews.firstMatch.swipeUp()
            }
            XCTAssertTrue(rejectCookies.isHittable, "Cookie-Ablehnung ist nicht erreichbar.")
            if rejectCookies.isHittable { rejectCookies.tap() }
        }
        return app
    }

    @MainActor private func record(_ app: XCUIApplication, name: String, detail: String = "") {
        // The root invocation saves its xcresult under /tmp. No screenshots or
        // user-specific accessibility labels are printed to the chat/stdout.
        let attachment = XCTAttachment(string: detail + "\n" + app.debugDescription)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor private func waitUntil(_ timeout: TimeInterval, _ body: @escaping () -> Bool) -> Bool {
        // Observe an already satisfied condition immediately. XCTest's first
        // predicate poll otherwise adds a full second at each UI boundary.
        if body() { return true }
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in body() }, object: nil)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    private let searchLabel = NSPredicate(format: "label MATCHES[c] %@", "^(Suchen|Suche|Search|Search YouTube|YouTube durchsuchen|YouTube-Suche|In YouTube suchen|Bei YouTube suchen)$")

    @MainActor private func searchField(_ app: XCUIApplication) -> XCUIElement? {
        let typedSearch = app.searchFields.allElementsBoundByIndex.first { $0.exists && $0.isHittable }
        if let typedSearch { return typedSearch }
        return app.textFields.allElementsBoundByIndex.first { $0.exists && $0.isHittable }
    }

    @MainActor func test01DiscoverHomeAccessibility() {
        let start = ProcessInfo.processInfo.systemUptime
        let app = launchInstalledApp()
        let elapsed = ProcessInfo.processInfo.systemUptime - start
        let home = app.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", ["Startseite", "Home"])).firstMatch
        let search = app.buttons.matching(searchLabel).firstMatch
        _ = home.waitForExistence(timeout: 20)
        record(app, name: "01-home-accessibility", detail: "XCTest launch + WebView observation elapsed: \(elapsed)s (includes XCTest/automation overhead).\nHome exists: \(home.exists); search button exists: \(search.exists); search field exists: \(searchField(app) != nil).")
        XCTAssertTrue(home.exists, "WebView vorhanden, aber keine zugängliche Home-Tab-Oberfläche gefunden; siehe lokale Accessibility-Anlage.")
    }

    @MainActor func test02PublicNASASearch() throws {
        let app = launchInstalledApp()
        if searchField(app) == nil {
            let headerSearch = app.buttons["In YouTube suchen"]
            let searchButton = headerSearch.waitForExistence(timeout: 10) && headerSearch.isHittable
                ? headerSearch : app.buttons.matching(searchLabel).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
            guard let searchButton else {
                record(app, name: "02-search-control-unavailable")
                XCTFail("Kein eindeutig beschrifteter erreichbarer Suchknopf.")
                return
            }
            searchButton.tap()
        }
        guard waitUntil(15, { self.searchField(app) != nil }), let field = searchField(app) else {
            record(app, name: "02-search-field-unavailable")
            XCTFail("Kein zugängliches Suchfeld nach dem Öffnen der Suche.")
            return
        }
        field.tap()
        field.typeText("NASA\n")
        let result = app.links.matching(NSPredicate(format: "label CONTAINS[c] %@", "NASA")).firstMatch
        let found = waitUntil(30, { result.exists })
        record(app, name: "02-NASA-search-results", detail: "Public query: NASA. Accessible result link/text found: \(found).")
        XCTAssertTrue(found, "Keine zugänglichen Ergebnisse zur öffentlichen NASA-Suche innerhalb von 30 Sekunden.")
    }

    /// Optional follow-on only after discovery identifies a genuine watch URL
    /// as an AX identifier. Avoid guessing whether a NASA link is a channel.
    @MainActor func test03PublicWatchAndReadOnlyCommentsIfIdentifiable() throws {
        let app = launchInstalledApp()
        let watch = app.links.matching(NSPredicate(format: "identifier CONTAINS %@", "/watch?v=")).firstMatch
        guard watch.waitForExistence(timeout: 20), watch.isHittable else {
            record(app, name: "03-watch-link-unavailable")
            throw XCTSkip("Home-Videolinks haben keine eindeutig als Watch-URL erkennbare Accessibility-ID; Discovery zuerst auswerten.")
        }
        watch.tap()
        let collapse = app.buttons["Verkleinern"]
        XCTAssertTrue(collapse.waitForExistence(timeout: 30), "Videoklick zeigt keinen nativen großen Player.")
        record(app, name: "03-watch-open")
        let comments = app.buttons.matching(NSPredicate(format: "label MATCHES[c] %@", "^(Kommentare|Comments)(,.*| [0-9].*)?$")).firstMatch
        if comments.exists && comments.isHittable {
            comments.tap()
            record(app, name: "03-read-only-comments-open")
            // Read-only: no text field interaction, comment posting, like,
            // subscription, account settings or destructive action.
        } else {
            record(app, name: "03-comments-control-unavailable")
        }
    }

    @MainActor func test04WatchMinimizeExpandAndClose() {
        let app = launchInstalledApp(videoID: "aqz-KE-bpKQ")
        let collapse = app.buttons["Verkleinern"]
        XCTAssertTrue(waitUntil(30, { collapse.exists && collapse.isHittable }), "Öffnungsprobe zeigt keinen erreichbaren großen Player.")
        record(app, name: "04-watch-expanded")
        collapse.tap()

        let mini = app.buttons["Video vergrößern"]
        XCTAssertTrue(waitUntil(15, {
            mini.exists && mini.isHittable && mini.frame.height > 0 && mini.frame.height < app.frame.height * 0.5
        }), "Verkleinern zeigt keinen erreichbaren Mini-Player.")
        record(app, name: "04-watch-mini")
        mini.tap()
        XCTAssertTrue(waitUntil(15, { collapse.exists && collapse.isHittable }), "Mini-Player lässt sich nicht wieder vergrößern.")
        collapse.tap()
        XCTAssertTrue(waitUntil(15, { mini.exists && mini.isHittable && mini.frame.height < app.frame.height * 0.5 }), "Zweites Verkleinern erreicht den Mini-Player nicht.")
        // UIKit exposes the whole mini card as one accessibility element.
        // The visible close button's verified frame is (width - 48, 4, 44, 44).
        mini.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0))
            .withOffset(CGVector(dx: -26, dy: 26)).tap()
        XCTAssertTrue(waitUntil(15, { !collapse.isHittable && !mini.isHittable }), "Player bleibt nach Schließen bedienbar.")
        record(app, name: "04-watch-closed")
    }

    @MainActor func test05WatchToolsAndDownloadPresentation() {
        // Use the same long-form Watch entry as the player-interaction test.
        let app = launchInstalledApp(videoID: "aqz-KE-bpKQ")
        let collapse = app.buttons["Verkleinern"]
        XCTAssertTrue(waitUntil(30, { collapse.exists && collapse.isHittable }))
        let downloads = app.buttons["Downloads öffnen"]
        XCTAssertTrue(downloads.waitForExistence(timeout: 20), "Downloadaktion wird nach Metadatenhydration nicht zugänglich.")
        for _ in 0..<4 where !(downloads.exists && downloads.isHittable) {
            app.webViews.firstMatch.swipeUp()
        }
        XCTAssertTrue(waitUntil(15, { downloads.exists && downloads.isHittable }), "Downloadaktion fehlt im Watch-Dokument.")
        XCTAssertGreaterThan(downloads.frame.minY, collapse.frame.maxY, "Downloads überdeckt die Videokopfsteuerung.")
        let sponsor = app.switches["SponsorBlock umschalten"]
        XCTAssertTrue(sponsor.exists, "SponsorBlock-Schalter fehlt in der Werkzeugzeile.")
        if sponsor.value as? String == "1" { sponsor.tap() }
        XCTAssertTrue(waitUntil(5, { sponsor.value as? String == "0" }))
        let summary = app.buttons.matching(NSPredicate(format: "label == %@", "Kurzfassung")).allElementsBoundByIndex
            .first { $0.exists && $0.isHittable }
        XCTAssertNotNil(summary, "Kurzfassungsaktion ist im Watch nicht erreichbar.")
        if let summary { XCTAssertGreaterThanOrEqual(summary.frame.height, 44) }
        record(app, name: "05-watch-tools-in-document")
        let toolbarImage = XCTAttachment(screenshot: app.screenshot())
        toolbarImage.name = "05-watch-tools-layout"
        toolbarImage.lifetime = .keepAlways
        add(toolbarImage)
        sponsor.tap()
        XCTAssertTrue(waitUntil(10, { sponsor.value as? String == "1" }), "SponsorBlock lässt sich nicht aktivieren.")
        let settledStatus = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@ OR label CONTAINS[c] %@", "werden automatisch übersprungen", "keine Sponsorsegmente", "SponsorBlock ist gerade nicht erreichbar")).firstMatch
        XCTAssertTrue(settledStatus.waitForExistence(timeout: 15), "SponsorBlock-Abfrage bleibt ohne Abschlussstatus.")
        record(app, name: "05-sponsorblock-query-completed")
        sponsor.tap()
        XCTAssertTrue(waitUntil(10, { sponsor.value as? String == "0" }))
        downloads.tap()
        let done = app.buttons["Fertig"]
        XCTAssertTrue(done.waitForExistence(timeout: 45), "Downloadbibliothek öffnet nicht nach Quellenprüfung.")
        XCTAssertTrue(app.navigationBars["Downloads"].exists)
        record(app, name: "05-download-library")
        done.tap()
        XCTAssertTrue(waitUntil(15, { collapse.exists && collapse.isHittable }))
    }

    @MainActor func test06RepeatedPlayerActionsRemainResponsive() {
        let app = launchInstalledApp(videoID: "aqz-KE-bpKQ")
        let collapse = app.buttons["Verkleinern"]
        let mini = app.buttons["Video vergrößern"]
        XCTAssertTrue(waitUntil(30, { collapse.exists && collapse.isHittable }))
        for cycle in 0..<3 {
            if cycle == 0 { app.webViews.firstMatch.swipeUp() }
            collapse.tap(withNumberOfTaps: 2, numberOfTouches: 1)
            XCTAssertTrue(waitUntil(10, { mini.exists && mini.isHittable && mini.frame.height < app.frame.height * 0.5 }))
            mini.tap(withNumberOfTaps: 2, numberOfTouches: 1)
            XCTAssertTrue(waitUntil(10, { collapse.exists && collapse.isHittable }))
            let unexpectedMinimize = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                mini.exists && mini.isHittable && mini.frame.height < app.frame.height * 0.5
            }, object: nil)
            unexpectedMinimize.isInverted = true
            XCTAssertEqual(XCTWaiter.wait(for: [unexpectedMinimize], timeout: 1), .completed, "Ältere Minimierungsabsicht überschreibt erneut Expanded.")
            record(app, name: "06-repeat-\(cycle)")
        }
        collapse.tap()
        XCTAssertTrue(waitUntil(10, { mini.exists && mini.isHittable && mini.frame.height < app.frame.height * 0.5 }))
    }

    @MainActor func test07ActualSideHoldTemporarilyDoublesPlaybackRate() throws {
        let app = launchInstalledApp(videoID: "aqz-KE-bpKQ", holdProbe: true)
        let collapse = app.buttons["Verkleinern"]
        XCTAssertTrue(waitUntil(30, { collapse.exists && collapse.isHittable }))
        let probe = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready=")).firstMatch
        XCTAssertTrue(probe.waitForExistence(timeout: 20), "Opt-in Geschwindigkeitsprobe fehlt.")
        if !probe.label.contains("ready=true") {
            let play = app.buttons.matching(NSPredicate(format: "label IN %@", ["Video starten", "Wiedergeben", "Play"])).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
            guard let play else { record(app, name: "07-play-unavailable"); XCTFail("Kein erreichbarer Playknopf."); return }
            play.tap()
        }
        guard waitUntil(30, { probe.label.contains("ready=true") }) else {
            record(app, name: "07-playback-unavailable")
            XCTFail("Testvideo liefert keine laufende Wiedergabe für den echten Holdtest.")
            return
        }
        func number(_ name: String) -> Double? {
            probe.label.components(separatedBy: " ").first { $0.hasPrefix(name + "=") }.flatMap { Double($0.dropFirst(name.count + 1)) }
        }
        guard let x = number("x"), let y = number("y"), let width = number("w"), let height = number("h"), let rate = number("rate") else { XCTFail("Videogeometrie fehlt."); return }
        XCTAssertGreaterThan(width, 100); XCTAssertGreaterThan(height, 100)
        record(app, name: "07-before-actual-side-hold")
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x + width * 0.2, dy: y + height * 0.5)).press(forDuration: 1.2)
        let leftHeld = waitUntil(10, { probe.label.contains("held=1") && probe.label.contains("heldRate=2") && probe.label.contains("released=1") })
        record(app, name: "07-after-left-side-hold", detail: probe.label)
        XCTAssertTrue(leftHeld, "Langer Druck auf die Videoseite erreicht temporäres 2× nicht; Diagnose siehe Anlage.")
        XCTAssertEqual(number("rate"), rate, "Loslassen stellt die ursprüngliche Geschwindigkeit nicht wieder her.")
        XCTAssertEqual(number("releasedRate"), rate)
        XCTAssertGreaterThanOrEqual(number("heldForMs") ?? 0, 750, "2× endet vor dem tatsächlichen Loslassen.")
        XCTAssertTrue(probe.label.contains("releaseEvent=pointerup"))
        XCTAssertFalse(app.menuItems.matching(NSPredicate(format: "label IN %@", ["Kopieren", "Nachschlagen", "Übersetzen", "Copy", "Look Up", "Translate"])).firstMatch.exists, "2×-Hold öffnet zusätzlich das native Textauswahlmenü.")
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x + width * 0.9, dy: y + height * 0.5)).press(forDuration: 1.2)
        let rightHeld = waitUntil(10, { probe.label.contains("held=2") && probe.label.contains("heldRate=2") && probe.label.contains("released=2") })
        record(app, name: "07-after-right-side-hold", detail: probe.label)
        XCTAssertTrue(rightHeld, "Auch die rechte freie Videoseite soll 2× halten; Diagnose siehe Anlage.")
        XCTAssertEqual(number("rate"), rate)
        XCTAssertEqual(number("releasedRate"), rate)
        XCTAssertGreaterThanOrEqual(number("heldForMs") ?? 0, 750)
        XCTAssertTrue(probe.label.contains("releaseEvent=pointerup"))
        XCTAssertFalse(app.menuItems.matching(NSPredicate(format: "label IN %@", ["Kopieren", "Nachschlagen", "Übersetzen", "Copy", "Look Up", "Translate"])).firstMatch.exists, "2×-Hold öffnet zusätzlich das native Textauswahlmenü.")
        record(app, name: "07-after-actual-side-hold")
    }

    @MainActor private func sponsorSeconds(_ text: String) -> Double? {
        let normalized = text.replacingOccurrences(of: "\u{00a0}", with: " ").lowercased()
        guard !normalized.contains("%") else { return nil } // slider 0% is not seconds
        let clock = try! NSRegularExpression(pattern: #"(?<!\d)(\d{1,2}:\d{2}(?::\d{2})?)(?!\d)"#)
        let range = NSRange(normalized.startIndex..., in: normalized)
        if let match = clock.firstMatch(in: normalized, range: range),
           let span = Range(match.range(at: 1), in: normalized) {
            let values = normalized[span].split(separator: ":").compactMap { Double($0) }
            if values.count == 2 { return values[0] * 60 + values[1] }
            if values.count == 3 { return values[0] * 3600 + values[1] * 60 + values[2] }
        }
        let units = try! NSRegularExpression(pattern: #"(\d+(?:[.,]\d+)?)\s*(stunden?|hours?|minuten?|minutes?|sekunden?|seconds?)\b"#)
        var value = 0.0, found = false
        for match in units.matches(in: normalized, range: range) {
            guard let amountRange = Range(match.range(at: 1), in: normalized),
                  let unitRange = Range(match.range(at: 2), in: normalized),
                  let amount = Double(normalized[amountRange].replacingOccurrences(of: ",", with: ".")) else { return nil }
            let unit = String(normalized[unitRange])
            value += amount * ((unit.hasPrefix("stund") || unit.hasPrefix("hour")) ? 3600 : unit.hasPrefix("min") ? 60 : 1)
            found = true
        }
        return found ? value : nil
    }

    @MainActor private func sponsorPlayer(_ app: XCUIApplication) -> XCUIElement? {
        let candidates = app.otherElements.matching(NSPredicate(format: "label == %@", "YouTube-Videoplayer"))
            .allElementsBoundByIndex.filter { $0.exists && $0.frame.width > 100 && $0.frame.height > 100 }
        return candidates.count == 1 ? candidates[0] : nil
    }

    @MainActor private func sponsorElapsed(_ app: XCUIApplication) -> Double? {
        guard let region = sponsorPlayer(app) else { return nil }
        // Actual AX specimen: "Abgespielte Zeit 4 seconds". Prefer the website's
        // advancing time label; WebKit's video Other.value may remain stale at 0.
        let labels = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Abgespielte Zeit"))
            .allElementsBoundByIndex.filter {
                $0.exists && $0.frame.intersects(region.frame) && self.sponsorSeconds($0.label) != nil
            }
        if labels.count == 1 { return sponsorSeconds(labels[0].label) }
        // Native video accessibility still helps while controls are hidden. Never
        // use title/total-duration as elapsed time and never infer seconds from %.
        let media = region.otherElements.allElementsBoundByIndex.filter { element in
            guard element.exists, element.frame.width > region.frame.width * 0.9,
                  element.frame.height > region.frame.height * 0.9,
                  let raw = element.value as? String else { return false }
            return sponsorSeconds(raw) != nil
        }
        guard media.count == 1, let raw = media[0].value as? String else { return nil }
        return sponsorSeconds(raw)
    }

    @MainActor private func sponsorRevealControls(_ app: XCUIApplication) -> Bool {
        func visible() -> Bool {
            return ["Video anhalten", "Video abspielen", "Video starten", "Wiedergeben", "Play"].contains {
                let button = app.buttons[$0]
                return button.exists && button.isHittable
            }
        }
        if visible() { return true }
        guard let region = sponsorPlayer(app) else { return false }
        // Idempotent reveal: do not hide controls that are already shown.
        region.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30)).tap()
        return waitUntil(5, visible)
    }

    @MainActor private func sponsorPlayButton(_ app: XCUIApplication) -> XCUIElement? {
        let labels = ["Video starten", "Video abspielen", "Wiedergeben", "Play"]
        return app.buttons.matching(NSPredicate(format: "label IN %@", labels))
            .allElementsBoundByIndex.first { $0.exists && $0.isHittable }
    }

    @MainActor func test08LiveSponsorBlockActuallySeeksAndUndoResumesSponsor() throws {
        executionTimeAllowance = 150
        // Existing read-only hold probe confirms exact real player identity/rate.
        // It does not set time/rate and does not fabricate SponsorBlock data.
        let app = launchInstalledApp(videoID: "1H8_tk_dMLw", holdProbe: true)
        let collapse = app.buttons["Verkleinern"]
        XCTAssertTrue(waitUntil(30) { collapse.exists && collapse.isHittable })
        let sponsor = app.switches["SponsorBlock umschalten"]
        let toolsReady = waitUntil(20) { sponsor.exists && sponsor.isHittable }
        if !toolsReady {
            let unavailableVideo = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "Video nicht verfügbar", "Video ist privat")).firstMatch
            if unavailableVideo.exists {
                record(app, name: "08-live-video-prerequisite-unavailable")
                throw XCTSkip("Öffentliches Testvideo ist aktuell nicht verfügbar; kein Sponsor-Skipnachweis daraus.")
            }
        }
        XCTAssertTrue(toolsReady, "Werkzeugzeile fehlt für das öffentliche Testvideo.")
        defer {
            // This test changes only its Simulator SponsorBlock preference. Clean
            // it explicitly even after failure; do not change account/cookie data.
            if app.state == .runningForeground, sponsor.exists, sponsor.isHittable,
               sponsor.value as? String == "1" {
                sponsor.tap()
                XCTAssertTrue(waitUntil(5) { sponsor.value as? String == "0" }, "SponsorBlock-Cleanup fehlgeschlagen.")
            }
            if collapse.exists && collapse.isHittable {
                collapse.tap()
                let mini = app.buttons["Video vergrößern"]
                if waitUntil(5, { mini.exists && mini.isHittable && mini.frame.height < app.frame.height * 0.5 }) {
                    mini.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0))
                        .withOffset(CGVector(dx: -26, dy: 26)).tap()
                }
            }
        }
        if sponsor.value as? String == "1" { sponsor.tap() }
        XCTAssertTrue(waitUntil(5) { sponsor.value as? String == "0" })
        let probe = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready=")).firstMatch
        XCTAssertTrue(waitUntil(20) { probe.exists && probe.label.contains("data=1H8_tk_dMLw") }, "Andere oder unbestätigte Playeridentität.")

        // Always exercise an actual Play action, regardless of warm autoplay.
        if probe.label.contains("ready=true") {
            _ = sponsorRevealControls(app)
            let pause = app.buttons["Video anhalten"]
            XCTAssertTrue(waitUntil(5) { pause.exists && pause.isHittable })
            pause.tap()
        }
        guard let play = sponsorPlayButton(app) else {
            record(app, name: "08-play-button-unavailable")
            XCTFail("Kein eindeutig erreichbarer echter Playknopf."); return
        }
        play.tap()
        XCTAssertTrue(waitUntil(20) { probe.label.contains("ready=true") })
        _ = sponsorRevealControls(app)
        guard let firstElapsed = sponsorElapsed(app) else {
            record(app, name: "08-elapsed-AX-unavailable")
            throw XCTSkip("Aktuelle YouTube-AX-Oberfläche liefert keine unabhängige Sekundentimeline; kein Seek-Erfolg aus Undo-Button allein ableiten.")
        }
        XCTAssertTrue(waitUntil(10) { (self.sponsorElapsed(app) ?? -1) >= firstElapsed + 2 }, "Video liefert keinen tatsächlich fortschreitenden Zeitnachweis.")
        let pause = app.buttons["Video anhalten"]
        if !pause.isHittable { _ = sponsorRevealControls(app) }
        XCTAssertTrue(waitUntil(5) { pause.exists && pause.isHittable })
        pause.tap()

        // Seek back using the verified original accessible slider while paused.
        // Specimen label: "Schieberegler für Suche", value "0%". Use it for UI
        // input only; time assertions come from elapsed seconds above.
        let slider = app.sliders["Schieberegler für Suche"]
        XCTAssertTrue(waitUntil(5) { slider.exists && slider.isHittable })
        // This actual mweb ARIA slider reports no AX scrubber endpoints on
        // iOS 27 (both are {0,0}). Use its recorded visible frame for a normal
        // finger drag, and prove the result through independent elapsed time.
        let scrubStart = slider.coordinate(withNormalizedOffset: CGVector(dx: 0.06, dy: 0.5))
        let scrubBeginning = slider.coordinate(withNormalizedOffset: CGVector(dx: 0.001, dy: 0.5))
        scrubStart.press(forDuration: 0.1, thenDragTo: scrubBeginning)
        XCTAssertTrue(waitUntil(8) { (self.sponsorElapsed(app) ?? 999) <= 1 }, "Normaler UI-Seek erreicht den Videoanfang nicht.")
        record(app, name: "08-real-video-paused-at-start")

        sponsor.tap()
        XCTAssertTrue(waitUntil(5) { sponsor.value as? String == "1" })
        let ready = app.staticTexts["Sponsorsegmente werden automatisch übersprungen."]
        let empty = app.staticTexts["Für dieses Video sind keine Sponsorsegmente gemeldet."]
        let unavailable = app.staticTexts["SponsorBlock ist gerade nicht erreichbar."]
        XCTAssertTrue(waitUntil(15) { ready.exists || empty.exists || unavailable.exists }, "Abfrage hängt ohne Abschlussstatus.")
        if empty.exists || unavailable.exists {
            record(app, name: "08-live-API-prerequisite-unavailable")
            throw XCTSkip("Live-SponsorBlock-Quelle derzeit leer/nicht erreichbar; tatsächlicher Seek wurde nicht geprüft.")
        }
        XCTAssertTrue(ready.exists)
        let undo = app.buttons["Überspringen rückgängig"]
        XCTAssertFalse(undo.exists, "Alleinige API-Antwort auf pausiertes Video hat bereits geskippt.")
        let before = try XCTUnwrap(sponsorElapsed(app))
        XCTAssertLessThanOrEqual(before, 1)
        guard let resume = sponsorPlayButton(app) else { XCTFail("Kein echter Playknopf nach dem API-Laden."); return }

        let began = ProcessInfo.processInfo.systemUptime
        resume.tap()
        var observed = -1.0
        let jumped = waitUntil(12) {
            observed = self.sponsorElapsed(app) ?? -1
            return undo.exists && observed >= 36 && observed < 50
        }
        let wall = ProcessInfo.processInfo.systemUptime - began
        record(app, name: "08-actual-live-sponsor-jump", detail: "Before=\(before)s; observed=\(observed)s; wall=\(wall)s; live API expected segment 3.662–36.322s.")
        XCTAssertTrue(jumped, "Kein tatsächlicher Sprung ans Ende des real gemeldeten Sponsors innerhalb von 12 Sekunden.")
        // Independent anti-false-positive: ordinary playback at up to 2x cannot
        // explain this displacement. UI scheduling may add a small wall-time cost.
        XCTAssertGreaterThan(observed - before, wall * 2 + 4, "Zeitänderung lässt sich durch normales Abspielen erklären.")
        XCTAssertTrue(undo.isHittable)
        undo.tap()
        XCTAssertTrue(waitUntil(8) { (self.sponsorElapsed(app) ?? 999) < 12 }, "Undo zeigt einen Buttonstatus, aber keinen echten Rücksprung.")
        let afterUndo = try XCTUnwrap(sponsorElapsed(app))
        XCTAssertLessThan(afterUndo, 12)
        XCTAssertTrue(waitUntil(8) {
            guard let value = self.sponsorElapsed(app) else { return false }
            return value >= afterUndo + 2 && value < 24 && !undo.exists
        }, "Zurückgenommener Sponsor läuft nicht weiter oder wird erneut automatisch übersprungen.")
        XCTAssertEqual(sponsor.value as? String, "1", "Undo wurde durch Abschalten statt Segmentausnahme erreicht.")
        record(app, name: "08-actual-live-undo-and-resumed-sponsor")
        sponsor.tap()
        XCTAssertTrue(waitUntil(5) { sponsor.value as? String == "0" })
    }

    @MainActor func test09MixedFullscreenReturnsVideoAndWatchSurface() throws {
        let began = ProcessInfo.processInfo.systemUptime
        let deadline = began + 112 // Leave room for the final result attachment.
        XCUIDevice.shared.orientation = .portrait
        let app = launchInstalledApp(videoID: "aqz-KE-bpKQ", holdProbe: true)
        let collapse = app.buttons["Verkleinern"]
        let mini = app.buttons["Video vergrößern"]
        let downloads = app.buttons["Downloads öffnen"]
        let sponsor = app.switches["SponsorBlock umschalten"]
        var phase = "watch entry", facts = [String](), completedCycles = 0
        defer {
            facts.append("completedMixedCycles=\(completedCycles); finalPhase=\(phase); elapsed=\(ProcessInfo.processInfo.systemUptime - began)s")
            record(app, name: "09-fullscreen-mixed-result", detail: facts.joined(separator: "\n"))
            let image = XCTAttachment(screenshot: app.screenshot())
            image.name = "09-fullscreen-mixed-result"
            image.lifetime = .keepAlways
            add(image)
            XCUIDevice.shared.orientation = .portrait
        }
        func boundedWait(_ seconds: TimeInterval, _ body: @escaping () -> Bool) -> Bool {
            let remaining = deadline - ProcessInfo.processInfo.systemUptime
            return remaining > 0 && waitUntil(min(seconds, remaining), body)
        }
        func videoOther() -> XCUIElement? {
            // The recorded real specimen is Other, BBB title + duration, with
            // a seconds value and frame 402 x 226. Metadata has no media value.
            // Resolve the current matching element on each observation. A
            // bound-by-index snapshot can retain an AX node that disappears
            // during the native orientation/DOM accessibility handoff.
            let query = app.otherElements.matching(NSPredicate(
                format: "label BEGINSWITH %@", "Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film,"
            ))
            guard query.count == 1 else { return nil }
            let candidate = query.firstMatch
            guard candidate.exists else { return nil }
            let frame = candidate.frame
            guard frame.width > 100, frame.height > 100,
                  let raw = candidate.value as? String, self.sponsorSeconds(raw) != nil else { return nil }
            return candidate
        }
        func fullscreenRegion() -> XCUIElement? {
            let query = app.otherElements.matching(NSPredicate(
                format: "label == %@ OR label == %@", "Vollbild-Videoplayer", "Vollbild-Videoplayer, Bereich"
            ))
            guard query.count == 1 else { return nil }
            let candidate = query.firstMatch
            guard candidate.exists else { return nil }
            let frame = candidate.frame
            return frame.width > 100 && frame.height > 100 ? candidate : nil
        }
        func fullscreenTime(_ region: XCUIElement) -> Double? {
            let slider = region.sliders["Videoposition"]
            if slider.exists, let raw = slider.value as? String, raw.contains(":"),
               let value = sponsorSeconds(raw) { return value }
            // Shipping clock is "elapsed / total". Never treat a 0% slider,
            // video title or total duration as an independently observed time.
            let clock = region.staticTexts.allElementsBoundByIndex.filter { $0.exists && $0.label.contains(" / ") }
            guard clock.count == 1, let elapsed = clock[0].label.components(separatedBy: " / ").first else { return nil }
            return sponsorSeconds(elapsed)
        }
        func showOriginalControls() -> Bool {
            func visible() -> Bool {
                return ["Video anhalten", "Video abspielen", "Video starten", "Wiedergeben", "Play", "Vollbild"].contains {
                    let button = app.buttons[$0]
                    return button.exists && button.isHittable
                }
            }
            if visible() { return true }
            guard let region = sponsorPlayer(app) else { return false }
            region.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30)).tap()
            return boundedWait(5, visible)
        }
        func showFullscreenControls(_ region: XCUIElement) -> Bool {
            func visible() -> Bool {
                return ["Pause", "Wiedergabe"].contains {
                    let button = region.buttons[$0]
                    return button.exists && button.isHittable
                }
            }
            if visible() { return true }
            // Short middle-background tap toggles actual shipping controls.
            // Center buttons sit at 0.50, so the upper 0.28 area avoids them.
            region.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28)).tap()
            return boundedWait(5, visible)
        }
        func frameMatches(_ frame: CGRect, _ baseline: CGRect) -> Bool {
            return abs(frame.minX - baseline.minX) <= 8 && abs(frame.minY - baseline.minY) <= 8 &&
                abs(frame.width - baseline.width) <= 8 && abs(frame.height - baseline.height) <= 8
        }

        XCTAssertTrue(boundedWait(25) { collapse.exists && collapse.isHittable })
        XCTAssertTrue(boundedWait(15) { downloads.exists && downloads.isHittable && sponsor.exists && sponsor.isHittable }, "Watchwerkzeuge vor dem Eintritt nicht bedienbar.")
        XCTAssertTrue(boundedWait(10) { self.sponsorPlayer(app) != nil && videoOther() != nil }, "Eindeutiges originales Video-Other fehlt.")

        // Exercise an actual play action even when the route warm-autoplays.
        XCTAssertTrue(showOriginalControls())
        let originalPause = app.buttons["Video anhalten"]
        if originalPause.exists && originalPause.isHittable { originalPause.tap() }
        guard let play = sponsorPlayButton(app) else { XCTFail("Kein erreichbarer originaler Playknopf."); return }
        play.tap()
        XCTAssertTrue(showOriginalControls())
        guard let firstElapsed = sponsorElapsed(app) else {
            throw XCTSkip("Originale YouTube-AX liefert keine bestätigte Sekundentimeline; Vollbild nicht als Playbacknachweis werten.")
        }
        XCTAssertTrue(boundedWait(12) { showOriginalControls() && (self.sponsorElapsed(app) ?? -1) >= firstElapsed + 2 }, "Echter Play startet keine fortschreitende Timeline.")
        let original = try XCTUnwrap(videoOther())
        let baseline = original.frame
        facts.append("baselineVideoOther=\(baseline)")
        XCTAssertEqual(baseline.width, app.frame.width, accuracy: 8)
        XCTAssertEqual(baseline.height, baseline.width * 9 / 16, accuracy: 8)
        XCTAssertGreaterThan(baseline.height, 100)

        for cycle in 0..<2 {
            // One verified cycle is retained if the 120-s runner budget cannot
            // safely fit another; record this scenario explicitly as not run.
            if cycle == 1 && deadline - ProcessInfo.processInfo.systemUptime < 32 {
                facts.append("secondMixedCycle=not-run (less than 32s remaining)")
                break
            }
            phase = "cycle \(cycle + 1): enter"
            XCTAssertTrue(showOriginalControls())
            if !originalPause.isHittable {
                guard let cyclePlay = sponsorPlayButton(app) else { XCTFail("Echter Playknopf vor Mischzyklus fehlt."); return }
                cyclePlay.tap()
                XCTAssertTrue(showOriginalControls())
            }
            XCTAssertTrue(boundedWait(5) { originalPause.exists && originalPause.isHittable }, "Mischzyklus beginnt ohne laufende Wiedergabe.")
            let enter = app.buttons.matching(NSPredicate(format: "label IN %@", ["Vollbild", "Full screen"]))
                .allElementsBoundByIndex.first { $0.exists && $0.isHittable }
            guard let enter else { XCTFail("Originaler Vollbildknopf fehlt oder ist verdeckt."); return }
            enter.tap()
            XCTAssertTrue(boundedWait(10) { fullscreenRegion() != nil }, "Eigene Vollbildregion fehlt; AV- oder fremde Controls werden nicht ersetzt.")
            let fs = try XCTUnwrap(fullscreenRegion())
            XCTAssertTrue(showFullscreenControls(fs), "Eigene Vollbildcontrols lassen sich nicht zeigen.")
            if cycle == 0 {
                // Real pointer holds in the shipping fullscreen background;
                // diagnostic observer only reads the physical media rate.
                let holdStatus = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready=")).firstMatch
                XCTAssertTrue(boundedWait(5) { holdStatus.exists && holdStatus.label.contains("ready=true") })
                for (index, side) in [0.20, 0.90].enumerated() {
                    fs.coordinate(withNormalizedOffset: CGVector(dx: side, dy: 0.50)).press(forDuration: 1.2)
                    record(app, name: "09-fullscreen-hold-\(index + 1)")
                    XCTAssertFalse(app.menuItems.matching(NSPredicate(format: "label IN %@", ["Kopieren", "Nachschlagen", "Übersetzen", "Copy", "Look Up", "Translate"])).firstMatch.exists, "Vollbild-Hold konkurriert mit Textauswahl/Kopierenmenü.")
                    XCTAssertTrue(boundedWait(5) {
                        holdStatus.exists && holdStatus.label.contains("held=\(index + 1)") &&
                        holdStatus.label.contains("heldRate=2") && holdStatus.label.contains("releasedRate=1") && holdStatus.label.contains("heldBadgeVisible=true") &&
                        holdStatus.label.contains("releaseEvent=pointerup")
                    }, "Vollbild-Hold hat keine tatsächliche 2×-Rate mit anschließender Restauration.")
                }
                XCTAssertTrue(showFullscreenControls(fs))
            }
            // FullscreenMotion intentionally makes the original YouTube
            // ancestors inert. Original media AX is unavailable in this pose;
            // examine actual screenshot pixels separately from control AX.
            facts.append("cycle\(cycle + 1)FullscreenControlsFrame=\(fs.frame); appFrame=\(app.frame); imageGeometry=visual-review-required")
            record(app, name: "09-fullscreen-cycle-\(cycle + 1)", detail: facts.last ?? "")
            let fullImage = XCTAttachment(screenshot: app.screenshot())
            fullImage.name = "09-fullscreen-cycle-\(cycle + 1)"
            fullImage.lifetime = .keepAlways
            add(fullImage)
            XCTAssertFalse(collapse.exists && collapse.isHittable, "Native Verkleinernsteuerung liegt über eigener Vollbildsteuerung.")

            phase = "cycle \(cycle + 1): pause and UI seek"
            XCTAssertTrue(showFullscreenControls(fs), "Nach Screenshot ausgeblendete Controls nicht erneut erreichbar.")
            let pause = fs.buttons["Pause"], resume = fs.buttons["Wiedergabe"]
            XCTAssertTrue(boundedWait(5) { pause.exists && pause.isHittable })
            pause.tap()
            XCTAssertTrue(boundedWait(5) { resume.exists && resume.isHittable })
            let before = try XCTUnwrap(fullscreenTime(fs), "Keine unabhängige Sekundenposition im eigenen Vollbild.")
            let forward = fs.buttons["10 Sekunden vor"], back = fs.buttons["10 Sekunden zurück"]
            XCTAssertTrue(forward.exists && forward.isHittable && back.exists && back.isHittable)
            XCTAssertTrue(fs.sliders["Videoposition"].exists && fs.sliders["Videoposition"].isHittable)
            forward.tap()
            XCTAssertTrue(boundedWait(5) {
                guard let now = fullscreenTime(fs) else { return false }
                return now >= before + 8 && now <= before + 12
            }, "Vorwärtstipp zeigt keinen echten 10-s-Positionssprung.")
            back.tap()
            XCTAssertTrue(boundedWait(5) { abs((fullscreenTime(fs) ?? -999) - before) <= 2 }, "Zurücktipp restauriert die vorherige Position nicht.")
            let pausedTime = try XCTUnwrap(fullscreenTime(fs))
            resume.tap()
            XCTAssertTrue(boundedWait(5) { pause.exists && pause.isHittable })
            XCTAssertTrue(boundedWait(8) { showFullscreenControls(fs) && (fullscreenTime(fs) ?? -1) >= pausedTime + 2 }, "Wiedergabe im Vollbild setzt Timeline nicht fort.")
            if !pause.isHittable { XCTAssertTrue(showFullscreenControls(fs)) }
            pause.tap()
            XCTAssertTrue(boundedWait(5) { resume.exists && resume.isHittable })

            phase = "cycle \(cycle + 1): exit and surface recovery"
            // Both labels are shipping data-action=exit. Generic Zurück is
            // native feedBack; generic Schließen closes the mini card instead.
            let exit = fs.buttons[cycle == 0 ? "Vollbild schließen" : "Vollbild verkleinern"]
            XCTAssertTrue(exit.exists && exit.isHittable, "Eigener Exitknopf fehlt.")
            exit.tap()
            XCTAssertTrue(boundedWait(10) {
                guard let media = videoOther() else { return false }
                return fullscreenRegion() == nil && collapse.exists && collapse.isHittable && frameMatches(media.frame, baseline)
            }, "Fullscreen-Rückweg stellt Inline-Pose oder Oberfläche nicht wieder her.")
            XCTAssertTrue(boundedWait(5) { downloads.exists && downloads.isHittable && sponsor.exists && sponsor.isHittable }, "Watchdetails bleiben verborgen, inert oder verdeckt.")
            facts.append("cycle\(cycle + 1)InlineVideoOther=\(try XCTUnwrap(videoOther()).frame)")

            phase = "cycle \(cycle + 1): mini and expanded"
            collapse.tap()
            XCTAssertTrue(boundedWait(8) { mini.exists && mini.isHittable && mini.frame.height > 0 && mini.frame.height < app.frame.height * 0.5 })
            mini.tap()
            XCTAssertTrue(boundedWait(8) {
                guard let media = videoOther() else { return false }
                return collapse.exists && collapse.isHittable && frameMatches(media.frame, baseline) && downloads.isHittable && sponsor.isHittable
            }, "Mini-Rückweg verliert ursprüngliche Videogeometrie oder Watchbedienung.")
            completedCycles += 1
        }
        XCTAssertGreaterThanOrEqual(completedCycles, 1)
        phase = "finished"
    }

    @MainActor func test10RepeatedHomeSubscriptionsTabs() {
        let app = launchInstalledApp()
        let home = app.buttons.matching(NSPredicate(format: "label IN %@", ["Startseite", "Home"])).firstMatch
        let subscriptions = app.buttons.matching(NSPredicate(format: "label IN %@", ["Abos", "Subscriptions"])).firstMatch
        XCTAssertTrue(waitUntil(20, { home.exists && home.isHittable && subscriptions.exists && subscriptions.isHittable }), "Beide Feedtabs müssen tatsächlich erreichbar sein.")
        home.tap()
        XCTAssertTrue(waitUntil(20, { home.isSelected && !subscriptions.isSelected }))
        subscriptions.tap()
        // A signed-out subscription page is legitimate. This test neither
        // signs in nor subscribes; Selected comes from YouTube's actual DOM.
        XCTAssertTrue(waitUntil(20, { subscriptions.isSelected && !home.isSelected }), "Aboswechsel erreicht keinen eindeutig ausgewählten Tab.")
        record(app, name: "10-tabs-before-bursts")

        for burst in 0..<2 {
            let first = burst == 0 ? home : subscriptions
            let last = burst == 0 ? subscriptions : home
            XCTAssertTrue(first.isHittable && last.isHittable)
            for _ in 0..<3 {
                first.tap()
                last.tap()
            }
            XCTAssertTrue(waitUntil(15, {
                home.isHittable && subscriptions.isHittable && last.isSelected && !first.isSelected
            }), "Wiederholte Tabkontakte verlieren das letzte Ziel oder die nächste Bedienung.")
            record(app, name: "10-tabs-after-burst-\(burst + 1)", detail: "Six alternating real XCTest taps, without explicit intermediate waits. Last target: \(last.label). XCTest itself waits for UI quiescence; no sub-180-ms/FPS claim.")
        }

        let search = app.buttons["In YouTube suchen"]
        XCTAssertTrue(waitUntil(10, { search.exists && search.isHittable }), "Suchknopf nach den Tabwechseln fehlt oder ist verdeckt.")
        search.tap()
        XCTAssertTrue(waitUntil(15, { self.searchField(app) != nil }), "Nach Tabwechseln öffnet sich kein erreichbares Suchfeld.")
        record(app, name: "10-tabs-search-still-operable")
    }
    // This draft is inserted only after the baseline audit releases Simulator.
    @MainActor private func zoomNumber(_ probe: XCUIElement, _ key: String) -> Double? {
        guard probe.exists else { return nil }
        return probe.label.components(separatedBy: " ").first { $0.hasPrefix(key + "=") }
            .flatMap { Double($0.dropFirst(key.count + 1)) }
    }

    @MainActor private func zoomVideo(_ app: XCUIApplication) -> XCUIElement? {
        let query = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@",
            "Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film,"))
        guard query.count == 1 else { return nil }
        let video = query.firstMatch
        guard video.exists, video.frame.width > 100, video.frame.height > 100,
              let raw = video.value as? String, sponsorSeconds(raw) != nil else { return nil }
        return video
    }

    @MainActor private func zoomRegion(_ app: XCUIApplication) -> XCUIElement? {
        let query = app.otherElements.matching(NSPredicate(format: "label IN %@",
            ["Vollbild-Videoplayer", "Vollbild-Videoplayer, Bereich"]))
        guard query.count == 1 else { return nil }
        let region = query.firstMatch
        return region.exists && region.frame.width > 100 && region.frame.height > 100 ? region : nil
    }

    @MainActor private func showZoomControls(_ fs: XCUIElement) -> Bool {
        let close = fs.buttons["Vollbild schließen"]
        if close.exists && close.isHittable { return true }
        fs.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28)).tap()
        return waitUntil(5) { close.exists && close.isHittable }
    }

    @MainActor private func zoomSession() throws -> (XCUIApplication, XCUIElement, XCUIElement, CGRect, TimeInterval) {
        let began = ProcessInfo.processInfo.systemUptime
        XCUIDevice.shared.orientation = .portrait
        let app = launchInstalledApp(videoID: "aqz-KE-bpKQ", holdProbe: true)
        let collapse = app.buttons["Verkleinern"]
        XCTAssertTrue(waitUntil(25) { collapse.exists && collapse.isHittable })
        let probe = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready=")).firstMatch
        XCTAssertTrue(probe.waitForExistence(timeout: 10))
        if !probe.label.contains("ready=true") {
            guard let play = sponsorPlayButton(app) else { record(app, name: "zoom-play-prerequisite"); XCTFail("Kein normaler Playzugang."); throw NSError(domain: "ZoomPlayback", code: 1) }
            play.tap()
        }
        XCTAssertTrue(waitUntil(10) { probe.exists && probe.label.contains("ready=true") })
        XCTAssertTrue(waitUntil(5) { self.zoomVideo(app) != nil })
        let baseline = try XCTUnwrap(zoomVideo(app)).frame
        var enter = app.buttons.matching(NSPredicate(format: "label IN %@", ["Vollbild", "Full screen"]))
            .allElementsBoundByIndex.first { $0.exists && $0.isHittable }
        if enter == nil, let player = sponsorPlayer(app) {
            player.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30)).tap()
            XCTAssertTrue(waitUntil(5) {
                enter = app.buttons.matching(NSPredicate(format: "label IN %@", ["Vollbild", "Full screen"]))
                    .allElementsBoundByIndex.first { $0.exists && $0.isHittable }
                return enter != nil
            })
        }
        try XCTUnwrap(enter, "Originaler Vollbildknopf fehlt.").tap()
        XCTAssertTrue(waitUntil(10) { self.zoomRegion(app) != nil })
        let fs = try XCTUnwrap(zoomRegion(app))
        XCTAssertGreaterThan(fs.frame.width, fs.frame.height)
        // Hide the real controls before pinching through the central picture.
        if fs.buttons["Vollbild schließen"].exists && fs.buttons["Vollbild schließen"].isHittable {
            fs.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28)).tap()
        }
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - began, 45,
            "Die 60-s-Leseprobe muss für die folgenden Kontakte noch aktuell sein.")
        return (app, probe, fs, baseline, began)
    }

    @MainActor func test11ActualFullscreenPinchPanAndReset() throws {
        let (app, probe, fs, _, began) = try zoomSession()
        defer { XCUIDevice.shared.orientation = .portrait }
        let viewport = fs.frame, rate = try XCTUnwrap(zoomNumber(probe, "rate"))
        let beforeImage = XCTAttachment(screenshot: app.screenshot()); beforeImage.name = "11-original-video"; beforeImage.lifetime = .keepAlways; add(beforeImage)
        fs.pinch(withScale: 2, velocity: 1.5)
        XCTAssertTrue(waitUntil(8) { (self.zoomNumber(probe, "zoom") ?? 0) > 1.25 })
        let scale = try XCTUnwrap(zoomNumber(probe, "zoom"))
        XCTAssertGreaterThan(zoomNumber(probe, "w") ?? 0, viewport.width * 1.2)
        XCTAssertEqual(fs.frame.width, viewport.width, accuracy: 8)
        XCTAssertEqual(fs.frame.height, viewport.height, accuracy: 8)
        XCTAssertEqual(zoomNumber(probe, "rate"), rate)
        XCTAssertTrue(probe.label.contains("zoomGesturing=false"))
        record(app, name: "11-actual-pinch", detail: probe.label)
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "11-enlarged-video"; image.lifetime = .keepAlways; add(image)
        let x = zoomNumber(probe, "zoomX") ?? 0
        fs.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25))
            .press(forDuration: 0.05, thenDragTo: fs.coordinate(withNormalizedOffset: CGVector(dx: 0.68, dy: 0.32)), withVelocity: .slow, thenHoldForDuration: 0)
        XCTAssertTrue(waitUntil(5) { abs((self.zoomNumber(probe, "zoomX") ?? x) - x) > 10 })
        XCTAssertEqual(zoomNumber(probe, "zoom") ?? 0, scale, accuracy: 0.1)
        XCTAssertEqual(zoomNumber(probe, "rate"), rate)
        record(app, name: "11-actual-pan", detail: probe.label)
        let heldBefore = zoomNumber(probe, "held") ?? 0
        fs.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).press(forDuration: 1.2)
        XCTAssertTrue(waitUntil(5) {
            (self.zoomNumber(probe, "held") ?? 0) > heldBefore &&
            self.zoomNumber(probe, "heldRate") == 2 && self.zoomNumber(probe, "releasedRate") == rate &&
            probe.label.contains("heldBadgeVisible=true") && probe.label.contains("releaseEvent=pointerup")
        }, "Stationärer 2×-Hold im Zoom verliert Tempo oder sichtbare Anzeige.")
        XCTAssertEqual(zoomNumber(probe, "rate"), rate)
        record(app, name: "11-held-zoom-restored", detail: probe.label)
        XCTAssertTrue(showZoomControls(fs))
        let reset = fs.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Zoom ", "zurücksetzen")).firstMatch
        XCTAssertTrue(reset.exists && reset.isHittable)
        XCTAssertGreaterThanOrEqual(reset.frame.width, 44); XCTAssertGreaterThanOrEqual(reset.frame.height, 44)
        XCTAssertFalse(reset.frame.intersects(fs.buttons["Vollbild schließen"].frame))
        reset.tap()
        XCTAssertTrue(waitUntil(5) { abs((self.zoomNumber(probe, "zoom") ?? 0) - 1) < 0.01 })
        XCTAssertEqual(zoomNumber(probe, "w") ?? 0, viewport.width, accuracy: 8)
        XCTAssertEqual(zoomNumber(probe, "h") ?? 0, viewport.height, accuracy: 8)
        XCTAssertEqual(zoomNumber(probe, "rate"), rate)
        XCTAssertFalse(reset.exists)
        record(app, name: "11-reset-to-original", detail: probe.label)
        let resetImage = XCTAttachment(screenshot: app.screenshot()); resetImage.name = "11-reset-video"; resetImage.lifetime = .keepAlways; add(resetImage)
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - began, 55, "Keine stale Probe als Erfolg verwenden.")
    }

    @MainActor func test12EnlargedFullscreenExitRestoresInlineAndMini() throws {
        let (app, probe, fs, baseline, began) = try zoomSession()
        defer { XCUIDevice.shared.orientation = .portrait }
        fs.pinch(withScale: 2, velocity: 1.5)
        XCTAssertTrue(waitUntil(8) { (self.zoomNumber(probe, "zoom") ?? 0) > 1.25 })
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - began, 55, "Zoomassertion vor Ablauf der Leseprobe.")
        record(app, name: "12-enlarged-before-exit", detail: probe.label)
        XCTAssertTrue(showZoomControls(fs))
        fs.buttons["Vollbild verkleinern"].tap()
        func matches(_ rect: CGRect) -> Bool {
            abs(rect.minX-baseline.minX)<=8 && abs(rect.minY-baseline.minY)<=8 &&
            abs(rect.width-baseline.width)<=8 && abs(rect.height-baseline.height)<=8
        }
        let collapse = app.buttons["Verkleinern"]
        XCTAssertTrue(waitUntil(10) {
            guard let video = self.zoomVideo(app) else { return false }
            return self.zoomRegion(app) == nil && collapse.exists && collapse.isHittable && matches(video.frame)
        }, "Vergrößerter Vollbildausschnitt bleibt beim Inline-Rückweg erhalten.")
        record(app, name: "12-inline-restored", detail: probe.label)
        // Fresh normal controls remain usable after the zoom gesture and exit.
        collapse.tap()
        let mini = app.buttons["Video vergrößern"]
        XCTAssertTrue(waitUntil(10) { mini.exists && mini.isHittable && mini.frame.height < app.frame.height*0.5 })
        mini.tap()
        XCTAssertTrue(waitUntil(10) {
            guard let video = self.zoomVideo(app) else { return false }
            return collapse.exists && collapse.isHittable && matches(video.frame)
        })
        record(app, name: "12-mini-expanded-restored")
    }
    @MainActor func test13ActualHorizontalSwipesSeekFifteenSeconds() throws {
        executionTimeAllowance = 180
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launchInstalledApp(videoID:"aqz-KE-bpKQ",holdProbe:true)
        let collapse = app.buttons["Verkleinern"]
        XCTAssertTrue(waitUntil(25){collapse.exists && collapse.isHittable})
        let probe = app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Holdprobe ready=")).firstMatch
        XCTAssertTrue(probe.waitForExistence(timeout:8))
        if !probe.label.contains("ready=true") {
            XCTAssertTrue(sponsorRevealControls(app))
            try XCTUnwrap(sponsorPlayButton(app)).tap()
        }
        XCTAssertTrue(waitUntil(15){probe.exists && probe.label.contains("ready=true") && probe.label.contains("data=aqz-KE-bpKQ")})
        func freshPlaybackState(paused: Bool) -> Bool {
            let sample = zoomNumber(probe, "sample") ?? -1
            return waitUntil(5) {
                guard probe.exists else { return false }
                let label = probe.label
                let next = label.components(separatedBy:" ").first{$0.hasPrefix("sample=")}.flatMap{Double($0.dropFirst(7))} ?? -1
                return label.contains("data=aqz-KE-bpKQ") && label.contains("paused=\(paused)") && next > sample
            }
        }
        let baseline = try XCTUnwrap(zoomVideo(app)).frame
        func matchesOriginal(_ r: CGRect) -> Bool {
            abs(r.minX-baseline.minX)<=8 && abs(r.minY-baseline.minY)<=8 &&
                abs(r.width-baseline.width)<=8 && abs(r.height-baseline.height)<=8
        }
        XCTAssertTrue(sponsorRevealControls(app))
        let pause = app.buttons["Video anhalten"]
        XCTAssertTrue(pause.exists && pause.isHittable);pause.tap()
        XCTAssertTrue(waitUntil(5){self.sponsorPlayButton(app) != nil})
        let start = try XCTUnwrap(sponsorElapsed(app))
        func point(_ x:CGFloat,_ y:CGFloat) -> XCUICoordinate {
            app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:x,dy:y))
        }
        func inlineSwipe(_ from:CGFloat,_ to:CGFloat) {
            point(from,baseline.minY+baseline.height*0.30).press(forDuration:0.05,thenDragTo:point(to,baseline.minY+baseline.height*0.30),withVelocity:.fast,thenHoldForDuration:0)
        }
        // The first actual swipe begins inside the left display edge. Stable
        // picture ownership must allow seeking there instead of native back.
        inlineSwipe(8,baseline.width*0.70)
        XCTAssertTrue(waitUntil(6){guard let t=self.sponsorElapsed(app) else{return false};return abs(t-(start+15))<=1})
        XCTAssertTrue(freshPlaybackState(paused: true));XCTAssertTrue(collapse.exists && collapse.isHittable)
        record(app,name:"13-inline-edge-right-plus15",detail:"before=\(start);after=\(sponsorElapsed(app) ?? -1);\(probe.label)")
        inlineSwipe(baseline.width*0.25,baseline.width*0.75)
        XCTAssertTrue(waitUntil(6){guard let t=self.sponsorElapsed(app) else{return false};return abs(t-(start+30))<=1})
        inlineSwipe(baseline.width*0.78,baseline.width*0.22)
        XCTAssertTrue(waitUntil(6){guard let t=self.sponsorElapsed(app) else{return false};return abs(t-(start+15))<=1})
        XCTAssertTrue(freshPlaybackState(paused: true))
        record(app,name:"13-inline-left-minus15",detail:"expected=\(start+15);actual=\(sponsorElapsed(app) ?? -1);\(probe.label)")
        // A real playing swipe must retain playback, not merely the clock.
        XCTAssertTrue(sponsorRevealControls(app))
        try XCTUnwrap(sponsorPlayButton(app)).tap()
        XCTAssertTrue(freshPlaybackState(paused: false))
        XCTAssertEqual(zoomNumber(probe,"rate"),1)
        let playingSeekBegan = ProcessInfo.processInfo.systemUptime
        let playingStart = try XCTUnwrap(sponsorElapsed(app))
        inlineSwipe(baseline.width*0.25,baseline.width*0.75)
        XCTAssertTrue(waitUntil(4){guard let t=self.sponsorElapsed(app) else{return false};return t-playingStart>=14 && t-playingStart<=20})
        let playingSeekObserved = ProcessInfo.processInfo.systemUptime-playingSeekBegan
        XCTAssertLessThanOrEqual(playingSeekObserved,8,"A 14-s clock jump within8s at1× proves actual seek rather than natural playback.")
        XCTAssertTrue(freshPlaybackState(paused: false))
        XCTAssertTrue(sponsorRevealControls(app))
        XCTAssertTrue(pause.exists && pause.isHittable)
        pause.tap();XCTAssertTrue(waitUntil(5){self.sponsorPlayButton(app) != nil})
        let playingEnd=try XCTUnwrap(sponsorElapsed(app))
        XCTAssertGreaterThanOrEqual(playingEnd-playingStart,14)
        record(app,name:"13-playing-right-plus15",detail:"before=\(playingStart);after normal pause=\(playingEnd);jump observed within\(playingSeekObserved)s at1×;normal playback survived")
        XCTAssertTrue(sponsorRevealControls(app))
        let enter=app.buttons.matching(NSPredicate(format:"label IN %@",["Vollbild","Full screen"]))
            .allElementsBoundByIndex.first{$0.exists && $0.isHittable}
        try XCTUnwrap(enter).tap()
        XCTAssertTrue(waitUntil(10){self.zoomRegion(app) != nil})
        let fs=try XCTUnwrap(zoomRegion(app));XCTAssertTrue(showZoomControls(fs))
        XCTAssertTrue(waitUntil(8){
            let r=fs.frame,a=app.frame
            return r.width>r.height && a.width>a.height && abs(r.width-a.width)<=8 && abs(r.height-a.height)<=8
        },"Calibrate actual landscape AX viewport before sending two-finger input.")
        XCTAssertTrue(fs.buttons["Wiedergabe"].exists && fs.buttons["Wiedergabe"].isHittable)
        XCTAssertTrue(freshPlaybackState(paused: true))
        record(app,name:"13-fullscreen-calibration-before-pinch",detail:"app=\(app.frame);fullscreen=\(fs.frame);\(probe.label)")
        // Actual two-finger input precedes the first fullscreen seek. This
        // catches listener-order phantom contacts after Zoom consumes its ends.
        // Paused fullscreen intentionally keeps its real controls visible.
        // Play explicitly so XCTest's central pinch begins on free picture.
        fs.buttons["Wiedergabe"].tap()
        XCTAssertTrue(freshPlaybackState(paused: false))
        fs.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.28)).tap()
        XCTAssertTrue(waitUntil(5){!fs.buttons["Vollbild schließen"].isHittable && !fs.buttons["Pause"].isHittable},"Send the central pinch only after actual controls are hidden.")
        let pinchRegion=try XCTUnwrap(zoomRegion(app))
        XCTAssertGreaterThan(pinchRegion.frame.width,pinchRegion.frame.height)
        record(app,name:"13-free-fullscreen-before-pinch",detail:"app=\(app.frame);fullscreen=\(pinchRegion.frame);\(probe.label)")
        pinchRegion.pinch(withScale:2,velocity:1.5)
        XCTAssertTrue(waitUntil(8){(self.zoomNumber(probe,"zoom") ?? 0)>1.25})
        XCTAssertTrue(showZoomControls(fs))
        let reset=fs.buttons.matching(NSPredicate(format:"label BEGINSWITH %@ AND label CONTAINS %@","Zoom ","zurücksetzen")).firstMatch
        XCTAssertTrue(reset.exists && reset.isHittable);reset.tap()
        XCTAssertTrue(waitUntil(5){abs((self.zoomNumber(probe,"zoom") ?? 0)-1)<0.01})
        XCTAssertTrue(freshPlaybackState(paused: false))
        record(app,name:"13-pinch-reset-before-first-fullscreen-swipe",detail:probe.label)
        func fullTime() -> Double? {
            let clocks=fs.staticTexts.allElementsBoundByIndex.filter{$0.exists && $0.label.contains(" / ")}
            guard clocks.count==1,let first=clocks[0].label.components(separatedBy:" / ").first else{return nil}
            return sponsorSeconds(first)
        }
        let firstFullSeekBegan=ProcessInfo.processInfo.systemUptime
        let firstFullStart=try XCTUnwrap(fullTime())
        fs.coordinate(withNormalizedOffset:CGVector(dx:0.24,dy:0.30)).press(forDuration:0.05,thenDragTo:fs.coordinate(withNormalizedOffset:CGVector(dx:0.68,dy:0.30)),withVelocity:.fast,thenHoldForDuration:0)
        XCTAssertTrue(showZoomControls(fs))
        XCTAssertTrue(waitUntil(4){guard let t=fullTime() else{return false};return t-firstFullStart>=14 && t-firstFullStart<=20})
        let firstFullSeekObserved=ProcessInfo.processInfo.systemUptime-firstFullSeekBegan
        XCTAssertLessThanOrEqual(firstFullSeekObserved,8)
        XCTAssertTrue(freshPlaybackState(paused:false))
        record(app,name:"13-first-seek-after-pinch-reset",detail:"before=\(firstFullStart);after=\(fullTime() ?? -1);jump within\(firstFullSeekObserved)s at1×;\(probe.label)")
        // Refresh the real idle window before the next deliberate button tap.
        // A control that was visible before the evidence snapshot can otherwise
        // hide while XCTest waits for quiescence and retries its AX lookup.
        let fullClose=fs.buttons["Vollbild schließen"]
        if fullClose.exists && fullClose.isHittable {
            fs.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.28)).tap()
            XCTAssertTrue(waitUntil(5){!fullClose.isHittable})
        }
        fs.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.28)).tap()
        XCTAssertTrue(waitUntil(5){fs.buttons["Pause"].exists && fs.buttons["Pause"].isHittable})
        let fullPause=fs.buttons["Pause"]
        let pauseFrame=fullPause.frame
        XCTAssertGreaterThanOrEqual(pauseFrame.width,44);XCTAssertGreaterThanOrEqual(pauseFrame.height,44)
        point(pauseFrame.midX,pauseFrame.midY).tap()
        XCTAssertTrue(freshPlaybackState(paused:true))
        let fullStart=try XCTUnwrap(fullTime())
        fs.coordinate(withNormalizedOffset:CGVector(dx:0.24,dy:0.30)).press(forDuration:0.05,thenDragTo:fs.coordinate(withNormalizedOffset:CGVector(dx:0.68,dy:0.30)),withVelocity:.fast,thenHoldForDuration:0)
        XCTAssertTrue(showZoomControls(fs))
        XCTAssertTrue(waitUntil(6){guard let t=fullTime() else{return false};return abs(t-(fullStart+15))<=1})
        XCTAssertTrue(fs.buttons["Wiedergabe"].exists && fs.buttons["Wiedergabe"].isHittable)
        fs.coordinate(withNormalizedOffset:CGVector(dx:0.70,dy:0.30)).press(forDuration:0.05,thenDragTo:fs.coordinate(withNormalizedOffset:CGVector(dx:0.25,dy:0.30)),withVelocity:.fast,thenHoldForDuration:0)
        XCTAssertTrue(showZoomControls(fs))
        XCTAssertTrue(waitUntil(6){guard let t=fullTime() else{return false};return abs(t-fullStart)<=1})
        record(app,name:"13-fullscreen-plus-minus15",detail:"original=\(fullStart);recovered=\(fullTime() ?? -1);paused remains paused")
        fs.buttons["Vollbild schließen"].tap()
        XCTAssertTrue(waitUntil(10){guard let video=self.zoomVideo(app) else{return false};return self.zoomRegion(app)==nil && collapse.exists && collapse.isHittable && matchesOriginal(video.frame)})
        record(app,name:"13-swipe-normal-return")
        // Cancel a short native downward card grab, then seek on the next
        // contact without any intervening media/route/overlay action.
        let partialStart = try XCTUnwrap(sponsorElapsed(app))
        point(baseline.width*0.60,baseline.minY+baseline.height*0.30).press(forDuration:0.08,thenDragTo:point(baseline.width*0.60,baseline.minY+baseline.height*0.30+55),withVelocity:.slow,thenHoldForDuration:0.1)
        XCTAssertTrue(waitUntil(8){guard let video=self.zoomVideo(app) else{return false};return collapse.exists && collapse.isHittable && matchesOriginal(video.frame)})
        inlineSwipe(baseline.width*0.25,baseline.width*0.75)
        XCTAssertTrue(waitUntil(6){guard let t=self.sponsorElapsed(app) else{return false};return abs(t-(partialStart+15))<=1})
        XCTAssertTrue(freshPlaybackState(paused: true))
        record(app,name:"13-after-native-cancel-first-swipe",detail:"before=\(partialStart);after=\(sponsorElapsed(app) ?? -1);\(probe.label)")
        collapse.tap()
        let mini=app.buttons["Video vergrößern"]
        XCTAssertTrue(waitUntil(8){mini.exists && mini.isHittable && mini.frame.height<app.frame.height*0.5})
        mini.tap()
        XCTAssertTrue(waitUntil(8){guard let video=self.zoomVideo(app) else{return false};return collapse.exists && collapse.isHittable && matchesOriginal(video.frame)})
        let miniReturnStart=try XCTUnwrap(sponsorElapsed(app))
        inlineSwipe(8,baseline.width*0.70)
        XCTAssertTrue(waitUntil(6){guard let t=self.sponsorElapsed(app) else{return false};return abs(t-(miniReturnStart+15))<=1})
        XCTAssertTrue(freshPlaybackState(paused: true))
        record(app,name:"13-after-mini-return-first-edge-swipe",detail:"before=\(miniReturnStart);after=\(sponsorElapsed(app) ?? -1);\(probe.label)")
    }

}
