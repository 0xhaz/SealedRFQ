-- Record what kind of account a linked wallet was reported to be.
--
-- An externally owned account proves control by an ECDSA signature; a smart-contract account such
-- as a Safe proves it by answering EIP-1271 from inside the contract. Those are different facts
-- with different failure modes, so the link keeps which one was checked at link time. It is stored
-- rather than re-derived later because a contract's code can change after the fact (an upgradeable
-- account, a delegated EOA).
--
-- This is caller-asserted, not enforced: linkWallet stores what it is given (default 'eoa') and
-- the database cannot check it, so a caller could record 'contract' for an EOA. The single
-- intended caller passes verifyWalletSignature's accountType straight through, and the CHECK only
-- bounds the values.
--
-- Existing rows are EOAs: wallet login, the only way they were created, was ECDSA-only.
--
-- No grant change. 0011 granted SELECT, INSERT on the whole table, not on a column list, so the
-- new column is readable and insertable by sealedrfq_app already; nothing is added, and UPDATE
-- stays withheld, so the type cannot be rewritten after the fact by the application.
ALTER TABLE wallet_links
  ADD COLUMN account_type text NOT NULL DEFAULT 'eoa'
  CHECK (account_type IN ('eoa', 'contract'));
