// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal view of an ERC-8004 identity registry (an ERC-721: one token per identity).
interface IIdentityRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title PayeeRegistry
/// @notice On-chain "Confirmation of Payee". Vendors register their own payout address once.
///         Payers (and their AI agents) refer to a vendor by `payeeId`, never by a raw address,
///         so an address in an invoice or a prompt can never redirect a payment.
///
///         Changing a payout address starts a cooldown. During the cooldown the payee is frozen:
///         `payoutOf` reports it as inactive and no payment can reach it. This defeats the classic
///         "our bank details have changed" invoice fraud, and gives payers time to notice.
///
///         A payee can optionally be linked to an ERC-8004 identity (agent/organisation NFT). The link
///         is only accepted from the identity's current owner.
contract PayeeRegistry {
    struct Payee {
        address owner; // who manages this entry (the vendor)
        address payout; // where payments go
        address pendingPayout; // non-zero while a change is cooling down
        uint64 changeReadyAt; // when `pendingPayout` may be confirmed
        uint64 registeredAt;
        bool active; // the owner can retire an entry
        uint256 identityId; // ERC-8004 identity id, 0 if not linked
        string name;
        string domain;
        string metadataURI;
    }

    /// @notice Cooldown for payout changes, in seconds (48 h in production, short on demo deployments).
    uint64 public immutable changeDelay;
    /// @notice ERC-8004 identity registry used for optional identity links (zero = linking disabled).
    IIdentityRegistry public immutable identityRegistry;

    uint256 public payeeCount;
    mapping(uint256 payeeId => Payee) private _payees;

    event PayeeRegistered(
        uint256 indexed payeeId, address indexed owner, address payout, string name, string domain, uint256 identityId
    );
    event PayoutChangeRequested(uint256 indexed payeeId, address newPayout, uint64 readyAt);
    event PayoutChangeCancelled(uint256 indexed payeeId);
    event PayoutChanged(uint256 indexed payeeId, address oldPayout, address newPayout);
    event PayeeActiveSet(uint256 indexed payeeId, bool active);
    event PayeeOwnerTransferred(uint256 indexed payeeId, address newOwner);

    error ZeroAddress();
    error EmptyName();
    error UnknownPayee();
    error NotPayeeOwner();
    error NotIdentityOwner();
    error IdentityLinkDisabled();
    error NoPendingChange();
    error ChangeNotReady(uint64 readyAt);
    error SamePayout();

    constructor(uint64 changeDelay_, address identityRegistry_) {
        changeDelay = changeDelay_;
        identityRegistry = IIdentityRegistry(identityRegistry_);
    }

    modifier onlyPayeeOwner(uint256 payeeId) {
        Payee storage p = _payees[payeeId];
        if (p.owner == address(0)) revert UnknownPayee();
        if (p.owner != msg.sender) revert NotPayeeOwner();
        _;
    }

    /// @notice Register yourself as a payee. Returns the new `payeeId` (starts at 1).
    /// @param identityId ERC-8004 identity to link, or 0. Must be owned by the caller.
    function register(
        string calldata name,
        string calldata domain,
        address payout,
        string calldata metadataURI,
        uint256 identityId
    ) external returns (uint256 payeeId) {
        if (payout == address(0)) revert ZeroAddress();
        if (bytes(name).length == 0) revert EmptyName();
        if (identityId != 0) _checkIdentity(identityId);

        payeeId = ++payeeCount;
        Payee storage p = _payees[payeeId];
        p.owner = msg.sender;
        p.payout = payout;
        p.registeredAt = uint64(block.timestamp);
        p.active = true;
        p.identityId = identityId;
        p.name = name;
        p.domain = domain;
        p.metadataURI = metadataURI;

        emit PayeeRegistered(payeeId, msg.sender, payout, name, domain, identityId);
    }

    /// @notice Start changing the payout address. The payee is frozen until the change is confirmed.
    function requestPayoutChange(uint256 payeeId, address newPayout) external onlyPayeeOwner(payeeId) {
        if (newPayout == address(0)) revert ZeroAddress();
        Payee storage p = _payees[payeeId];
        if (newPayout == p.payout) revert SamePayout();
        uint64 readyAt = uint64(block.timestamp) + changeDelay;
        p.pendingPayout = newPayout;
        p.changeReadyAt = readyAt;
        emit PayoutChangeRequested(payeeId, newPayout, readyAt);
    }

    /// @notice Abort a pending change. The old address becomes payable again at once.
    function cancelPayoutChange(uint256 payeeId) external onlyPayeeOwner(payeeId) {
        Payee storage p = _payees[payeeId];
        if (p.pendingPayout == address(0)) revert NoPendingChange();
        delete p.pendingPayout;
        delete p.changeReadyAt;
        emit PayoutChangeCancelled(payeeId);
    }

    /// @notice Finish a change once the cooldown is over. Anyone may call it.
    function confirmPayoutChange(uint256 payeeId) external {
        Payee storage p = _payees[payeeId];
        if (p.owner == address(0)) revert UnknownPayee();
        address next = p.pendingPayout;
        if (next == address(0)) revert NoPendingChange();
        if (block.timestamp < p.changeReadyAt) revert ChangeNotReady(p.changeReadyAt);
        address old = p.payout;
        p.payout = next;
        delete p.pendingPayout;
        delete p.changeReadyAt;
        emit PayoutChanged(payeeId, old, next);
    }

    function setActive(uint256 payeeId, bool active) external onlyPayeeOwner(payeeId) {
        _payees[payeeId].active = active;
        emit PayeeActiveSet(payeeId, active);
    }

    function transferPayeeOwner(uint256 payeeId, address newOwner) external onlyPayeeOwner(payeeId) {
        if (newOwner == address(0)) revert ZeroAddress();
        _payees[payeeId].owner = newOwner;
        emit PayeeOwnerTransferred(payeeId, newOwner);
    }

    /// @notice The address a payment to `payeeId` may go to right now.
    /// @return payout the registered payout address
    /// @return payable_ false if the payee is unknown, retired, or a payout change is pending
    function payoutOf(uint256 payeeId) external view returns (address payout, bool payable_) {
        Payee storage p = _payees[payeeId];
        payout = p.payout;
        payable_ = p.owner != address(0) && p.active && p.pendingPayout == address(0);
    }

    function getPayee(uint256 payeeId) external view returns (Payee memory) {
        if (_payees[payeeId].owner == address(0)) revert UnknownPayee();
        return _payees[payeeId];
    }

    function _checkIdentity(uint256 identityId) private view {
        if (address(identityRegistry) == address(0)) revert IdentityLinkDisabled();
        if (identityRegistry.ownerOf(identityId) != msg.sender) revert NotIdentityOwner();
    }
}
