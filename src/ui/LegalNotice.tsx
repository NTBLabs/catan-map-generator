import './legalNotice.css';

export interface LegalNoticeProps {
  /** Drop the "Legal and IP notice" link. Only /legal passes this: a link
   *  from the notice page to itself is noise. Everywhere else the link is
   *  the point. */
  unlinked?: boolean;
}

/** Site-wide trademark and non-affiliation line, rendered on every page
 *  (the drawer footer in the app, the card footer on /legal). The wording is fixed
 *  copy from the legal notice; change it there and here together or not at
 *  all. Deliberately small and low emphasis: it is a disclosure, not a call
 *  to action. */
export function LegalNotice({ unlinked = false }: LegalNoticeProps) {
  return (
    <p className="legal-notice">
      CATAN® is a trademark of CATAN GmbH. Catan Lab is an unofficial fan tool
      with original artwork and is not affiliated with or endorsed by CATAN
      GmbH or Catan Studio.
      {!unlinked && (
        <>
          {' '}
          {/* BASE_URL-relative so the link survives a move back to a Pages
              project subpath (see the base comment in vite.config.ts). */}
          <a className="legal-notice__link" href={`${import.meta.env.BASE_URL}legal`}>
            Legal and IP notice
          </a>
        </>
      )}
    </p>
  );
}
