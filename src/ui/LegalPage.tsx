import { ParentLockup } from './ParentLockup';
import { LegalNotice } from './LegalNotice';
import './legal.css';

/** The /legal page: a statement, not a contract. There is no assent flow and
 *  no consent banner, so this renders fixed copy and nothing interactive
 *  beyond links. The copy is the approved notice text and is reproduced
 *  verbatim; edit the wording only as a deliberate revision and bump the
 *  "Last updated" line with it.
 *
 *  The Privacy section describes the CURRENT state: zero automatic requests
 *  to any external origin, no cookies, no storage of anything about the
 *  visitor. Any change that adds a network call (the board counter, an
 *  analytics beacon) has to replace that section in the same commit. The
 *  replacement text is filed in DECISIONS.md as a pending amendment. */

const REPO_URL = 'https://github.com/NTBLabs/catan-lab';

export function LegalPage() {
  return (
    <div className="legal">
      <header className="legal__header">
        <ParentLockup
          productName="CATAN LAB"
          color="var(--catan-gold)"
          parentColor="#ffffff"
          className="legal__title"
        />
        <a className="legal__back" href={import.meta.env.BASE_URL}>
          Back to the generator
        </a>
      </header>

      <main className="legal__card">
        <h1>Legal and IP Notice</h1>
        <p className="legal__updated">Last updated: September 2026</p>

        <h2>What Catan Lab is</h2>
        <p>
          Catan Lab is a browser tool that generates board layouts for the
          board game Catan. It is an independent fan project built and
          maintained by NTB Labs. It is provided free of charge and requires
          no account.
        </p>

        <h2>No affiliation</h2>
        <p>
          Catan Lab is not affiliated with, endorsed by, sponsored by, licensed
          by, or otherwise connected to CATAN GmbH, Catan Studio, Asmodee,
          Kosmos, or any of their subsidiaries, parents, or licensees.
        </p>

        <h2>Trademarks</h2>
        <p>
          CATAN® and CATAN - Seafarers® are trademarks of CATAN GmbH. All
          rights reserved. Catan Lab uses the name only to identify the game
          whose board layouts it generates, which is the minimum necessary to
          describe what the tool does. Catan Lab does not use the stylized
          CATAN logo or any official artwork.
        </p>

        <h2>Original artwork</h2>
        <p>
          Every visual element in Catan Lab is original work created for this
          project or used under a permissive open-source license. That includes
          the hex shapes, terrain colors and patterns, number token styling,
          port markers, icons, typography, and page layout. Catan Lab does not
          host, reproduce, or redistribute any artwork, illustrations, fonts,
          logos, packaging design, or rulebook text created by CATAN GmbH or
          its licensees.
        </p>
        <p>
          Catan Lab's visual design uses colors and typographic conventions
          common to the game's physical components so that generated boards are
          readable against a real set. It is not intended to be mistaken for an
          official product.
        </p>
        <p>
          Third-party icon assets embedded in the project are listed in{' '}
          <a href={`${REPO_URL}/blob/main/THIRD-PARTY.md`}>THIRD-PARTY.md</a> in
          the source repository.
        </p>

        <h2>Game rules and mechanics</h2>
        <p>
          The mechanics of a board game, meaning things like hex-based resource
          collection, dice probability, number token distribution, and turn
          order, are functional rules rather than expressive works. Catan Lab
          implements those mechanics for analytical and recreational purposes
          on that basis. Where rules are referenced, they are described in
          original wording. No rulebook text is reproduced.
        </p>

        <h2>Scope</h2>
        <p>
          Catan Lab supports the base game and the 5-6 player expansion. It
          does not support Seafarers, Cities &amp; Knights, or Traders &amp;
          Barbarians. Generated boards may not match every edge case in the
          official rules, and Catan Lab is not a substitute for the published
          rulebook.
        </p>

        <h2>Using Catan Lab</h2>
        <p>
          Boards generated with Catan Lab may be used for any purpose,
          commercial or otherwise, including game nights, clubs, tournaments,
          streams, and videos. No attribution is required.
        </p>
        <p>
          The site itself may not be republished, scraped at a volume that
          degrades it for other users, or rebuilt from its output as a
          competing service. The source code is public under the MIT license,
          which permits building on the code.
        </p>

        <h2>Source code</h2>
        <p>
          Catan Lab is open source under the MIT license. The repository is at{' '}
          <a href={REPO_URL}>github.com/NTBLabs/catan-lab</a>.
        </p>

        <h2>Links to other sites</h2>
        <p>
          The share buttons pass a board link to WhatsApp, Reddit, Telegram, or
          your email client only when you click one. These third-party services
          are not controlled by NTB Labs and are subject to their own terms and
          privacy practices. The site also links to GitHub and to{' '}
          <a href="https://ntblabs.dev">ntblabs.dev</a>.
        </p>

        <h2>Rights-holder requests</h2>
        <p>
          If you represent CATAN GmbH, Catan Studio, or another rights holder
          and believe any part of Catan Lab exceeds fair use or infringes your
          rights, email{' '}
          <a href="mailto:legal@ntblabs.dev">legal@ntblabs.dev</a>. Good-faith
          requests will be reviewed promptly and the contested element modified
          or removed where the request is well-founded.
        </p>

        <h2>Privacy</h2>
        <p>
          Catan Lab runs entirely in your browser. There is no account and no
          login, no data is transmitted to any server, and no cookies are set.
          Board configurations are encoded in the share URL itself, so a link
          you share contains the board and nothing about you.
        </p>
        <p>
          No personal information is collected from anyone using this site,
          regardless of age.
        </p>

        <h2>No warranty</h2>
        <p>
          Catan Lab is provided as is, without warranty of any kind. It may be
          changed or taken offline at any time. To the fullest extent permitted
          by law, NTB Labs is not liable for any damages arising from use of or
          inability to use the tool.
        </p>

        <h2>Contact</h2>
        <p className="legal__contact">
          General questions and feedback:{' '}
          <a href="mailto:nathan@ntblabs.dev">nathan@ntblabs.dev</a>
        </p>
        <p className="legal__contact">
          Rights-holder and legal matters:{' '}
          <a href="mailto:legal@ntblabs.dev">legal@ntblabs.dev</a>
        </p>

        <h2>Changes</h2>
        <p>
          This notice may be revised. The date above reflects the most recent
          revision.
        </p>

        <footer className="legal__footer">
          <LegalNotice unlinked />
        </footer>
      </main>
    </div>
  );
}
