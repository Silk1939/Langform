import UIKit

/// A real UIKit search surface. The retained feed owns results and playback;
/// neither the keyboard nor suggestions ever live in the miniplayer WebView.
final class NativeSearchOverlay: UIView, UITextFieldDelegate, UITableViewDataSource, UITableViewDelegate {
    var onSubmit: ((NativeSearchSubmission, LangformSearchFilter) -> Void)?
    var onClose: (() -> Void)?
    var onOpenLink: (() -> Void)?
    private let field = UITextField()
    private let table = UITableView(frame: .zero, style: .plain)
    private let header = UIStackView()
    private let chips = UIStackView()
    private let chipScroll = UIScrollView()
    private var chipButtons: [LangformSearchFilter: UIButton] = [:]
    private var filter: LangformSearchFilter = .videos
    private var suggestions: [String] = []
    private var recent: [String] = []
    private var cache: [String: (Date, [String])] = [:]
    private var generation = 0
    private var focusGeneration = 0
    private var pending: DispatchWorkItem?
    private var request: URLSessionDataTask?
    private var keyboardFrame: CGRect = .null
    private var entrance: UIViewPropertyAnimator?
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.timeoutIntervalForRequest = 4
        config.timeoutIntervalForResource = 5
        return URLSession(configuration: config)
    }()

    init(query: String, filter: LangformSearchFilter, recent: [String]) {
        super.init(frame: .zero)
        self.filter = filter
        self.recent = recent
        overrideUserInterfaceStyle = .dark
        backgroundColor = .black
        accessibilityIdentifier = "langform-native-search"
        accessibilityViewIsModal = true
        let back = MotionButton(type: .system)
        back.setImage(UIImage(systemName: "arrow.left"), for: .normal)
        back.tintColor = .white
        back.accessibilityLabel = "Suche schließen"
        back.addTarget(self, action: #selector(close), for: .touchUpInside)
        back.widthAnchor.constraint(equalToConstant: 44).isActive = true
        back.heightAnchor.constraint(equalToConstant: 44).isActive = true
        field.text = query
        field.placeholder = "In YouTube suchen"
        field.accessibilityLabel = "In YouTube suchen"
        field.accessibilityIdentifier = "langform-search-field"
        field.font = .preferredFont(forTextStyle: .body)
        field.adjustsFontForContentSizeCategory = true
        field.textColor = .white
        field.backgroundColor = UIColor(white: 0.13, alpha: 1)
        field.layer.cornerRadius = 22
        let padding = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
        field.leftView = padding; field.leftViewMode = .always
        field.clearButtonMode = .whileEditing
        field.returnKeyType = .search
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.delegate = self
        field.addTarget(self, action: #selector(changed), for: .editingChanged)
        header.axis = .horizontal; header.spacing = 4
        header.addArrangedSubview(back); header.addArrangedSubview(field)
        let link = MotionButton(type: .system)
        link.setImage(UIImage(systemName: "link"), for: .normal)
        link.tintColor = .white
        link.accessibilityLabel = "YouTube-Link öffnen"
        link.accessibilityIdentifier = "langform-search-open-link"
        link.addTarget(self, action: #selector(openLink), for: .touchUpInside)
        link.widthAnchor.constraint(equalToConstant: 44).isActive = true
        link.heightAnchor.constraint(equalToConstant: 44).isActive = true
        header.addArrangedSubview(link)
        addSubview(header)
        chips.axis = .horizontal; chips.spacing = 8; chips.distribution = .fillEqually
        for item in LangformSearchFilter.allCases {
            let button = MotionButton(type: .custom)
            button.hapticRole = .selection
            button.setTitle(item.title, for: .normal)
            button.titleLabel?.font = .preferredFont(forTextStyle: .subheadline)
            button.titleLabel?.adjustsFontForContentSizeCategory = true
            button.layer.cornerRadius = 9
            button.accessibilityIdentifier = "langform-search-filter-" + item.rawValue
            button.addAction(UIAction { [weak self] _ in
                self?.filter = item; self?.updateChips()
                self?.focus()
            }, for: .touchUpInside)
            chipButtons[item] = button; chips.addArrangedSubview(button)
        }
        chipScroll.showsHorizontalScrollIndicator = false
        chipScroll.addSubview(chips)
        addSubview(chipScroll)
        table.backgroundColor = .black
        table.separatorStyle = .none
        table.keyboardDismissMode = .interactive
        table.dataSource = self; table.delegate = self
        table.rowHeight = UITableView.automaticDimension; table.estimatedRowHeight = 52
        table.accessibilityIdentifier = "langform-search-suggestions"
        addSubview(table)
        updateChips()
        NotificationCenter.default.addObserver(self, selector: #selector(keyboard(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboard(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        changed()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit { pending?.cancel(); request?.cancel(); session.invalidateAndCancel(); NotificationCenter.default.removeObserver(self) }

    /// Search has a short, quiet arrival; the keyboard keeps its own system
    /// timing. Animate decoration only, leaving the field's hit area stable.
    func present() {
        setNeedsLayout(); layoutIfNeeded()
        let reduced = LangformMotion.reduceSpatialMotion
        alpha = 0
        if !reduced {
            table.transform = CGAffineTransform(translationX: 0, y: 10)
        }
        let animation = UIViewPropertyAnimator(duration: reduced ? LangformMotion.Duration.fade : LangformMotion.Duration.surface,
            controlPoint1: CGPoint(x: 0.16, y: 1), controlPoint2: CGPoint(x: 0.3, y: 1)) {
                self.alpha = 1
                self.table.transform = .identity
        }
        entrance = animation
        animation.addCompletion { [weak self, weak animation] _ in
            guard let self, self.entrance === animation else { return }
            self.entrance = nil
        }
        animation.startAnimation()
        focus()
    }

    func focus() {
        focusGeneration += 1
        let ticket = focusGeneration
        // The WebKit callback can arrive before the newly attached field has
        // nonzero geometry. Lay it out, then finish focus after that callback.
        setNeedsLayout(); layoutIfNeeded()
        field.becomeFirstResponder()
        DispatchQueue.main.async { [weak self] in
            guard let self, self.focusGeneration == ticket, self.window != nil,
                  UIApplication.shared.applicationState == .active else { return }
            if !self.field.isFirstResponder { self.field.becomeFirstResponder() }
        }
    }
    func cancel() {
        entrance?.stopAnimation(true); entrance = nil
        alpha = 1; table.transform = .identity
        focusGeneration += 1
        generation += 1; pending?.cancel(); pending = nil; request?.cancel(); request = nil
        field.resignFirstResponder(); endEditing(true)
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        let top = safeAreaInsets.top + 4
        let width = max(0, bounds.width-safeAreaInsets.left-safeAreaInsets.right-16)
        header.frame = CGRect(x: safeAreaInsets.left+8, y: top, width: width, height: 44)
        chipScroll.frame = CGRect(x: safeAreaInsets.left+12, y: header.frame.maxY+10, width: max(0,width-8), height: 38)
        let longest = chipButtons.values.map { $0.intrinsicContentSize.width }.max() ?? 0
        let contentWidth = max(chipScroll.bounds.width, (longest+20)*CGFloat(chipButtons.count)+chips.spacing*CGFloat(max(0,chipButtons.count-1)))
        chips.frame = CGRect(x: 0, y: 0, width: contentWidth, height: 38)
        chipScroll.contentSize = chips.bounds.size
        let keyboard = keyboardFrame.isNull ? .null : convert(keyboardFrame, from: nil).intersection(bounds)
        let bottom = keyboard.isNull ? bounds.maxY-safeAreaInsets.bottom : min(bounds.maxY, keyboard.minY)
        table.frame = CGRect(x: safeAreaInsets.left, y: chipScroll.frame.maxY+8, width: max(0,bounds.width-safeAreaInsets.left-safeAreaInsets.right), height: max(0,bottom-chipScroll.frame.maxY-8))
    }

    @objc private func keyboard(_ note: Notification) {
        keyboardFrame = note.name == UIResponder.keyboardWillHideNotification ? .null : (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect ?? .null)
        let duration = note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        let curve = (note.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt) ?? 7
        UIView.animate(withDuration: LangformMotion.reduceSpatialMotion ? 0 : duration, delay: 0,
                       options: [UIView.AnimationOptions(rawValue: curve << 16), .beginFromCurrentState, .allowUserInteraction]) {
            self.setNeedsLayout(); self.layoutIfNeeded()
        }
    }
    private func updateChips() {
        for (item, button) in chipButtons {
            let selected = item == filter
            button.isSelected = selected
            button.backgroundColor = selected ? .white : UIColor(white: 0.16, alpha: 1)
            button.setTitleColor(selected ? .black : .white, for: .normal)
            button.setTitleColor(selected ? .black : .white, for: .selected)
            button.accessibilityTraits = selected ? [.button, .selected] : .button
        }
    }
    @objc private func close() { cancel(); onClose?() }
    @objc private func openLink() { cancel(); onOpenLink?() }
    func textFieldShouldReturn(_ textField: UITextField) -> Bool { submit(textField.text ?? ""); return true }
    private func submit(_ text: String) {
        // Pasting a shared URL into the search field is also an explicit open
        // request. Validate the full URL before the ordinary 200-character
        // search limit; never turn a truncated link into a different target.
        if let link = try? ExternalYouTubeLink.parse(text) {
            let selected = filter
            cancel(); onSubmit?(.youtubeLink(link.url), selected)
            return
        }
        let query = LangformSearchPolicy.query(text)
        guard !query.isEmpty else { return }
        let selected = filter
        cancel(); onSubmit?(.query(query), selected)
    }

    @objc private func changed() {
        generation += 1; let ticket = generation
        pending?.cancel(); request?.cancel(); request = nil
        let query = LangformSearchPolicy.query(field.text ?? "")
        suggestions = recent.filter { query.isEmpty || $0.localizedCaseInsensitiveContains(query) }.prefix(8).map { $0 }
        table.reloadData()
        guard let url = LangformSearchPolicy.suggestionURL(query: query) else { return }
        if let cached = cache[query.lowercased()], Date().timeIntervalSince(cached.0) < 180 {
            suggestions = cached.1; table.reloadData(); return
        }
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.generation == ticket, self.window != nil else { return }
            self.request = self.session.dataTask(with: url) { [weak self] data, response, error in
                guard error == nil, let http = response as? HTTPURLResponse, http.statusCode == 200, let data else { return }
                let values = LangformSearchPolicy.suggestions(from: data, expectedQuery: query)
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.generation == ticket, self.window != nil,
                          LangformSearchPolicy.query(self.field.text ?? "") == query else { return }
                    if self.cache.count >= 32 { self.cache.removeAll(keepingCapacity: true) }
                    self.cache[query.lowercased()] = (Date(), values)
                    self.suggestions = values; self.table.reloadData()
                }
            }
            self.request?.resume()
        }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now()+0.18, execute: work)
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { suggestions.count }
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "suggestion") ?? UITableViewCell(style: .default, reuseIdentifier: "suggestion")
        var content = cell.defaultContentConfiguration()
        content.text = suggestions[indexPath.row]
        content.textProperties.color = .white
        content.textProperties.numberOfLines = 2
        content.image = UIImage(systemName: (field.text ?? "").isEmpty ? "clock.arrow.circlepath" : "magnifyingglass")
        content.imageProperties.tintColor = .lightGray
        cell.contentConfiguration = content; cell.backgroundColor = .black
        cell.accessibilityTraits = .button
        return cell
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        guard suggestions.indices.contains(indexPath.row) else { return }
        submit(suggestions[indexPath.row])
    }
}
