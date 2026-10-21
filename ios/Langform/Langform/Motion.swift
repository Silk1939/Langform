import UIKit

/// Shared roles for app-owned decoration. Gesture decisions, geometry and the
/// existing physical oscillators keep their own ownership and equations.
enum LangformMotion {
    enum Duration {
        static let pressIn: TimeInterval = 0.08
        static let pressOut: TimeInterval = 0.16
        static let fade: TimeInterval = 0.16
        static let sheetEnter: TimeInterval = 0.36
        static let sheetExit: TimeInterval = 0.22
        static let surface: TimeInterval = 0.24
        static let submenu: TimeInterval = 0.18
        static let hero: TimeInterval = 0.40
    }

    enum Scale {
        static let icon: CGFloat = 0.94
        static let card: CGFloat = 0.98
    }

    enum Easing {
        static let enter = "cubic-bezier(.16,1,.3,1)"
        static let exit = "cubic-bezier(.4,0,1,1)"
        static let move = "cubic-bezier(.4,0,.2,1)"
        static let fade = "ease-out"
    }

    struct Spring {
        let omega: Double
        let damping: Double
        let duration: TimeInterval
        var descriptor: [String: Double] {
            ["omega": omega, "damping": damping, "duration": duration * 1000]
        }
    }

    // Descriptors preserve the current oscillator values; exporting a role
    // does not migrate its equation or substitute an unrelated native spring.
    enum Springs {
        static let hero = Spring(omega: 24, damping: 0.94, duration: Duration.hero)
        static let sheet = Spring(omega: 19, damping: 0.88, duration: 0.50)
    }

    enum HapticRole { case none, commit, selection }

    @MainActor static var reduceSpatialMotion: Bool {
        UIAccessibility.isReduceMotionEnabled || UIAccessibility.prefersCrossFadeTransitions
    }

    /// One cooldown across controls prevents adjacent committed actions from
    /// producing a burst. Callers still authenticate the real user contact.
    @MainActor enum Haptics {
        private static let commit = UIImpactFeedbackGenerator(style: .light)
        private static let selection = UISelectionFeedbackGenerator()
        private static var lastAt: TimeInterval?
        static let minimumInterval: TimeInterval = 0.07

        static func prepare(_ role: HapticRole) {
            switch role {
            case .none: break
            case .commit: commit.prepare()
            case .selection: selection.prepare()
            }
        }

        static func send(_ role: HapticRole) {
            guard role != .none else { return }
            let now = ProcessInfo.processInfo.systemUptime
            if let lastAt, now - lastAt < minimumInterval { return }
            lastAt = now
            switch role {
            case .none: break
            case .commit: commit.impactOccurred(intensity: 0.55)
            case .selection: selection.selectionChanged()
            }
        }
    }

    @MainActor static var preferenceUpdateSource: String {
        let reduced = UIAccessibility.isReduceMotionEnabled ? "true" : "false"
        let crossFade = UIAccessibility.prefersCrossFadeTransitions ? "true" : "false"
        return "window.__langformMotion && window.__langformMotion.setNativePreferences(\(reduced), \(crossFade))"
    }

    /// Prefix this before all app scripts in each WebView. The object and its
    /// role records are immutable; preference getters follow the live state.
    /// No head/style element, media access, frame loop or timer is required.
    @MainActor static var bootstrapSource: String {
        let roles: [String: Any] = [
            "version": 1,
            "durations": ["pressIn": Duration.pressIn * 1000, "pressOut": Duration.pressOut * 1000,
                "fade": Duration.fade * 1000, "sheetEnter": Duration.sheetEnter * 1000,
                "sheetExit": Duration.sheetExit * 1000, "surface": Duration.surface * 1000, "submenu": Duration.submenu * 1000,
                "hero": Duration.hero * 1000],
            "easings": ["enter": Easing.enter, "exit": Easing.exit, "move": Easing.move, "fade": Easing.fade],
            "scales": ["icon": Double(Scale.icon), "card": Double(Scale.card)],
            "springs": ["hero": Springs.hero.descriptor, "sheet": Springs.sheet.descriptor]
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: roles, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8) else { return "" }
        let reduced = UIAccessibility.isReduceMotionEnabled ? "true" : "false"
        let crossFade = UIAccessibility.prefersCrossFadeTransitions ? "true" : "false"
        return """
        (function(win){
          'use strict';
          if(!win || !win.document || win.__langformMotion)return;
          var doc=win.document,roles=\(json),reduced=\(reduced),crossFade=\(crossFade),query=null,mountObserver=null;
          function freeze(value){Object.keys(value).forEach(function(key){if(value[key] && typeof value[key]==='object')freeze(value[key]);});return Object.freeze(value);}
          freeze(roles);
          try{if(typeof win.matchMedia==='function')query=win.matchMedia('(prefers-reduced-motion: reduce)');}catch(_){}
          if(query)reduced=!!query.matches;
          function styles(){
            var root=doc.documentElement;if(!root || !root.style)return false;
            Object.keys(roles.durations).forEach(function(key){root.style.setProperty('--lf-duration-'+key,roles.durations[key]+'ms');});
            Object.keys(roles.easings).forEach(function(key){root.style.setProperty('--lf-ease-'+key,roles.easings[key]);});
            Object.keys(roles.scales).forEach(function(key){root.style.setProperty('--lf-scale-'+key,String(roles.scales[key]));});
            root.style.setProperty('--lf-reduced-motion',reduced?'1':'0');
            root.style.setProperty('--lf-prefers-crossfade',crossFade?'1':'0');
            root.style.setProperty('--lf-reduce-spatial-motion',reduced||crossFade?'1':'0');
            return true;
          }
          function sync(nextReduced,nextCrossFade){
            if(typeof nextReduced!=='boolean' || typeof nextCrossFade!=='boolean')return false;
            var changed=reduced!==nextReduced || crossFade!==nextCrossFade;
            reduced=nextReduced;crossFade=nextCrossFade;styles();
            if(changed && typeof win.CustomEvent==='function')win.dispatchEvent(new win.CustomEvent('langform-motion-change',{detail:Object.freeze({reducedMotion:reduced,prefersCrossFade:crossFade,reduceSpatialMotion:reduced||crossFade})}));
            return true;
          }
          var api={version:roles.version,durations:roles.durations,easings:roles.easings,scales:roles.scales,springs:roles.springs,
            get reducedMotion(){return reduced;},get prefersCrossFade(){return crossFade;},get reduceSpatialMotion(){return reduced||crossFade;},
            setNativePreferences:sync};
          Object.freeze(api);
          Object.defineProperty(win,'__langformMotion',{value:api,writable:false,configurable:false});
          if(!styles()){
            var mount=function(){if(styles() && mountObserver){mountObserver.disconnect();mountObserver=null;}};
            doc.addEventListener('DOMContentLoaded',mount,{once:true});
            if(typeof win.MutationObserver==='function'){mountObserver=new win.MutationObserver(mount);mountObserver.observe(doc,{childList:true});}
          }
          if(query){
            var changed=function(event){sync(!!event.matches,crossFade);};
            if(typeof query.addEventListener==='function')query.addEventListener('change',changed);
            else if(typeof query.addListener==='function')query.addListener(changed);
          }
        })(window);
        """
    }
}
