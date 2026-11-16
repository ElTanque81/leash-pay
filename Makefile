# Leash. Run `make help` for the list.
SHELL := /bin/bash
.DEFAULT_GOAL := help

AEVUM_RPC  ?= https://rpc-test.qday.info
LOCAL_RPC  ?= http://127.0.0.1:8545
FORK_PORT  ?= 8555
FORK_RPC   ?= http://127.0.0.1:$(FORK_PORT)
FORK_CHAIN := 440050
TUSD8      := 0x456569838f1d43009A91ebA4263147Afd7233483
# tUSD8's master minter. Only impersonated on a local fork.
TUSD8_MM   := 0x4d4b7031D35B74215bebe33F6AF6e682Ea99d0b1
# anvil's first default account (public test key, local chains only).
ANVIL_0    := 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
ANVIL_0_PK := 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
AMOUNT     ?= 100
# Payout-address cooldown in seconds. 48 h in production; 120 s makes the fraud demo watchable.
CHANGE_DELAY ?= 120

.PHONY: help install build test test-fork check abi anvil fork deploy-local deploy-fork deploy-aevum deal demo-setup agent pay web

help: ## Show this list
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36mmake %-14s\033[0m %s\n", $$1, $$2}'

install: ## Fetch Solidity libs and JS packages
	git submodule update --init --recursive
	pnpm install

build: ## Compile contracts, check they are Shanghai-safe, export ABIs
	cd contracts && forge build
	node tools/check-shanghai.mjs contracts/out
	node tools/export-abi.mjs

test: ## Contract tests (unit, fuzz, invariants) + agent tests
	cd contracts && forge test --no-match-path 'test/fork/*' -vv
	pnpm --filter @leash/agent test

test-fork: ## Contract tests against the real tUSD8 on a fork of Aevum
	cd contracts && forge test --match-path 'test/fork/*' --fork-url $(AEVUM_RPC) -vv

check: build test ## Everything CI runs
	pnpm -r typecheck

abi: ## Re-export ABIs into shared/src/abi.ts
	node tools/export-abi.mjs

anvil: ## Empty local chain (31337) with Aevum's EVM rules
	anvil --hardfork shanghai

fork: ## Local copy of Aevum testnet on 127.0.0.1:8555 (chain 440050)
	anvil --fork-url $(AEVUM_RPC) --hardfork shanghai --chain-id $(FORK_CHAIN) --port $(FORK_PORT)

deploy-local: ## Deploy MockUSD8 + Leash to `make anvil`
	cd contracts && CHANGE_DELAY=$(CHANGE_DELAY) forge script script/Deploy.s.sol --rpc-url $(LOCAL_RPC) --broadcast --legacy --private-key $(ANVIL_0_PK)

# Deploys from a throwaway address nobody has the key for (anvil impersonates it).
deploy-fork: ## Deploy Leash (real tUSD8) to `make fork`
	@test "$$(cast chain-id --rpc-url $(FORK_RPC))" = "$(FORK_CHAIN)" || (echo "This only works on 'make fork'." && exit 1)
	@DEPLOYER=$$(cast to-check-sum-address 0x$$(openssl rand -hex 20)); \
	  cast rpc anvil_setBalance $$DEPLOYER 0x8ac7230489e80000 --rpc-url $(FORK_RPC) > /dev/null && \
	  cast rpc anvil_impersonateAccount $$DEPLOYER --rpc-url $(FORK_RPC) > /dev/null && \
	  cd contracts && CHANGE_DELAY=$(CHANGE_DELAY) forge script script/Deploy.s.sol --rpc-url $(FORK_RPC) --broadcast --legacy --unlocked --sender $$DEPLOYER

deploy-aevum: ## Deploy to Aevum testnet. Needs ACCOUNT=<keystore name> (cast wallet import <name> --interactive)
	@test -n "$(ACCOUNT)" || (echo "Set ACCOUNT=<name>. Create one with: cast wallet import <name> --interactive" && exit 1)
	cd contracts && CHANGE_DELAY=$(CHANGE_DELAY) forge script script/Deploy.s.sol --rpc-url $(AEVUM_RPC) --broadcast --legacy --account $(ACCOUNT)

deal: ## `make fork` only: give TO AMOUNT tUSD8 and 10 tQDAY
	@test -n "$(TO)" || (echo "Usage: make deal TO=0x... [AMOUNT=100]" && exit 1)
	@test "$$(cast chain-id --rpc-url $(FORK_RPC))" = "$(FORK_CHAIN)" || (echo "This only works on 'make fork'." && exit 1)
	@cast rpc anvil_setBalance $(TO) 0x8ac7230489e80000 --rpc-url $(FORK_RPC) > /dev/null
	@cast rpc anvil_impersonateAccount $(TUSD8_MM) --rpc-url $(FORK_RPC) > /dev/null
	@cast rpc anvil_setBalance $(TUSD8_MM) 0x56BC75E2D63100000 --rpc-url $(FORK_RPC) > /dev/null
	@cast send $(TUSD8) "configureMinter(address,uint256)" $(TUSD8_MM) 1000000000000000 --from $(TUSD8_MM) --unlocked --rpc-url $(FORK_RPC) > /dev/null
	@cast send $(TUSD8) "mint(address,uint256)" $(TO) $$(cast parse-units $(AMOUNT) 6) --from $(TUSD8_MM) --unlocked --rpc-url $(FORK_RPC) > /dev/null
	@echo "tUSD8 balance of $(TO): $$(cast call $(TUSD8) 'balanceOf(address)(uint256)' $(TO) --rpc-url $(FORK_RPC))"

# Example: make demo-setup RPC=https://rpc-test.qday.info ACCOUNT=leash-owner AGENT=0x.. HOSTING_PAYOUT=0x.. DESIGN_PAYOUT=0x..
demo-setup: ## Register 2 demo vendors, create + fund a leash (one wallet). See README
	@test -n "$(ACCOUNT)$(PRIVATE_KEY)" || (echo "Set ACCOUNT=<keystore> (or PRIVATE_KEY on local chains)" && exit 1)
	@DEP=deployments/$$(cast chain-id --rpc-url $(RPC)).json; \
	  export REGISTRY=$$(jq -r .registry $$DEP) VAULT=$$(jq -r .vault $$DEP) TOKEN=$$(jq -r .token $$DEP); \
	  cd contracts && forge script script/DemoSetup.s.sol --rpc-url $(RPC) --broadcast --legacy \
	  $(if $(ACCOUNT),--account $(ACCOUNT),--private-key $(PRIVATE_KEY))

agent: ## Start the agent service + keeper (reads agent/.env)
	cd agent && set -a && source .env && set +a && pnpm start

pay: ## Give one invoice file to the agent: make pay FILE=demo-invoices/01-webhost.txt
	@test -n "$(FILE)" || (echo "Usage: make pay FILE=demo-invoices/01-webhost.txt (path relative to agent/)" && exit 1)
	cd agent && set -a && source .env && set +a && pnpm pay $(FILE)

web: ## Start the web app (reads web/.env.local)
	pnpm --filter @leash/web dev
