import Link from 'next/link';
export default function NotFound() {
    return (<main id="main" style={{ maxWidth: '32rem', margin: '0 auto', padding: '6rem 1.5rem' }}>
      <p className="label">Error 404</p>
      <h1 style={{ marginTop: '0.5rem' }}>That page does not exist</h1>
      <p className="muted" style={{ marginTop: '0.75rem' }}>
        The link may be out of date, or the record may have been moved. If you reached this from
        inside the portal, please tell the Secretary so it can be corrected.
      </p>
      <p style={{ marginTop: '1.5rem' }}>
        <Link className="btn btnPrimary" href="/portal">Back to the portal</Link>
      </p>
    </main>);
}
