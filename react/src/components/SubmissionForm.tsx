import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';

type Props = {
  disabled: boolean;
  onSubmit: (repoUrl: string, video: File | null) => void;
  errorMessage?: string | null;
};

const MAX_VIDEO_BYTES = 150 * 1024 * 1024; // 150MB — matches intake's multer cap.

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SubmissionForm({ disabled, onSubmit, errorMessage }: Props) {
  const [value, setValue] = useState('');
  const [video, setVideo] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > MAX_VIDEO_BYTES) {
      // Mirror the server cap client-side so the user isn't surprised by a 413
      // after a long upload. Intake still enforces it authoritatively.
      setFileError(`Video exceeds the 150MB cap (${formatBytes(file.size)}).`);
      setVideo(null);
      return;
    }
    setFileError(null);
    setVideo(file);
  }

  function clearFile() {
    setVideo(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed, video);
  }

  return (
    <section className="submission-form">
      <div className="submission-form__heading">
        <h2 className="submission-form__title">Run the panel</h2>
        <p className="submission-form__lede">
          Paste a public GitHub repository. Three judges will score it independently and the
          results will appear below. Optionally attach a demo video for a fourth, multimodal
          review.
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

      <div className="submission-form__video">
        <label className="submission-form__video-label">
          <span className="submission-form__video-trigger">
            {video ? 'Change video' : 'Attach demo video (optional)'}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            className="submission-form__video-input"
            accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime"
            onChange={handleFileChange}
            disabled={disabled}
          />
        </label>
        {video ? (
          <span className="submission-form__video-selected">
            <span className="submission-form__video-name" title={video.name}>
              {video.name}
            </span>
            <span className="submission-form__video-size">{formatBytes(video.size)}</span>
            <button
              type="button"
              className="submission-form__video-clear"
              onClick={clearFile}
              disabled={disabled}
              aria-label="Remove selected video"
            >
              ×
            </button>
          </span>
        ) : (
          <span className="submission-form__video-hint">mp4 / webm / mov · 150MB max</span>
        )}
      </div>
      {video ? (
        <p className="submission-form__video-note">
          Heads up: with a video, the submission transcodes and uploads to Filecoin inside the
          request — expect the run to take roughly 4–5 minutes before results appear.
        </p>
      ) : null}

      {fileError ? <p className="submission-form__error">{fileError}</p> : null}
      {errorMessage ? <p className="submission-form__error">{errorMessage}</p> : null}
    </section>
  );
}
