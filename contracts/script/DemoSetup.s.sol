// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";
import {LeashVault} from "../src/LeashVault.sol";

/// @notice One-wallet demo setup: registers two demo vendors, creates a leash, allows both vendors
///         and funds the leash. Everything is signed by the owner wallet, so the faucet's
///         1 tQDAY + 5 tUSD8 are enough. The vendors' payout addresses can be any wallets you control.
/// Env (all required unless noted):
///   REGISTRY, VAULT, TOKEN       from deployments/<chainId>.json
///   AGENT                        the agent's address (gets no tUSD8)
///   HOSTING_PAYOUT, DESIGN_PAYOUT payout addresses for the two demo vendors
///   FUND                         tUSD8 base units to deposit (default 4000000 = 4 tUSD8)
///   VETO_WINDOW                  seconds (default 120)
contract DemoSetup is Script {
    function run() external {
        PayeeRegistry registry = PayeeRegistry(vm.envAddress("REGISTRY"));
        LeashVault vault = LeashVault(vm.envAddress("VAULT"));
        IERC20 token = IERC20(vm.envAddress("TOKEN"));
        address agent = vm.envAddress("AGENT");
        uint128 fund = uint128(vm.envOr("FUND", uint256(4e6)));
        uint32 veto = uint32(vm.envOr("VETO_WINDOW", uint256(120)));

        vm.startBroadcast();
        uint256 hosting = registry.register("Webhost GmbH", "webhost.example", vm.envAddress("HOSTING_PAYOUT"), "", 0);
        uint256 design = registry.register("Pixel Studio", "pixel.example", vm.envAddress("DESIGN_PAYOUT"), "", 0);
        // 0.50 instant, 2 per invoice, 3 per day, 30 days.
        uint256 leashId = vault.createLeash(agent, 0.5e6, 2e6, 3e6, uint64(block.timestamp + 30 days), veto);
        vault.setPayeeAllowed(leashId, hosting, true);
        vault.setPayeeAllowed(leashId, design, true);
        token.approve(address(vault), fund);
        vault.fund(leashId, fund);
        vm.stopBroadcast();

        console.log("hosting payeeId", hosting);
        console.log("design payeeId ", design);
        console.log("LEASH_ID       ", leashId);
    }
}
