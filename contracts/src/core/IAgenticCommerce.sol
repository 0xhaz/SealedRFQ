// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.28;

/// @title IAgenticCommerce: ERC-8183 job escrow
/// @notice ABI-compatible with the ERC-8183 reference implementation deployed on Arc testnet
///         (proxy 0x0747EEf0706327138c69792bF28Cd525089e4583, impl "AgenticCommerce"), so Arc
///         tooling and explorers decode SealedRFQ's instance the same way.
///         Lifecycle: Open -> Funded -> Submitted -> Completed | Rejected | Expired.
interface IAgenticCommerce {
    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        JobStatus status;
        address hook;
    }

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        uint256 expiredAt,
        address hook
    );
    event ProviderSet(uint256 indexed jobId, address indexed provider);
    event BudgetSet(uint256 indexed jobId, uint256 amount);
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable);
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    event JobExpired(uint256 indexed jobId);
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event EvaluatorFeePaid(uint256 indexed jobId, address indexed evaluator, uint256 amount);
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event HookWhitelistUpdated(address indexed hook, bool status);

    error InvalidJob();
    error WrongStatus();
    error Unauthorized();
    error ZeroAddress();
    error ExpiryTooShort();
    error ZeroBudget();
    error ProviderNotSet();
    error FeesTooHigh();
    error HookNotWhitelisted();

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 jobId);

    function setProvider(uint256 jobId, address provider) external;

    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external;

    function fund(uint256 jobId, bytes calldata optParams) external;

    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external;

    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external;

    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external;

    function claimRefund(uint256 jobId) external;

    function getJob(uint256 jobId) external view returns (Job memory);

    function paymentToken() external view returns (address);
}
