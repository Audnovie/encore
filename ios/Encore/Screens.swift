import UIKit

private let accent = UIColor(red: 0.902, green: 0.263, blue: 0.306, alpha: 1) // Encore's rose, #E6434E

private func label(_ text: String, _ style: UIFont.TextStyle, weight: UIFont.Weight = .regular, color: UIColor = .label) -> UILabel {
    let l = UILabel()
    l.text = text
    let base = UIFont.preferredFont(forTextStyle: style)
    l.font = UIFont.systemFont(ofSize: base.pointSize, weight: weight)
    l.adjustsFontForContentSizeCategory = true
    l.textColor = color
    l.numberOfLines = 0
    l.textAlignment = .center
    return l
}

private func filledButton(_ title: String) -> UIButton {
    let b = UIButton(type: .system)
    b.setTitle(title, for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
    b.setTitleColor(.white, for: .normal)
    b.backgroundColor = accent
    b.layer.cornerRadius = 14
    b.layer.cornerCurve = .continuous
    b.heightAnchor.constraint(equalToConstant: 52).isActive = true
    return b
}

private func plainButton(_ title: String) -> UIButton {
    let b = UIButton(type: .system)
    b.setTitle(title, for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: 17, weight: .regular)
    b.setTitleColor(accent, for: .normal)
    b.heightAnchor.constraint(equalToConstant: 44).isActive = true
    return b
}

/// A centred column that scrolls when the keyboard or large text needs it.
private func column(in host: UIView, _ views: [UIView]) -> UIScrollView {
    let scroll = UIScrollView()
    scroll.translatesAutoresizingMaskIntoConstraints = false
    scroll.keyboardDismissMode = .interactive
    scroll.alwaysBounceVertical = true
    host.addSubview(scroll)
    // box: as tall as the screen, or as the column when that's taller; the column sits in its middle
    let box = UIView()
    box.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(box)
    let stack = UIStackView(arrangedSubviews: views)
    stack.axis = .vertical
    stack.spacing = 14
    stack.alignment = .fill
    stack.translatesAutoresizingMaskIntoConstraints = false
    box.addSubview(stack)
    NSLayoutConstraint.activate([
        scroll.leadingAnchor.constraint(equalTo: host.leadingAnchor),
        scroll.trailingAnchor.constraint(equalTo: host.trailingAnchor),
        scroll.topAnchor.constraint(equalTo: host.topAnchor),
        scroll.bottomAnchor.constraint(equalTo: host.keyboardLayoutGuide.topAnchor),
        box.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
        box.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
        box.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
        box.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
        box.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
        box.heightAnchor.constraint(greaterThanOrEqualTo: scroll.frameLayoutGuide.heightAnchor),
        box.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor).withPriority(.defaultLow),
        stack.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 28),
        stack.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -28),
        stack.centerYAnchor.constraint(equalTo: box.centerYAnchor),
        stack.topAnchor.constraint(greaterThanOrEqualTo: box.topAnchor, constant: 40),
        stack.bottomAnchor.constraint(lessThanOrEqualTo: box.bottomAnchor, constant: -24),
    ])
    return scroll
}

private extension NSLayoutConstraint {
    func withPriority(_ p: UILayoutPriority) -> NSLayoutConstraint { priority = p; return self }
}

/// First screen: where is Encore?
final class SetupView: UIView, UITextFieldDelegate {
    var onConnect: ((URL) -> Void)?
    var onCancel: (() -> Void)?
    private let field = UITextField()
    private let error = label("", .footnote, color: .systemRed)
    private let cancel = plainButton("Cancel")

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .systemBackground
        accessibilityIdentifier = "setupScreen"

        let icon = UIImageView(image: UIImage(named: "Logo"))
        icon.contentMode = .scaleAspectFit
        icon.layer.cornerRadius = 22
        icon.layer.cornerCurve = .continuous
        icon.clipsToBounds = true
        icon.heightAnchor.constraint(equalToConstant: 96).isActive = true
        let iconRow = UIView()
        iconRow.addSubview(icon)
        icon.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 96),
            icon.centerXAnchor.constraint(equalTo: iconRow.centerXAnchor),
            icon.topAnchor.constraint(equalTo: iconRow.topAnchor),
            icon.bottomAnchor.constraint(equalTo: iconRow.bottomAnchor),
        ])

        let title = label("Encore", .largeTitle, weight: .bold)
        let intro = label("Enter the address you open Encore at in Safari.", .body, color: .secondaryLabel)

        field.placeholder = "http://192.168.1.20:4534"
        field.keyboardType = .URL
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.spellCheckingType = .no
        field.textContentType = .URL
        field.returnKeyType = .go
        field.clearButtonMode = .whileEditing
        field.borderStyle = .none
        field.backgroundColor = .secondarySystemBackground
        field.layer.cornerRadius = 12
        field.layer.cornerCurve = .continuous
        field.font = .systemFont(ofSize: 17)
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 10))
        field.leftViewMode = .always
        field.heightAnchor.constraint(equalToConstant: 50).isActive = true
        field.delegate = self
        field.accessibilityIdentifier = "addressField"
        field.accessibilityLabel = "Encore’s address"

        let connect = filledButton("Connect")
        connect.accessibilityIdentifier = "connectButton"
        connect.addTarget(self, action: #selector(connectTapped), for: .touchUpInside)
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

        let note = label("Away from home, use the Tailscale address so it works everywhere. You can change it later in Encore’s Settings.",
                         .footnote, color: .secondaryLabel)
        error.isHidden = true

        _ = column(in: self, [iconRow, title, intro, field, error, connect, cancel, note])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func prepare(current: URL?, cancellable: Bool) {
        field.text = current?.absoluteString ?? ""
        error.isHidden = true
        cancel.isHidden = !cancellable
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        connectTapped()
        return false
    }

    @objc private func connectTapped() {
        guard let url = Address.normalize(field.text ?? "") else {
            error.text = "That isn’t a web address. It looks like http://192.168.1.20:4534 (the address and port of Encore, not of Navidrome)."
            error.isHidden = false
            return
        }
        error.isHidden = true
        endEditing(true)
        onConnect?(url)
    }

    @objc private func cancelTapped() {
        endEditing(true)
        onCancel?()
    }
}

/// When the page can't be shown.
final class ProblemView: UIView {
    enum Kind: Equatable {
        case unreachable(String)
        case httpError(Int)
        case notEncore
        case oldEncore(String)
    }

    var onRetry: (() -> Void)?
    var onChangeAddress: (() -> Void)?
    var onUseAnyway: (() -> Void)?
    private let title = label("", .title2, weight: .bold)
    private let message = label("", .body, color: .secondaryLabel)
    private let retry = filledButton("Try Again")
    private let change = plainButton("Change Address")
    private let anyway = plainButton("Use It Anyway")

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .systemBackground
        accessibilityIdentifier = "problemScreen"
        let symbol = UIImageView(image: UIImage(systemName: "wifi.exclamationmark"))
        symbol.tintColor = .secondaryLabel
        symbol.contentMode = .scaleAspectFit
        symbol.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 44, weight: .regular)
        symbol.heightAnchor.constraint(equalToConstant: 56).isActive = true
        retry.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        change.addTarget(self, action: #selector(changeTapped), for: .touchUpInside)
        anyway.addTarget(self, action: #selector(anywayTapped), for: .touchUpInside)
        retry.accessibilityIdentifier = "retryButton"
        title.accessibilityIdentifier = "problemTitle"
        _ = column(in: self, [symbol, title, message, retry, change, anyway])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func show(_ kind: Kind, address: URL?) {
        let at = address.map { ($0.host ?? "") + ($0.port.map { ":\($0)" } ?? "") } ?? "that address"
        anyway.isHidden = true
        switch kind {
        case .unreachable(let why):
            title.text = "Can’t reach Encore"
            message.text = "Nothing answered at \(at). If you’re away from home, check that Tailscale is on. If you’re at home, check the Wi-Fi.\n\n(\(why))"
        case .httpError(let code):
            title.text = "Can’t open Encore"
            message.text = "The server at \(at) answered with error \(code). Check the address: it should be Encore’s, the one you open in Safari."
        case .notEncore:
            title.text = "This isn’t Encore"
            message.text = "A web page opened at \(at), but it isn’t Encore. Check the address and port (Encore’s, not Navidrome’s)."
        case .oldEncore(let v):
            title.text = "Update Encore on your server"
            message.text = "This is Encore \(v). The iPhone app needs Encore 1.5 or newer on your server to keep playing while the phone is locked."
            anyway.isHidden = false
        }
        isHidden = false
    }

    @objc private func retryTapped() { onRetry?() }
    @objc private func changeTapped() { onChangeAddress?() }
    @objc private func anywayTapped() { onUseAnyway?() }
}
