// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PayeeRegistry} from "../../src/PayeeRegistry.sol";
import {LeashVault, IPayeeRegistry} from "../../src/LeashVault.sol";
import {Signing} from "../Signing.sol";

interface ITUSD8 is IERC20 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @notice The full Leash flow against the REAL tUSD8 on a local fork of Aevum testnet. No funds needed:
///         `deal` writes balances into the fork only.  Run with: make test-fork
contract AevumForkTest is Test {
    ITUSD8 constant TUSD8 = ITUSD8(0x456569838f1d43009A91ebA4263147Afd7233483);

    function test_fullFlow_withRealTusd8() public {
        assertEq(block.chainid, 44005, "run with --fork-url aevum");
        (address owner, uint256 ownerKey) = makeAddrAndKey("owner");
        address agent = makeAddr("agent");
        address vendor = makeAddr("vendor");
        address payout = makeAddr("payout");

        PayeeRegistry registry = new PayeeRegistry(120, address(0));
        LeashVault vault = new LeashVault(TUSD8, IPayeeRegistry(address(registry)));
        vm.prank(vendor);
        uint256 payee = registry.register("Webhost GmbH", "webhost.example", payout, "", 0);

        deal(address(TUSD8), owner, 5e6);
        vm.startPrank(owner);
        uint256 leashId = vault.createLeash(agent, 0.5e6, 2e6, 3e6, uint64(block.timestamp + 30 days), 120);
        vault.setPayeeAllowed(leashId, payee, true);
        vm.stopPrank();

        // Gasless deposit with a real EIP-3009 signature; a relayer pays the gas.
        Signing.Auth memory a = Signing.Auth({
            from: owner,
            to: address(vault),
            value: 4e6,
            validAfter: 0,
            validBefore: block.timestamp + 1 hours,
            nonce: keccak256("fork-fund")
        });
        (uint8 v, bytes32 r, bytes32 s) = Signing.signReceive(vm, ownerKey, TUSD8.DOMAIN_SEPARATOR(), a);
        vm.prank(makeAddr("relayer"));
        vault.fundWithAuthorization(leashId, owner, 4e6, 0, a.validBefore, a.nonce, v, r, s);
        assertEq(TUSD8.balanceOf(address(vault)), 4e6);

        vm.prank(agent);
        uint256 id = vault.propose(leashId, payee, 0.29e6, keccak256("WH20261107"), bytes32(0), "Webhost GmbH");
        vm.warp(block.timestamp + 120);
        vault.execute(id);
        assertEq(TUSD8.balanceOf(payout), 0.29e6);
    }
}
