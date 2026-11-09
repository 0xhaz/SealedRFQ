// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ConcordiumEpochRegistry} from "../../src/concordium/ConcordiumEpochRegistry.sol";
import {ConcordiumQualifier} from "../../src/concordium/ConcordiumQualifier.sol";
import {Roles} from "../../src/governance/Roles.sol";
import {IRFQRegistry} from "../../src/interfaces/IRFQRegistry.sol";
import {QualifiedRFQRegistryV2} from "../../src/rfq/QualifiedRFQRegistryV2.sol";
import {SealedRFQFixture} from "../utils/SealedRFQFixture.sol";

/// @notice The eligibility gate, from a bidder's side.
///
/// G3 asks for one property above all: a tender that demands a Concordium check must refuse an
/// unqualified bidder **even when the commit is called directly**, bypassing any front end. The
/// gate therefore sits in `_screenBidder`, which both commit entry points reach, and the tests
/// below call the contract rather than any helper.
contract QualifiedRFQRegistryV2Test is SealedRFQFixture {
    QualifiedRFQRegistryV2 internal v2;
    ConcordiumEpochRegistry internal finality;
    ConcordiumQualifier internal qualifier;

    bytes32 blockHash;
    uint64 round;
    uint64 ccdEpoch;
    bytes members;
    bytes signerBits;
    bytes signature;

    function setUp() public override {
        super.setUp();

        string memory qc = vm.readFile("test/fixtures/concordium-qc.json");
        blockHash = vm.parseJsonBytes32(qc, ".blockHash");
        round = uint64(vm.parseJsonUint(qc, ".round"));
        ccdEpoch = uint64(vm.parseJsonUint(qc, ".epoch"));
        members = vm.parseJsonBytes(qc, ".members");
        signerBits = vm.parseJsonBytes(qc, ".signerBits");
        signature = vm.parseJsonBytes(qc, ".signature");
        uint64 eraMs = uint64(vm.parseJsonUint(qc, ".eraGenesisMs"));

        finality = new ConcordiumEpochRegistry(
            vm.parseJsonBytes32(qc, ".genesis"), eraMs, 3_600_000, 24, 2,
            vm.parseJsonBytes(vm.readFile("test/fixtures/bls-concordium.json"), ".negG2Generator"),
            1, admin
        );
        // The chain clock has to sit inside the certificate's own epoch for it to be current.
        vm.warp((uint256(eraMs) + uint256(ccdEpoch) * 3_600_000) / 1000 + 60);
        vm.prank(admin);
        finality.proposeCommittee(
            ccdEpoch / 24,
            vm.parseJsonBytes32(qc, ".membersHash"),
            uint128(vm.parseJsonUint(qc, ".totalStake"))
        );

        qualifier = new ConcordiumQualifier(finality, 1 hours, admin);

        v2 = new QualifiedRFQRegistryV2(IERC20(address(usdc)), policy, attestations, adapter, admin);
        vm.startPrank(admin);
        adapter.grantRole(Roles.REGISTRY, address(v2));
        v2.setQualifierV2(qualifier);
        vm.stopPrank();

        address[4] memory people = [buyer, s1, s2, s3];
        for (uint256 i; i < people.length; ++i) {
            vm.prank(people[i]);
            usdc.approve(address(v2), type(uint256).max);
        }
    }

    function openGatedTender() internal returns (uint256 id) {
        IRFQRegistry.RFQParams memory p = defaultParams();
        // Deadlines are relative to the warped clock, not the fixture's original one.
        p.bidDeadline = uint64(block.timestamp + 1 days);
        p.revealDeadline = uint64(block.timestamp + 2 days);
        p.awardDeadline = uint64(block.timestamp + 3 days);
        vm.prank(buyer);
        id = v2.createRFQ(p);
        vm.prank(buyer);
        v2.requireConcordium(id);
    }

    function qualify(address bidder, uint256 id, bytes32 principal) internal {
        vm.prank(admin);
        qualifier.recordQualification(
            bidder, id, principal, blockHash, round, ccdEpoch, members, signerBits, signature
        );
    }

    function commitTo(uint256 id, address bidder) internal {
        bytes32 h = v2.computeCommitment(id, bidder, 2 * USDC, 7 days, bytes32(0), salt(bidder));
        vm.prank(bidder);
        v2.commitBid(id, h);
    }

    function test_aQualifiedBidderCommits() public {
        uint256 id = openGatedTender();
        qualify(s1, id, keccak256("supplier-one-ltd"));
        commitTo(id, s1);
        assertEq(v2.getBid(id, s1).commitHash != bytes32(0), true);
    }

    /// G3. Called directly, with no front end anywhere in the path.
    function test_anUnqualifiedBidderIsRefusedCallingTheContractDirectly() public {
        uint256 id = openGatedTender();
        bytes32 h = v2.computeCommitment(id, s2, 2 * USDC, 7 days, bytes32(0), salt(s2));
        vm.prank(s2);
        vm.expectRevert(
            abi.encodeWithSelector(ConcordiumQualifier.NotQualified.selector, s2, id)
        );
        v2.commitBid(id, h);
    }

    /// Qualification is per tender: one does not carry to the next.
    function test_qualifyingForOneTenderDoesNotQualifyForAnother() public {
        uint256 first = openGatedTender();
        uint256 second = openGatedTender();
        qualify(s1, first, keccak256("supplier-one-ltd"));
        commitTo(first, s1);

        bytes32 h = v2.computeCommitment(second, s1, 2 * USDC, 7 days, bytes32(0), salt(s1));
        vm.prank(s1);
        vm.expectRevert(
            abi.encodeWithSelector(ConcordiumQualifier.NotQualified.selector, s1, second)
        );
        v2.commitBid(second, h);
    }

    function test_aLapsedQualificationStopsWorking() public {
        uint256 id = openGatedTender();
        qualify(s1, id, keccak256("supplier-one-ltd"));
        vm.warp(block.timestamp + 2 hours);
        bytes32 h = v2.computeCommitment(id, s1, 2 * USDC, 7 days, bytes32(0), salt(s1));
        vm.prank(s1);
        vm.expectRevert();
        v2.commitBid(id, h);
    }

    /// A tender that does not ask for a check behaves exactly as V1 did.
    function test_anUngatedTenderIsUnaffected() public {
        IRFQRegistry.RFQParams memory p = defaultParams();
        p.bidDeadline = uint64(block.timestamp + 1 days);
        p.revealDeadline = uint64(block.timestamp + 2 days);
        p.awardDeadline = uint64(block.timestamp + 3 days);
        vm.prank(buyer);
        uint256 id = v2.createRFQ(p);
        commitTo(id, s2);
        assertTrue(v2.getBid(id, s2).commitHash != bytes32(0));
    }

    /// Fails closed: a tender demanding a check nobody can perform takes no bids.
    function test_aGatedTenderWithNoQualifierTakesNoBids() public {
        vm.prank(admin);
        v2.setQualifierV2(ConcordiumQualifier(address(0)));
        uint256 id = openGatedTender();
        bytes32 h = v2.computeCommitment(id, s1, 2 * USDC, 7 days, bytes32(0), salt(s1));
        vm.prank(s1);
        vm.expectRevert(QualifiedRFQRegistryV2.ConcordiumQualifierNotSet.selector);
        v2.commitBid(id, h);
    }

    /// The override must add to V1's screening, not replace it.
    function test_theBuyerStillCannotBidOnItsOwnTender() public {
        uint256 id = openGatedTender();
        qualify(buyer, id, keccak256("northwind"));
        bytes32 h = v2.computeCommitment(id, buyer, 2 * USDC, 7 days, bytes32(0), salt(buyer));
        vm.prank(buyer);
        vm.expectRevert();
        v2.commitBid(id, h);
    }

    /// Only the buyer decides that a tender needs verified suppliers.
    function test_aStrangerCannotGateSomeoneElsesTender() public {
        IRFQRegistry.RFQParams memory p = defaultParams();
        p.bidDeadline = uint64(block.timestamp + 1 days);
        p.revealDeadline = uint64(block.timestamp + 2 days);
        p.awardDeadline = uint64(block.timestamp + 3 days);
        vm.prank(buyer);
        uint256 id = v2.createRFQ(p);
        vm.prank(stranger);
        vm.expectRevert();
        v2.requireConcordium(id);
    }
}
