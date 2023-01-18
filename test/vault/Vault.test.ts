import { network, ethers } from "hardhat";
import chai, { expect } from "chai";
import { IERC20, Vault, Vault__factory, IUniswapV2Router02 } from "../../typechain-types";
import { Signer } from "ethers";
import { solidity } from "ethereum-waffle";

const SPEEDY_RPC = "https://clean-cosmological-river.bsc.discover.quiknode.pro/c9de34123c5ab25becaf0da059ad8b339690577c/"; //https://speedy-nodes-nyc.moralis.io/a17c9bc49f30339ffd778a16/bsc/mainnet/archive
const WHALE = "0x63fc43d4874f314d3f519d9406415dc91c5b11ec";
const ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const FARMING = "0x73feaa1eE314F8c655E354234017bE2193C9E24E";
const WTOKEN = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const TOKEN = "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56";
const CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
const LP = "0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16";

describe("Pacific Defi BNB Vault", function () {
    let VAULT: Vault__factory,
        vault: Vault,
        cakeRouter: IUniswapV2Router02,
        bnb: IERC20,
        busd: IERC20,
        router: IUniswapV2Router02;
    let signer: Signer, lp: IERC20;

    before(async () => {
        await startFork();
        signer = await impersonate(WHALE);
        VAULT = (await ethers.getContractFactory("Vault")) as Vault__factory;
    });

    beforeEach(async () => {
        vault = await VAULT.connect(signer).deploy(10, TOKEN, WTOKEN);
        router = (await ethers.getContractAt("IUniswapV2Router02", ROUTER)) as IUniswapV2Router02;
        bnb = (await ethers.getContractAt("IERC20", WTOKEN)) as IERC20;
        busd = (await ethers.getContractAt("IERC20", TOKEN)) as IERC20;
        lp = (await ethers.getContractAt("IERC20", LP)) as IERC20;
    });

    it("deploys correctly", async () => {
        expect(await vault.feePercent()).eq(10);
        expect((await vault.wToken()).toLowerCase()).to.eq(WTOKEN.toLowerCase());
        expect((await vault.token()).toLowerCase()).eq(TOKEN.toLowerCase());
    });

    it("should add DEXes", async () => {
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );
        await vault.addAmm(
            "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
            "0x5c8D727b265DBAfaba67E050f2f739cAeEB4A6F9",
            3,
            "0x603c7f932ED1fc6575303D8Fb018fDCBb0f39a95"
        );
        let Amms = await vault.activeAmms();
        expect(Amms).eq(2);
    });

    it("Deactivates and Reactivates Amm", async () => {
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );
        await vault.addAmm(
            "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
            "0x5c8D727b265DBAfaba67E050f2f739cAeEB4A6F9",
            3,
            "0x603c7f932ED1fc6575303D8Fb018fDCBb0f39a95"
        );

        let Amms = await vault.activeAmms();
        expect(Amms).to.eq(2);

        await vault.setAmmStatus(0, false);
        let Amms1 = await vault.activeAmms();
        expect(Amms1).to.eq(1);

        await vault.setAmmStatus(0, true);
        let Amms2 = await vault.activeAmms();
        expect(Amms2).to.eq(2);
    });

    it("Cannot add already existing AMM", async () => {
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );
        
        await expect(vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        )).to.be.revertedWith("Router already exists");
    });

    it("Cannot add AMM with wrong ID", async () => {
        await expect(vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            250,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        )).to.be.revertedWith("LP tokens do not match");
    });

    it("Cannot activate/deactivate already active/inactive AMM", async () => {
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );
        await expect(vault.setAmmStatus(0, true)).to.be.revertedWith("Pool already in this status");

        await vault.setAmmStatus(0, false)
        await expect(vault.setAmmStatus(0, false)).to.be.revertedWith("Pool already in this status");
    });

    it("should deposit correctly", async () => {
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );
        await vault.addAmm(
            "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
            "0x5c8D727b265DBAfaba67E050f2f739cAeEB4A6F9",
            3,
            "0x603c7f932ED1fc6575303D8Fb018fDCBb0f39a95"
        );

        let value = ethers.utils.parseEther("1");
        let txRes = await vault.connect(signer).deposit(10, { value });
    });

    it("should not deposit when contract is paused", async () => {
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );
        await vault.addAmm(
            "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
            "0x5c8D727b265DBAfaba67E050f2f739cAeEB4A6F9",
            3,
            "0x603c7f932ED1fc6575303D8Fb018fDCBb0f39a95"
        );
        
        await vault.pause();
        let value = ethers.utils.parseEther("1");
        await expect(vault.connect(signer).deposit(10, { value })).to.be.revertedWith("Pausable: paused");
    });

    it("should deposit correctly after deactivating 1 AMM", async () => {
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );
        await vault.addAmm(
            "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
            "0x5c8D727b265DBAfaba67E050f2f739cAeEB4A6F9",
            3,
            "0x603c7f932ED1fc6575303D8Fb018fDCBb0f39a95"
        );

        await vault.setAmmStatus(0, false);

        let value = ethers.utils.parseEther("1");
        let txRes = await vault.connect(signer).deposit(10, { value });

        let fee = value.mul(10).div(100);
        let net = value.sub(fee);
        let share = net.div(await vault.activeAmms());

        await expect(share).to.equal(net);
        await expect(txRes).to.changeEtherBalance(signer, ethers.utils.parseEther("-1"));
    });

    it("User balance is correct after multiple deposits:", async() => {
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );

        let value = ethers.utils.parseEther("1");
        await vault.connect(signer).deposit(10, { value });
        const firstLp = await vault.ammBalances(0, WHALE);
        await vault.connect(signer).deposit(10, { value });
        let secondLp = await vault.ammBalances(0, WHALE);
        await expect(secondLp.lpAmount).to.be.gt(firstLp.lpAmount);

        const userBalance = await vault.ammBalances(0, WHALE);
        console.log("excess:", userBalance.excess);
    });

    it("should withdraw correctly", async () => {
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );
        await vault.connect(signer).deposit(10, { value: ethers.utils.parseEther("1") });
        advanceTime(50000);
        const balanceBefore = await signer.getBalance();
        await vault.connect(signer).withdraw(10);
        const balanceAfter = await signer.getBalance();
        expect(balanceAfter.sub(balanceBefore)).gt(ethers.utils.parseEther("0.9"));
    });

    it("should not withdraw when contract is paused", async () => {
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );

        await vault.connect(signer).deposit(10, { value: ethers.utils.parseEther("1") });
        advanceTime(50000);
        await vault.pause();
        await expect(vault.connect(signer).withdraw(10)).to.be.revertedWith("Pausable: paused");
    });

    it("Collected fees after withdraw are exact", async () => {
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );
        await vault.connect(signer).deposit(10, { value: ethers.utils.parseEther("1") });
        advanceTime(50000);
        await vault.connect(signer).withdraw(10);
        
        const fees = await ethers.provider.getBalance(vault.address);
        let feeVal = ethers.utils.parseEther("1").mul(10).div(1000);
        expect(fees).to.be.eq(feeVal);
    });

    it("User balances cleared after withdrawing", async () => {
        this.timeout(100000);
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );
        await vault.connect(signer).deposit(10, { value: ethers.utils.parseEther("1") });
        advanceTime(50000);
        await vault.connect(signer).withdraw(10);

        const userBalance = await vault.ammBalances(0, WHALE);
        expect(userBalance.excess).to.be.eq(0);
        expect(userBalance.lpAmount).to.be.equal(0);

        const ammStatus = await vault.userAmms(WHALE, 0);
        await expect(ammStatus.toString()).to.be.eq("false");
    
    });

    it("Should set swap AMM correctly", async () => {
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );

        await vault.addAmm(
            "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
            "0x5c8D727b265DBAfaba67E050f2f739cAeEB4A6F9",
            3,
            "0x603c7f932ED1fc6575303D8Fb018fDCBb0f39a95"
        );

        const bef = await vault.swapAmmId();
        expect(bef).to.be.eq(0);

        await vault.setSwapAmm(1);
        const aft = await vault.swapAmmId();
        expect(aft).to.be.eq(1);
    })

    it("should be able to collect fee", async () => {
        let bef = await vault.totalFees();
        expect(bef).to.equal(0);

        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );

        let value = ethers.utils.parseEther("1");
        await vault.connect(signer).deposit(10, { value });
        bef = await vault.totalFees();
        let fee = value.mul(10).div(1000);
        expect(bef).to.eq(fee);

        await vault.connect(signer).collectFees();
        let aft = await vault.totalFees();
        expect(aft).to.equal(0);
    });

    it("Should get earned rewards:", async () => {
        await vault.addAmm(
            "0x10ED43C718714eb63d5aA57B78B54704E256024E",
            "0x73feaa1eE314F8c655E354234017bE2193C9E24E",
            252,
            "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"
        );

        await vault.addAmm(
            "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
            "0x5c8D727b265DBAfaba67E050f2f739cAeEB4A6F9",
            3,
            "0x603c7f932ED1fc6575303D8Fb018fDCBb0f39a95"
        );

        await vault.connect(signer).deposit(10, { value: ethers.utils.parseEther("1") });
        advanceTime(50000);
        let rewards = await vault.connect(signer).getEarnedRewards(WHALE);
        console.log("Earned rewards:", rewards);
    });
});

const startFork = async () => {
    await network.provider.request({
        method: "hardhat_reset",
        params: [
            {
                forking: {
                    jsonRpcUrl: SPEEDY_RPC,
                    blockNumber: 15642500,
                },
            },
        ],
    });
};

const impersonate = async (whale: string): Promise<Signer> => {
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [whale],
    });
    return await ethers.getSigner(whale);
};

async function advanceTime(seconds: number) {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine");
}
