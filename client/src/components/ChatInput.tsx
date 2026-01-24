import { useEffect, useRef, useState } from "react";

type Level = "ELI5" | "ELI15" | "EXAM";

export interface ChatInputValue {
  text: string;
  level: Level;
}

interface ChatInputProps {
  disabled?: boolean;
  placeholder?: string;
  onSend: (value: ChatInputValue) => void;
}

const levels: Level[] = ["ELI5", "ELI15", "EXAM"];

export function ChatInput({ disabled, placeholder, onSend }: ChatInputProps) {
  const [text, setText] = useState("");
  const [level, setLevel] = useState<Level>("ELI5");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend({ text: trimmed, level });
    setText("");
  }

  return (
    <div className="flex w-full gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-[#1e293b] bg-[#020617] px-3 py-2 shadow-[0_8px_22px_rgba(0,0,0,0.32)] focus-within:border-[#38bdf8] focus-within:ring-2 focus-within:ring-[#38bdf8]/60 flex-1 transition">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as Level)}
          className="h-10 rounded-lg border border-[#1e293b] bg-[#0f172a] px-3 text-sm font-semibold text-[#e5e7eb] focus:border-[#38bdf8] focus:outline-none focus:ring-2 focus:ring-[#38bdf8]/60"
          disabled={disabled}
          aria-label="Explanation level"
        >
          {levels.map((opt) => (
            <option
              key={opt}
              value={opt}
              className="bg-[#0f172a] text-[#e5e7eb]"
            >
              {opt}
            </option>
          ))}
        </select>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          className="flex-1 resize-none bg-transparent text-[15px] text-[#e5e7eb] placeholder:text-[#9ca3af] focus:outline-none"
          placeholder={placeholder ?? "Ask a question or request a quiz..."}
          aria-label="Chat input"
          disabled={disabled}
        />
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={disabled || text.trim().length === 0}
        className="h-11 rounded-xl px-4 text-sm font-semibold text-[#020617] shadow-[0_10px_24px_rgba(56,189,248,0.22)] disabled:opacity-60 disabled:cursor-not-allowed bg-[#38bdf8] border border-[#38bdf8] hover:bg-[#5cc9ff] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#38bdf8]"
      >
        Send
      </button>
    </div>
  );
}

export default ChatInput;
