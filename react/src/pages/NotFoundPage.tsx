import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="not-found">
      <h2>Not found</h2>
      <p>That page doesn't exist.</p>
      <Link to="/" className="not-found__link">Back to dashboard</Link>
    </div>
  );
}
