import { useEffect, useState } from "react";
import { listSessions } from "../lib/api";
import type { Session } from "../lib/api";
import clsx from "clsx";

type Props = {
    activeSessionId?: string;
    onSelect: (id: string) => void;
};

function isToday(date?: string) {
    if (!date) return false;
    const d = new Date(date);
    return d.toDateString() === new Date().toDateString();
}

export default function SessionSidebar({ activeSessionId, onSelect }: Props) {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        listSessions().then(res => {
            if (res.ok) setSessions(res.sessions);
            setLoading(false);
        });
    }, []);

    const today = sessions.filter(s => isToday(s.time));
    const previous = sessions.filter(s => !isToday(s.time));

    return (
        <aside className="w-64 border-r h-screen p-4 overflow-y-auto">
            <h2 className="font-semibold mb-4">Sessions</h2>

            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

            {today.length > 0 && (
                <>
                    <p className="text-xs text-muted-foreground mb-2">Today</p>
                    {today.map(s => (
                        <button
                            key={s.id}
                            onClick={() => onSelect(s.id)}
                            className={clsx(
                                "w-full text-left px-3 py-2 rounded mb-1",
                                activeSessionId === s.id
                                    ? "bg-primary text-primary-foreground"
                                    : "hover:bg-muted"
                            )}
                        >
                            {s.title}
                        </button>
                    ))}
                </>
            )}

            {previous.length > 0 && (
                <>
                    <p className="text-xs text-muted-foreground mt-4 mb-2">Previous</p>
                    {previous.map(s => (
                        <button
                            key={s.id}
                            onClick={() => onSelect(s.id)}
                            className={clsx(
                                "w-full text-left px-3 py-2 rounded mb-1",
                                activeSessionId === s.id
                                    ? "bg-primary text-primary-foreground"
                                    : "hover:bg-muted"
                            )}
                        >
                            {s.title}
                        </button>
                    ))}
                </>
            )}
        </aside>
    );
}
