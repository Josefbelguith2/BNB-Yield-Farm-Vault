import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function ({ deployments, getNamedAccounts }) {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const token = "0xe9e7cea3dedca5984780bafc599bd69add087d56";
    const wToken = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

    await deploy("Vault", {
        from: deployer,
        args: [25, token, wToken], // 2.5%
        log: true,
    });
};
export default func;
func.tags = ["Vault"];
