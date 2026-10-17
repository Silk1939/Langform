import XCTest

/// Standalone runner: the Langform app is already installed. No application
/// target, source dependency or user data reset is part of this project.
final class DeviceAccessibilityTests: XCTestCase {
    private let bundleID = "de.ipekkaya.langform"

    override func setUpWithError() throws {
        continueAfterFailure = false
        executionTimeAllowance = 120
    }

    @MainActor private func launchInstalledApp(videoID: String? = nil, holdProbe: Bool = false, audibleWatch: Bool = false, backgroundProbe: Bool = false, categoryProbe: Bool = false, visibilityProbe: Bool = false, backgroundBaseline: Bool = false, audioRouteProbe: Bool = false, nativeSearchProbe: Bool = false, commentsStructureProbe: Bool = false, mutedPlayback: Bool = false, settingsDeferredControlProbe: Bool = false) -> XCUIApplication {
        let app = XCUIApplication(bundleIdentifier: bundleID)
        app.launchEnvironment["LANGFORM_DIAGNOSTICS"] = "1"
        if holdProbe { app.launchEnvironment["LANGFORM_HOLD_PROBE"] = "1" }
        if settingsDeferredControlProbe { app.launchEnvironment["LANGFORM_SETTINGS_DEFERRED_CONTROL_PROBE"] = "1" }
        if backgroundProbe { app.launchEnvironment["LANGFORM_BACKGROUND_AUDIO_PROBE"] = "1" }
        if categoryProbe { app.launchEnvironment["LANGFORM_BACKGROUND_CATEGORY_PROBE"] = "1" }
        if visibilityProbe { app.launchEnvironment["LANGFORM_BACKGROUND_VISIBILITY_PROBE"] = "1" }
        if backgroundBaseline { app.launchEnvironment["LANGFORM_BACKGROUND_VISIBILITY_PROBE"] = "0" }
        if audioRouteProbe {
            app.launchEnvironment["LANGFORM_AUDIO_ROUTE_PROBE"] = "1"
            app.launchEnvironment["LANGFORM_GESTURE_INPUT_PROBE"] = "1"
        }
        if nativeSearchProbe { app.launchEnvironment["LANGFORM_NATIVE_SEARCH_PROBE"] = "1" }
        if commentsStructureProbe { app.launchEnvironment["LANGFORM_COMMENTS_STRUCTURE_PROBE"] = "1" }
        if audibleWatch {
            app.launchEnvironment["LANGFORM_VIDEO_PROBE_PLAY"] = "1"
            app.launchEnvironment["LANGFORM_VIDEO_PROBE_AUDIO"] = "1"
        }
        if mutedPlayback { app.launchEnvironment["LANGFORM_VIDEO_PROBE_PLAY"] = "1" }
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
            if rejectCookies.isHittable {
                record(app, name: "00-cookie-reject-before")
                rejectCookies.tap()
                if !waitUntil(5, { !rejectCookies.exists }) {
                    // AX may call a clipped consent button hittable although
                    // the tap lands on the scrollable notice. Bring the same
                    // explicit reject action into view before retrying.
                    for _ in 0..<5 where rejectCookies.exists {
                        app.webViews.firstMatch.swipeUp()
                        if rejectCookies.exists && rejectCookies.isHittable {
                            rejectCookies.tap()
                            if waitUntil(3, { !rejectCookies.exists }) { break }
                        }
                    }
                }
                record(app, name: "00-cookie-reject-after")
                XCTAssertFalse(rejectCookies.exists, "YouTubes optionaler Cookiehinweis wurde nicht geschlossen.")
                if videoID != nil && !rejectCookies.exists {
                    // Consent navigation can consume the one-shot route probe.
                    // Restart with the same probe after the choice is persisted.
                    app.terminate()
                    app.launch()
                    XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30))
                }
            }
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
        // The media may start before YouTube mounts its separate controls.
        for _ in 0..<2 {
            if visible() { return true }
            region.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30)).tap()
            if waitUntil(5, visible) { return true }
        }
        return false
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

    private struct ZoomPlaybackReadback {
        let videoID: String
        let media: Int
        let source: Int
        let sample: Int
        let time: Double
        let rate: Double
        let label: String
    }

    @MainActor private func zoomPlaybackReadback(_ app: XCUIApplication, videoID: String) -> ZoomPlaybackReadback? {
        // Resolve a fresh AX element and parse one coherent report. A total
        // test duration is not evidence that the current sampler is alive.
        guard let label=app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Holdprobe ready="))
            .allElementsBoundByIndex.first?.label else { return nil }
        let values=Dictionary(label.split(separator:" ").compactMap { part -> (String,String)? in
            let pair=part.split(separator:"=",maxSplits:1)
            return pair.count==2 ? (String(pair[0]),String(pair[1])) : nil
        },uniquingKeysWith:{ _,last in last })
        guard values["data"]==videoID,values["ready"]=="true",values["ad"]=="false",
              values["paused"]=="false",values["ended"]=="false",values["seeking"]=="false",
              let media=Int(values["audioMedia"] ?? ""),media>0,
              let source=Int(values["audioSource"] ?? ""),source>0,
              let sample=Int(values["sample"] ?? ""),sample>=0,
              let time=Double(values["time"] ?? ""),time.isFinite,time>=0,
              let rate=Double(values["rate"] ?? ""),rate.isFinite,rate>0 else { return nil }
        return ZoomPlaybackReadback(videoID:videoID,media:media,source:source,sample:sample,time:time,rate:rate,label:label)
    }

    @MainActor private func assertFreshZoomPlayback(_ app: XCUIApplication, matching source: ZoomPlaybackReadback, name: String) throws {
        let anchor=try XCTUnwrap(zoomPlaybackReadback(app,videoID:source.videoID),"Keine aktuelle laufende Probe derselben Video-ID.")
        XCTAssertEqual(anchor.media,source.media,"Der Medienknoten wechselte während der Zoomprüfung.")
        XCTAssertEqual(anchor.source,source.source,"Die Medienquelle wechselte während der Zoomprüfung.")
        XCTAssertGreaterThanOrEqual(anchor.sample,source.sample)
        XCTAssertGreaterThanOrEqual(anchor.time,source.time)
        var observed=anchor
        XCTAssertTrue(waitUntil(4) {
            guard let current=self.zoomPlaybackReadback(app,videoID:source.videoID),
                  current.media==source.media,current.source==source.source,
                  current.rate==source.rate,current.sample>anchor.sample,current.time>anchor.time+0.1 else { return false }
            observed=current
            return true
        },"Probe oder Wiedergabe schreitet nach dem aktuellen Zeitanker auf derselben Quelle nicht fort.")
        record(app,name:name,detail:"anchorSample=\(anchor.sample) anchorTime=\(anchor.time) media=\(anchor.media) source=\(anchor.source)\n\(observed.label)")
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

    @MainActor private func zoomSession() throws -> (XCUIApplication, XCUIElement, XCUIElement, CGRect, ZoomPlaybackReadback) {
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
        let source=try XCTUnwrap(zoomPlaybackReadback(app,videoID:"aqz-KE-bpKQ"),"Keine gebundene laufende Startquelle für die Zoomprüfung.")
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
        try assertFreshZoomPlayback(app,matching:source,name:"zoom-session-current-source-and-progress")
        return (app, probe, fs, baseline, source)
    }

    @MainActor func test11ActualFullscreenPinchPanAndReset() throws {
        let (app, probe, fs, _, source) = try zoomSession()
        defer { XCUIDevice.shared.orientation = .portrait }
        let viewport = fs.frame, rate = try XCTUnwrap(zoomNumber(probe, "rate"))
        let beforeImage = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); beforeImage.name = "11-original-video"; beforeImage.lifetime = .keepAlways; add(beforeImage)
        fs.pinch(withScale: 2, velocity: 1.5)
        XCTAssertTrue(waitUntil(8) { (self.zoomNumber(probe, "zoom") ?? 0) > 1.25 })
        let scale = try XCTUnwrap(zoomNumber(probe, "zoom"))
        XCTAssertGreaterThan(zoomNumber(probe, "w") ?? 0, viewport.width * 1.2)
        XCTAssertEqual(fs.frame.width, viewport.width, accuracy: 8)
        XCTAssertEqual(fs.frame.height, viewport.height, accuracy: 8)
        XCTAssertEqual(zoomNumber(probe, "rate"), rate)
        XCTAssertTrue(probe.label.contains("zoomGesturing=false"))
        record(app, name: "11-actual-pinch", detail: probe.label)
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); image.name = "11-enlarged-video"; image.lifetime = .keepAlways; add(image)
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
        // XCTest begins a pinch-in near the element's corners. Hide the
        // real edge controls so this exercises two picture contacts.
        let pinchClose=fs.buttons["Vollbild schließen"]
        if pinchClose.exists && pinchClose.isHittable {
            fs.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.28)).tap()
            XCTAssertTrue(waitUntil(3) { !pinchClose.isHittable })
        }
        fs.pinch(withScale: 0.20, velocity: -1.5)
        XCTAssertTrue(waitUntil(5) { abs((self.zoomNumber(probe,"zoom") ?? 0)-1)<0.01 },"Zusammenziehen muss direkt zum Originalformat zurückkehren.")
        XCTAssertEqual(zoomNumber(probe,"rate"),rate)
        record(app,name:"11-actual-pinch-in-to-fit",detail:probe.label)
        fs.pinch(withScale: 1.6, velocity: 1.5)
        XCTAssertTrue(waitUntil(5) { (self.zoomNumber(probe,"zoom") ?? 0)>1.25 })
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
        let resetImage = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); resetImage.name = "11-reset-video"; resetImage.lifetime = .keepAlways; add(resetImage)
        try assertFreshZoomPlayback(app,matching:source,name:"11-reset-current-source-and-progress")
    }

    @MainActor func test12EnlargedFullscreenExitRestoresInlineAndMini() throws {
        let (app, probe, fs, baseline, source) = try zoomSession()
        defer { XCUIDevice.shared.orientation = .portrait }
        fs.pinch(withScale: 2, velocity: 1.5)
        XCTAssertTrue(waitUntil(8) { (self.zoomNumber(probe, "zoom") ?? 0) > 1.25 })
        try assertFreshZoomPlayback(app,matching:source,name:"12-zoom-current-source-and-progress")
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
            // Resolve the persistent clock by meaning. A transient swipe
            // status can disappear between indexed AX snapshots while seeking.
            let clocks=fs.staticTexts.matching(NSPredicate(format:"label MATCHES %@","^[0-9]+(?::[0-9]{2}){1,2} / [0-9]+(?::[0-9]{2}){1,2}$"))
            guard clocks.count==1,let first=clocks.firstMatch.label.components(separatedBy:" / ").first else{return nil}
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

    @MainActor func test14NaturalVideoEndKeepsInlineAndFullscreenTouchOperable() throws {
        executionTimeAllowance = 150
        let began = ProcessInfo.processInfo.systemUptime, deadline = began + 140
        XCUIDevice.shared.orientation = .portrait
        // This public short clip reaches its real media end twice. The probe
        // only reads HTMLMediaElement state; no fake ended event or time setter
        // participates in the test's Simulator path.
        let videoID = "jNQXAC9IVRw"
        let app = launchInstalledApp(videoID: videoID, holdProbe: true)
        let collapse = app.buttons["Verkleinern"], mini = app.buttons["Video vergrößern"]
        let probe = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready=")).firstMatch
        var phase = "watch entry", endedViews = [String]()
        var inlineBaseline: CGRect?, inlineDOMRootBaseline: CGRect?, originalMediaRect: CGRect?
        defer {
            record(app, name: "14-natural-end-result", detail: "actualEndedViews=\(endedViews.joined(separator: ",")); finalPhase=\(phase); elapsed=\(ProcessInfo.processInfo.systemUptime - began)s; \(probe.exists ? probe.label : "probe missing")")
            XCUIDevice.shared.orientation = .portrait
        }
        func boundedWait(_ seconds: TimeInterval, _ body: @escaping () -> Bool) -> Bool {
            let remaining = deadline - ProcessInfo.processInfo.systemUptime
            return remaining > 0 && waitUntil(min(seconds, remaining), body)
        }
        func snapshot() -> [String: String] {
            guard probe.exists else { return [:] }
            var values = [String: String]()
            for part in probe.label.split(separator: " ") {
                let pair = part.split(separator: "=", maxSplits: 1)
                if pair.count == 2 { values[String(pair[0])] = String(pair[1]) }
            }
            return values
        }
        func number(_ values: [String: String], _ key: String) -> Double? {
            values[key].flatMap(Double.init)
        }
        func measuredRect(_ values: [String: String], _ key: String? = nil) -> CGRect? {
            let coordinates: [Double]
            if let key {
                guard let raw = values[key]?.split(separator: ":", maxSplits: 1).first else { return nil }
                coordinates = raw.split(separator: ",").compactMap { Double($0) }
            } else {
                coordinates = ["x", "y", "w", "h"].compactMap { number(values, $0) }
            }
            guard coordinates.count == 4, coordinates.allSatisfy(\.isFinite), coordinates[2] > 100, coordinates[3] > 100 else { return nil }
            return CGRect(x: coordinates[0], y: coordinates[1], width: coordinates[2], height: coordinates[3])
        }
        func matches(_ frame: CGRect, _ baseline: CGRect) -> Bool {
            abs(frame.minX - baseline.minX) <= 8 && abs(frame.minY - baseline.minY) <= 8 &&
                abs(frame.width - baseline.width) <= 8 && abs(frame.height - baseline.height) <= 8
        }
        func contained(_ frame: CGRect, in surface: CGRect) -> Bool {
            frame.minX >= surface.minX - 8 && frame.minY >= surface.minY - 8 &&
                frame.maxX <= surface.maxX + 8 && frame.maxY <= surface.maxY + 8
        }
        func visibleEndedSurface(_ view: String, _ values: [String: String]) -> Bool {
            if view == "inline" {
                guard let player = sponsorPlayer(app), let nativeBaseline = inlineBaseline,
                      let domBaseline = inlineDOMRootBaseline, let root = measuredRect(values, "playerRoot") else { return false }
                // YouTube deliberately moves its ended video offscreen. The
                // visible endscreen belongs to movie_player (16:9), whereas
                // this clip's playing media occupies a centered 4:3 box.
                // Verify the actual native/AX endscreen and its DOM owner;
                // never accept an offscreen native card merely because its
                // hidden HTMLVideoElement reports paused+ended.
                let native = player.frame
                let mappedRoot = root.offsetBy(dx: nativeBaseline.minX - domBaseline.minX,
                                              dy: nativeBaseline.minY - domBaseline.minY)
                let reportedValues = ["reportedX", "reportedY", "reportedW", "reportedH"].compactMap { number(values, $0) }
                guard reportedValues.count == 4, values["reportedID"] == videoID,
                      values["reportedState"] == "ended", (number(values, "reportedCount") ?? 0) > 0 else { return false }
                let reported = CGRect(x: reportedValues[0], y: reportedValues[1], width: reportedValues[2], height: reportedValues[3])
                return zoomRegion(app) == nil && collapse.exists && collapse.isHittable &&
                    matches(root, domBaseline) && matches(native, nativeBaseline) &&
                    matches(reported, root) && contained(reported, in: root) &&
                    matches(mappedRoot, native) && contained(native, in: app.frame)
            }
            guard let fs = zoomRegion(app), let media = measuredRect(values) else { return false }
            let frame = fs.frame, viewport = app.frame
            let domViewport = CGRect(x: 0, y: 0, width: Double(frame.width), height: Double(frame.height))
            return frame.width > frame.height && viewport.width > viewport.height &&
                matches(frame, viewport) && contained(frame, in: viewport) &&
                matches(media, domViewport) && contained(media, in: domViewport)
        }
        func twoFreshEndedSamples(_ view: String, timeout: TimeInterval) -> Bool {
            var lastSample = number(snapshot(), "sample") ?? -1, consecutive = 0
            return boundedWait(timeout) {
                let values = snapshot()
                guard let sample = number(values, "sample"), sample > lastSample else { return false }
                lastSample = sample
                guard values["data"] == videoID, values["ended"] == "true", values["paused"] == "true", values["mediaError"] == "0",
                      let current = number(values, "time"), let duration = number(values, "duration"),
                      duration.isFinite, current.isFinite, duration > 0, abs(current - duration) <= 0.35,
                      visibleEndedSurface(view, values) else { consecutive = 0; return false }
                consecutive += 1
                return consecutive >= 2
            }
        }
        func sourceUnavailable() -> Bool {
            let values = snapshot()
            if values["data"] == videoID, let code = number(values, "mediaError"), [2.0, 3.0, 4.0].contains(code) { return true }
            return app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@ OR label CONTAINS[c] %@", "Video nicht verfügbar", "Video ist privat", "Video unavailable")).firstMatch.exists
        }
        func freshState(paused: Bool, ended: Bool, timeout: TimeInterval = 6) -> Bool {
            let previous = number(snapshot(), "sample") ?? -1
            return boundedWait(timeout) {
                let values = snapshot()
                return values["data"] == videoID && values["paused"] == String(paused) && values["ended"] == String(ended) &&
                    values["mediaError"] == "0" && (number(values, "sample") ?? -1) > previous
            }
        }
        func advancingPlayback() -> Bool {
            let previous = snapshot(), time = number(previous, "time") ?? -1
            return boundedWait(6) {
                let values = snapshot()
                return values["data"] == videoID && values["paused"] == "false" && values["ended"] == "false" &&
                    (number(values, "sample") ?? -1) > (number(previous, "sample") ?? -1) &&
                    (number(values, "time") ?? -1) >= time + 0.5
            }
        }
        func cancelInlineNextAutoplayIfPresent() {
            guard zoomRegion(app) == nil, let player = sponsorPlayer(app) else { return }
            let rootFrame = player.frame
            let nextVideo = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@ OR label BEGINSWITH %@", "Nächstes Video in", "Next video in"))
                .allElementsBoundByIndex.first { $0.exists && $0.frame.intersects(rootFrame) }
            guard nextVideo != nil else { return }
            // Cancel only YouTube's actual next-video countdown inside the
            // current visible player. This is an ordinary user tap and does
            // not change the account's or app's autoplay preference.
            let cancels = app.buttons.matching(NSPredicate(format: "label IN %@", ["Abbrechen", "Cancel"]))
            func cancelButton() -> XCUIElement? {
                cancels.allElementsBoundByIndex.first { $0.exists && $0.isHittable && contained($0.frame, in: rootFrame) }
            }
            XCTAssertTrue(boundedWait(2) { cancelButton() != nil }, "Der echte Next-Autoplay-Abbrechenknopf liegt nicht erreichbar in der aktuellen Playercard.")
            guard let cancel = cancelButton() else { return }
            cancel.tap()
            XCTAssertTrue(boundedWait(4) { cancelButton() == nil }, "Der echte Abbrechenkontakt beendet den nächsten YouTube-Autoplaycountdown nicht.")
        }
        func observeNaturalEnd(_ view: String) throws {
            phase = "\(view): wait for actual media end"
            let reached = twoFreshEndedSamples(view, timeout: 26)
            if !reached && sourceUnavailable() { throw XCTSkip("Die echte öffentliche Videoquelle ist ausgefallen; Videoende in \(view) ist damit nicht prüfbar.") }
            XCTAssertTrue(reached, "\(view): Keine zwei frischen paused+ended-Samples am tatsächlichen Clipende mit sichtbarer Endscreen-/Playergeometrie.")
            endedViews.append(view)
            if view == "inline" {
                phase = "inline ended: cancel original next-video countdown"
                cancelInlineNextAutoplayIfPresent()
                XCTAssertTrue(twoFreshEndedSamples("inline", timeout: 6), "Nach dem echten Autoplay-Abbrechen bleiben Quelle, Endzustand oder sichtbare Endscreen-Card nicht stabil.")
                XCTAssertTrue(boundedWait(5) { inlineReplayButton() != nil }, "Nach dem echten Autoplay-Abbrechen erscheint kein erreichbarer originaler Replayknopf.")
            }
            record(app, name: "14-\(view)-actual-ended", detail: probe.label)
            let image = XCTAttachment(screenshot: app.screenshot())
            image.name = "14-\(view)-actual-ended"; image.lifetime = .keepAlways; add(image)
        }
        func inlineReplayButton() -> XCUIElement? {
            // Mobile YouTube can retain its regular Play label on the same
            // control after ending. A real restart and advancing media time,
            // rather than the wording alone, proves this tap performs replay.
            let labels = ["Video wiedergeben", "Video erneut wiedergeben", "Video erneut abspielen", "Erneut wiedergeben", "Wiederholen", "Noch einmal ansehen", "Replay", "Video abspielen", "Video starten", "Wiedergeben", "Play"]
            return app.buttons.matching(NSPredicate(format: "label IN %@", labels)).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
        }
        func enterFullscreen() throws -> XCUIElement {
            let enter = app.buttons.matching(NSPredicate(format: "label IN %@", ["Vollbild", "Full screen"]))
            if !enter.allElementsBoundByIndex.contains(where: { $0.exists && $0.isHittable }), let player = sponsorPlayer(app) {
                player.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30)).tap()
            }
            XCTAssertTrue(boundedWait(5) { enter.allElementsBoundByIndex.contains { $0.exists && $0.isHittable } }, "Nach dem echten Videoende bleibt der Vollbildknopf nicht bedienbar.")
            try XCTUnwrap(enter.allElementsBoundByIndex.first { $0.exists && $0.isHittable }).tap()
            XCTAssertTrue(boundedWait(10) { self.zoomRegion(app) != nil })
            let fs = try XCTUnwrap(zoomRegion(app))
            XCTAssertTrue(boundedWait(8) {
                let frame = fs.frame, viewport = app.frame, values = snapshot()
                guard let media = measuredRect(values) else { return false }
                let domViewport = CGRect(x: 0, y: 0, width: Double(frame.width), height: Double(frame.height))
                return frame.width > frame.height && viewport.width > viewport.height &&
                    abs(frame.width - viewport.width) <= 8 && abs(frame.height - viewport.height) <= 8 &&
                    matches(media, domViewport) && contained(media, in: domViewport)
            }, "Eigene Vollbildregion und tatsächlich beobachtete Videofläche übernehmen die Landscape-Geometrie nicht.")
            return fs
        }

        // A newly routed short clip may keep readyState=0/duration=NaN until
        // the ordinary native or YouTube Play control receives a real tap.
        // First resolve the actual Watch owner, then start through shipping UI;
        // waiting for loaded media before that tap would deadlock this harness.
        let watchReady = boundedWait(25) {
            let values = snapshot()
            return collapse.exists && collapse.isHittable && values["data"] == videoID
        }
        if !watchReady && sourceUnavailable() { throw XCTSkip("Öffentliches Kurzvideo ist aktuell nicht verfügbar; kein Videoende daraus ableiten.") }
        XCTAssertTrue(watchReady, "Watchroute liefert keinen passenden Kurzclip und erreichbaren Player.")
        let initial = snapshot()
        if initial["paused"] == "true" || (number(initial, "mediaReady") ?? 0) < 2 {
            phase = "initial real Play tap"
            if inlineReplayButton() == nil {
                XCTAssertTrue(sponsorRevealControls(app), "Echter Playzugang lässt sich vor dem Laden des Kurzclips nicht zeigen.")
            }
            XCTAssertTrue(boundedWait(5) { inlineReplayButton() != nil }, "Nativer/originaler Playknopf fehlt vor dem initialen Laden.")
            record(app, name: "14-before-initial-real-play", detail: probe.label)
            try XCTUnwrap(inlineReplayButton(), "Echter erster Playkontakt fehlt.").tap()
        }
        phase = "wait for actually loaded short media"
        let ready = boundedWait(25) {
            let values = snapshot()
            return collapse.exists && collapse.isHittable && values["data"] == videoID &&
                (number(values, "mediaReady") ?? 0) >= 2 && (number(values, "duration") ?? 0) > 0
        }
        if !ready && sourceUnavailable() { throw XCTSkip("Öffentliches Kurzvideo ist aktuell nicht verfügbar; kein Videoende daraus ableiten.") }
        XCTAssertTrue(ready, "Watchroute liefert keinen tatsächlich geladenen passenden Kurzclip.")
        let duration = try XCTUnwrap(number(snapshot(), "duration"))
        XCTAssertLessThanOrEqual(duration, 25, "Der Prüffall benötigt eine echte kurze Quelle innerhalb seines Laufzeitbudgets.")
        XCTAssertTrue(boundedWait(5) { self.sponsorPlayer(app) != nil })
        let baseline = try XCTUnwrap(sponsorPlayer(app)).frame
        let originalVideo = snapshot()
        inlineBaseline = baseline
        inlineDOMRootBaseline = try XCTUnwrap(measuredRect(originalVideo, "playerRoot"))
        originalMediaRect = try XCTUnwrap(measuredRect(originalVideo))
        func inlineRestored() -> Bool {
            let values = snapshot()
            guard let player = sponsorPlayer(app), let root = measuredRect(values, "playerRoot"),
                  let originalMedia = originalMediaRect else { return false }
            let frame = player.frame
            guard zoomRegion(app) == nil, collapse.exists, collapse.isHittable, values["data"] == videoID,
                  matches(frame, baseline), contained(frame, in: app.frame) else { return false }
            if values["ended"] == "true" { return values["paused"] == "true" && visibleEndedSurface("inline", values) }
            guard let media = measuredRect(values) else { return false }
            return matches(media, originalMedia) && contained(media, in: root)
        }
        if snapshot()["paused"] == "true" {
            if inlineReplayButton() == nil, let player = sponsorPlayer(app) {
                player.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30)).tap()
            }
            try XCTUnwrap(inlineReplayButton(), "Echter Play-/Replayknopf für den Kurzclip fehlt.").tap()
        }
        XCTAssertTrue(freshState(paused: false, ended: false))
        XCTAssertTrue(advancingPlayback(), "Der Kurzclip muss vor seinem Ende tatsächlich Zeitfortschritt zeigen.")
        try observeNaturalEnd("inline")

        phase = "inline ended: minimize, expand and replay"
        XCTAssertTrue(collapse.exists && collapse.isHittable); collapse.tap()
        XCTAssertTrue(boundedWait(8) { mini.exists && mini.isHittable && mini.frame.height < app.frame.height * 0.5 }, "Echter Verkleinernkontakt wird nach Inline-Ende blockiert.")
        mini.tap()
        XCTAssertTrue(twoFreshEndedSamples("inline", timeout: 8), "Expand nach Videoende stellt keine in zwei frischen Samples sichtbare native Endscreen-Card wieder her.")
        if inlineReplayButton() == nil, let player = sponsorPlayer(app) {
            player.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30)).tap()
        }
        XCTAssertTrue(boundedWait(5) { inlineReplayButton() != nil }, "Inline-Replay ist nach Videoende nicht erreichbar.")
        try XCTUnwrap(inlineReplayButton()).tap()
        XCTAssertTrue(freshState(paused: false, ended: false))
        XCTAssertTrue(boundedWait(6, inlineRestored), "Inline-Replay stellt die originale 4:3-Mediengeometrie nicht innerhalb des aktiven Players wieder her.")
        XCTAssertLessThan(try XCTUnwrap(number(snapshot(), "time")), duration - 3, "Inline-Replay startet nicht wieder vor dem Ende.")
        XCTAssertTrue(advancingPlayback(), "Inline-Replay nimmt die tatsächliche Wiedergabe nicht wieder auf.")

        phase = "enter fullscreen after inline replay"
        let fs = try enterFullscreen()
        record(app, name: "14-fullscreen-after-inline-replay", detail: "app=\(app.frame); fullscreen=\(fs.frame); \(probe.label)")
        try observeNaturalEnd("fullscreen")
        phase = "fullscreen ended: replay, pause and exit"
        let replay = fs.buttons["Wiedergabe"]
        XCTAssertTrue(boundedWait(5) { replay.exists && replay.isHittable }, "Eigener Replayknopf bleibt nach Vollbildende verdeckt oder inert.")
        replay.tap()
        XCTAssertTrue(freshState(paused: false, ended: false))
        XCTAssertLessThan(try XCTUnwrap(number(snapshot(), "time")), duration - 3, "Vollbild-Replay startet nicht wieder vor dem Ende.")
        XCTAssertTrue(advancingPlayback(), "Vollbild-Replay zeigt keinen echten fortschreitenden Medienzustand.")
        XCTAssertTrue(showZoomControls(fs))
        let pause = fs.buttons["Pause"]
        XCTAssertTrue(pause.exists && pause.isHittable); pause.tap()
        XCTAssertTrue(freshState(paused: true, ended: false))
        fs.buttons["Vollbild schließen"].tap()
        XCTAssertTrue(boundedWait(8, inlineRestored), "Echter Exit nach Vollbildende/Replay stellt Inline nicht wieder her.")

        phase = "repeat fullscreen geometry after replay"
        let repeated = try enterFullscreen()
        XCTAssertTrue(showZoomControls(repeated))
        record(app, name: "14-repeated-fullscreen-after-replay", detail: "app=\(app.frame); fullscreen=\(repeated.frame); \(probe.label)")
        repeated.buttons["Vollbild schließen"].tap()
        XCTAssertTrue(boundedWait(8, inlineRestored), "Wiederholter Vollbildrückweg verliert Geometrie oder Touchzugang.")
        phase = "feed touch after both ended views"
        collapse.tap()
        XCTAssertTrue(boundedWait(8) { mini.exists && mini.isHittable && mini.frame.height < app.frame.height * 0.5 })
        let home = app.buttons.matching(NSPredicate(format: "label IN %@", ["Startseite", "Home"])).firstMatch
        let subscriptions = app.buttons.matching(NSPredicate(format: "label IN %@", ["Abos", "Subscriptions"])).firstMatch
        // A fresh, signed-out YouTube session exposes Home/You instead of an
        // Abos tab. Exercise its actual second feed without requiring a login.
        let personal = app.buttons.matching(NSPredicate(format: "label IN %@", ["Mein YouTube", "You", "Du"])).firstMatch
        let alternate = subscriptions.exists ? subscriptions : personal
        XCTAssertTrue(boundedWait(8) { home.exists && home.isHittable && alternate.exists && alternate.isHittable })
        record(app, name: "14-feed-touch-target", detail: "subscriptions available=\(subscriptions.exists); alternate=\(alternate.label)")
        let target = home.isSelected ? alternate : home
        let other = home.isSelected ? home : alternate
        target.tap()
        if subscriptions.exists {
            XCTAssertTrue(boundedWait(8) { target.exists && other.exists && target.isSelected && !other.isSelected && target.isHittable }, "Ein echter Feed-Tabkontakt wird nach Videoende weiter blockiert.")
        } else {
            // The signed-out destination rebuilds its tab AX nodes. Require
            // its actual unique page content instead of a stale button handle.
            let accountPage = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Du bist nicht angemeldet")).firstMatch
            XCTAssertTrue(boundedWait(8) { accountPage.exists && accountPage.isHittable }, "Der echte Kontakt auf Mein YouTube erreicht dessen ausgeloggte Seite nicht.")
        }
        record(app, name: "14-feed-touch-destination")
        XCTAssertEqual(endedViews, ["inline", "fullscreen"])
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - began, 145, "Videoendeprüfung überschreitet ihr bewusst begrenztes Laufzeitbudget.")
        phase = "both real ends and subsequent touch paths verified"
    }

    @MainActor func test33DoubleTapSeeksTenSecondsAndMixedGesturesPreserveAudioState() throws {
        executionTimeAllowance = 180
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        // This source has an encoded audio track with silent creator content.
        // Mute/API/decode observations are evidence, never a speaker test.
        let id = "12XcnOTUy-E"
        let app = launchInstalledApp(videoID: id, holdProbe: true, audibleWatch: true, audioRouteProbe: true)
        let probe = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready=")).firstMatch
        func state() -> [String:String] {
            guard probe.exists else { return [:] }
            return Dictionary(probe.label.split(separator: " ").compactMap { part -> (String,String)? in
                let fields = part.split(separator: "=", maxSplits: 1)
                return fields.count == 2 ? (String(fields[0]),String(fields[1])) : nil
            }, uniquingKeysWith: { _,new in new })
        }
        func number(_ key: String) -> Double { Double(state()[key] ?? "") ?? -1 }
        func soundState(_ paused: Bool) -> Bool {
            let s = state()
            return s["data"] == id && s["paused"] == String(paused) && s["ended"] == "false" && s["seeking"] == "false" &&
                s["muted"] == "false" && s["apiMuted"] == "false" &&
                (Double(s["volume"] ?? "") ?? 0) > 0 && (Double(s["apiVolume"] ?? "") ?? 0) > 0 &&
                s["audioSession"] != "interrupted" && s["mediaError"] == "0"
        }
        XCTAssertTrue(waitUntil(35) { soundState(false) && number("time") > 0.5 })
        let originalMedia = number("audioMedia")
        let revealed = sponsorRevealControls(app)
        if !revealed { record(app,name:"33-original-controls-unavailable",detail:probe.label) }
        XCTAssertTrue(revealed)
        let pause = app.buttons["Video anhalten"]
        XCTAssertTrue(pause.exists && pause.isHittable); pause.tap()
        XCTAssertTrue(waitUntil(6) { soundState(true) })
        let inline = try XCTUnwrap(sponsorPlayer(app)).frame
        func inlinePoint(_ fraction: CGFloat) -> XCUICoordinate {
            app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: inline.minX + inline.width*fraction, dy: inline.minY + inline.height*0.30))
        }
        let start = number("time")
        let singleTapBegan = ProcessInfo.processInfo.systemUptime
        inlinePoint(0.80).tap()
        XCTAssertTrue(waitUntil(3) { soundState(true) && abs(number("time")-start) < 0.6 && ProcessInfo.processInfo.systemUptime-singleTapBegan > 0.4 }, "Ein einzelner Seitentipp darf keine10s-Sequenz auslösen.")
        inlinePoint(0.80).doubleTap()
        XCTAssertTrue(waitUntil(6) { soundState(true) && abs(number("time") - (start+10)) < 0.6 }, "Rechter Doppeltipp spult nicht genau10s vor oder verändert Audio/Pause.")
        inlinePoint(0.20).doubleTap()
        XCTAssertTrue(waitUntil(6) { soundState(true) && abs(number("time") - start) < 0.6 }, "Linker Doppeltipp spult nicht genau10s zurück.")
        record(app,name: "33-inline-doubletap-plus-minus10-paused",detail: probe.label)
        XCTAssertTrue(sponsorRevealControls(app)); try XCTUnwrap(sponsorPlayButton(app)).tap()
        XCTAssertTrue(waitUntil(6) { soundState(false) })
        for (cycle,side) in [CGFloat(0.20),CGFloat(0.80)].enumerated() {
            let held = number("held"), released = number("released")
            inlinePoint(side).press(forDuration: 1.2)
            XCTAssertTrue(waitUntil(5) { soundState(false) && number("held") > held && number("released") > released && number("heldRate") == 2 && number("rate") == 1 }, "Inlinehold verändert Audio oder lässt2× nach Release zurück.")
            let before = number("time"), forward = cycle == 0
            inlinePoint(forward ? 0.25 : 0.75).press(forDuration: 0.05, thenDragTo: inlinePoint(forward ? 0.75 : 0.25), withVelocity: .fast, thenHoldForDuration: 0)
            XCTAssertTrue(waitUntil(6) { soundState(false) && (forward ? number("time")-before >= 14 : before-number("time") >= 9) }, "Gemischter Seek verliert Playback-/Audiozustand.")
            XCTAssertEqual(number("rate"),1)
            record(app,name: "33-inline-mixed-hold-swipe-\(cycle)",detail: probe.label)
        }
        XCTAssertTrue(sponsorRevealControls(app))
        let enter = app.buttons.matching(NSPredicate(format: "label IN %@", ["Vollbild", "Full screen"])).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
        try XCTUnwrap(enter).tap()
        XCTAssertTrue(waitUntil(10) { self.zoomRegion(app) != nil })
        let fs = try XCTUnwrap(zoomRegion(app))
        XCTAssertTrue(showZoomControls(fs)); fs.buttons["Pause"].tap()
        XCTAssertTrue(waitUntil(6) { soundState(true) })
        let fullscreenStart = number("time")
        fs.coordinate(withNormalizedOffset: CGVector(dx:0.80,dy:0.30)).doubleTap()
        XCTAssertTrue(waitUntil(6) { soundState(true) && abs(number("time") - (fullscreenStart+10)) < 0.6 }, "Vollbild-Doppeltipp rechts verliert10s-/Pause-/Audiobindung.")
        fs.coordinate(withNormalizedOffset: CGVector(dx:0.20,dy:0.30)).doubleTap()
        XCTAssertTrue(waitUntil(6) { soundState(true) && abs(number("time") - fullscreenStart) < 0.6 }, "Vollbild-Doppeltipp links verliert10s-/Pause-/Audiobindung.")
        XCTAssertTrue(showZoomControls(fs)); fs.buttons["Wiedergabe"].tap()
        XCTAssertTrue(waitUntil(6) { soundState(false) })
        let fullscreenHeld = number("held")
        fs.coordinate(withNormalizedOffset: CGVector(dx:0.80,dy:0.30)).press(forDuration:1.2)
        XCTAssertTrue(waitUntil(5) { soundState(false) && number("held") > fullscreenHeld && number("rate") == 1 })
        let progression = number("time")
        XCTAssertTrue(waitUntil(5) { soundState(false) && number("time") > progression+0.5 })
        XCTAssertEqual(number("audioMedia"),originalMedia,"Gemischte Kontakte ersetzen unerwartet das physische Medium.")
        record(app,name: "33-fullscreen-doubletap-hold-audio-state",detail: probe.label)
        XCTAssertTrue(showZoomControls(fs)); fs.buttons["Vollbild schließen"].tap()
        XCTAssertTrue(waitUntil(10) { self.zoomRegion(app) == nil && app.buttons["Verkleinern"].isHittable && soundState(false) })
    }

    @MainActor func test34NativeSearchSuggestionsAndResultFiltersOnSixInchDisplay() throws {
        executionTimeAllowance = 220
        XCUIDevice.shared.orientation = .portrait
        let app = launchInstalledApp(nativeSearchProbe:true)
        let search = app.buttons.matching(searchLabel).allElementsBoundByIndex.first { $0.exists && $0.isHittable && $0.frame.minY < 150 }
        try XCTUnwrap(search, "Die feste Headerlupe fehlt.").tap()
        let field = app.textFields["langform-search-field"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "Lupe öffnet keine native Suche.")
        XCTAssertTrue(app.tables["langform-search-suggestions"].exists)
        for name in ["Alle", "Videos", "Kanäle", "Ungesehen"] { XCTAssertTrue(app.buttons[name].exists) }
        XCTAssertTrue(app.buttons["langform-search-filter-videos"].isSelected)
        field.tap(); field.typeText("NASA")
        let suggestions = app.tables["langform-search-suggestions"].cells
        XCTAssertTrue(waitUntil(10) { suggestions.count > 0 }, "Keine tatsächlichen Suchvorschläge zur öffentlichen Query.")
        record(app, name: "34-native-search-with-suggestions")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "34-native-search-61"; shot.lifetime = .keepAlways; add(shot)
        field.typeText("\n")
        func filterControl(_ name:String) -> XCUIElement? {
            app.webViews.firstMatch.descendants(matching:.any).matching(NSPredicate(format:"label == %@",name)).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
        }
        XCTAssertTrue(waitUntil(35) { !field.exists && filterControl("Videos") != nil && app.webViews.firstMatch.descendants(matching:.any).matching(NSPredicate(format:"label CONTAINS[c] %@", "NASA")).count > 0 })
        record(app,name:"34-video-results-before-scroll")
        let videos = filterControl("Videos")
        let firstTop = try XCTUnwrap(videos).frame.minY
        app.webViews.firstMatch.swipeUp()
        XCTAssertTrue(waitUntil(4) { filterControl("Videos").map { abs($0.frame.minY-firstTop) < 2 } == true }, "Suchchips scrollen unter den Statusbereich.")
        let resultShot = XCTAttachment(screenshot: app.screenshot()); resultShot.name = "34-fixed-header-results-after-scroll-61"; resultShot.lifetime = .keepAlways; add(resultShot)
        try XCTUnwrap(filterControl("Kanäle")).tap()
        XCTAssertTrue(waitUntil(30) { filterControl("Kanäle") != nil && app.webViews.firstMatch.descendants(matching:.any).matching(NSPredicate(format:"label CONTAINS[c] %@", "NASA")).count > 0 })
        record(app, name: "34-native-search-and-channel-filter-complete")
    }

    @MainActor func test35PortraitUpFullscreenDownSettingsAndSustainedHold() throws {
        executionTimeAllowance = 240
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launchInstalledApp(videoID:"12XcnOTUy-E", holdProbe:true, audibleWatch:true)
        let probe = app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@", "Holdprobe ready=")).firstMatch
        XCTAssertTrue(waitUntil(35) { probe.exists && probe.label.contains("ready=true") && (self.zoomNumber(probe,"time") ?? 0) > 0.5 })
        func button(_ prefix: String) -> XCUIElement? {
            if prefix == "Autoplay" {
                return app.descendants(matching:.any).matching(NSPredicate(format:"label IN %@",["Autoplay an","Autoplay aus","Autoplay einschalten","Autoplay aktuell nicht verfügbar"])).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
            }
            return app.descendants(matching:.any).matching(NSPredicate(format:"label BEGINSWITH %@",prefix)).allElementsBoundByIndex.first { $0.exists && $0.isHittable && $0.frame.height > 0 }
        }
        XCTAssertTrue(sponsorRevealControls(app))
        try XCTUnwrap(button("Einstellungen")).tap()
        XCTAssertTrue(waitUntil(6) { button("Wiedergabegeschwindigkeit") != nil }, "Das sichtbare Inlinezahnrad öffnet kein Einstellungsblatt.")
        try XCTUnwrap(button("Wiedergabegeschwindigkeit")).tap()
        XCTAssertTrue(waitUntil(4) { button("Tempo 1,5×") != nil })
        try XCTUnwrap(button("Tempo 1,5×")).tap()
        XCTAssertTrue(waitUntil(5) { self.zoomNumber(probe,"rate") == 1.5 })
        XCTAssertTrue(waitUntil(4) { button("Einstellungen schließen") == nil }, "Eine angenommene Tempowahl schließt das Blatt nicht.")
        let inline = try XCTUnwrap(sponsorPlayer(app)).frame
        let held = zoomNumber(probe,"held") ?? 0
        app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:inline.minX+inline.width*0.2,dy:inline.minY+inline.height*0.45)).press(forDuration:3.3)
        XCTAssertTrue(waitUntil(5) { (self.zoomNumber(probe,"held") ?? 0) > held && self.zoomNumber(probe,"heldRate") == 2 && self.zoomNumber(probe,"rate") == 1 && self.zoomNumber(probe,"releasedRate") == 1 })
        XCTAssertGreaterThanOrEqual(zoomNumber(probe,"heldForMs") ?? 0,2600,"Langer2×-Hold bricht vor dem tatsächlichen Release ab.")
        XCTAssertFalse(app.menuItems.matching(NSPredicate(format:"label IN %@",["Kopieren","Nachschlagen","Übersetzen","Copy","Look Up","Translate"])).firstMatch.exists)
        record(app,name:"35-inline-settings-and-long-hold",detail:probe.label)
        let refreshed = try XCTUnwrap(sponsorPlayer(app)).frame
        let begin = app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:refreshed.midX,dy:refreshed.minY+refreshed.height*0.75))
        let end = app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:refreshed.midX,dy:refreshed.minY+refreshed.height*0.10))
        begin.press(forDuration:0.05,thenDragTo:end,withVelocity:.fast,thenHoldForDuration:0)
        XCTAssertTrue(waitUntil(12) { self.zoomRegion(app) != nil }, "Portrait-Swipe-Up öffnet Vollbild nicht.")
        let fs = try XCTUnwrap(zoomRegion(app))
        XCTAssertTrue(showZoomControls(fs))
        try XCTUnwrap(button("Einstellungen")).tap()
        XCTAssertNotNil(button("Qualität")); XCTAssertNotNil(button("Wiedergabegeschwindigkeit")); XCTAssertNotNil(button("Untertitel"))
        record(app,name:"35-fullscreen-settings")
        try XCTUnwrap(button("Einstellungen schließen")).tap()
        XCTAssertTrue(showZoomControls(fs))
        let autoplay = button("Autoplay")
        XCTAssertNotNil(autoplay,"Autoplay ist nicht im Vollbildoverlay vorhanden.")
        if let autoplay, autoplay.isEnabled {
            let label = autoplay.label; autoplay.tap()
            XCTAssertTrue(waitUntil(4) { button("Autoplay")?.label != label })
            button("Autoplay")?.tap()
        } else { record(app,name:"35-autoplay-unavailable-for-public-source") }
        fs.coordinate(withNormalizedOffset:CGVector(dx:0.50,dy:0.26)).press(forDuration:0.05,thenDragTo:fs.coordinate(withNormalizedOffset:CGVector(dx:0.50,dy:0.78)),withVelocity:.fast,thenHoldForDuration:0)
        XCTAssertTrue(waitUntil(12) { self.zoomRegion(app) == nil && app.buttons["Verkleinern"].isHittable },"Freier Vollbild-Swipe-Down beendet Vollbild nicht.")
        let final = try XCTUnwrap(sponsorPlayer(app)).frame
        app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:final.midX,dy:final.minY+final.height*0.40)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.80)),withVelocity:.fast,thenHoldForDuration:0)
        XCTAssertTrue(waitUntil(10) { app.buttons["Video vergrößern"].isHittable },"Portrait-Swipe-Down minimiert nicht.")
        record(app,name:"35-gestures-settings-hold-complete",detail:"Inline→Vollbild→Inline→Mini completed; the hidden player probe is intentionally outside the Mini accessibility tree.")
    }

    @MainActor func test36CommentsSheetExpandsAndDismissesWithActualDrag() throws {
        executionTimeAllowance = 180
        XCUIDevice.shared.orientation = .portrait
        let app = launchInstalledApp(videoID:"aqz-KE-bpKQ",holdProbe:true,commentsStructureProbe:true)
        XCTAssertTrue(waitUntil(30) { app.buttons["Verkleinern"].isHittable })
        func commentCard() -> XCUIElement? {
            app.buttons.matching(NSPredicate(format:"label MATCHES[c] %@", "^(Kommentare|Comments)(,.*| [0-9].*)?$")).allElementsBoundByIndex.first { $0.exists && $0.frame.width > app.frame.width*0.6 && $0.frame.height > 40 }
        }
        func opener() -> XCUIElement? {
            guard let card = commentCard(), let player = sponsorPlayer(app), card.isHittable,
                  card.frame.minY > player.frame.maxY+8, card.frame.maxY < app.frame.maxY-24 else { return nil }
            return card
        }
        _ = waitUntil(12) { commentCard() != nil }
        for _ in 0..<8 where opener() == nil {
            let above = commentCard().map { $0.frame.minY < (self.sponsorPlayer(app)?.frame.maxY ?? 330)+8 } ?? false
            app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:above ? 0.62 : 0.80)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:above ? 0.80 : 0.62)),withVelocity:.slow,thenHoldForDuration:0)
        }
        guard let open = opener() else { record(app,name:"36-public-comments-unavailable"); throw XCTSkip("Öffentliche Quelle bietet keinen eindeutig erreichbaren Kommentaröffner.") }
        record(app,name:"36-before-comments-opener")
        open.tap()
        let structure = app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Commentsprobe ")).firstMatch
        XCTAssertTrue(waitUntil(5) { structure.exists })
        let settleUntil = ProcessInfo.processInfo.systemUptime + 3.2
        XCTAssertTrue(waitUntil(5) { ProcessInfo.processInfo.systemUptime >= settleUntil })
        record(app,name:"36-after-comments-opener")
        XCTAssertTrue(structure.label.contains("\"ownSheets\":1"), "Der Originalöffner zeigt kein vom Kommentarblattadapter erkanntes Sheet.")
        func header() -> XCUIElement? {
            app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH[c] %@","Kommentare")).allElementsBoundByIndex.first { $0.exists && $0.isHittable && $0.frame.minY > 10 }
        }
        XCTAssertTrue(waitUntil(12) { header() != nil })
        let before = try XCTUnwrap(header()).frame
        let point = app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:app.frame.midX,dy:before.midY))
        point.press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:app.frame.midX,dy:max(70,before.midY-280))),withVelocity:.slow,thenHoldForDuration:0)
        record(app,name:"36-after-upward-sheet-drag")
        XCTAssertTrue(structure.label.contains("\"ownSheets\":1"),"Aufwärtsdrag hat das erkannte Kommentarblatt entfernt.")
        XCTAssertTrue(waitUntil(5) { (header()?.frame.minY ?? before.minY) < before.minY-40 },"Kommentarblatt folgt dem Aufwärtsdrag nicht.")
        let expanded = try XCTUnwrap(header()).frame
        let screenshot = XCTAttachment(screenshot:app.screenshot());screenshot.name="36-expanded-comments-with-handle-61";screenshot.lifetime = .keepAlways;add(screenshot)
        app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:app.frame.midX,dy:expanded.midY)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.93)),withVelocity:.fast,thenHoldForDuration:0)
        XCTAssertTrue(waitUntil(8) { header() == nil },"Kommentarblatt wird nach Abwärtsdrag nicht geschlossen.")
        record(app,name:"36-comments-expanded-and-dismissed")
    }

    @MainActor func test37PrefetchedPersonalTabReusesLivePage() throws {
        executionTimeAllowance = 100
        XCUIDevice.shared.orientation = .portrait
        let app = launchInstalledApp()
        func tab(_ names: [String]) -> XCUIElement? {
            app.buttons.matching(NSPredicate(format:"label IN %@",names)).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
        }
        XCTAssertTrue(waitUntil(15) { tab(["Mein YouTube","You","Du"]) != nil && tab(["Startseite","Home"]) != nil })
        // Allow the serial background warmup to finish without opening the tab.
        // Native timing marks are checked separately; this is not a load benchmark.
        let warmUntil = ProcessInfo.processInfo.systemUptime + 6
        XCTAssertTrue(waitUntil(8) { ProcessInfo.processInfo.systemUptime >= warmUntil })
        record(app,name:"37-before-first-personal-tab")
        try XCTUnwrap(tab(["Mein YouTube","You","Du"])).tap()
        let signedOut = app.descendants(matching:.any).matching(NSPredicate(format:"label == %@","Du bist nicht angemeldet")).firstMatch
        XCTAssertTrue(waitUntil(8) { signedOut.exists && signedOut.isHittable })
        record(app,name:"37-first-cached-personal-tab")
        try XCTUnwrap(tab(["Startseite","Home"])).tap()
        XCTAssertTrue(waitUntil(5) { tab(["Mein YouTube","You","Du"]) != nil })
        try XCTUnwrap(tab(["Mein YouTube","You","Du"])).tap()
        XCTAssertTrue(waitUntil(5) { signedOut.exists && signedOut.isHittable })
        record(app,name:"37-reused-personal-tab")
    }

    @MainActor private func autoplayTailWithActualControls(_ app: XCUIApplication, videoID: String, name: String) throws {
        func label() -> String {
            app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Holdprobe ready=")).allElementsBoundByIndex.first?.label ?? ""
        }
        func state() -> [String:String] {
            Dictionary(label().split(separator:" ").compactMap { part -> (String,String)? in
                let pair=part.split(separator:"=",maxSplits:1)
                return pair.count==2 ? (String(pair[0]),String(pair[1])) : nil
            },uniquingKeysWith:{ _,last in last })
        }
        XCTAssertTrue(waitUntil(10) { let v=state();return v["data"]==videoID && v["ad"]=="false" && v["paused"]=="false" && v["ended"]=="false" })
        // Use the actual free left-side swipe lane already exercised by
        // case40 and the normal-launch case46. The original AX reveal action
        // can expose a 12x12 accessibility proxy at the screen origin; that
        // proxy is not the visible video control and is not a tap target.
        let fullscreenEntrySample=try XCTUnwrap(Double(state()["sample"] ?? ""))
        let portraitViewport=app.frame.size
        let expectedFullscreenViewport=CGSize(width:max(portraitViewport.width,portraitViewport.height),height:min(portraitViewport.width,portraitViewport.height))
        let picture=try XCTUnwrap(sponsorPlayer(app)).frame
        app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:picture.minX+picture.width*0.20,dy:picture.minY+picture.height*0.60)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:picture.minX+picture.width*0.20,dy:picture.minY+picture.height*0.08)),withVelocity:.fast,thenHoldForDuration:0)
        let entered=waitUntil(12) {
            let current=state()
            return self.zoomRegion(app) != nil && current["data"]==videoID &&
                current["ad"]=="false" && current["paused"]=="false" && current["ended"]=="false" &&
                (Double(current["sample"] ?? "") ?? -1)>fullscreenEntrySample &&
                current["fsStage"]=="open" && current["fsInert"]=="false" &&
                abs((Double(current["windowW"] ?? "") ?? 0)-expectedFullscreenViewport.width)<2 &&
                abs((Double(current["windowH"] ?? "") ?? 0)-expectedFullscreenViewport.height)<2
        }
        record(app,name:name+"-fullscreen-entry-swipe",detail:"Actual portrait up-swipe on the free left video lane (.20,.60)→(.20,.08); source-bound readiness after sample=\(fullscreenEntrySample); picture=\(picture);\(label())")
        if !entered { record(app,name:name+"-fullscreen-entry-failure",detail:label()) }
        XCTAssertTrue(entered,"Der tatsächliche Aufwärtsswipe erreicht keine frische, quellengebundene und interaktive Vollbildoberfläche.")
        let fullscreen=try XCTUnwrap(zoomRegion(app))
        XCTAssertTrue(showZoomControls(fullscreen));fullscreen.buttons["Pause"].tap()
        XCTAssertTrue(waitUntil(5) { state()["paused"]=="true" })
        let duration=try XCTUnwrap(Double(state()["duration"] ?? ""))
        XCTAssertGreaterThan(duration,90)
        let slider=fullscreen.sliders["Videoposition"]
        XCTAssertTrue(slider.exists && slider.isHittable)
        // Actual accessible slider input only. Leave a substantial tail so the
        // later ended event/countdown is natural, never an exact-end seek.
        // WebKit exposes this HTML range without XCTest scrubber endpoints.
        // Drag the real thumb along its measured track; no AX value assignment.
        let trackWidth=slider.frame.width
        XCTAssertGreaterThan(trackWidth,100)
        let current=try XCTUnwrap(Double(state()["time"] ?? ""))
        let startX=(7+(trackWidth-14)*CGFloat(current/duration))/trackWidth
        let targetX=(7+(trackWidth-14)*CGFloat((duration-35)/duration))/trackWidth
        slider.coordinate(withNormalizedOffset:CGVector(dx:startX,dy:0.5)).press(forDuration:0.08,
            thenDragTo:slider.coordinate(withNormalizedOffset:CGVector(dx:targetX,dy:0.5)),withVelocity:.slow,thenHoldForDuration:0)
        let reached=waitUntil(12) {
            let v=state(),remaining=duration-(Double(v["time"] ?? "") ?? -999)
            return v["data"]==videoID && v["paused"]=="true" && v["seeking"]=="false" && v["ended"]=="false" && remaining>=12 && remaining<=70
        }
        record(app,name:name+"-actual-slider-tail-paused",detail:label())
        XCTAssertTrue(reached,"Der echte Slider muss eine pausierte Restlaufzeit von12–70s erreichen; kein Endseek-/Ended-Ersatz.")
        XCTAssertTrue(showZoomControls(fullscreen));fullscreen.buttons["Vollbild schließen"].tap()
        XCTAssertTrue(waitUntil(12) { self.zoomRegion(app)==nil && self.sponsorPlayer(app) != nil && state()["paused"]=="true" })
        XCTAssertTrue(sponsorRevealControls(app));try XCTUnwrap(sponsorPlayButton(app)).tap()
        let resumed=waitUntil(6) { let v=state();return v["data"]==videoID && v["paused"]=="false" && v["seeking"]=="false" && v["ended"]=="false" }
        record(app,name:name+"-real-play-before-natural-tail",detail:label())
        XCTAssertTrue(resumed,"Normaler Playknopf setzt den verbleibenden Abschnitt vor dem natürlichen Ende nicht fort.")
    }

    @MainActor func test38OriginalAutoplayAdvancesAfterNaturalEnd() throws {
        executionTimeAllowance = 420
        XCUIDevice.shared.orientation = .portrait
        let firstID = "M7lc1UVf-VE"
        let app = launchInstalledApp(videoID:firstID,holdProbe:true,audioRouteProbe:true,mutedPlayback:true)
        let probe = app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Holdprobe ready=")).firstMatch
        defer { record(app,name:"38-final-autoplay-state",detail:probe.exists ? probe.label : "Probe unavailable") }
        XCTAssertTrue(waitUntil(35) { probe.exists && probe.label.contains("data=\(firstID)") && probe.label.contains("ready=true") && probe.label.contains("ad=false") && (self.zoomNumber(probe,"time") ?? 0) > 0.3 })
        func toggle() -> XCUIElement? {
            app.descendants(matching:.any).matching(NSPredicate(format:"label IN %@",["Autoplay an","Autoplay aus","Autoplay einschalten","Autoplay aktuell nicht verfügbar"])).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
        }
        // Natural-end cases require a mounted original preference. Deliberate
        // unknown/deferred enabling is separately exercised by case41.
        func originalPreferenceReady() -> Bool { ["Autoplay an","Autoplay aus"].contains(toggle()?.label ?? "") }
        if !waitUntil(4,originalPreferenceReady) {
            XCTAssertTrue(sponsorRevealControls(app))
        }
        let available=waitUntil(8,originalPreferenceReady)
        record(app,name:"38-original-autoplay-availability",detail:app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Holdprobe ready=")).allElementsBoundByIndex.first?.label ?? "No current probe")
        XCTAssertTrue(available,"Der echte Original-Autoplayschalter wird nicht verfügbar.")
        let original = try XCTUnwrap(toggle()).label
        if original == "Autoplay an" {
            toggle()?.tap()
            XCTAssertTrue(waitUntil(4) { toggle()?.label == "Autoplay aus" })
        }
        toggle()?.tap()
        let onConfirmed=waitUntil(5) { toggle()?.label == "Autoplay an" }
        let currentLabel=app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Holdprobe ready=")).allElementsBoundByIndex.first?.label ?? "Probe unavailable"
        record(app,name:"38-original-autoplay-before-natural-end",detail:currentLabel)
        XCTAssertTrue(onConfirmed,"Autoplay-An wird vor dem natürlichen Ende nicht vom Original bestätigt.")
        try autoplayTailWithActualControls(app,videoID:firstID,name:"38")
        XCTAssertTrue(waitUntil(360) { probe.exists && probe.label.contains("ready=true") && probe.label.contains("ad=false") && probe.label.contains("ended=false") && probe.label.contains("seeking=false") && !probe.label.contains("data=\(firstID)") && !probe.label.contains("data=none") && (self.zoomNumber(probe,"duration") ?? 0) > 30 && (self.zoomNumber(probe,"time") ?? 0) > 0.2 },"Das natürliche Ende und der Originalcountdown öffnen kein laufendes passendes Langvideo.")
        let nextIdentity = probe.label.split(separator:" ").first { $0.hasPrefix("data=") }.map(String.init)
        let nextTime = try XCTUnwrap(zoomNumber(probe,"time"))
        XCTAssertTrue(waitUntil(6) { probe.exists && nextIdentity.map { probe.label.contains($0+" ") } == true && probe.label.contains("ready=true") && probe.label.contains("ended=false") && (self.zoomNumber(probe,"time") ?? 0) > nextTime+0.7 },"Das nächste Langvideo schreitet nicht mit derselben Quelle fort.")
        record(app,name:"38-original-autoplay-next-video",detail:probe.label)
        if original == "Autoplay aus", sponsorRevealControls(app), toggle()?.label == "Autoplay an" { toggle()?.tap() }
    }

    @MainActor func test39AutoplayOffKeepsNaturalEndOnCurrentVideo() throws {
        executionTimeAllowance = 450
        XCUIDevice.shared.orientation = .portrait
        let firstID = "M7lc1UVf-VE"
        let app = launchInstalledApp(videoID:firstID,holdProbe:true,audioRouteProbe:true,mutedPlayback:true)
        let probe = app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Holdprobe ready=")).firstMatch
        defer { record(app,name:"39-final-autoplay-state",detail:probe.exists ? probe.label : "Probe unavailable") }
        XCTAssertTrue(waitUntil(35) { probe.exists && probe.label.contains("ready=true") && probe.label.contains("ad=false") && probe.label.contains("data=\(firstID)") })
        func toggle() -> XCUIElement? {
            app.descendants(matching:.any).matching(NSPredicate(format:"label IN %@",["Autoplay an","Autoplay aus","Autoplay einschalten","Autoplay aktuell nicht verfügbar"])).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
        }
        func originalPreferenceReady() -> Bool { ["Autoplay an","Autoplay aus"].contains(toggle()?.label ?? "") }
        if !waitUntil(4,originalPreferenceReady) {
            XCTAssertTrue(sponsorRevealControls(app))
        }
        let available=waitUntil(8,originalPreferenceReady)
        record(app,name:"39-original-autoplay-availability",detail:app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Holdprobe ready=")).allElementsBoundByIndex.first?.label ?? "No current probe")
        XCTAssertTrue(available,"Der echte Original-Autoplayschalter wird nicht verfügbar.")
        let original = try XCTUnwrap(toggle()).label
        if original == "Autoplay an" { toggle()?.tap() }
        XCTAssertTrue(waitUntil(5) { toggle()?.label == "Autoplay aus" })
        record(app,name:"39-explicit-autoplay-off",detail:probe.label)
        try autoplayTailWithActualControls(app,videoID:firstID,name:"39-off")
        XCTAssertTrue(waitUntil(75) { probe.exists && probe.label.contains("data=\(firstID)") && probe.label.contains("ended=true") && probe.label.contains("seeking=false") })
        let countdownUntil = ProcessInfo.processInfo.systemUptime+7
        XCTAssertTrue(waitUntil(9) { ProcessInfo.processInfo.systemUptime >= countdownUntil })
        XCTAssertTrue(probe.exists && probe.label.contains("data=\(firstID)") && probe.label.contains("ended=true"),"Autoplay aus wechselt nach dem natürlichen Ende trotzdem die Quelle.")
        record(app,name:"39-autoplay-off-after-original-countdown",detail:probe.label)
        if toggle()?.label == "Autoplay aus" { toggle()?.tap() }
        XCTAssertTrue(waitUntil(5) { toggle()?.label == "Autoplay an" })
        backgroundMiniPlaybackTap(app,pause:false)
        XCTAssertTrue(waitUntil(10) { probe.exists && probe.label.contains("data=\(firstID)") && probe.label.contains("ready=true") && probe.label.contains("ad=false") && probe.label.contains("ended=false") && (self.zoomNumber(probe,"time") ?? 999) < 10 })
        record(app,name:"39-replay-with-autoplay-on",detail:probe.label)
        try autoplayTailWithActualControls(app,videoID:firstID,name:"39-replay-on")
        XCTAssertTrue(waitUntil(360) { probe.exists && probe.label.contains("ready=true") && probe.label.contains("ad=false") && probe.label.contains("ended=false") && probe.label.contains("seeking=false") && !probe.label.contains("data=\(firstID)") && (self.zoomNumber(probe,"duration") ?? 0) > 30 && (self.zoomNumber(probe,"time") ?? 0) > 0.2 },"Nach Aus→Ende→An→Replay folgt kein laufendes nächstes Langvideo.")
        let next = probe.label.split(separator:" ").first { $0.hasPrefix("data=") }.map(String.init)
        let before = try XCTUnwrap(zoomNumber(probe,"time"))
        XCTAssertTrue(waitUntil(6) { probe.exists && next.map { probe.label.contains($0+" ") } == true && probe.label.contains("ready=true") && (self.zoomNumber(probe,"time") ?? 0) > before+0.7 })
        record(app,name:"39-autoplay-on-after-replay-next",detail:probe.label)
        if original == "Autoplay aus", toggle()?.label == "Autoplay an" { toggle()?.tap() }
    }

    @MainActor func test40LiveQualityAndCaptionSettings() throws {
        executionTimeAllowance = 180
        XCUIDevice.shared.orientation = .portrait
        let id = "M7lc1UVf-VE"
        let app = launchInstalledApp(videoID:id,holdProbe:true,commentsStructureProbe:true,mutedPlayback:true)
        let probe = app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Holdprobe ready=")).firstMatch
        defer { record(app,name:"40-final-source-and-settings-state",detail:probe.exists ? probe.label : "Probe outside modal accessibility tree") }
        func value(_ key:String) -> String? {
            guard probe.exists else { return nil }
            return probe.label.split(separator:" ").first { $0.hasPrefix(key+"=") }.map { String($0.dropFirst(key.count+1)) }
        }
        func captionSnapshot() -> [String:Any]? {
            let geometry=app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Commentsprobe ")).firstMatch
            guard geometry.exists,let bytes=String(geometry.label.dropFirst("Commentsprobe ".count)).data(using:.utf8) else { return nil }
            return (try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any]
        }
        func captionSnapshotMatches(_ state:[String:Any],afterSample:Int,viewport:CGSize) -> Bool {
            guard let sample=state["sample"] as? Int,sample>afterSample,
                  let measured=state["viewport"] as? [Double],measured.count==2 else { return false }
            return abs(measured[0]-viewport.width)<2 && abs(measured[1]-viewport.height)<2
        }
        func captionGeometryIssue(fullscreen:Bool,afterSample:Int = -1,viewport:CGSize) -> String? {
            guard let state=captionSnapshot() else { return "Voraussetzung fehlt: keine lesbare Caption-Geometrieprobe." }
            guard captionSnapshotMatches(state,afterSample:afterSample,viewport:viewport) else {
                return "Voraussetzung fehlt: veraltete Probe oder anderer Viewport (sample=\(state["sample"] ?? "nil"), viewport=\(state["viewport"] ?? "nil"))."
            }
            guard let layout=state["captionLayout"] as? [String:Any],
                  let windows=layout["windows"] as? [[String:Any]],let allControls=layout["controls"] as? [[String:Any]] else {
                return "Voraussetzung fehlt: Caption-/Controlrechtecke nicht vorhanden."
            }
            let captions=windows.filter { ($0["visible"] as? Bool)==true && ($0["classes"] as? [String])?.contains("caption-window")==true }
            let controls=allControls.filter { ($0["visible"] as? Bool)==true && ($0["name"] as? String)?.hasPrefix(fullscreen ? "fullscreen-" : "inline-")==true }
            guard !captions.isEmpty else { return "Voraussetzung fehlt: aktuell kein sichtbares Captionfenster; kein Kollisionspass." }
            guard controls.contains(where:{ ($0["name"] as? String)==(fullscreen ? "fullscreen-time" : "inline-bottom") }) else {
                return "Voraussetzung fehlt: erforderliche Controls sind ausgeblendet; kein Kollisionspass."
            }
            func box(_ item:[String:Any]) -> CGRect? {
                guard let r=item["rect"] as? [Double],r.count==4,r.allSatisfy({ $0.isFinite }),r[2]>0,r[3]>0 else { return nil }
                return CGRect(x:r[0],y:r[1],width:r[2],height:r[3])
            }
            for caption in captions {
                guard let rectangle=box(caption) else { return "Voraussetzung fehlt: ungültiges Captionrechteck." }
                for control in controls {
                    guard let obstacle=box(control) else { return "Voraussetzung fehlt: ungültiges Controlrechteck." }
                    let intersection=rectangle.intersection(obstacle)
                    if !intersection.isNull && intersection.width>=0.5 && intersection.height>=0.5 {
                        return "Kollision: Caption \(rectangle) mit \(control["name"] ?? "Control") \(obstacle); Schnitt \(intersection)."
                    }
                }
            }
            return nil
        }
        func action(_ prefix:String) -> XCUIElement? {
            if prefix == "Untertitel" {
                return app.buttons.matching(NSPredicate(format:"label BEGINSWITH %@",prefix)).allElementsBoundByIndex.first { $0.exists && $0.isHittable && $0.frame.minY > app.frame.height*0.5 }
            }
            return app.descendants(matching:.any).matching(NSPredicate(format:"label BEGINSWITH %@",prefix)).allElementsBoundByIndex.first { $0.exists && $0.isHittable && (prefix != "Untertitel" || $0.frame.minY > app.frame.height*0.5) }
        }
        func tap(_ prefix:String) throws {
            var frame:CGRect?, stableSince=ProcessInfo.processInfo.systemUptime
            XCTAssertTrue(waitUntil(6) {
                guard let item=action(prefix),item.isEnabled else { frame=nil;stableSince=ProcessInfo.processInfo.systemUptime;return false }
                let next=item.frame
                if frame != next { frame=next;stableSince=ProcessInfo.processInfo.systemUptime;return false }
                return ProcessInfo.processInfo.systemUptime-stableSince > 0.3
            }, "Einstellungsaktion ist nicht stabil sichtbar: \(prefix)")
            try XCTUnwrap(action(prefix)).tap()
        }
        XCTAssertTrue(waitUntil(40) { value("data")==id && value("ready")=="true" && value("ad")=="false" })
        try tap("Einstellungen")
        XCTAssertTrue(waitUntil(12) { action("Qualität")?.isEnabled == true })
        try tap("Qualität")
        let choices = ["Qualität 360p","Qualität 480p","Qualität 720p","Qualität 240p","Qualität 144p"]
        let choice = try XCTUnwrap(choices.compactMap { action($0) }.first { $0.isEnabled })
        let expected = ["Qualität 360p":"medium","Qualität 480p":"large","Qualität 720p":"hd720","Qualität 240p":"small","Qualität 144p":"tiny"][choice.label]
        choice.tap()
        XCTAssertTrue(waitUntil(20) { value("qualityActual")==expected && value("qualityMode")=="manual" && value("data")==id },"Die gewählte Qualität erreicht den gebundenen Originalplayer nicht.")
        record(app,name:"40-live-manual-quality",detail:probe.label)
        try tap("Einstellungen"); try tap("Qualität")
        try tap("Automatische Qualität")
        let autoAccepted=waitUntil(12) { value("qualityMode")=="adaptive" && value("data")==id }
        record(app,name:"40-live-auto-quality-source",detail:probe.exists ? probe.label : "Probe outside modal accessibility tree")
        XCTAssertTrue(autoAccepted,"Autoqualität darf die Videoquelle nicht wechseln.")
        XCTAssertTrue(waitUntil(5) { action("Einstellungen schließen")==nil })
        try tap("Einstellungen")
        // aria-modal correctly excludes the underlying player probe from AX.
        // Observe capability through the visible sheet; read media again after
        // the accepted action has dismissed it.
        let captionsReady=waitUntil(12) { action("Untertitel")?.isEnabled == true }
        if !captionsReady { record(app,name:"40-caption-availability-failure",detail:"row=\(action("Untertitel")?.debugDescription ?? "nil")") }
        XCTAssertTrue(captionsReady,"Die Untertitelaktion ist im sichtbaren Einstellungsblatt nicht bereit.")
        try tap("Untertitel")
        try tap("Untertitel ausschalten")
        let captionsOffAccepted=waitUntil(8) { value("captionState")=="false" && value("data")==id }
        record(app,name:"40-live-caption-off-source",detail:probe.exists ? probe.label : "Probe outside modal accessibility tree")
        XCTAssertTrue(captionsOffAccepted,"Untertitel-Aus darf die Videoquelle nicht wechseln.")
        try tap("Einstellungen"); try tap("Untertitel")
        try tap("Untertitel einschalten")
        XCTAssertTrue(waitUntil(12) { value("captionState")=="true" && value("data")==id },"Untertitel-An muss auf derselben Quelle bleiben.")
        record(app,name:"40-live-captions-enabled",detail:probe.label)
        XCTAssertTrue(sponsorRevealControls(app))
        let inlineCaptionViewport=app.frame.size
        var captionIssue="Captionprüfung noch nicht ausgeführt."
        XCTAssertTrue(waitUntil(4) {
            let issue=captionGeometryIssue(fullscreen:false,viewport:inlineCaptionViewport);captionIssue=issue ?? "Keine Kollision.";return issue==nil
        },captionIssue)
        record(app,name:"40-caption-controls-inline-geometry")
        let captionInline=XCTAttachment(screenshot:app.screenshot());captionInline.name="40-live-captions-with-inline-controls";captionInline.lifetime = .keepAlways;add(captionInline)
        let fullscreenEntrySample=try XCTUnwrap(Double(value("sample") ?? ""))
        let expectedFullscreenViewport=CGSize(width:max(inlineCaptionViewport.width,inlineCaptionViewport.height),height:min(inlineCaptionViewport.width,inlineCaptionViewport.height))
        let picture=try XCTUnwrap(sponsorPlayer(app)).frame
        // The visible chapter chip occupies the lower middle of this source.
        // Use the same free left-side gesture lane as the normal-launch case46.
        app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:picture.minX+picture.width*0.20,dy:picture.minY+picture.height*0.60)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:picture.minX+picture.width*0.20,dy:picture.minY+picture.height*0.08)),withVelocity:.fast,thenHoldForDuration:0)
        XCTAssertTrue(waitUntil(12) {
            self.zoomRegion(app) != nil && value("data")==id &&
            (Double(value("sample") ?? "") ?? -1)>fullscreenEntrySample &&
            value("fsStage")=="open" && value("fsInert")=="false" &&
            abs((Double(value("windowW") ?? "") ?? 0)-expectedFullscreenViewport.width)<2 &&
            abs((Double(value("windowH") ?? "") ?? 0)-expectedFullscreenViewport.height)<2
        },"Voraussetzung fehlt: keine frische, quellengebundene und interaktive Vollbildprobe nach dem Eintritt.")
        let captionFullscreen=try XCTUnwrap(zoomRegion(app))
        XCTAssertTrue(showZoomControls(captionFullscreen))
        let fullscreenCaptionViewport=captionFullscreen.frame.size
        let beforeHideSample=captionSnapshot()?["sample"] as? Int ?? -1
        // A long native entry can outlive the last input-triggered probe and
        // the controls' idle deadline. Exercise a real hide/reveal and require
        // a new sample in this viewport; empty captions never count as clear.
        captionFullscreen.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.28)).tap()
        var hiddenSample=beforeHideSample
        XCTAssertTrue(waitUntil(3) {
            guard let state=captionSnapshot(),captionSnapshotMatches(state,afterSample:beforeHideSample,viewport:fullscreenCaptionViewport),
                  let layout=state["captionLayout"] as? [String:Any],let controls=layout["controls"] as? [[String:Any]] else { return false }
            guard !controls.contains(where:{ ($0["visible"] as? Bool)==true && ($0["name"] as? String)?.hasPrefix("fullscreen-")==true }) else { return false }
            hiddenSample=state["sample"] as? Int ?? beforeHideSample;return true
        },"Voraussetzung fehlt: tatsächliches Ausblenden mit frischer Vollbildprobe nicht bestätigt.")
        captionFullscreen.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.28)).tap()
        XCTAssertTrue(waitUntil(4) {
            let issue=captionGeometryIssue(fullscreen:true,afterSample:hiddenSample,viewport:fullscreenCaptionViewport);captionIssue=issue ?? "Keine Kollision.";return issue==nil
        },captionIssue)
        record(app,name:"40-caption-controls-fullscreen-geometry")
        let captionFull=XCTAttachment(screenshot:XCUIScreen.main.screenshot());captionFull.name="40-live-captions-with-fullscreen-controls";captionFull.lifetime = .keepAlways;add(captionFull)
        let captionHeldBefore=Double(value("held") ?? "") ?? -1
        captionFullscreen.coordinate(withNormalizedOffset:CGVector(dx:0.20,dy:0.30)).press(forDuration:3.3)
        XCTAssertTrue(waitUntil(5) { (Double(value("held") ?? "") ?? -1)>captionHeldBefore && value("heldRate")=="2" && value("rate")=="1" && value("data")==id && value("captionState")=="true" },"Hold mit sichtbaren Untertiteln muss Quelle, Captionzustand und Rückkehr auf1× erhalten.")
        XCTAssertGreaterThanOrEqual(Double(value("heldForMs") ?? "") ?? 0,2600,"Untertitel und sichtbare Statusanzeige dürfen den gehaltenen2×-Kontakt nicht abbrechen.")
        record(app,name:"40-captions-and-hold-restored",detail:probe.label)
        captionFullscreen.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.26)).press(forDuration:0.05,thenDragTo:captionFullscreen.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.78)),withVelocity:.fast,thenHoldForDuration:0)
        XCTAssertTrue(waitUntil(12) { self.zoomRegion(app) == nil && app.buttons["Verkleinern"].isHittable })
        try tap("Einstellungen"); try tap("Untertitel")
        try tap("Untertitel ausschalten")
        XCTAssertTrue(waitUntil(8) { value("captionState")=="false" && value("data")==id && value("muted")=="true" })
        let screenshot=XCTAttachment(screenshot:app.screenshot());screenshot.name="40-live-settings-verified";screenshot.lifetime = .keepAlways;add(screenshot)
        record(app,name:"40-quality-auto-caption-on-off-complete",detail:probe.label)
    }

    @MainActor func test41DeferredAutoplayUsesOriginalAfterHydration() throws {
        executionTimeAllowance = 100
        XCUIDevice.shared.orientation = .portrait
        let app=launchInstalledApp(videoID:"12XcnOTUy-E",holdProbe:true,mutedPlayback:true,settingsDeferredControlProbe:true)
        let probe=app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Holdprobe ready=")).firstMatch
        func toggle()->XCUIElement? {
            app.descendants(matching:.any).matching(NSPredicate(format:"label IN %@",["Autoplay einschalten","Autoplay an","Autoplay aus"])).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
        }
        XCTAssertTrue(waitUntil(35) { probe.exists && probe.label.contains("ready=true") && probe.label.contains("ad=false") && toggle() != nil })
        XCTAssertEqual(toggle()?.label,"Autoplay einschalten","Ohne gelesene Präferenz darf kein An/Aus erfunden werden.")
        toggle()?.tap()
        let enabled=waitUntil(6) { toggle()?.label == "Autoplay an" }
        record(app,name:"41-deferred-original-enabled",detail:probe.label)
        XCTAssertTrue(enabled,"Live-Player bestätigt den ausdrücklichen Einschaltbefehl nicht.")
        XCTAssertTrue(probe.label.contains("autonav-on"),"Der Originalschalter hat das Einschalten nicht bestätigt.")
        toggle()?.tap()
        XCTAssertTrue(waitUntil(6) { toggle()?.label == "Autoplay aus" })
        XCTAssertTrue(probe.label.contains("autonav-off"))
        record(app,name:"41-deferred-original-on-off-confirmed",detail:probe.label)
    }

    @MainActor func test45ProviderWithoutAutoplayShowsUnavailableWithoutInventedPreference() throws {
        executionTimeAllowance = 65
        XCUIDevice.shared.orientation = .portrait
        let id="jNQXAC9IVRw"
        let app=launchInstalledApp(videoID:id,holdProbe:true,mutedPlayback:true)
        func currentProbe() -> String {
            app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Holdprobe ready=")).allElementsBoundByIndex.first?.label ?? ""
        }
        func watchNext(_ label:String) -> [String:Any]? {
            guard let start=label.range(of:" settingsReveal="),let end=label.range(of:" mediaEvents=",range:start.upperBound..<label.endIndex),
                  let bytes=String(label[start.upperBound..<end.lowerBound]).data(using:.utf8),
                  let reveal=(try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any] else { return nil }
            return reveal["watchNext"] as? [String:Any]
        }
        var observed=""
        XCTAssertTrue(waitUntil(35) {
            observed=currentProbe()
            guard observed.contains("data=\(id) "),observed.contains("ready=true"),observed.contains("ad=false"),let response=watchNext(observed) else { return false }
            return response["available"] as? Bool == true && response["matchingVideo"] as? Bool == true && response["complete"] as? Bool == true
        },"Keine vollständige aktuelle Originalantwort zur Autoplay-Fähigkeit; kein Negativpass.")
        record(app,name:"45-current-original-autoplay-capability",detail:observed)
        let response=try XCTUnwrap(watchNext(observed))
        if response["togglePresent"] as? Bool == true || response["overlayAutoplay"] as? Bool == true || response["nextAutoplay"] as? Bool == true {
            throw XCTSkip("YouTube liefert für den früheren Negativkandidaten wieder Autoplay; Verfügbarkeit wird in38/39 geprüft.")
        }
        for field in ["togglePresent","overlayAutoplay","nextAutoplay"] { XCTAssertEqual(response[field] as? Bool,false,"Capabilityfeld fehlt: \(field)") }
        XCTAssertTrue(waitUntil(5) {
            app.buttons.matching(NSPredicate(format:"label == %@","Autoplay aktuell nicht verfügbar")).allElementsBoundByIndex.contains { $0.exists && $0.isHittable && !$0.isEnabled }
        },"Ohne gelieferte Original-Autoplayfunktion darf kein Einschalten versprochen werden.")
        XCTAssertFalse(currentProbe().contains("autonav-request"),"Es darf kein ungefragter Aktivierungsversuch starten.")
        record(app,name:"45-original-capability-unavailable",detail:currentProbe())
    }

    @MainActor func test15ExplicitWatchStartsUnmutedAndKeepsPlaybackOnResume() throws {
        // Encoded audio remains unmuted, but the creator's silence content
        // keeps this repeated Simulator regression quiet on the host Mac.
        try explicitWatchAudioState(videoID: "12XcnOTUy-E")
    }

    @MainActor private func explicitWatchAudioState(videoID: String) throws {
        let app = launchInstalledApp(videoID: videoID, holdProbe: true, audibleWatch: true)
        let probe = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready=")).firstMatch
        func state(_ key: String) -> String? {
            guard probe.exists else { return nil }
            return probe.label.split(separator: " ").compactMap { part -> String? in
                let values = part.split(separator: "=", maxSplits: 1)
                return values.count == 2 && values[0] == key ? String(values[1]) : nil
            }.first
        }
        XCTAssertTrue(waitUntil(30) {
            state("data") == videoID && state("paused") == "false" && state("ended") == "false" &&
                state("muted") == "false" && (Double(state("volume") ?? "") ?? 0) > 0 &&
                (Double(state("time") ?? "") ?? 0) > 0.5
        }, "Ein ausdrücklich neu geöffnetes Video startet nicht mit fortschreitendem, ungemutetem Hauptmedium.")
        record(app, name: "15-explicit-user-open-audible-media-state", detail: probe.label)
        XCTAssertTrue(sponsorRevealControls(app))
        let enter = app.buttons.matching(NSPredicate(format: "label IN %@", ["Vollbild", "Full screen"])).allElementsBoundByIndex.first { $0.exists && $0.isHittable }
        try XCTUnwrap(enter).tap()
        XCTAssertTrue(waitUntil(10) { self.zoomRegion(app) != nil })
        let fs = try XCTUnwrap(zoomRegion(app))
        XCTAssertTrue(showZoomControls(fs))
        let pause = fs.buttons["Pause"]
        XCTAssertTrue(pause.exists && pause.isHittable); pause.tap()
        XCTAssertTrue(waitUntil(5) { state("paused") == "true" && state("muted") == "false" })
        fs.buttons["Wiedergabe"].tap()
        XCTAssertTrue(waitUntil(5) { state("paused") == "false" && state("muted") == "false" && (Double(state("volume") ?? "") ?? 0) > 0 })
        XCTAssertTrue(showZoomControls(fs)); fs.buttons["Vollbild schließen"].tap()
        XCTAssertTrue(waitUntil(10) { self.zoomRegion(app) == nil && app.buttons["Verkleinern"].isHittable })
        record(app, name: "15-audible-media-after-pause-resume-and-fullscreen", detail: probe.label)
        XCUIDevice.shared.orientation = .portrait
    }

    @MainActor func test16PhysicalRotationOpensFullscreenAndHonorsManualExit() throws {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launchInstalledApp(videoID: "aqz-KE-bpKQ", holdProbe: true)
        XCTAssertTrue(waitUntil(25) { self.sponsorPlayer(app) != nil && app.buttons["Verkleinern"].isHittable })
        if let play = sponsorPlayButton(app) { play.tap() }
        let probe = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready=")).firstMatch
        XCTAssertTrue(waitUntil(15) { probe.exists && probe.label.contains("ready=true") })
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(waitUntil(12) { self.zoomRegion(app) != nil && app.frame.width > app.frame.height }, "Physisches Querformat öffnet das aktuelle Video nicht in eigenem Vollbild.")
        let fs = try XCTUnwrap(zoomRegion(app)); XCTAssertTrue(showZoomControls(fs))
        record(app, name: "16-physical-landscape-fullscreen", detail: probe.label)
        fs.buttons["Vollbild schließen"].tap()
        XCTAssertTrue(waitUntil(10) { self.zoomRegion(app) == nil && app.buttons["Verkleinern"].isHittable })
        XCTAssertFalse(waitUntil(3) { self.zoomRegion(app) != nil }, "Manuelles Verlassen wird ohne neue physische Drehung rückgängig gemacht.")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(waitUntil(8) { app.frame.height > app.frame.width })
        XCUIDevice.shared.orientation = .landscapeRight
        XCTAssertTrue(waitUntil(12) { self.zoomRegion(app) != nil && app.frame.width > app.frame.height })
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(waitUntil(12) { self.zoomRegion(app) == nil && app.frame.height > app.frame.width && app.buttons["Verkleinern"].isHittable }, "Physisches Hochformat gibt die normale Videobedienung nicht zurück.")
        record(app, name: "16-physical-portrait-return", detail: probe.label)
    }

    @MainActor func test18ReleasedZoomPanAndSwipePermitPortraitRotation() throws {
        executionTimeAllowance = 150
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launchInstalledApp(videoID: "aqz-KE-bpKQ", holdProbe: true)
        let collapse = app.buttons["Verkleinern"]
        let probe = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready=")).firstMatch
        XCTAssertTrue(waitUntil(25) { collapse.isHittable && self.sponsorPlayer(app) != nil })
        if let play = sponsorPlayButton(app) { play.tap() }
        XCTAssertTrue(waitUntil(15) { probe.exists && probe.label.contains("ready=true") && (self.zoomNumber(probe, "mediaReady") ?? 0) >= 2 })
        let inline = try XCTUnwrap(zoomVideo(app)).frame
        for gesture in ["pinch", "pan", "swipe"] {
            XCUIDevice.shared.orientation = .landscapeLeft
            XCTAssertTrue(waitUntil(12) { self.zoomRegion(app) != nil && app.frame.width > app.frame.height })
            let fs = try XCTUnwrap(zoomRegion(app))
            XCTAssertTrue(showZoomControls(fs), "Die tatsächliche Vollbildbedienung muss vor der Geste bereit sein.")
            // Keep both pinch contacts on the free picture, as in test11.
            fs.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28)).tap()
            XCTAssertTrue(waitUntil(5) {
                let close = fs.buttons["Vollbild schließen"]
                return !close.exists || !close.isHittable
            })
            if gesture == "pinch" || gesture == "pan" {
                fs.pinch(withScale: 2, velocity: 1.5)
                XCTAssertTrue(waitUntil(8) { (self.zoomNumber(probe, "zoom") ?? 0) > 1.25 })
                if gesture == "pan" {
                    let before = zoomNumber(probe, "zoomX") ?? 0
                    fs.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25))
                        .press(forDuration: 0.05, thenDragTo: fs.coordinate(withNormalizedOffset: CGVector(dx: 0.68, dy: 0.32)), withVelocity: .slow, thenHoldForDuration: 0)
                    XCTAssertTrue(waitUntil(5) { abs((self.zoomNumber(probe, "zoomX") ?? before) - before) > 10 })
                }
            } else {
                let before = try XCTUnwrap(zoomNumber(probe, "time"))
                fs.coordinate(withNormalizedOffset: CGVector(dx: 0.30, dy: 0.25))
                    .press(forDuration: 0.05, thenDragTo: fs.coordinate(withNormalizedOffset: CGVector(dx: 0.47, dy: 0.25)), withVelocity: .fast, thenHoldForDuration: 0)
                XCTAssertTrue(waitUntil(5) { (self.zoomNumber(probe, "time") ?? 0) >= before + 14 })
            }
            XCTAssertTrue(waitUntil(5) { probe.exists && probe.label.contains("zoomGesturing=false") })
            record(app, name: "18-\(gesture)-released-before-rotation", detail: probe.label)
            XCUIDevice.shared.orientation = .portrait
            XCTAssertTrue(waitUntil(12) { self.zoomRegion(app) == nil && app.frame.height > app.frame.width && collapse.isHittable }, "Der vollständig losgelassene \(gesture)-Kontakt blockiert die Hochformat-Rückkehr.")
            XCTAssertTrue(waitUntil(5) {
                guard probe.exists, let media = self.zoomVideo(app) else { return false }
                return (probe.label.contains("zoom=none") || self.zoomNumber(probe, "zoom") == 1) &&
                    probe.label.contains("data=aqz-KE-bpKQ") &&
                    abs(media.frame.minX-inline.minX) <= 8 && abs(media.frame.minY-inline.minY) <= 8 &&
                    abs(media.frame.width-inline.width) <= 8 && abs(media.frame.height-inline.height) <= 8
            })
            record(app, name: "18-\(gesture)-portrait-return", detail: probe.label)
        }
    }

    @MainActor func test19PlayingWatchContinuesThroughHomeAndReturn() throws {
        try playingWatchHome(categoryProbe: false)
    }

    @MainActor func test21PlayingWatchWithBackgroundCategoryProbe() throws {
        try playingWatchHome(categoryProbe: true)
    }

    @MainActor func test23SilentAudioTrackWatchHomeBaseline() throws {
        try playingWatchHome(categoryProbe: false, videoID: "12XcnOTUy-E")
    }

    @MainActor func test25SilentAudioTrackWatchWithBackgroundCategoryProbe() throws {
        try playingWatchHome(categoryProbe: true, videoID: "12XcnOTUy-E")
    }

    @MainActor func test27SilentAudioTrackWatchWithBackgroundVisibilityProbe() throws {
        try playingWatchHome(categoryProbe: false, videoID: "12XcnOTUy-E", visibilityProbe: true)
    }

    @MainActor func test29SilentAudioTrackWatchContinuesWithOrdinaryBackgroundPolicy() throws {
        try playingWatchHome(categoryProbe: false, videoID: "12XcnOTUy-E", normalBackground: true)
    }

    @MainActor func test32EarlyPlayingSilentWatchContinuesThroughHome() throws {
        try playingWatchHome(categoryProbe: false, videoID: "12XcnOTUy-E", normalBackground: true, earlyHome: true)
    }

    @MainActor private func playingWatchHome(categoryProbe: Bool, videoID: String = "aqz-KE-bpKQ", visibilityProbe: Bool = false, normalBackground: Bool = false, earlyHome: Bool = false) throws {
        XCUIDevice.shared.orientation = .portrait
        let app = launchInstalledApp(videoID: videoID, holdProbe: true, audibleWatch: true, backgroundProbe: true, categoryProbe: categoryProbe, visibilityProbe: visibilityProbe, backgroundBaseline: !categoryProbe && !visibilityProbe && !normalBackground)
        let probe = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready=")).firstMatch
        if !earlyHome {
            XCTAssertTrue(waitUntil(25) { app.buttons["Verkleinern"].exists && app.buttons["Verkleinern"].isHittable && self.sponsorPlayer(app) != nil })
        }
        XCTAssertTrue(waitUntil(25) { probe.exists && probe.label.contains("data=\(videoID)") && probe.label.contains("ready=true") && probe.label.contains("muted=false") && (self.zoomNumber(probe, "volume") ?? 0) > 0 })
        if !earlyHome { record(app, name: "19-playing-before-home", detail: probe.label) }
        // The full AX attachment can take seconds. Read time immediately
        // before Home, so foreground attachment work cannot count as progress.
        XCTAssertEqual(try XCTUnwrap(zoomNumber(probe, "rate")), 1)
        let beforeReadUptime = ProcessInfo.processInfo.systemUptime
        let before = try XCTUnwrap(zoomNumber(probe, "time"))
        let beforeSample = try XCTUnwrap(zoomNumber(probe, "sample"))
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(waitUntil(5) { app.state == .runningBackground || app.state == .runningBackgroundSuspended })
        let backgroundConfirmedUptime = ProcessInfo.processInfo.systemUptime
        let until = ProcessInfo.processInfo.systemUptime + 8
        XCTAssertTrue(waitUntil(10) { ProcessInfo.processInfo.systemUptime >= until })
        let activationStartedUptime = ProcessInfo.processInfo.systemUptime
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(waitUntil(8) {
            probe.exists && probe.label.contains("data=\(videoID)") &&
                (self.zoomNumber(probe, "sample") ?? 0) > beforeSample &&
                (self.zoomNumber(probe, "mediaReady") ?? 0) >= 2 &&
                (self.zoomNumber(probe, "duration") ?? 0) > 0
        })
        let after = try XCTUnwrap(zoomNumber(probe, "time"))
        let afterReadUptime = ProcessInfo.processInfo.systemUptime
        // Deduct every second that could have been foreground playback. A
        // foreground-only restart cannot satisfy the background threshold.
        let foregroundAllowance = backgroundConfirmedUptime-beforeReadUptime + afterReadUptime-activationStartedUptime
        let backgroundProgress = after-before-foregroundAllowance
        record(app, name: "19-playing-after-home", detail: "before=\(before) after=\(after) foregroundAllowance=\(foregroundAllowance) backgroundProgress=\(backgroundProgress)\n" + probe.label)
        XCTAssertEqual(try XCTUnwrap(zoomNumber(probe, "rate")), 1)
        XCTAssertGreaterThanOrEqual(backgroundProgress, 6, "Das laufende Hauptvideo ist im tatsächlichen Home-Hintergrund stehen geblieben.")
        XCTAssertTrue(probe.label.contains("paused=false") && probe.label.contains("muted=false"))
    }

    @MainActor func test20PausedWatchStaysPausedThroughHomeAndReturn() throws {
        try pausedWatchHome(categoryProbe: false)
    }

    @MainActor func test22PausedWatchWithBackgroundCategoryProbe() throws {
        try pausedWatchHome(categoryProbe: true)
    }

    @MainActor func test24PausedSilentAudioTrackWatchHomeBaseline() throws {
        try pausedWatchHome(categoryProbe: false, videoID: "12XcnOTUy-E")
    }

    @MainActor func test26PausedSilentAudioTrackWatchWithBackgroundCategoryProbe() throws {
        try pausedWatchHome(categoryProbe: true, videoID: "12XcnOTUy-E")
    }

    @MainActor func test28PausedSilentAudioTrackWatchWithBackgroundVisibilityProbe() throws {
        try pausedWatchHome(categoryProbe: false, videoID: "12XcnOTUy-E", visibilityProbe: true)
    }

    @MainActor func test30PausedSilentAudioTrackWatchPreservesPauseWithOrdinaryBackgroundPolicy() throws {
        try pausedWatchHome(categoryProbe: false, videoID: "12XcnOTUy-E", normalBackground: true)
    }

    /// The native mini card exposes its play/pause action as a custom AX action,
    /// not a child button. Tap the actual visible 44pt button's verified center.
    /// This remains ordinary user input; the read-only probe observes the result.
    @MainActor private func backgroundMiniPlaybackTap(_ app: XCUIApplication, pause: Bool) {
        let collapse = app.buttons["Verkleinern"], mini = app.buttons["Video vergrößern"]
        XCTAssertTrue(waitUntil(10) { collapse.exists && collapse.isHittable })
        collapse.tap()
        XCTAssertTrue(waitUntil(10) { mini.exists && mini.isHittable && mini.frame.height < app.frame.height * 0.5 })
        XCTAssertTrue(waitUntil(5) { mini.value as? String == (pause ? "Wiedergabe läuft" : "Pausiert") })
        mini.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
            .withOffset(CGVector(dx: 26, dy: 26)).tap()
        XCTAssertTrue(waitUntil(5) { mini.value as? String == (pause ? "Pausiert" : "Wiedergabe läuft") })
        mini.tap()
        XCTAssertTrue(waitUntil(10) { collapse.exists && collapse.isHittable })
    }

    @MainActor private func pausedWatchHome(categoryProbe: Bool, videoID: String = "aqz-KE-bpKQ", visibilityProbe: Bool = false, normalBackground: Bool = false) throws {
        executionTimeAllowance = 150
        XCUIDevice.shared.orientation = .portrait
        let app = launchInstalledApp(videoID: videoID, holdProbe: true, audibleWatch: true, backgroundProbe: true, categoryProbe: categoryProbe, visibilityProbe: visibilityProbe, backgroundBaseline: !categoryProbe && !visibilityProbe && !normalBackground)
        let probe = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready=")).firstMatch
        XCTAssertTrue(waitUntil(25) { app.buttons["Verkleinern"].exists && app.buttons["Verkleinern"].isHittable && self.sponsorPlayer(app) != nil })
        XCTAssertTrue(waitUntil(25) { probe.exists && probe.label.contains("data=\(videoID)") && probe.label.contains("ready=true") })
        if sponsorRevealControls(app), app.buttons["Video anhalten"].exists, app.buttons["Video anhalten"].isHittable {
            app.buttons["Video anhalten"].tap()
        } else {
            record(app, name: "20-original-controls-unavailable", detail: probe.label)
            backgroundMiniPlaybackTap(app, pause: true)
        }
        XCTAssertTrue(waitUntil(5) { probe.exists && probe.label.contains("paused=true") })
        let before = try XCTUnwrap(zoomNumber(probe, "time"))
        record(app, name: "20-paused-before-home", detail: probe.label)
        let beforeSample = try XCTUnwrap(zoomNumber(probe, "sample"))
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(waitUntil(5) { app.state == .runningBackground || app.state == .runningBackgroundSuspended })
        let until = ProcessInfo.processInfo.systemUptime + 8
        XCTAssertTrue(waitUntil(10) { ProcessInfo.processInfo.systemUptime >= until })
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(waitUntil(5) { probe.exists && (self.zoomNumber(probe, "sample") ?? 0) > beforeSample && probe.label.contains("data=\(videoID)") && probe.label.contains("paused=true") })
        let after = try XCTUnwrap(zoomNumber(probe, "time"))
        record(app, name: "20-paused-after-home", detail: "before=\(before) after=\(after)\n" + probe.label)
        XCTAssertTrue(probe.label.contains("paused=true"), "Bewusste Pause wurde beim Appwechsel aufgehoben.")
        // A paused YouTube MSE source may remain unloaded until explicit Play.
        // Verify the position at the first actual resumed picture, as a user
        // sees it, while the preceding return remains explicitly paused.
        if sponsorRevealControls(app), let play = sponsorPlayButton(app) {
            play.tap()
        } else {
            backgroundMiniPlaybackTap(app, pause: false)
        }
        XCTAssertTrue(waitUntil(15) { probe.exists && probe.label.contains("ready=true") && (self.zoomNumber(probe, "mediaReady") ?? 0) >= 2 })
        let resumed = try XCTUnwrap(zoomNumber(probe, "time"))
        XCTAssertGreaterThanOrEqual(resumed, before-0.5, "Ausdrückliches Play verliert die pausierte Position.")
        XCTAssertLessThanOrEqual(resumed, before+4, "Das pausierte Video ist vor ausdrücklichem Play weitergelaufen.")
        record(app, name: "20-explicit-resume-after-paused-home", detail: probe.label)
    }

    @MainActor func test17FourThreeSidebarsAndEndedSurfaceSeekWithoutChangingPlayback() throws {
        executionTimeAllowance = 170
        XCUIDevice.shared.orientation = .portrait
        let id = "jNQXAC9IVRw", app = launchInstalledApp(videoID: "jNQXAC9IVRw", holdProbe: true)
        let probe = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready=")).firstMatch
        let collapse = app.buttons["Verkleinern"]
        func state() -> [String: String] {
            guard probe.exists else { return [:] }
            return Dictionary(probe.label.split(separator: " ").compactMap { part in
                let pair = part.split(separator: "=", maxSplits: 1)
                return pair.count == 2 ? (String(pair[0]), String(pair[1])) : nil
            }, uniquingKeysWith: { _, latest in latest })
        }
        func number(_ key: String) -> Double { Double(state()[key] ?? "") ?? -1 }
        XCTAssertTrue(waitUntil(25) { collapse.isHittable && state()["data"] == id })
        if state()["paused"] == "true" { try XCTUnwrap(sponsorPlayButton(app)).tap() }
        XCTAssertTrue(waitUntil(15) { state()["data"] == id && number("mediaReady") >= 2 && number("duration") > 0 })
        XCTAssertTrue(sponsorRevealControls(app))
        let pause = app.buttons["Video anhalten"]
        XCTAssertTrue(waitUntil(5) { pause.exists && pause.isHittable }); pause.tap()
        XCTAssertTrue(waitUntil(5) { state()["paused"] == "true" && state()["ended"] == "false" })
        let player = try XCTUnwrap(sponsorPlayer(app)), root = player.frame
        XCTAssertGreaterThan(number("x"), Double(root.minX + 20), "Die reale Quelle hat keine linke 4:3-Seitenfläche.")
        XCTAssertLessThan(number("x") + number("w"), Double(root.maxX - 20), "Die reale Quelle hat keine rechte 4:3-Seitenfläche.")
        func swipe(_ from: CGFloat, _ to: CGFloat) {
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let y = root.minY + root.height * 0.30
            origin.withOffset(CGVector(dx: from, dy: y)).press(forDuration: 0.05,
                thenDragTo: origin.withOffset(CGVector(dx: to, dy: y)), withVelocity: .fast, thenHoldForDuration: 0)
        }
        let began = number("time"), duration = number("duration")
        XCTAssertGreaterThanOrEqual(began, 0); XCTAssertLessThan(began, duration - 1)
        swipe(root.minX + 8, root.minX + 120)
        XCTAssertTrue(waitUntil(6) { abs(number("time") - min(duration, began + 15)) <= 0.5 && state()["paused"] == "true" && state()["data"] == id })
        XCTAssertTrue(collapse.isHittable && state()["mini"] == "false" && abs((sponsorPlayer(app)?.frame.height ?? 0) - root.height) <= 3,
                      "Die linke freie Seitenfläche löst Native-Zurück statt Seek aus.")
        let forward = number("time")
        swipe(root.maxX - 8, root.maxX - 120)
        XCTAssertTrue(waitUntil(6) { abs(number("time") - max(0, forward - 15)) <= 0.5 && state()["paused"] == "true" && state()["ended"] == "false" && state()["data"] == id })
        record(app, name: "17-both-real-four-three-sidebars-seek", detail: probe.label)
        XCTAssertTrue(sponsorRevealControls(app)); try XCTUnwrap(sponsorPlayButton(app)).tap()
        XCTAssertTrue(waitUntil(28) { state()["data"] == id && state()["ended"] == "true" && state()["paused"] == "true" && abs(number("time") - duration) <= 0.35 })
        XCTAssertLessThan(number("y"), 0, "Der Endeprüffall benötigt YouTubes tatsächlich offscreen versetztes Medium.")
        let sample = number("sample")
        swipe(root.maxX - 8, root.maxX - 120)
        XCTAssertTrue(waitUntil(6) { state()["data"] == id && state()["paused"] == "true" && state()["ended"] == "false" && number("sample") > sample && abs(number("time") - (duration - 15)) <= 0.5 }, "Zurückwischen am sichtbaren Endscreen sucht nicht im beendeten Hauptvideo.")
        XCTAssertFalse(waitUntil(11) { state()["data"] != id || state()["paused"] != "true" || abs(number("time") - (duration - 15)) > 0.5 }, "Ein alter Next-Countdown oder fremder Playbackkontakt überschreibt den pausierten Ende-Seek.")
        XCTAssertTrue(collapse.isHittable)
        record(app, name: "17-ended-surface-minus15-remains-paused", detail: probe.label)
    }
    @MainActor func test42AllSearchFiltersAndNativeSearchReturn() throws {
        executionTimeAllowance = 360
        XCUIDevice.shared.orientation = .portrait
        let app=launchInstalledApp(nativeSearchProbe:true)
        func headerSearch()->XCUIElement? {
            app.buttons.matching(searchLabel).allElementsBoundByIndex.first { $0.exists && $0.isHittable && $0.frame.minY<150 }
        }
        try XCTUnwrap(headerSearch()).tap()
        let field=app.textFields["langform-search-field"]
        XCTAssertTrue(field.waitForExistence(timeout:10))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:6),"Die native Suche öffnet ohne Tastaturfokus.")
        // A finite public source avoids an hours-long live preview keeping
        // XCTest's mandatory UI-quiescence waits busy between chip taps.
        field.typeText("jawed\n")
        func chip(_ name:String)->XCUIElement? {
            app.webViews.firstMatch.descendants(matching:.any).matching(NSPredicate(format:"label == %@",name)).allElementsBoundByIndex.first {
                guard $0.exists else { return false }
                let rect=$0.frame
                return !rect.isEmpty && rect.minY>50 && rect.maxY<210
            }
        }
        func selected(_ name:String)->Bool {
            guard let item=chip(name) else { return false }
            if item.isSelected { return true }
            if let value=item.value as? NSNumber { return value.intValue==1 }
            return ["1","true","selected","ausgewählt"].contains((item.value as? String ?? "").lowercased())
        }
        func resultsReady()->Bool {
            app.webViews.firstMatch.descendants(matching:.any).matching(NSPredicate(format:"label CONTAINS[c] %@","jawed")).allElementsBoundByIndex.contains {
                guard $0.exists else { return false }
                let rect=$0.frame
                return !rect.isEmpty && rect.minY>=160 && rect.minY<app.frame.maxY-40
            }
        }
        func settled(_ name:String)->Bool {
            var since:TimeInterval?
            return waitUntil(35) {
                guard selected(name) && resultsReady() else { since=nil;return false }
                let now=ProcessInfo.processInfo.systemUptime
                if since==nil { since=now }
                return now-(since ?? now)>=1
            }
        }
        XCTAssertTrue(waitUntil(35) { !field.exists && chip("Alle") != nil })
        XCTAssertTrue(settled("Videos"),"Die erste Standard-Videosuche muss vor dem Filterwechsel tatsächlich fertig sein.")
        for name in ["Alle","Ungesehen","Videos","Kanäle"] {
            try XCTUnwrap(chip(name)).tap()
            let accepted=settled(name)
            record(app,name:"42-filter-\(name)",detail:"Selected=\(chip(name)?.isSelected ?? false); value=\(String(describing:chip(name)?.value))")
            let shot=XCTAttachment(screenshot:app.screenshot());shot.name="42-filter-\(name)";shot.lifetime = .keepAlways;add(shot)
            XCTAssertTrue(accepted,"Ergebnisfilter bleibt nicht ausgewählt: \(name)")
            XCTAssertTrue(resultsReady(),"Der Filter darf erst mit tatsächlich geladenen Treffern als geprüft zählen.")
            if name=="Ungesehen" {
                try XCTUnwrap(headerSearch()).tap()
                XCTAssertTrue(field.waitForExistence(timeout:8))
                XCTAssertTrue(app.buttons["langform-search-filter-unwatched"].isSelected,"Ungesehen geht beim nativen Wiederöffnen nach der YouTube-URLbereinigung verloren.")
                app.buttons["langform-search-filter-videos"].tap()
                XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:6),"Die native Filterwahl darf den Texteingabefokus nicht verlieren.")
                field.typeText("\n")
                XCTAssertTrue(waitUntil(8) { !field.exists })
                XCTAssertTrue(settled("Videos"),"Die ausdrückliche native Videos-Auswahl muss den zusätzlichen Ungesehenfilter auch bei identischer kanonischer URL entfernen.")
                try XCTUnwrap(chip("Ungesehen")).tap()
                XCTAssertTrue(settled("Ungesehen"))
            }
        }
        try XCTUnwrap(headerSearch()).tap()
        XCTAssertTrue(field.waitForExistence(timeout:8));XCTAssertEqual(field.value as? String,"jawed")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:6),"Auch die wiedergeöffnete Suche muss direkt den Texteingabefokus erhalten.")
        XCTAssertTrue(app.buttons["langform-search-filter-channels"].isSelected)
        app.buttons["Suche schließen"].tap()
        XCTAssertTrue(waitUntil(6) { !field.exists && selected("Kanäle") })
        record(app,name:"42-four-filters-and-native-search-return-complete")
    }


    @MainActor func test43SettingsLayoutAndRepeatedSubmenuReturn() throws {
        executionTimeAllowance = 180
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launchInstalledApp(videoID:"12XcnOTUy-E",holdProbe:true,commentsStructureProbe:true,mutedPlayback:true)
        let probe = app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Holdprobe ready=")).firstMatch
        XCTAssertTrue(waitUntil(35) { probe.exists && probe.label.contains("ready=true") && probe.label.contains("ad=false") })
        func action(_ label:String) -> XCUIElement? {
            // Prefer the actionable control over its equally labelled WebKit
            // group. Resolving a group can outlive fullscreen auto-hide.
            let button = app.buttons.matching(NSPredicate(format:"label BEGINSWITH %@",label)).firstMatch
            if button.exists && button.isHittable && button.frame.width > 0 { return button }
            return app.descendants(matching:.any).matching(NSPredicate(format:"label BEGINSWITH %@",label)).allElementsBoundByIndex.first { $0.exists && $0.isHittable && $0.frame.width > 0 }
        }
        for mode in ["portrait","fullscreen"] {
            if mode == "fullscreen" {
                let picture=try XCTUnwrap(sponsorPlayer(app)).frame
                app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:picture.midX,dy:picture.minY+picture.height*0.75)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:picture.midX,dy:picture.minY+picture.height*0.10)),withVelocity:.fast,thenHoldForDuration:0)
                XCTAssertTrue(waitUntil(12) { self.zoomRegion(app) != nil },"Einstellungswiederholungen dürfen den Vollbild-Swipe nicht blockieren.")
            }
            for cycle in 0..<2 {
                if let fs=zoomRegion(app) { XCTAssertTrue(showZoomControls(fs)) } else { XCTAssertTrue(sponsorRevealControls(app)) }
                if mode == "portrait" && cycle == 0 {
                    record(app,name:"43-inline-original-control-structure")
                    let inlineShot=XCTAttachment(screenshot:app.screenshot());inlineShot.name="43-inline-controls-before-settings";inlineShot.lifetime = .keepAlways;add(inlineShot)
                }
                let settingsFrame = try XCTUnwrap(action("Einstellungen")).frame
                // The auto-hiding gear can be exposed as a WebKit group.
                // Tap its measured position without a second label lookup or
                // XCTest's scroll-to-visible round trip through that group.
                app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:settingsFrame.midX,dy:settingsFrame.midY)).tap()
                XCTAssertTrue(waitUntil(6) { action("Wiedergabegeschwindigkeit") != nil })
                XCTAssertNil(action("Zurück"),"Im Hauptmenü darf kein funktionsloser Zurückknopf sichtbar sein.")
                let rows=try ["Qualität","Wiedergabegeschwindigkeit","Untertitel"].map { try XCTUnwrap(action($0)).frame }
                for (index,frame) in rows.enumerated() {
                    XCTAssertGreaterThanOrEqual(frame.height,44)
                    XCTAssertGreaterThanOrEqual(frame.minX,app.frame.minX)
                    XCTAssertLessThanOrEqual(frame.maxX,app.frame.maxX+1)
                    XCTAssertLessThanOrEqual(frame.maxY,app.frame.maxY+1)
                    if index > 0 { XCTAssertGreaterThanOrEqual(frame.minY,rows[index-1].maxY-1,"Menüzeilen überdecken sich.") }
                }
                try XCTUnwrap(action("Wiedergabegeschwindigkeit")).tap()
                XCTAssertTrue(waitUntil(5) { action("Tempo 1×") != nil && action("Zurück") != nil })
                try XCTUnwrap(action("Zurück")).tap()
                XCTAssertTrue(waitUntil(5) { action("Wiedergabegeschwindigkeit") != nil && action("Zurück") == nil })
                let shot=XCTAttachment(screenshot:XCUIScreen.main.screenshot());shot.name="43-\(mode)-settings-layout-\(cycle)";shot.lifetime = .keepAlways;add(shot)
                try XCTUnwrap(action("Einstellungen schließen")).tap()
                XCTAssertTrue(waitUntil(5) { action("Wiedergabegeschwindigkeit") == nil })
            }
        }
        record(app,name:"43-settings-layout-repeat-complete",detail:probe.exists ? probe.label : "Player probe outside modal tree")
    }

    @MainActor func test44CommentsSmallDragReversalAndReopen() throws {
        executionTimeAllowance = 180
        XCUIDevice.shared.orientation = .portrait
        let app=launchInstalledApp(videoID:"aqz-KE-bpKQ",holdProbe:true,commentsStructureProbe:true,mutedPlayback:true)
        XCTAssertTrue(waitUntil(30) { app.buttons["Verkleinern"].isHittable })
        func card() -> XCUIElement? {
            app.buttons.matching(NSPredicate(format:"label MATCHES[c] %@","^(Kommentare|Comments)(,.*| [0-9].*)?$")).allElementsBoundByIndex.first { $0.exists && $0.frame.width > app.frame.width*0.6 && $0.frame.height > 40 }
        }
        func opener() -> XCUIElement? {
            guard let item=card(),let player=sponsorPlayer(app),item.isHittable,item.frame.minY > player.frame.maxY+8,item.frame.maxY < app.frame.maxY-24 else { return nil }; return item
        }
        func header() -> XCUIElement? {
            app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH[c] %@","Kommentare")).allElementsBoundByIndex.first { $0.exists && $0.isHittable && $0.frame.minY > 10 }
        }
        func contentScroll() -> Double? {
            let structure=app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Commentsprobe ")).firstMatch
            guard structure.exists,let data=String(structure.label.dropFirst("Commentsprobe ".count)).data(using:.utf8),
                  let snapshot=try? JSONSerialization.jsonObject(with:data) as? [String:Any],let rows=snapshot["rows"] as? [[String:Any]],
                  let content=rows.first(where:{ ($0["classes"] as? [String])?.contains("engagement-panel-content-wrapper") == true }),
                  let scroll=content["scroll"] as? [Double] else { return nil }
            return scroll.first
        }
        _=waitUntil(12) { card() != nil }
        for _ in 0..<8 where opener() == nil {
            let above=card().map { $0.frame.minY < (self.sponsorPlayer(app)?.frame.maxY ?? 330)+8 } ?? false
            app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:above ? 0.62 : 0.80)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:above ? 0.80 : 0.62)),withVelocity:.slow,thenHoldForDuration:0)
        }
        guard opener() != nil else { throw XCTSkip("Keine eindeutig erreichbaren öffentlichen Kommentare für Wiederöffnungsprüfung.") }
        func drag(_ distance:CGFloat,velocity:XCUIGestureVelocity = .slow,hold:TimeInterval = 0.15) throws {
            let frame=try XCTUnwrap(header()).frame
            let from=app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:app.frame.midX,dy:frame.midY))
            let to=app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:app.frame.midX,dy:max(72,min(app.frame.height-70,frame.midY+distance))))
            from.press(forDuration:0.05,thenDragTo:to,withVelocity:velocity,thenHoldForDuration:hold)
        }
        for cycle in 0..<2 {
            try XCTUnwrap(opener()).tap()
            XCTAssertTrue(waitUntil(10) { header() != nil })
            // WebKit AX reports the resting header frame during its entrance.
            // This case tests settled drag/reopen; sampled motion is separate.
            let settledAt=ProcessInfo.processInfo.systemUptime+3.2
            XCTAssertTrue(waitUntil(5) { ProcessInfo.processInfo.systemUptime >= settledAt })
            let resting=try XCTUnwrap(header()).frame.minY
            record(app,name:"44-before-small-drag-\(cycle)",detail:"Resting header Y=\(resting)")
            let beforeShot=XCTAttachment(screenshot:app.screenshot());beforeShot.name="44-before-small-drag-\(cycle)";beforeShot.lifetime = .keepAlways;add(beforeShot)
            try drag(35)
            let returned=waitUntil(5) { abs((header()?.frame.minY ?? -1000)-resting)<3 }
            record(app,name:"44-after-small-drag-\(cycle)",detail:"Resting header Y=\(resting); current=\(header()?.frame.minY ?? -1000)")
            let afterShot=XCTAttachment(screenshot:app.screenshot());afterShot.name="44-after-small-drag-\(cycle)";afterShot.lifetime = .keepAlways;add(afterShot)
            XCTAssertTrue(returned,"Kleiner Zug muss zur Ausgangslage federn und offen bleiben.")
            try drag(-260,velocity:.fast,hold:0)
            XCTAssertTrue(waitUntil(6) { (header()?.frame.minY ?? 1000)<resting-40 })
            let expanded=try XCTUnwrap(header()).frame.minY
            try drag(35)
            XCTAssertTrue(waitUntil(5) { abs((header()?.frame.minY ?? -1000)-expanded)<3 },"Kleiner Gegenzug am erweiterten Blatt darf es nicht schließen.")
            record(app,name:"44-comments-expanded-small-reverse-\(cycle)")
            if cycle == 0 {
                let origin=app.coordinate(withNormalizedOffset:.zero)
                origin.withOffset(CGVector(dx:app.frame.width*0.55,dy:app.frame.height*0.75)).press(forDuration:0.05,thenDragTo:origin.withOffset(CGVector(dx:app.frame.width*0.55,dy:app.frame.height*0.40)),withVelocity:.slow,thenHoldForDuration:0)
                XCTAssertTrue(waitUntil(5) { (contentScroll() ?? 0)>40 },"Die Kommentarliste muss tatsächlich scrollen können.")
                XCTAssertEqual(try XCTUnwrap(header()).frame.minY,expanded,accuracy:3,"Listen-Scroll darf das erweiterte Blatt nicht verschieben.")
                record(app,name:"44-content-scroll-before-header-dismiss",detail:"Content scroll=\(contentScroll() ?? -1)")
            }
            if cycle == 1 {
                XCTAssertLessThanOrEqual(try XCTUnwrap(contentScroll()),1,"Wiedergeöffnete Liste muss am Anfang stehen.")
                let origin=app.coordinate(withNormalizedOffset:.zero)
                origin.withOffset(CGVector(dx:app.frame.width*0.55,dy:app.frame.height*0.45)).press(forDuration:0.05,thenDragTo:origin.withOffset(CGVector(dx:app.frame.width*0.55,dy:app.frame.height*0.88)),withVelocity:.fast,thenHoldForDuration:0)
                record(app,name:"44-body-at-top-dismiss")
            } else {
                try drag(app.frame.height,velocity:.fast,hold:0)
            }
            XCTAssertTrue(waitUntil(8) { header() == nil && opener() != nil },"Schließen muss die unveränderte Watchkarte wieder erreichbar machen.")
        }
        record(app,name:"44-comments-reopen-complete")
    }

    /// A separate visual-comparison run without the opt-in launch probes. The
    /// assertions establish UI navigation only; recorded pixels must establish
    /// moving content and the quality of the two fullscreen return animations.
    @MainActor func test46NormalSearchWatchAndRepeatedFullscreenWithoutDiagnostics() throws {
        executionTimeAllowance = 240
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication(bundleIdentifier: bundleID)
        app.launchArguments = []
        app.launchEnvironment = [:]
        XCTAssertFalse(app.launchEnvironment.keys.contains { $0.hasPrefix("LANGFORM_") })
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30))
        func screenshot(_ name: String) {
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = name; shot.lifetime = .keepAlways; add(shot)
        }
        var completed = false
        defer { if !completed { screenshot("46-normal-flow-failure") } }
        let reject = app.buttons.matching(NSPredicate(format: "label IN %@", [
            "Verwendung von Cookies und anderen Daten zu den beschriebenen Zwecken ablehnen",
            "Alle ablehnen", "Reject all"
        ])).firstMatch
        if reject.waitForExistence(timeout: 5) {
            for _ in 0..<5 where !reject.isHittable { app.webViews.firstMatch.swipeUp() }
            XCTAssertTrue(reject.isHittable, "Die optionale Cookie-Ablehnung ist nicht erreichbar.")
            reject.tap()
            XCTAssertTrue(waitUntil(8) { !reject.exists })
        }
        var search: XCUIElement?
        XCTAssertTrue(waitUntil(20) {
            search = app.buttons.matching(self.searchLabel).allElementsBoundByIndex.first {
                $0.exists && $0.isHittable && $0.frame.minY < 150
            }
            return search != nil
        }, "Der normale Appstart zeigt keine erreichbare Headerlupe.")
        try XCTUnwrap(search).tap()
        let field = app.textFields["langform-search-field"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "Die Headerlupe öffnet keine native Suche.")
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 6))
        field.typeText("M7lc1UVf-VE\n")
        // Public title observed in the actual case-40 attachment. This is an
        // ordinary result-link tap, not a watch URL or JavaScript injection.
        let title = "YouTube Developers Live: Embedded Web Player Customization"
        let resultLinks = app.webViews.firstMatch.links.matching(NSPredicate(format: "label BEGINSWITH %@", title))
        var result: XCUIElement?
        XCTAssertTrue(waitUntil(40) {
            !field.exists && resultLinks.firstMatch.exists
        }, "Die öffentliche Suche zeigt keinen Videolink mit dem belegten Titel.")
        func reachableResult() -> Bool {
            result = resultLinks
                .allElementsBoundByIndex.first { $0.exists && $0.isHittable && $0.frame.intersects(app.frame) }
            return result != nil
        }
        // The real search can rank a different public clip first. Scroll the
        // unchanged exact-title result into view instead of injecting a route.
        if !reachableResult() {
            for _ in 0..<4 where result == nil {
                app.webViews.firstMatch.swipeUp()
                _ = waitUntil(3, reachableResult)
            }
        }
        XCTAssertNotNil(result, "Der belegte Videotitel ist nach begrenztem normalem Feedscroll nicht erreichbar.")
        try XCTUnwrap(result).tap()
        XCTAssertTrue(waitUntil(35) {
            app.buttons["Verkleinern"].isHittable && self.sponsorPlayer(app) != nil
        }, "Der Suchtreffer öffnet keine normale große Watchansicht.")
        XCTAssertTrue(sponsorRevealControls(app), "Die normale Watchansicht zeigt keinen Wiedergabezugang.")
        if let play = sponsorPlayButton(app) { play.tap() }
        XCTAssertTrue(waitUntil(12) { app.buttons["Video anhalten"].isHittable },
                      "Nach dem normalen Playzugang fehlt die Pause-Steuerung; kein Wiedergabestatus wird erfunden.")
        screenshot("46-normal-watch-from-search")
        for cycle in 0..<2 {
            let picture = try XCTUnwrap(sponsorPlayer(app)).frame
            // Start away from the centre play button and bottom seek controls.
            let origin = app.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: picture.minX + picture.width * 0.20, dy: picture.minY + picture.height * 0.60))
                .press(forDuration: 0.05,
                       thenDragTo: origin.withOffset(CGVector(dx: picture.minX + picture.width * 0.20, dy: picture.minY + picture.height * 0.08)),
                       withVelocity: .fast, thenHoldForDuration: 0)
            XCTAssertTrue(waitUntil(12) { self.zoomRegion(app) != nil }, "Normaler Portrait-Swipe-Up öffnet Vollbild nicht.")
            let fs = try XCTUnwrap(zoomRegion(app))
            XCTAssertTrue(showZoomControls(fs))
            XCTAssertTrue(fs.buttons["Vollbild schließen"].isHittable)
            screenshot("46-normal-fullscreen-\(cycle)")
            fs.coordinate(withNormalizedOffset: CGVector(dx: 0.50, dy: 0.26))
                .press(forDuration: 0.05,
                       thenDragTo: fs.coordinate(withNormalizedOffset: CGVector(dx: 0.50, dy: 0.78)),
                       withVelocity: .fast, thenHoldForDuration: 0)
            XCTAssertTrue(waitUntil(12) {
                self.zoomRegion(app) == nil && app.buttons["Verkleinern"].isHittable && self.sponsorPlayer(app) != nil
            }, "Normaler Vollbild-Swipe-Down kehrt nicht zur großen Portrait-Watchansicht zurück.")
            screenshot("46-normal-portrait-return-\(cycle)")
        }
        let scope = XCTAttachment(string: "Normal app launch with an empty launch environment and no diagnostic/probe route. Public native search M7lc1UVf-VE; exact visible result title; ordinary Watch/Play UI; two actual Portrait-Up/Fullscreen-Down pairs. AX confirms views and buttons only. Content motion, frame continuity, audible sound and media/source progress are not established by these assertions; inspect the separate recording.")
        scope.name = "46-normal-flow-scope"; scope.lifetime = .keepAlways; add(scope)
        completed = true
    }

    /// Source-bound diagnostic comparison of two real fullscreen exit routes.
    /// The recording and raw motion clocks establish movement; AX assertions
    /// establish source continuity, UI ownership and actual media progression.
    @MainActor func test47MotionExitRoutesWithMovingVideo() throws {
        executionTimeAllowance = 240
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let videoID = "M7lc1UVf-VE"
        let app = launchInstalledApp(videoID: videoID, holdProbe: true, mutedPlayback: true)
        let collapse = app.buttons["Verkleinern"]
        func probeLabel() -> String {
            app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready="))
                .allElementsBoundByIndex.first?.label ?? ""
        }
        func probeState() -> [String: String] {
            Dictionary(probeLabel().split(separator: " ").compactMap { part -> (String, String)? in
                let pair = part.split(separator: "=", maxSplits: 1)
                return pair.count == 2 ? (String(pair[0]), String(pair[1])) : nil
            }, uniquingKeysWith: { _, last in last })
        }
        func boundary(_ name: String, route: String) {
            let epoch = Date().timeIntervalSince1970 * 1000
            record(app, name: name, detail: "route=\(route) nativeTestEpochMilliseconds=\(epoch)\n\(probeLabel())")
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = name + "-screen"; shot.lifetime = .keepAlways; add(shot)
        }
        XCTAssertTrue(waitUntil(40) {
            collapse.isHittable && self.sponsorPlayer(app) != nil &&
                self.zoomPlaybackReadback(app, videoID: videoID) != nil
        }, "Keine laufende, bereite und quellengebundene bewegte Watchquelle für die Motionprüfung.")
        let original = try XCTUnwrap(zoomPlaybackReadback(app, videoID: videoID))
        try assertFreshZoomPlayback(app, matching: original, name: "47-initial-moving-source")

        func enterByRotation(_ orientation: UIDeviceOrientation, route: String) throws -> XCUIElement {
            let before = try XCTUnwrap(zoomPlaybackReadback(app, videoID: videoID))
            XCUIDevice.shared.orientation = orientation
            XCTAssertTrue(waitUntil(15) {
                let state = probeState()
                guard let current = self.zoomPlaybackReadback(app, videoID: videoID) else { return false }
                return self.zoomRegion(app) != nil && app.frame.width > app.frame.height &&
                    state["fsStage"] == "open" && state["fsInert"] == "false" &&
                    abs((Double(state["windowW"] ?? "") ?? 0) - app.frame.width) < 2 &&
                    abs((Double(state["windowH"] ?? "") ?? 0) - app.frame.height) < 2 &&
                    current.media == original.media && current.source == original.source &&
                    current.sample > before.sample && current.time > before.time && current.rate == original.rate
            }, "\(route): Die tatsächliche Gerätedrehung erreicht keine frische laufende Vollbildoberfläche derselben Quelle.")
            let fullscreen = try XCTUnwrap(zoomRegion(app))
            XCTAssertTrue(showZoomControls(fullscreen), "\(route): Die echte Vollbildbedienung ist nicht erreichbar.")
            try assertFreshZoomPlayback(app, matching: original, name: "47-\(route)-moving-fullscreen")
            boundary("47-\(route)-before-exit", route: route)
            return fullscreen
        }
        func confirmInline(after before: ZoomPlaybackReadback, route: String) throws {
            XCTAssertTrue(waitUntil(15) {
                guard let current = self.zoomPlaybackReadback(app, videoID: videoID) else { return false }
                return self.zoomRegion(app) == nil && app.frame.height > app.frame.width &&
                    collapse.isHittable && self.sponsorPlayer(app) != nil &&
                    current.media == original.media && current.source == original.source &&
                    current.sample > before.sample && current.time >= before.time && current.rate == original.rate
            }, "\(route): Der Rückweg gibt keine bedienbare Portrait-Watchansicht mit derselben laufenden Quelle zurück.")
            try assertFreshZoomPlayback(app, matching: before, name: "47-\(route)-moving-inline")
            boundary("47-\(route)-after-exit", route: route)
        }

        let buttonFullscreen = try enterByRotation(.landscapeLeft, route: "landscape-button")
        // The accessibility attachment can outlive auto-hide. Resolve and expose
        // the same real close control again immediately before the actual tap.
        XCTAssertTrue(showZoomControls(buttonFullscreen))
        let buttonAnchor = try XCTUnwrap(zoomPlaybackReadback(app, videoID: videoID))
        let close = buttonFullscreen.buttons["Vollbild schließen"]
        XCTAssertTrue(close.exists && close.isHittable)
        close.tap()
        try confirmInline(after: buttonAnchor, route: "landscape-button")

        // A manual exit deliberately suppresses automatic re-entry until a new
        // portrait contact with the physical orientation rearms that policy.
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(waitUntil(8) { app.frame.height > app.frame.width && collapse.isHittable })
        _ = try enterByRotation(.landscapeRight, route: "physical-portrait")
        let rotationAnchor = try XCTUnwrap(zoomPlaybackReadback(app, videoID: videoID))
        XCUIDevice.shared.orientation = .portrait
        try confirmInline(after: rotationAnchor, route: "physical-portrait")

        let scope = XCTAttachment(string: "Covered separately: real landscape close-button exit and physical-orientation landscape-to-portrait exit, both on moving M7lc1UVf-VE after the existing diagnostic Watch entry. Source/media identity and fresh media-time advancement are checked before and after each route. Physical orientation here means XCTest orientation events in Simulator, not sensor or finger acceptance on an iPhone. Portrait fullscreen is explicitly untested: no known stable portrait-video source was provided, and no source ratio or orientation was faked. Recorded pixels and raw diagnostic clocks must be reviewed separately; these UI assertions do not prove smoothness, audible audio or FPS.")
        scope.name = "47-motion-exit-route-scope"; scope.lifetime = .keepAlways; add(scope)
    }

    /// Actual slow drags distinguish preview cancellation from release commit.
    /// Recorded pixels separately establish whether the held image follows.
    @MainActor func test48FullscreenShortDragCancelsAndLongDragCommits() throws {
        executionTimeAllowance = 240
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let videoID = "M7lc1UVf-VE"
        let app = launchInstalledApp(videoID: videoID, holdProbe: true, mutedPlayback: true)
        let collapse = app.buttons["Verkleinern"]
        func label() -> String {
            app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Holdprobe ready="))
                .allElementsBoundByIndex.first?.label ?? ""
        }
        func state() -> [String: String] {
            Dictionary(label().split(separator: " ").compactMap { part -> (String, String)? in
                let pair = part.split(separator: "=", maxSplits: 1)
                return pair.count == 2 ? (String(pair[0]), String(pair[1])) : nil
            }, uniquingKeysWith: { _, last in last })
        }
        func boundary(_ name: String, detail: String) {
            record(app, name: name, detail: "nativeTestEpochMilliseconds=\(Date().timeIntervalSince1970 * 1000) \(detail)\n\(label())")
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = name + "-screen"; shot.lifetime = .keepAlways; add(shot)
        }
        func assertNoSelectionMenu() {
            XCTAssertFalse(app.menuItems.matching(NSPredicate(format: "label IN %@", [
                "Kopieren", "Nachschlagen", "Übersetzen", "Copy", "Look Up", "Translate"
            ])).firstMatch.exists, "Die gezogene Vollbildgeste öffnet zusätzlich ein Textauswahlmenü.")
        }
        XCTAssertTrue(waitUntil(40) {
            collapse.isHittable && self.sponsorPlayer(app) != nil &&
                self.zoomPlaybackReadback(app, videoID: videoID) != nil
        }, "Keine bereite, laufende und quellengebundene Watchansicht für den tatsächlichen Gestentest.")
        let original = try XCTUnwrap(zoomPlaybackReadback(app, videoID: videoID))
        XCTAssertEqual(original.rate, 1)
        try assertFreshZoomPlayback(app, matching: original, name: "48-initial-moving-source")
        let beforeEntry = try XCTUnwrap(zoomPlaybackReadback(app, videoID: videoID))
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(waitUntil(15) {
            let currentState = state()
            guard let current = self.zoomPlaybackReadback(app, videoID: videoID) else { return false }
            return self.zoomRegion(app) != nil && app.frame.width > app.frame.height &&
                currentState["fsStage"] == "open" && currentState["fsInert"] == "false" &&
                abs((Double(currentState["windowW"] ?? "") ?? 0) - app.frame.width) < 2 &&
                abs((Double(currentState["windowH"] ?? "") ?? 0) - app.frame.height) < 2 &&
                current.media == original.media && current.source == original.source &&
                current.sample > beforeEntry.sample && current.time > beforeEntry.time && current.rate == 1
        }, "Die tatsächliche Gerätedrehung öffnet keine frische interaktive Vollbildoberfläche derselben laufenden Quelle.")
        let fullscreen = try XCTUnwrap(zoomRegion(app))
        XCTAssertTrue(showZoomControls(fullscreen))
        try assertFreshZoomPlayback(app, matching: original, name: "48-fullscreen-moving-source")

        // Use the free central lane above the play row, as in cases40/46.
        // A slow28pt drag is admitted for tracking but below the existing
        // distance threshold; the real1.2s endpoint hold also defeats a flick.
        boundary("48-short-before", detail: "downwardDistancePt=28 velocity=slow endpointHoldSeconds=1.2")
        let beforeShort = try XCTUnwrap(zoomPlaybackReadback(app, videoID: videoID))
        let shortStart = fullscreen.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.26))
        shortStart.press(forDuration: 0.05,
                         thenDragTo: shortStart.withOffset(CGVector(dx: 0, dy: 28)),
                         withVelocity: .slow, thenHoldForDuration: 1.2)
        let shortRelease = ProcessInfo.processInfo.systemUptime
        XCTAssertTrue(waitUntil(6) {
            let currentState = state()
            guard let current = self.zoomPlaybackReadback(app, videoID: videoID) else { return false }
            return ProcessInfo.processInfo.systemUptime - shortRelease >= 0.6 &&
                self.zoomRegion(app) != nil && app.frame.width > app.frame.height &&
                currentState["fsStage"] == "open" && currentState["fsInert"] == "false" &&
                current.media == original.media && current.source == original.source &&
                current.sample > beforeShort.sample && current.time > beforeShort.time && current.rate == 1
        }, "Ein langsamer28pt-Zug mit Halten muss nach dem Loslassen im selben laufenden Vollbild bleiben.")
        assertNoSelectionMenu()
        try assertFreshZoomPlayback(app, matching: beforeShort, name: "48-short-cancel-moving-source")
        boundary("48-short-after-cancel", detail: "Expected fullscreen remains open after actual release; visual return must be reviewed in recording.")

        let longFullscreen = try XCTUnwrap(zoomRegion(app))
        boundary("48-long-before", detail: "downwardDistancePt=120 velocity=slow endpointHoldSeconds=1.2")
        let beforeLong = try XCTUnwrap(zoomPlaybackReadback(app, videoID: videoID))
        let longStart = longFullscreen.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.26))
        longStart.press(forDuration: 0.05,
                        thenDragTo: longStart.withOffset(CGVector(dx: 0, dy: 120)),
                        withVelocity: .slow, thenHoldForDuration: 1.2)
        XCTAssertTrue(waitUntil(15) {
            guard let current = self.zoomPlaybackReadback(app, videoID: videoID) else { return false }
            return self.zoomRegion(app) == nil && app.frame.height > app.frame.width &&
                collapse.isHittable && self.sponsorPlayer(app) != nil &&
                current.media == original.media && current.source == original.source &&
                current.sample > beforeLong.sample && current.time >= beforeLong.time && current.rate == 1
        }, "Ein langsamer120pt-Zug muss beim Loslassen zur bedienbaren Inlineansicht derselben laufenden Quelle zurückkehren.")
        assertNoSelectionMenu()
        try assertFreshZoomPlayback(app, matching: beforeLong, name: "48-long-commit-moving-inline")
        boundary("48-long-after-commit", detail: "Expected inline return after actual release; playback owner preserved.")

        // The manual fullscreen exit suppresses automatic re-entry until this
        // real portrait orientation rearms the normal device-rotation policy.
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(waitUntil(8) { app.frame.height > app.frame.width && collapse.isHittable })
        collapse.tap()
        let mini = app.buttons["Video vergrößern"]
        XCTAssertTrue(waitUntil(10) {
            mini.exists && mini.isHittable && mini.frame.height < app.frame.height * 0.5 &&
                mini.value as? String == "Wiedergabe läuft"
        }, "Nach der Vollbildgeste ist kein erreichbarer laufender Miniplayer vorhanden.")
        mini.tap()
        XCTAssertTrue(waitUntil(10) {
            collapse.isHittable && self.sponsorPlayer(app) != nil && self.zoomRegion(app) == nil
        }, "Der Miniplayer lässt sich nach dem Vollbildrückweg nicht wieder vergrößern.")
        try assertFreshZoomPlayback(app, matching: beforeLong, name: "48-mini-expanded-same-moving-source")
        assertNoSelectionMenu()
        boundary("48-mini-expanded-after-gestures", detail: "Actual native minimize and expand buttons remain usable.")

        let scope = XCTAttachment(string: "Actual slow downward drags on moving M7lc1UVf-VE:28pt with1.2s endpoint hold must cancel on release and preserve fullscreen;120pt with1.2s endpoint hold must commit on release, return inline and preserve source/media identity plus fresh1x media progression. Subsequent real Mini/Expand controls are exercised. Coordinates and ordinary UI buttons only; the existing muted diagnostic Watch entry observes state. Held visual following and continuity require the separate recording. Selection-menu assertions do not prove the absence of an iOS magnifier at every held frame. Portrait-video fullscreen, reduced-motion system settings, audible audio and physical iPhone finger acceptance remain untested.")
        scope.name = "48-fullscreen-drag-scope"; scope.lifetime = .keepAlways; add(scope)
    }

}
