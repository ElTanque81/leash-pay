// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPayeeRegistry {
    function payoutOf(uint256 payeeId) external view returns (address payout, bool payable_);
}

/// @dev EIP-3009 receive function (tUSD8 implements it).
interface IERC3009Receive {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title LeashVault
/// @notice Lets an AI agent pay invoices in a stablecoin, on a leash.
///
///         The owner deposits tUSD8 into a *leash* and names an agent key. The agent can only *propose*
///         payments, and only within the leash's rules, which this contract enforces:
///         - payees come from the PayeeRegistry by id; the agent never supplies an address
///         - a cap per invoice and a rolling 24 h cap (queued payments count against it)
///         - each (payee, invoice reference) can be paid at most once, whatever the amount
///         - the leash expires, and the owner can revoke it at any time
///
///         Tiers: small payments to a payee that was paid before settle at once (tier A). Everything
///         else waits in a queue for `vetoWindow` seconds; the owner can veto or approve early,
///         otherwise anyone (a keeper) executes it after the window (tier B). Above the cap: rejected.
contract LeashVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Queued,
        Paid,
        Vetoed
    }

    struct Leash {
        address owner;
        address agent;
        uint64 expiresAt;
        uint32 vetoWindow;
        bool revoked;
        uint128 balance; // deposited minus paid
        uint128 reserved; // sum of queued payments
        uint128 autoLimit; // tier A ceiling (known payees only)
        uint128 maxPerInvoice; // hard ceiling per payment
        uint128 dailyCap; // rolling 24 h ceiling, paid + queued
        uint128 spentInWindow;
        uint64 windowStart;
    }

    struct Payment {
        uint256 leashId;
        uint256 payeeId;
        address payout; // payout address at proposal time; must be unchanged at execution
        uint128 amount;
        uint64 proposedAt;
        uint64 executeAfter; // 0 for tier A
        uint64 windowStart; // the 24 h window this payment was counted in
        Status status;
        bytes32 invoiceRef; // keccak256 of the normalised invoice number
        bytes32 docHash; // keccak256 of the invoice document, for the audit trail
    }

    uint64 public constant WINDOW = 1 days;

    IERC20 public immutable token;
    IPayeeRegistry public immutable registry;

    uint256 public leashCount;
    uint256 public paymentCount;
    mapping(uint256 leashId => Leash) public leashes;
    mapping(uint256 paymentId => Payment) public payments;
    mapping(uint256 leashId => mapping(uint256 payeeId => bool)) public payeeAllowed;
    mapping(uint256 leashId => mapping(uint256 payeeId => bool)) public payeePaidBefore;
    /// @notice (leash, keccak256(payeeId, invoiceRef)) => payment id that consumed it
    mapping(uint256 leashId => mapping(bytes32 invoiceKey => uint256 paymentId)) public invoiceUsed;

    event LeashCreated(
        uint256 indexed leashId,
        address indexed owner,
        address indexed agent,
        uint128 autoLimit,
        uint128 maxPerInvoice,
        uint128 dailyCap,
        uint64 expiresAt,
        uint32 vetoWindow
    );
    event LeashUpdated(
        uint256 indexed leashId,
        address agent,
        uint128 autoLimit,
        uint128 maxPerInvoice,
        uint128 dailyCap,
        uint64 expiresAt,
        uint32 vetoWindow
    );
    event LeashRevoked(uint256 indexed leashId);
    event Funded(uint256 indexed leashId, address indexed from, uint256 amount);
    event Withdrawn(uint256 indexed leashId, address indexed to, uint256 amount);
    event PayeeAllowed(uint256 indexed leashId, uint256 indexed payeeId, bool allowed);
    event PaymentProposed(
        uint256 indexed paymentId,
        uint256 indexed leashId,
        uint256 indexed payeeId,
        uint128 amount,
        bytes32 invoiceRef,
        bytes32 docHash,
        uint64 executeAfter,
        string memo
    );
    event PaymentExecuted(
        uint256 indexed paymentId, uint256 indexed leashId, address indexed payout, uint128 amount, bytes32 invoiceRef
    );
    event PaymentVetoed(uint256 indexed paymentId, uint256 indexed leashId);

    error NotOwner();
    error NotAgent();
    error UnknownLeash();
    error LeashRevokedErr();
    error LeashExpired();
    error BadLimits();
    error ZeroAmount();
    error OverInvoiceCap(uint128 amount, uint128 maxPerInvoice);
    error OverDailyCap(uint128 amount, uint128 remaining);
    error InsufficientBalance(uint128 amount, uint128 available);
    error PayeeNotAllowed(uint256 payeeId);
    error PayeeNotPayable(uint256 payeeId);
    error PayeeChanged(uint256 payeeId);
    error InvoiceAlreadyUsed(uint256 paymentId);
    error NotQueued();
    error VetoWindowOpen(uint64 executeAfter);
    error WrongPayer();

    constructor(IERC20 token_, IPayeeRegistry registry_) {
        token = token_;
        registry = registry_;
    }

    // ------------------------------------------------------------------ owner

    modifier onlyLeashOwner(uint256 leashId) {
        if (leashes[leashId].owner != msg.sender) revert NotOwner();
        _;
    }

    function createLeash(
        address agent,
        uint128 autoLimit,
        uint128 maxPerInvoice,
        uint128 dailyCap,
        uint64 expiresAt,
        uint32 vetoWindow
    ) external returns (uint256 leashId) {
        _checkLimits(agent, autoLimit, maxPerInvoice, dailyCap, expiresAt);
        leashId = ++leashCount;
        Leash storage l = leashes[leashId];
        l.owner = msg.sender;
        l.agent = agent;
        l.autoLimit = autoLimit;
        l.maxPerInvoice = maxPerInvoice;
        l.dailyCap = dailyCap;
        l.expiresAt = expiresAt;
        l.vetoWindow = vetoWindow;
        l.windowStart = uint64(block.timestamp);
        emit LeashCreated(leashId, msg.sender, agent, autoLimit, maxPerInvoice, dailyCap, expiresAt, vetoWindow);
    }

    /// @notice Change the rules (or rotate the agent key). Queued payments keep their amounts.
    function updateLeash(
        uint256 leashId,
        address agent,
        uint128 autoLimit,
        uint128 maxPerInvoice,
        uint128 dailyCap,
        uint64 expiresAt,
        uint32 vetoWindow
    ) external onlyLeashOwner(leashId) {
        Leash storage l = leashes[leashId];
        if (l.revoked) revert LeashRevokedErr();
        // An expired leash's queued payments are void and its reserve is free; start a new leash instead.
        if (block.timestamp >= l.expiresAt) revert LeashExpired();
        _checkLimits(agent, autoLimit, maxPerInvoice, dailyCap, expiresAt);
        l.agent = agent;
        l.autoLimit = autoLimit;
        l.maxPerInvoice = maxPerInvoice;
        l.dailyCap = dailyCap;
        l.expiresAt = expiresAt;
        l.vetoWindow = vetoWindow;
        emit LeashUpdated(leashId, agent, autoLimit, maxPerInvoice, dailyCap, expiresAt, vetoWindow);
    }

    /// @notice Kill switch: the agent loses all rights and every queued payment is void.
    function revoke(uint256 leashId) external onlyLeashOwner(leashId) {
        Leash storage l = leashes[leashId];
        if (l.revoked) revert LeashRevokedErr();
        l.revoked = true;
        l.reserved = 0; // queued payments can no longer execute
        emit LeashRevoked(leashId);
    }

    function setPayeeAllowed(uint256 leashId, uint256 payeeId, bool allowed) external onlyLeashOwner(leashId) {
        payeeAllowed[leashId][payeeId] = allowed;
        emit PayeeAllowed(leashId, payeeId, allowed);
    }

    /// @notice Deposit with a prior `approve`. Anyone may top up a leash.
    function fund(uint256 leashId, uint128 amount) external nonReentrant {
        Leash storage l = leashes[leashId];
        if (l.owner == address(0)) revert UnknownLeash();
        if (amount == 0) revert ZeroAmount();
        l.balance += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(leashId, msg.sender, amount);
    }

    /// @notice Gasless deposit: the owner signs an EIP-3009 `ReceiveWithAuthorization` to this vault,
    ///         anyone (a relayer) submits it. Only the leash owner's signature is accepted.
    function fundWithAuthorization(
        uint256 leashId,
        address from,
        uint128 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        Leash storage l = leashes[leashId];
        if (l.owner == address(0)) revert UnknownLeash();
        if (from != l.owner) revert WrongPayer();
        if (amount == 0) revert ZeroAmount();
        l.balance += amount;
        IERC3009Receive(address(token)).receiveWithAuthorization(
            from, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
        emit Funded(leashId, from, amount);
    }

    /// @notice Take back funds that are not reserved for queued payments.
    function withdraw(uint256 leashId, uint128 amount) external onlyLeashOwner(leashId) nonReentrant {
        Leash storage l = leashes[leashId];
        uint128 free = _free(l);
        if (amount > free) revert InsufficientBalance(amount, free);
        l.balance -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(leashId, msg.sender, amount);
    }

    function veto(uint256 paymentId) external {
        Payment storage p = payments[paymentId];
        Leash storage l = leashes[p.leashId];
        if (l.owner != msg.sender) revert NotOwner();
        if (p.status != Status.Queued || l.revoked) revert NotQueued();
        p.status = Status.Vetoed;
        l.reserved -= p.amount;
        if (p.windowStart == l.windowStart) l.spentInWindow -= p.amount;
        emit PaymentVetoed(paymentId, p.leashId);
    }

    /// @notice Owner skips the veto window and pays now.
    function approveNow(uint256 paymentId) external nonReentrant {
        Payment storage p = payments[paymentId];
        if (leashes[p.leashId].owner != msg.sender) revert NotOwner();
        _execute(paymentId, p);
    }

    // ------------------------------------------------------------------ agent

    /// @notice The agent's only power: ask to pay `amount` to registered payee `payeeId`.
    /// @param invoiceRef keccak256 of the normalised invoice number (one payment per payee + number)
    /// @param docHash keccak256 of the invoice document (stored in the event for audits)
    /// @param memo short human-readable note (vendor, invoice number, due date)
    function propose(
        uint256 leashId,
        uint256 payeeId,
        uint128 amount,
        bytes32 invoiceRef,
        bytes32 docHash,
        string calldata memo
    ) external nonReentrant returns (uint256 paymentId) {
        Leash storage l = leashes[leashId];
        if (l.owner == address(0)) revert UnknownLeash();
        if (msg.sender != l.agent) revert NotAgent();
        if (l.revoked) revert LeashRevokedErr();
        if (block.timestamp >= l.expiresAt) revert LeashExpired();
        if (amount == 0) revert ZeroAmount();
        if (amount > l.maxPerInvoice) revert OverInvoiceCap(amount, l.maxPerInvoice);
        if (!payeeAllowed[leashId][payeeId]) revert PayeeNotAllowed(payeeId);

        (address payout, bool payable_) = registry.payoutOf(payeeId);
        if (!payable_) revert PayeeNotPayable(payeeId);

        bytes32 key = keccak256(abi.encode(payeeId, invoiceRef));
        uint256 used = invoiceUsed[leashId][key];
        if (used != 0) revert InvoiceAlreadyUsed(used);

        _rollWindow(l);
        uint128 remaining = l.dailyCap > l.spentInWindow ? l.dailyCap - l.spentInWindow : 0;
        if (amount > remaining) revert OverDailyCap(amount, remaining);
        uint128 free = l.balance - l.reserved;
        if (amount > free) revert InsufficientBalance(amount, free);

        paymentId = ++paymentCount;
        invoiceUsed[leashId][key] = paymentId;
        l.spentInWindow += amount;

        Payment storage p = payments[paymentId];
        p.leashId = leashId;
        p.payeeId = payeeId;
        p.payout = payout;
        p.amount = amount;
        p.proposedAt = uint64(block.timestamp);
        p.windowStart = l.windowStart;
        p.invoiceRef = invoiceRef;
        p.docHash = docHash;

        bool instant = amount <= l.autoLimit && payeePaidBefore[leashId][payeeId];
        p.executeAfter = instant ? 0 : uint64(block.timestamp) + l.vetoWindow;
        p.status = Status.Queued;
        l.reserved += amount;

        emit PaymentProposed(paymentId, leashId, payeeId, amount, invoiceRef, docHash, p.executeAfter, memo);

        if (instant) _execute(paymentId, p);
    }

    // ------------------------------------------------------------------ keeper

    /// @notice Pay a queued payment once its veto window has passed. Anyone may call it.
    function execute(uint256 paymentId) external nonReentrant {
        Payment storage p = payments[paymentId];
        if (p.status == Status.Queued && block.timestamp < p.executeAfter) revert VetoWindowOpen(p.executeAfter);
        _execute(paymentId, p);
    }

    // ------------------------------------------------------------------ views

    function available(uint256 leashId) external view returns (uint128) {
        return _free(leashes[leashId]);
    }

    /// @notice What the agent could still spend in the current 24 h window.
    function remainingToday(uint256 leashId) external view returns (uint128) {
        Leash storage l = leashes[leashId];
        if (block.timestamp >= l.windowStart + WINDOW) return l.dailyCap;
        return l.dailyCap > l.spentInWindow ? l.dailyCap - l.spentInWindow : 0;
    }

    /// @notice True if a payment is queued and can still execute (not revoked, not expired).
    function isPending(uint256 paymentId) external view returns (bool) {
        Payment storage p = payments[paymentId];
        Leash storage l = leashes[p.leashId];
        return p.status == Status.Queued && !l.revoked && block.timestamp < l.expiresAt;
    }

    function invoiceKey(uint256 payeeId, bytes32 invoiceRef) external pure returns (bytes32) {
        return keccak256(abi.encode(payeeId, invoiceRef));
    }

    // ------------------------------------------------------------------ internal

    function _execute(uint256 paymentId, Payment storage p) private {
        Leash storage l = leashes[p.leashId];
        if (p.status != Status.Queued) revert NotQueued();
        if (l.revoked) revert LeashRevokedErr();
        if (block.timestamp >= l.expiresAt) revert LeashExpired();
        (address payout, bool payable_) = registry.payoutOf(p.payeeId);
        if (!payable_ || payout != p.payout) revert PayeeChanged(p.payeeId);

        uint128 amount = p.amount;
        p.status = Status.Paid;
        l.reserved -= amount;
        l.balance -= amount;
        payeePaidBefore[p.leashId][p.payeeId] = true;
        token.safeTransfer(payout, amount);
        emit PaymentExecuted(paymentId, p.leashId, payout, amount, p.invoiceRef);
    }

    /// @dev Funds the owner may take out. Once revoked or expired, queued payments can never execute,
    ///      so nothing stays reserved.
    function _free(Leash storage l) private view returns (uint128) {
        if (l.revoked || block.timestamp >= l.expiresAt) return l.balance;
        return l.balance - l.reserved;
    }

    function _rollWindow(Leash storage l) private {
        if (block.timestamp >= l.windowStart + WINDOW) {
            l.windowStart = uint64(block.timestamp);
            l.spentInWindow = 0;
        }
    }

    function _checkLimits(address agent, uint128 autoLimit, uint128 maxPerInvoice, uint128 dailyCap, uint64 expiresAt)
        private
        view
    {
        if (agent == address(0)) revert BadLimits();
        if (maxPerInvoice == 0 || autoLimit > maxPerInvoice || maxPerInvoice > dailyCap) revert BadLimits();
        if (expiresAt <= block.timestamp) revert BadLimits();
    }
}
