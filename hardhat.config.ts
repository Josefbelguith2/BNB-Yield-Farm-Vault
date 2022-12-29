import "dotenv/config";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-ethers";
import "hardhat-deploy";
import "@typechain/hardhat";
import "solidity-coverage";
import "@nomiclabs/hardhat-etherscan";
import { HardhatUserConfig } from "hardhat/types";

const config: HardhatUserConfig = {
    solidity: "0.8.4",
    namedAccounts: { deployer: 0, admin: 1, alice: 2, bob: 3 },
    paths: { sources: "src" },
    networks: {
        bsc_testnet: {
            url: "https://data-seed-prebsc-1-s1.binance.org:8545/",
            accounts: [process.env.DEPLOYER_PRIVATE_KEY!],
            saveDeployments: true,
            tags: ["staging"],
        },
        bsc_mainnet: {
            url: "https://bsc-dataseed.binance.org/",
            accounts: [process.env.DEPLOYER_PRIVATE_KEY!],
            saveDeployments: true,
            tags: ["production"],
        },
    },
    etherscan: { apiKey: process.env.EXPLORER_API_KEY },
};
export default config;
