import { useState, type FormEvent } from 'react';

type Props = {
  disabled: boolean;
  onSubmit: (repoUrl: string) => void;
  errorMessage?: string | null;
};

export function SubmissionForm({ disabled, onSubmit, errorMessage }: Props) {
  const [value, setValue] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <section className="submission-form">
      <div className="submission-form__heading">
        <h2 className="submission-form__title">Run the panel</h2>
        <p className="submission-form__lede">
          Paste a public GitHub repository. Three judges will score it independently and the
          results will appear below.
        </p>
      </div>
      <form className="submission-form__form" onSubmit={handleSubmit}>
        <input
          type="url"
          className="submission-form__input"
          placeholder="https://github.com/owner/repo"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          required
        />
        <button type="submit" className="submission-form__button" disabled={disabled || !value.trim()}>
          {disabled ? 'Running…' : 'Run Panel'}
        </button>
      </form>
      {errorMessage ? <p className="submission-form__error">{errorMessage}</p> : null}
    </section>
  );
}
