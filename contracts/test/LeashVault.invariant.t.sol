// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";
import {LeashVault, IPayeeRegistry} from "../src/LeashVault.sol";

/// @dev Drives the vault with random agent, owner, keeper and vendor actions.
contract Handler is Test {
    LeashVault public vault;
    PayeeRegistry public registry;
    MockUSD8 public token;
    address public owner;
    address public agent;
    address public vendor;
    uint256 public leashId;
    uint256[2] public payees;
    address[3] public payouts;

    uint256 public invoiceNonce;
    // Sum of payments executed per 24 h window start, to check the daily cap.
    mapping(uint64 => uint256) public paidInWindow;
    uint64[] public windows;

    constructor(LeashVault v, PayeeRegistry r, MockUSD8 t, address o, address a, address vend, uint256 id, uint256[2] memory ps, address[3] memory outs) {
        vault = v;
        registry = r;
        token = t;
        owner = o;
        agent = a;
        vendor = vend;
        leashId = id;
        payees = ps;
        payouts = outs;
    }

    function propose(uint256 seed, uint128 amount, bool reuseInvoice) external {
        uint256 payee = payees[seed % 2];
        amount = uint128(bound(amount, 1, 3e6));
        bytes32 ref = reuseInvoice && invoiceNonce > 0 ? bytes32(invoiceNonce - 1) : bytes32(invoiceNonce++);
        vm.prank(agent);
        try vault.propose(leashId, payee, amount, ref, bytes32(0), "") returns (uint256 id) {
            _recordIfPaid(id);
        } catch {}
    }

    function execute(uint256 seed) external {
        uint256 n = vault.paymentCount();
        if (n == 0) return;
        uint256 id = seed % n + 1;
        try vault.execute(id) {
            _recordIfPaid(id);
        } catch {}
    }

    function veto(uint256 seed) external {
        uint256 n = vault.paymentCount();
        if (n == 0) return;
        vm.prank(owner);
        try vault.veto(seed % n + 1) {} catch {}
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    function changePayout(uint256 seed) external {
        vm.prank(vendor);
        try registry.requestPayoutChange(payees[0], payouts[2 - (seed % 2) * 2]) {} catch {}
        try registry.confirmPayoutChange(payees[0]) {} catch {}
    }

    function _recordIfPaid(uint256 id) private {
        (,,, uint128 amount,,, uint64 windowStart, LeashVault.Status status,,) = vault.payments(id);
        if (status != LeashVault.Status.Paid) return;
        if (paidInWindow[windowStart] == 0) windows.push(windowStart);
        paidInWindow[windowStart] += amount;
    }

    function windowCount() external view returns (uint256) {
        return windows.length;
    }
}

contract LeashVaultInvariantTest is Test {
    MockUSD8 token;
    PayeeRegistry registry;
    LeashVault vault;
    Handler handler;
    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address vendor = makeAddr("vendor");
    address[3] outs;
    uint256 leashId;
    uint128 constant DAILY = 3e6;
    uint128 constant DEPOSIT = 50e6;

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new MockUSD8();
        registry = new PayeeRegistry(60, address(0));
        vault = new LeashVault(IERC20(address(token)), IPayeeRegistry(address(registry)));
        outs = [makeAddr("payoutA"), makeAddr("payoutB"), makeAddr("payoutA2")];

        vm.startPrank(vendor);
        uint256 a = registry.register("A", "a.example", outs[0], "", 0);
        uint256 b = registry.register("B", "b.example", outs[1], "", 0);
        vm.stopPrank();

        token.mint(owner, DEPOSIT);
        vm.startPrank(owner);
        token.approve(address(vault), DEPOSIT);
        leashId = vault.createLeash(agent, 0.5e6, 2e6, DAILY, uint64(block.timestamp + 365 days), 120);
        vault.fund(leashId, DEPOSIT);
        vault.setPayeeAllowed(leashId, a, true);
        vault.setPayeeAllowed(leashId, b, true);
        vm.stopPrank();

        handler = new Handler(vault, registry, token, owner, agent, vendor, leashId, [a, b], outs);
        targetContract(address(handler));
    }

    /// Money is conserved: whatever left the vault arrived at a registered payout address.
    function invariant_conservation() public view {
        uint256 out = token.balanceOf(outs[0]) + token.balanceOf(outs[1]) + token.balanceOf(outs[2]);
        assertEq(token.balanceOf(address(vault)) + out, DEPOSIT);
        (,,,,, uint128 balance,,,,,,) = vault.leashes(leashId);
        assertEq(token.balanceOf(address(vault)), balance);
    }

    /// Reserved funds never exceed the balance.
    function invariant_reserveCovered() public view {
        (,,,,, uint128 balance, uint128 reserved,,,,,) = vault.leashes(leashId);
        assertLe(reserved, balance);
    }

    /// Within any 24 h window, the agent never moved more than the daily cap.
    function invariant_dailyCap() public view {
        uint256 n = handler.windowCount();
        for (uint256 i; i < n; i++) {
            assertLe(handler.paidInWindow(handler.windows(i)), DAILY);
        }
    }
}
