// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "./utils/AccessProtected.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

import "hardhat/console.sol";

interface IFarming {
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt. See explanation below.
    }

    struct PoolInfo {
        address lpToken; // Address of LP token contract.
        uint256 allocPoint; // How many allocation points assigned to this pool. CAKEs to distribute per block.
        uint256 lastRewardBlock; // Last block number that CAKEs distribution occurs.
        uint256 accCakePerShare; // Accumulated CAKEs per share, times 1e12. See below.
    }

    function deposit(uint256 _pid, uint256 _amount) external;

    function withdraw(uint256 _pid, uint256 _amount) external;

    function userInfo(uint256, address) external view returns (UserInfo memory);

    function poolInfo(uint256) external view returns (PoolInfo memory);

    function pendingCake(uint256 _pid, address _user) external view returns (uint256);
}

contract Vault is AccessProtected, ReentrancyGuard, Pausable {
    using Address for address;
    using SafeMath for uint256;
    using Counters for Counters.Counter;
    using SafeERC20 for IERC20;
    uint256 public feePercent;
    uint256 public totalFees;
    address public token;
    address public wToken;
    Counters.Counter public activeAmms;
    uint256 public swapAmmId;

    struct Balance {
        address user;
        uint256 ammId;
        uint256 lpAmount;
        uint256 excess;
        uint256 deposit;
    }

    struct Amm {
        address router;
        uint256 id;
        address farming;
        uint256 farmingPId;
        address rewardToken;
        address lpToken;
        bool isActive;
    }

    Amm[] public amms;
    mapping(uint256 => mapping(address => Balance)) public ammBalances; // amm id => user => balances;
    mapping(address => mapping(uint256 => bool)) public userAmms; // user => amm id => bool;

    event Deposit(address indexed user, uint256 amount, uint256 fee, uint256 swapBnb, uint256 swapToken);
    event Recovered(address indexed tokenAddress, uint256 tokenAmount);
    event AmmDeposit(
        address indexed user,
        address indexed router,
        uint256 indexed pId,
        uint256 liquidityBnb,
        uint256 liquidityToken,
        uint256 lpAmount,
        uint256 excess
    );
    event Withdraw(address indexed user, uint256 amount);
    event AmmWithdraw(
        address indexed user,
        address indexed router,
        uint256 indexed pId,
        uint256 lpAmount,
        uint256 bnbFromLiq,
        uint256 tokenFromLiq,
        uint256 rewards,
        uint256 bnbFromToken,
        uint256 bnbFromRewards
    );
    event FeesCollected(uint256 amount);
    event PoolAdded(
        address indexed router,
        address farming,
        uint256 indexed farmingPId,
        address rewardToken,
        address lpToken
    );
    event PoolStatusSet(uint256 pId, bool isActive);
    event Deployed(address deployer);

    constructor(
        uint256 _feePercent,
        address _token,
        address _wToken
    ) {
        require(_feePercent > 0 && _feePercent < 100, "Fees should be between 0 and 100"); // 100 = 10%, 65 = 6.5%
        require(_token.isContract(), "Invalid token address");
        require(_wToken.isContract(), "Invalid wrapped token address address");
        feePercent = _feePercent;
        token = _token;
        wToken = _wToken;
        emit Deployed(msg.sender);
    }

    function deposit(uint256 _slippage) public payable nonReentrant whenNotPaused {
        (uint256 fee, uint256 net) = _deductFee(msg.value);
        uint256 halfBnb = net.div(2);
        Amm memory swapAmm = amms[swapAmmId];
        uint256 minOutput = _getMinAmount(halfBnb, _slippage, swapAmm.router, wToken, token);
        uint256 tokenOut = _swapFromBnb(token, swapAmm.router, halfBnb, minOutput, address(this));
        uint256 n = amms.length;
        for (uint256 i = 0; i < n; i++) {
            Amm memory amm = amms[i];
            if (!amm.isActive) continue;
            uint256 numActiveAmms = activeAmms.current();
            uint256 bnbForLiq = halfBnb.div(numActiveAmms);
            uint256 tokenForLiq = tokenOut.div(numActiveAmms);
            _checkApprove(token, amm.router, tokenForLiq);
            (uint256 lpAmount, uint256 excess) = _addLiq(amm.router, bnbForLiq, tokenForLiq);
            _checkApprove(amm.lpToken, amm.farming, lpAmount);
            IFarming(amm.farming).deposit(amm.farmingPId, lpAmount);
            ammBalances[amm.id][msg.sender].user = msg.sender;
            ammBalances[amm.id][msg.sender].ammId = amm.id;
            ammBalances[amm.id][msg.sender].lpAmount = ammBalances[amm.id][msg.sender].lpAmount.add(lpAmount);
            ammBalances[amm.id][msg.sender].excess = ammBalances[amm.id][msg.sender].excess.add(excess);
            ammBalances[amm.id][msg.sender].deposit = ammBalances[amm.id][msg.sender].deposit.add(msg.value);
            userAmms[msg.sender][amm.id] = true;
            emit AmmDeposit(msg.sender, amm.router, amm.farmingPId, bnbForLiq, tokenForLiq, lpAmount, excess);
        }
        emit Deposit(msg.sender, msg.value, fee, halfBnb, tokenOut);
    }

    function withdraw(uint256 _slippage) public nonReentrant whenNotPaused {
        Amm memory swapAmm = amms[swapAmmId];
        uint256 amount;
        for (uint256 i = 0; i < amms.length; i++) {
            Amm memory amm = amms[i];
            if (!userAmms[msg.sender][amm.id]) continue;
            uint256 lpAmount = ammBalances[amm.id][msg.sender].lpAmount;
            uint256 excess = ammBalances[amm.id][msg.sender].excess;
            if (lpAmount == 0) continue;
            uint256 balanceBefore = IERC20(amm.rewardToken).balanceOf(address(this));
            IFarming(amm.farming).withdraw(amm.farmingPId, lpAmount);
            uint256 balanceAfter = IERC20(amm.rewardToken).balanceOf(address(this));
            uint256 rewards = balanceAfter.sub(balanceBefore);
            _checkApprove(amm.lpToken, amm.router, lpAmount);
            (uint256 tokenFromLiq, uint256 bnbFromLiq) = _removeLiq(amm.router, lpAmount);
            _checkApprove(amm.rewardToken, amm.router, rewards);
            uint256 minOutput = _getMinAmount(rewards, _slippage, swapAmm.router, amm.rewardToken, wToken);
            uint256 bnbFromRewards = _swapToBnb(
                amm.rewardToken,
                amm.router,
                rewards,
                minOutput,
                address(this)
            );
            _checkApprove(token, amm.router, tokenFromLiq);
            minOutput = _getMinAmount(tokenFromLiq, _slippage, swapAmm.router, token, wToken);
            uint256 bnbFromToken = _swapToBnb(token, swapAmm.router, tokenFromLiq, minOutput, address(this));
            amount = amount.add(bnbFromRewards.add(bnbFromToken).add(bnbFromLiq).add(excess));
            delete ammBalances[amm.id][msg.sender];
            delete userAmms[msg.sender][amm.id];
            emit AmmWithdraw(
                msg.sender,
                amm.router,
                amm.farmingPId,
                lpAmount,
                bnbFromLiq,
                tokenFromLiq,
                rewards,
                bnbFromToken,
                bnbFromRewards
            );
        }
        payable(msg.sender).transfer(amount);
        emit Withdraw(msg.sender, amount);
    }

    function addAmm(
        address _router,
        address _farming,
        uint256 _farmingPId,
        address _rewardToken
    ) public onlyOwner {
        require(_router.isContract(), "Invalid Router Address");
        require(_farming.isContract(), "Invalid Farming Address");
        require(_rewardToken.isContract(), "Invalid Reward Token Address");
        bool exists = checkExists(_router);
        require(!exists, "Router already exists");
        IFarming.PoolInfo memory poolInfo = IFarming(_farming).poolInfo(_farmingPId);
        address lpFromFarming = poolInfo.lpToken;
        address factory = IUniswapV2Router02(_router).factory();
        address lpFromAmm = IUniswapV2Factory(factory).getPair(token, wToken);
        require(lpFromFarming == lpFromAmm, "LP tokens do not match");
        amms.push(Amm(_router, amms.length, _farming, _farmingPId, _rewardToken, lpFromFarming, true));
        activeAmms.increment();
        emit PoolAdded(_router, _farming, _farmingPId, _rewardToken, lpFromAmm);
    }

    function setAmmStatus(uint256 _ammId, bool _status) public onlyOwner {
        require(amms[_ammId].isActive != _status, "Pool already in this status");
        if (!amms[_ammId].isActive && _status) {
            amms[_ammId].isActive = true;
            activeAmms.increment();
        } else {
            amms[_ammId].isActive = false;
            activeAmms.decrement();
        }
        emit PoolStatusSet(_ammId, _status);
    }

    function collectFees() external onlyOwner {
        payable(owner()).transfer(totalFees);
        emit FeesCollected(totalFees);
        totalFees = 0;
    }

    function recoverERC20(address tokenAddress, uint256 tokenAmount) public nonReentrant onlyOwner {
        IERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    function getEarnedRewards(address _account) public view returns (uint256) {
        uint256 n = amms.length;
        uint256 reward;
        for (uint256 i = 0; i < n; i++) {
            Amm memory amm = amms[i];
            if (!userAmms[_account][amm.id]) continue;
            uint256 first = IFarming(amm.farming).pendingCake(amm.farmingPId, address(this));
            IFarming.UserInfo memory userInfo = IFarming(amm.farming).userInfo(amm.farmingPId, address(this));
            uint256 totLp = userInfo.amount;
            uint256 second = first.mul(ammBalances[amm.id][_account].lpAmount).div(totLp);
            reward = reward.add(_getAmountOut(second, amm.router, amm.rewardToken, wToken));
        }
        return reward;
    }

    function getAmmsLength() public view returns (uint256) {
        return amms.length;
    }

    function getUserDeposit(address _account) public view returns (uint256) {
        uint256 n = amms.length;
        uint256 _deposit;
        for (uint256 i = 0; i < n; i++) {
            Amm memory amm = amms[i];
            if (!userAmms[_account][amm.id]) continue;
            _deposit = _deposit.add(ammBalances[amm.id][_account].deposit);
        }
        return _deposit;
    }

    function _swapFromBnb(
        address _token,
        address _router,
        uint256 _amountIn,
        uint256 _amountOutMin,
        address _to
    ) internal returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = wToken;
        path[1] = _token;
        uint256[] memory amounts = IUniswapV2Router02(_router).swapExactETHForTokens{ value: _amountIn }(
            _amountOutMin,
            path,
            _to,
            block.timestamp
        );
        return amounts[1];
    }

    function _swapToBnb(
        address _token,
        address _router,
        uint256 _amountIn,
        uint256 _amountOutMin,
        address _to
    ) internal returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = _token;
        path[1] = wToken;
        uint256[] memory amounts = IUniswapV2Router02(_router).swapExactTokensForETH(
            _amountIn,
            _amountOutMin,
            path,
            _to,
            block.timestamp
        );
        return amounts[1];
    }

    function _addLiq(
        address _router,
        uint256 _bnbAmount,
        uint256 _tokenAmount
    ) internal returns (uint256 lpAmount, uint256 bnbExcess) {
        uint256 expected = address(this).balance.sub(_bnbAmount);
        (, , lpAmount) = IUniswapV2Router02(_router).addLiquidityETH{ value: _bnbAmount }(
            token,
            _tokenAmount,
            0,
            0,
            address(this),
            block.timestamp
        );
        bnbExcess = address(this).balance.sub(expected);
    }

    function _removeLiq(address _router, uint256 _lpAmount)
        internal
        returns (uint256 tokenAmount, uint256 bnbAmount)
    {
        (tokenAmount, bnbAmount) = IUniswapV2Router02(_router).removeLiquidityETH(
            token,
            _lpAmount,
            0,
            0,
            address(this),
            block.timestamp
        );
    }

    function _checkApprove(
        address _token,
        address _recipient,
        uint256 _amount
    ) internal {
        IERC20 token_ = IERC20(_token);
        if (token_.allowance(address(this), _recipient) < _amount) {
            token_.approve(_recipient, type(uint256).max);
        }
    }

    function _deductFee(uint256 _amount) private returns (uint256 fee, uint256 net) {
        fee = _amount.mul(feePercent).div(1000);
        net = _amount.sub(fee);
        totalFees = totalFees.add(fee);
    }

    function checkExists(address _router) public view onlyOwner returns (bool exists) {
        uint256 n = amms.length;
        for (uint256 i = 0; i < n; i++) {
            if (amms[i].router == _router) return true;
        }
        return false;
    }

    function _getAmountOut(
        uint256 _amountIn,
        address _router,
        address _token,
        address _outToken
    ) internal view returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = _token;
        path[1] = _outToken;
        uint256[] memory amountOut = IUniswapV2Router02(_router).getAmountsOut(_amountIn, path);
        return amountOut[1];
    }

    function _getMinAmount(
        uint256 _amountIn,
        uint256 _slippage,
        address _router,
        address _token,
        address _outToken
    ) internal view returns (uint256) {
        uint256 inputOut = _getAmountOut(_amountIn, _router, _token, _outToken);
        uint256 part = inputOut.mul(_slippage).div(1e18).div(100);
        uint256 minAmount = inputOut.sub(part);
        return minAmount;
    }

    function setSwapAmm(uint256 _id) public onlyOwner {
        require(_id < amms.length);
        swapAmmId = _id;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    receive() external payable {}
}
