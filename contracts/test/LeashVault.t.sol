// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";
import {LeashVault, IPayeeRegistry} from "../src/LeashVault.sol";
import {Signing} from "./Signing.sol";

contract MockIdentity is ERC721 {
    constructor() ERC721("Agent Identity", "AID") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

contract LeashVaultTest is Test {
    MockUSD8 token;
    PayeeRegistry registry;
    LeashVault vault;
    MockIdentity identity;

    uint256 ownerPk = 0xA11CE;
    address owner;
    address agent = makeAddr("agent");
    address hostingPayout = makeAddr("hostingPayout");
    address designPayout = makeAddr("designPayout");
    address hostingVendor = makeAddr("hostingVendor");
    address designVendor = makeAddr("designVendor");
    address attacker = makeAddr("attacker");
    address keeper = makeAddr("keeper");

    uint64 constant DELAY = 120; // payout change cooldown
    uint32 constant VETO = 120;
    uint128 constant AUTO = 0.5e6;
    uint128 constant MAX = 2e6;
    uint128 constant DAILY = 3e6;

    uint256 leashId;
    uint256 hosting;
    uint256 design;

    function setUp() public {
        vm.warp(1_800_000_000);
        owner = vm.addr(ownerPk);
        token = new MockUSD8();
        identity = new MockIdentity();
        registry = new PayeeRegistry(DELAY, address(identity));
        vault = new LeashVault(IERC20(address(token)), IPayeeRegistry(address(registry)));

        vm.prank(hostingVendor);
        hosting = registry.register("Webhost GmbH", "webhost.example", hostingPayout, "", 0);
        vm.prank(designVendor);
        design = registry.register("Pixel Studio", "pixel.example", designPayout, "", 0);

        token.mint(owner, 5e6);
        vm.startPrank(owner);
        token.approve(address(vault), type(uint256).max);
        leashId = vault.createLeash(agent, AUTO, MAX, DAILY, uint64(block.timestamp + 7 days), VETO);
        vault.fund(leashId, 4e6);
        vault.setPayeeAllowed(leashId, hosting, true);
        vault.setPayeeAllowed(leashId, design, true);
        vm.stopPrank();
    }

    function _ref(string memory invoiceNo) internal pure returns (bytes32) {
        return keccak256(bytes(invoiceNo));
    }

    function _propose(uint256 payee, uint128 amount, string memory invoiceNo) internal returns (uint256) {
        vm.prank(agent);
        return vault.propose(leashId, payee, amount, _ref(invoiceNo), keccak256("doc"), invoiceNo);
    }

    function _status(uint256 id) internal view returns (LeashVault.Status s) {
        (,,,,,,, s,,) = vault.payments(id);
    }

    // ------------------------------------------------------------- happy path

    function test_firstPaymentToNewPayee_isQueued_thenExecutedByKeeper() public {
        uint256 id = _propose(hosting, 0.29e6, "INV-1");
        assertEq(uint8(_status(id)), uint8(LeashVault.Status.Queued));
        assertEq(token.balanceOf(hostingPayout), 0);

        vm.expectRevert(abi.encodeWithSelector(LeashVault.VetoWindowOpen.selector, uint64(block.timestamp + VETO)));
        vm.prank(keeper);
        vault.execute(id);

        vm.warp(block.timestamp + VETO);
        vm.prank(keeper);
        vault.execute(id);
        assertEq(token.balanceOf(hostingPayout), 0.29e6);
        assertEq(uint8(_status(id)), uint8(LeashVault.Status.Paid));
        assertEq(vault.available(leashId), 4e6 - 0.29e6);
    }

    function test_smallPaymentToKnownPayee_settlesInstantly() public {
        uint256 first = _propose(hosting, 0.29e6, "INV-1");
        vm.warp(block.timestamp + VETO);
        vault.execute(first);

        uint256 second = _propose(hosting, 0.3e6, "INV-2");
        assertEq(uint8(_status(second)), uint8(LeashVault.Status.Paid));
        assertEq(token.balanceOf(hostingPayout), 0.59e6);
    }

    function test_largerPaymentToKnownPayee_stillWaitsForVetoWindow() public {
        uint256 first = _propose(hosting, 0.29e6, "INV-1");
        vm.warp(block.timestamp + VETO);
        vault.execute(first);

        uint256 big = _propose(hosting, 1.5e6, "INV-2");
        assertEq(uint8(_status(big)), uint8(LeashVault.Status.Queued));
    }

    function test_ownerCanApproveEarly() public {
        uint256 id = _propose(design, 1.5e6, "PS-77");
        vm.prank(owner);
        vault.approveNow(id);
        assertEq(token.balanceOf(designPayout), 1.5e6);
    }

    // ------------------------------------------------------------- attacks the contract stops

    function test_duplicateInvoice_reverts_evenWithDifferentAmount() public {
        uint256 id = _propose(hosting, 0.29e6, "INV-1");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.InvoiceAlreadyUsed.selector, id));
        vault.propose(leashId, hosting, 0.28e6, _ref("INV-1"), keccak256("other scan"), "INV-1 again");
    }

    function test_sameInvoiceNumber_fromOtherVendor_isFine() public {
        _propose(hosting, 0.29e6, "1001");
        _propose(design, 0.29e6, "1001");
    }

    function test_overInvoiceCap_reverts() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.OverInvoiceCap.selector, uint128(2.5e6), MAX));
        vault.propose(leashId, hosting, 2.5e6, _ref("BIG"), bytes32(0), "");
    }

    function test_dailyCap_countsQueuedPayments_andVetoFreesIt() public {
        uint256 a = _propose(hosting, 2e6, "A");
        _propose(design, 1e6, "B");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.OverDailyCap.selector, uint128(0.1e6), uint128(0)));
        vault.propose(leashId, design, 0.1e6, _ref("C"), bytes32(0), "");

        vm.prank(owner);
        vault.veto(a);
        assertEq(vault.remainingToday(leashId), 2e6);
        _propose(design, 0.1e6, "C");
    }

    function test_dailyCap_resetsAfter24h() public {
        _propose(hosting, 2e6, "A");
        _propose(design, 1e6, "B");
        vm.warp(block.timestamp + 1 days);
        assertEq(vault.remainingToday(leashId), DAILY);
        _propose(design, 0.5e6, "C");
    }

    function test_unknownOrDisallowedPayee_reverts() public {
        address scammer = makeAddr("scammer");
        vm.prank(scammer);
        uint256 fake = registry.register("Webhost GmbH", "webh0st.example", scammer, "", 0);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.PayeeNotAllowed.selector, fake));
        vault.propose(leashId, fake, 0.1e6, _ref("X"), bytes32(0), "");
    }

    function test_payoutChange_freezesPayee_andBlocksQueuedPayment() public {
        uint256 id = _propose(hosting, 1e6, "INV-9");

        // "Our bank details have changed": the vendor key (or an attacker holding it) swaps the address.
        vm.prank(hostingVendor);
        registry.requestPayoutChange(hosting, attacker);

        // While cooling down, nothing can be paid to this payee.
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.PayeeNotPayable.selector, hosting));
        vault.propose(leashId, hosting, 0.1e6, _ref("INV-10"), bytes32(0), "");

        vm.warp(block.timestamp + VETO);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.PayeeChanged.selector, hosting));
        vault.execute(id);

        // Even after the change is confirmed, the queued payment does not go to the new address.
        vm.warp(block.timestamp + DELAY);
        registry.confirmPayoutChange(hosting);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.PayeeChanged.selector, hosting));
        vault.execute(id);
        assertEq(token.balanceOf(attacker), 0);

        // The owner vetoes it and gets the reserve back.
        vm.prank(owner);
        vault.veto(id);
        assertEq(vault.available(leashId), 4e6);
    }

    function test_onlyAgentCanPropose() public {
        vm.prank(attacker);
        vm.expectRevert(LeashVault.NotAgent.selector);
        vault.propose(leashId, hosting, 0.1e6, _ref("X"), bytes32(0), "");
    }

    function test_onlyOwnerCanVetoWithdrawRevokeAllow() public {
        uint256 id = _propose(hosting, 1e6, "X");
        vm.startPrank(agent);
        vm.expectRevert(LeashVault.NotOwner.selector);
        vault.veto(id);
        vm.expectRevert(LeashVault.NotOwner.selector);
        vault.withdraw(leashId, 1);
        vm.expectRevert(LeashVault.NotOwner.selector);
        vault.revoke(leashId);
        vm.expectRevert(LeashVault.NotOwner.selector);
        vault.setPayeeAllowed(leashId, 99, true);
        vm.expectRevert(LeashVault.NotOwner.selector);
        vault.approveNow(id);
        vm.stopPrank();
    }

    function test_revoke_voidsQueue_andReturnsEverything() public {
        uint256 id = _propose(hosting, 1.5e6, "X");
        vm.prank(owner);
        vault.revoke(leashId);

        vm.warp(block.timestamp + VETO);
        vm.expectRevert(LeashVault.LeashRevokedErr.selector);
        vault.execute(id);
        assertFalse(vault.isPending(id));

        vm.prank(agent);
        vm.expectRevert(LeashVault.LeashRevokedErr.selector);
        vault.propose(leashId, hosting, 0.1e6, _ref("Y"), bytes32(0), "");

        uint256 before = token.balanceOf(owner);
        vm.prank(owner);
        vault.withdraw(leashId, 4e6);
        assertEq(token.balanceOf(owner), before + 4e6);
    }

    function test_withdraw_cannotTouchReservedFunds() public {
        _propose(hosting, 1.5e6, "X");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.InsufficientBalance.selector, uint128(4e6), uint128(2.5e6)));
        vault.withdraw(leashId, 4e6);
    }

    function test_expiry_stopsAgent_andFreesReserve() public {
        uint256 id = _propose(hosting, 1.5e6, "X");
        vm.warp(block.timestamp + 7 days);
        vm.prank(agent);
        vm.expectRevert(LeashVault.LeashExpired.selector);
        vault.propose(leashId, hosting, 0.1e6, _ref("Y"), bytes32(0), "");
        vm.expectRevert(LeashVault.LeashExpired.selector);
        vault.execute(id);
        assertEq(vault.available(leashId), 4e6);
        vm.prank(owner);
        vm.expectRevert(LeashVault.LeashExpired.selector);
        vault.updateLeash(leashId, agent, AUTO, MAX, DAILY, uint64(block.timestamp + 1 days), VETO);
    }

    function test_insufficientBalance_reverts() public {
        vm.startPrank(owner);
        vault.withdraw(leashId, 3.9e6);
        vm.stopPrank();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.InsufficientBalance.selector, uint128(0.5e6), uint128(0.1e6)));
        vault.propose(leashId, hosting, 0.5e6, _ref("X"), bytes32(0), "");
    }

    function test_badLimits_revert() public {
        vm.startPrank(owner);
        vm.expectRevert(LeashVault.BadLimits.selector);
        vault.createLeash(agent, 3e6, 2e6, 5e6, uint64(block.timestamp + 1), 0); // auto > max
        vm.expectRevert(LeashVault.BadLimits.selector);
        vault.createLeash(agent, 1e6, 6e6, 5e6, uint64(block.timestamp + 1), 0); // max > daily
        vm.expectRevert(LeashVault.BadLimits.selector);
        vault.createLeash(address(0), 1e6, 2e6, 5e6, uint64(block.timestamp + 1), 0);
        vm.expectRevert(LeashVault.BadLimits.selector);
        vault.createLeash(agent, 1e6, 2e6, 5e6, uint64(block.timestamp), 0); // already expired
        vm.stopPrank();
    }

    function test_vetoedInvoice_staysBlocked() public {
        uint256 id = _propose(hosting, 1e6, "X");
        vm.prank(owner);
        vault.veto(id);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(LeashVault.InvoiceAlreadyUsed.selector, id));
        vault.propose(leashId, hosting, 1e6, _ref("X"), bytes32(0), "");
    }

    // ------------------------------------------------------------- gasless funding (EIP-3009)

    function test_fundWithAuthorization_gasless() public {
        Signing.Auth memory a = Signing.Auth({
            from: owner,
            to: address(vault),
            value: 1e6,
            validAfter: 0,
            validBefore: block.timestamp + 1 hours,
            nonce: keccak256("fund-1")
        });
        (uint8 v, bytes32 r, bytes32 s) = Signing.signReceive(vm, ownerPk, token.DOMAIN_SEPARATOR(), a);
        vm.prank(keeper); // a relayer pays the gas
        vault.fundWithAuthorization(leashId, owner, 1e6, a.validAfter, a.validBefore, a.nonce, v, r, s);
        assertEq(vault.available(leashId), 5e6);
    }

    function test_fundWithAuthorization_rejectsStrangers() public {
        vm.expectRevert(LeashVault.WrongPayer.selector);
        vault.fundWithAuthorization(leashId, attacker, 1e6, 0, block.timestamp + 1, bytes32(0), 0, 0, 0);
    }

    // ------------------------------------------------------------- registry + ERC-8004 identity

    function test_identityLink_requiresIdentityOwner() public {
        identity.mint(designVendor, 42);
        vm.prank(attacker);
        vm.expectRevert(PayeeRegistry.NotIdentityOwner.selector);
        registry.register("Pixel Studio", "pixel.example", attacker, "", 42);

        vm.prank(designVendor);
        uint256 id = registry.register("Pixel Studio", "pixel.example", designPayout, "ipfs://card", 42);
        assertEq(registry.getPayee(id).identityId, 42);
    }

    function test_cancelPayoutChange_unfreezes() public {
        vm.startPrank(hostingVendor);
        registry.requestPayoutChange(hosting, attacker);
        (, bool ok) = registry.payoutOf(hosting);
        assertFalse(ok);
        registry.cancelPayoutChange(hosting);
        vm.stopPrank();
        (address payout, bool ok2) = registry.payoutOf(hosting);
        assertTrue(ok2);
        assertEq(payout, hostingPayout);
    }

    function test_confirmTooEarly_reverts() public {
        vm.prank(hostingVendor);
        registry.requestPayoutChange(hosting, attacker);
        vm.expectRevert(abi.encodeWithSelector(PayeeRegistry.ChangeNotReady.selector, uint64(block.timestamp + DELAY)));
        registry.confirmPayoutChange(hosting);
    }

    function test_onlyPayeeOwnerCanChangePayout() public {
        vm.prank(attacker);
        vm.expectRevert(PayeeRegistry.NotPayeeOwner.selector);
        registry.requestPayoutChange(hosting, attacker);
    }

    // ------------------------------------------------------------- fuzz

    function testFuzz_neverExceedsCaps(uint128[6] memory amounts) public {
        uint128 accepted;
        for (uint256 i; i < amounts.length; i++) {
            uint128 amt = uint128(bound(amounts[i], 1, 3e6));
            vm.prank(agent);
            try vault.propose(leashId, i % 2 == 0 ? hosting : design, amt, bytes32(i), bytes32(0), "") {
                accepted += amt;
                assertLe(amt, MAX);
            } catch {}
        }
        assertLe(accepted, DAILY);
        assertEq(vault.remainingToday(leashId), DAILY - accepted);
    }
}
