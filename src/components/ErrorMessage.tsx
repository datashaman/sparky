import { useState } from "react";

interface Props {
  message: string;
  className?: string;
}

export function ErrorMessage({ message, className = "" }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback ignored
    }
  }

  return (
    <div className={`error-message ${className}`.trim()}>
      <p className="error-message-text">{message}</p>
      <button
        type="button"
        onClick={handleCopy}
        className="error-copy-btn"
        title="Copy error"
        aria-label="Copy error message"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
