import Link from 'next/link'

export default function HomePage(): React.ReactElement {
  return (
    <div className="card">
      <p className="wordmark">Kairo</p>
      <h1>Scripture on the wall, without the scramble</h1>
      <p className="lead">
        Kairo listens to the sermon, finds the passage, and puts it on screen through
        ProPresenter. Create an account to share your setup with the rest of your team.
      </p>
      <Link href="/signup">
        <button className="primary" type="button">Create an account</button>
      </Link>
      <button className="link" type="button">
        <Link href="/login">I already have one</Link>
      </button>
    </div>
  )
}
