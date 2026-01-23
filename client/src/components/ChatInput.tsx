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
    <div className="flex w-full gap-2">
      <div className="flex items-center gap-2 rounded-xl border border-white/40 bg-[#303030] px-2 py-2 shadow-sm focus-within:border-white focus-within:ring-1 focus-within:ring-white flex-1">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as Level)}
          className="h-9 rounded-lg border border-white/40 bg-[#212121] px-2 text-sm font-medium text-white focus:border-white focus:outline-none focus:ring-1 focus:ring-white"
          disabled={disabled}
          aria-label="Explanation level"
        >
          {levels.map((opt) => (
            <option key={opt} value={opt} className="bg-[#212121] text-white">
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
          className="flex-1 resize-none bg-transparent text-sm text-white placeholder:text-white/60 focus:outline-none"
          placeholder={placeholder ?? "Ask a question or request a quiz..."}
          aria-label="Chat input"
          disabled={disabled}
        />
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={disabled || text.trim().length === 0}
        className="h-11 rounded-xl px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed bg-[#212121] border border-white hover:bg-[#303030]"
      >
        Send
      </button>
    </div>
  );
}

export default ChatInput;
