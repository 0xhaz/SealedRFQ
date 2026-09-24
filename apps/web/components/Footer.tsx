import { chain } from "@/lib/chain";

/**
 * The things a reader needs at the bottom of a page rather than the top.
 *
 * The repository link lives here on purpose. It is essential — every claim this project makes is
 * supposed to be checkable against the code — but it is not what someone reading a tender is
 * looking for, and a link in the header competes with the ones that are. The audit warning sits
 * beside it because anyone about to read the source should know it has not been through one.
 */
export function Footer() {
  return (
    <footer className="foot">
      <div className="foot-warn">
        <b>Unaudited software.</b> These contracts have not been through a security audit. They hold
        escrow, so treat the amounts you commit as amounts you could lose, and read the code before
        trusting it with anything that matters.
      </div>
      <span className="foot-label">
        Running on {chain.name} ·{" "}
        <a href="https://github.com/0xhaz/SealedTender" target="_blank" rel="noreferrer">
          source on GitHub
        </a>
      </span>
    </footer>
  );
}
