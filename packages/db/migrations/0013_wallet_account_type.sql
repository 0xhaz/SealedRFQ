-- Record what kind of account a linked wallet was verified as.
--
-- An externally owned account proves control by an ECDSA signature; a smart-contract account such
-- as a Safe proves it by answering EIP-1271 from inside the contract. Those are different facts
-- with different failure modes, so the link keeps which one was actually checked at link time.
-- It is stored rather than re-derived later because a contract's code can change after the fact
-- (an upgradeable account, a delegated EOA), and the link should say what was true when it was
-- accepted.
--
-- Existing rows are EOAs: wallet login, the only way they were created, was ECDSA-only.
--
-- No grant change. 0011 granted SELECT, INSERT on the whole table, not on a column list, so the
-- new column is readable and insertable by sealedrfq_app already; nothing is added, and UPDATE
-- stays withheld, so the type cannot be rewritten after the fact by the application.
ALTER TABLE wallet_links
  ADD COLUMN account_type text NOT NULL DEFAULT 'eoa'
  CHECK (account_type IN ('eoa', 'contract'));
