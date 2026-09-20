// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {IACPHook} from "./IACPHook.sol";
import {IAgenticCommerce} from "./IAgenticCommerce.sol";

/// @title AgenticCommerce: ERC-8183 job escrow, single ERC-20 (Arc USDC)
/// @notice Port of the EIP-8183 reference implementation (https://eips.ethereum.org/EIPS/eip-8183),
///         the same code Circle deployed on Arc testnet (0x0747EE…4583), kept ABI-identical.
/// @dev Differences from the reference, all deliberate:
///      - Not upgradeable: constructor instead of UUPS/initializer (a hackathon deployment should be
///        immutable and easy to audit).
///      - `setBudget` may be called by the client *or* the provider, as EIP-8183's specification
///        text says (the reference restricts it to the provider). SealedRFQ's adapter is the client
///        and sets each milestone budget itself.
contract AgenticCommerce is IAgenticCommerce, AccessControl, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    IERC20 public immutable token;
    uint256 public platformFeeBP;
    address public platformTreasury;
    uint256 public evaluatorFeeBP;

    mapping(uint256 => Job) internal _jobs;
    uint256 public jobCounter;
    mapping(address => bool) public whitelistedHooks;
    mapping(uint256 jobId => bool hasBudget) public jobHasBudget;

    constructor(address paymentToken_, address treasury_, address admin_) {
        if (paymentToken_ == address(0) || treasury_ == address(0) || admin_ == address(0)) {
            revert ZeroAddress();
        }
        token = IERC20(paymentToken_);
        platformTreasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ADMIN_ROLE, admin_);
        whitelistedHooks[address(0)] = true;
    }

    function paymentToken() external view returns (address) {
        return address(token);
    }

    // ──────────────────── Admin ────────────────────

    function setPlatformFee(uint256 feeBP_, address treasury_) external onlyRole(ADMIN_ROLE) {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (feeBP_ + evaluatorFeeBP > 10000) revert FeesTooHigh();
        platformFeeBP = feeBP_;
        platformTreasury = treasury_;
    }

    function setEvaluatorFee(uint256 feeBP_) external onlyRole(ADMIN_ROLE) {
        if (feeBP_ + platformFeeBP > 10000) revert FeesTooHigh();
        evaluatorFeeBP = feeBP_;
    }

    function setHookWhitelist(address hook, bool status) external onlyRole(ADMIN_ROLE) {
        if (hook == address(0)) revert ZeroAddress();
        whitelistedHooks[hook] = status;
        emit HookWhitelistUpdated(hook, status);
    }

    // ──────────────────── Hook helpers ────────────────────

    function _beforeHook(address hook, uint256 jobId, bytes4 selector, bytes memory data) internal {
        if (hook != address(0)) IACPHook(hook).beforeAction(jobId, selector, data);
    }

    function _afterHook(address hook, uint256 jobId, bytes4 selector, bytes memory data) internal {
        if (hook != address(0)) IACPHook(hook).afterAction(jobId, selector, data);
    }

    // ──────────────────── Job lifecycle ────────────────────

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external nonReentrant returns (uint256) {
        if (evaluator == address(0)) revert ZeroAddress();
        if (expiredAt <= block.timestamp + 5 minutes) revert ExpiryTooShort();
        if (!whitelistedHooks[hook]) revert HookNotWhitelisted();
        if (hook != address(0) && !ERC165Checker.supportsInterface(hook, type(IACPHook).interfaceId)) {
            revert InvalidJob();
        }

        uint256 jobId = ++jobCounter;
        _jobs[jobId] = Job({
            id: jobId,
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            description: description,
            budget: 0,
            expiredAt: expiredAt,
            status: JobStatus.Open,
            hook: hook
        });

        emit JobCreated(jobId, msg.sender, provider, evaluator, expiredAt, hook);
        _afterHook(hook, jobId, msg.sig, abi.encode(msg.sender, provider, evaluator));
        return jobId;
    }

    function setProvider(uint256 jobId, address provider_) external {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.client) revert Unauthorized();
        if (job.provider != address(0)) revert WrongStatus();
        if (provider_ == address(0)) revert ZeroAddress();
        job.provider = provider_;
        emit ProviderSet(jobId, provider_);
    }

    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.client && msg.sender != job.provider) revert Unauthorized();

        bytes memory data = abi.encode(msg.sender, amount, optParams);
        _beforeHook(job.hook, jobId, msg.sig, data);

        job.budget = amount;
        jobHasBudget[jobId] = true;
        emit BudgetSet(jobId, amount);

        _afterHook(job.hook, jobId, msg.sig, data);
    }

    function fund(uint256 jobId, bytes calldata optParams) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.client) revert Unauthorized();
        if (job.provider == address(0)) revert ProviderNotSet();
        if (block.timestamp >= job.expiredAt) revert WrongStatus();

        bytes memory data = abi.encode(msg.sender, optParams);
        _beforeHook(job.hook, jobId, msg.sig, data);

        job.status = JobStatus.Funded;
        if (job.budget > 0) token.safeTransferFrom(job.client, address(this), job.budget);
        emit JobFunded(jobId, job.client, job.budget);

        _afterHook(job.hook, jobId, msg.sig, data);
    }

    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Funded && (job.status != JobStatus.Open || job.budget > 0)) {
            revert WrongStatus();
        }
        if (msg.sender != job.provider) revert Unauthorized();

        bytes memory data = abi.encode(msg.sender, deliverable, optParams);
        _beforeHook(job.hook, jobId, msg.sig, data);

        job.status = JobStatus.Submitted;
        emit JobSubmitted(jobId, job.provider, deliverable);

        _afterHook(job.hook, jobId, msg.sig, data);
    }

    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Submitted) revert WrongStatus();
        if (msg.sender != job.evaluator) revert Unauthorized();

        bytes memory data = abi.encode(msg.sender, reason, optParams);
        _beforeHook(job.hook, jobId, msg.sig, data);

        job.status = JobStatus.Completed;

        uint256 amount = job.budget;
        uint256 platformFee = (amount * platformFeeBP) / 10000;
        uint256 evalFee = (amount * evaluatorFeeBP) / 10000;
        uint256 net = amount - platformFee - evalFee;

        if (platformFee > 0) token.safeTransfer(platformTreasury, platformFee);
        if (evalFee > 0) {
            token.safeTransfer(job.evaluator, evalFee);
            emit EvaluatorFeePaid(jobId, job.evaluator, evalFee);
        }
        if (net > 0) token.safeTransfer(job.provider, net);

        emit JobCompleted(jobId, job.evaluator, reason);
        emit PaymentReleased(jobId, job.provider, net);

        _afterHook(job.hook, jobId, msg.sig, data);
    }

    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert InvalidJob();

        if (job.status == JobStatus.Open) {
            if (msg.sender != job.client) revert Unauthorized();
        } else if (job.status == JobStatus.Funded || job.status == JobStatus.Submitted) {
            if (msg.sender != job.evaluator) revert Unauthorized();
        } else {
            revert WrongStatus();
        }

        bytes memory data = abi.encode(msg.sender, reason, optParams);
        _beforeHook(job.hook, jobId, msg.sig, data);

        JobStatus prev = job.status;
        job.status = JobStatus.Rejected;

        if ((prev == JobStatus.Funded || prev == JobStatus.Submitted) && job.budget > 0) {
            token.safeTransfer(job.client, job.budget);
            emit Refunded(jobId, job.client, job.budget);
        }

        emit JobRejected(jobId, msg.sender, reason);

        _afterHook(job.hook, jobId, msg.sig, data);
    }

    /// @notice Permissionless safety valve; never hooked (EIP-8183).
    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Funded && job.status != JobStatus.Submitted) revert WrongStatus();
        if (block.timestamp < job.expiredAt) revert WrongStatus();

        job.status = JobStatus.Expired;
        if (job.budget > 0) {
            token.safeTransfer(job.client, job.budget);
            emit Refunded(jobId, job.client, job.budget);
        }
        emit JobExpired(jobId);
    }

    // ──────────────────── Views ────────────────────

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    /// @notice Reference-compatible public getter (`jobs(uint256)` in the reference ABI).
    function jobs(uint256 jobId)
        external
        view
        returns (
            uint256 id,
            address client,
            address provider,
            address evaluator,
            string memory description,
            uint256 budget,
            uint256 expiredAt,
            JobStatus status,
            address hook
        )
    {
        Job storage j = _jobs[jobId];
        return
            (j.id, j.client, j.provider, j.evaluator, j.description, j.budget, j.expiredAt, j.status, j.hook);
    }
}
