// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";
import {LeashVault, IPayeeRegistry} from "../src/LeashVault.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";

/// @notice Deploys PayeeRegistry + LeashVault.
///   Aevum / fork: uses the real tUSD8 and the ERC-8004 identity registry found on Aevum.
///   Local anvil (31337): deploys MockUSD8 and disables identity linking.
/// Env:
///   CHANGE_DELAY      payout-change cooldown in seconds (default 172800 = 48 h; use 120 for a demo)
///   IDENTITY_REGISTRY override the ERC-8004 registry (0x0 disables linking)
contract Deploy is Script {
    address constant TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;
    address constant ERC8004_IDENTITY = 0xF45E7f39Caba1d2055f613970575a7e7069636Be;

    function run() external returns (PayeeRegistry registry, LeashVault vault, address token) {
        uint64 delay = uint64(vm.envOr("CHANGE_DELAY", uint256(2 days)));
        bool local = block.chainid == 31337;
        address identity = vm.envOr("IDENTITY_REGISTRY", local ? address(0) : ERC8004_IDENTITY);
        uint256 startBlock = block.number;

        vm.startBroadcast();
        token = local ? address(new MockUSD8()) : TUSD8;
        registry = new PayeeRegistry(delay, identity);
        vault = new LeashVault(IERC20(token), IPayeeRegistry(address(registry)));
        vm.stopBroadcast();

        console.log("token           ", token);
        console.log("PayeeRegistry   ", address(registry));
        console.log("LeashVault      ", address(vault));
        console.log("change delay (s)", delay);

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "startBlock", startBlock);
        vm.serializeUint(json, "changeDelay", delay);
        vm.serializeAddress(json, "token", token);
        vm.serializeAddress(json, "identityRegistry", identity);
        vm.serializeAddress(json, "registry", address(registry));
        string memory out = vm.serializeAddress(json, "vault", address(vault));
        vm.writeJson(out, string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json"));
    }
}
